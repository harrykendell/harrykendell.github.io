const SESSION_COOKIE_NAME = "gha_session";
const OAUTH_COOKIE_NAME = "gha_oauth";
const SESSION_HEADER_NAME = "X-GHA-Session";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const SESSION_EXCHANGE_MAX_AGE_SECONDS = 60 * 2;
const OAUTH_MAX_AGE_SECONDS = 60 * 10;
const REPO_STATUS_MIN_POLL_MS = 10 * 1000;
const REPO_STATUS_REQUEST_TIMEOUT_MS = 7 * 1000;

const DEFAULT_ALLOWED_ORIGINS = [
    "https://kendell.uk",
    "https://www.kendell.uk",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
];

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const hmacKeyCache = new Map();
const repoStatusCache = new Map();
const repoStatusInFlight = new Map();

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const corsHeaders = resolveCorsHeaders(request, env);

        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: buildPreflightHeaders(corsHeaders),
            });
        }

        try {
            if (url.pathname === "/" && request.method === "GET") {
                return jsonResponse({
                    ok: true,
                    service: "github-auth-worker",
                    routes: [
                        "GET /auth/login",
                        "GET /auth/callback",
                        "GET /api/session",
                        "POST /api/session/exchange",
                        "GET /api/repo-status",
                        "GET /api/file-history",
                        "GET /api/file-content",
                        "POST /api/logout",
                        "POST /api/submit",
                    ],
                }, 200, corsHeaders);
            }

            if (url.pathname === "/auth/login" && request.method === "GET") {
                return handleAuthLogin(request, env);
            }

            if (url.pathname === "/auth/callback" && request.method === "GET") {
                return handleAuthCallback(request, env);
            }

            if (url.pathname === "/api/session" && request.method === "GET") {
                return handleApiSession(request, env, corsHeaders);
            }

            if (url.pathname === "/api/session/exchange" && request.method === "POST") {
                return handleApiSessionExchange(request, env, corsHeaders);
            }

            if (url.pathname === "/api/repo-status" && request.method === "GET") {
                return handleApiRepoStatus(request, env, corsHeaders);
            }

            if (url.pathname === "/api/file-history" && request.method === "GET") {
                return handleApiFileHistory(request, env, corsHeaders);
            }

            if (url.pathname === "/api/file-content" && request.method === "GET") {
                return handleApiFileContent(request, env, corsHeaders);
            }

            if (url.pathname === "/api/logout" && request.method === "POST") {
                return handleApiLogout(request, env, corsHeaders);
            }

            if (url.pathname === "/api/submit" && request.method === "POST") {
                return handleApiSubmit(request, env, corsHeaders);
            }

            return jsonResponse({ error: "Not found." }, 404, corsHeaders);
        } catch (error) {
            const message = error && error.message ? error.message : "Unexpected worker error.";
            return jsonResponse({ error: message }, 500, corsHeaders);
        }
    },
};

async function handleAuthLogin(request, env) {
    const clientId = mustGetEnv(env, "GITHUB_CLIENT_ID");
    const sessionSecret = mustGetEnv(env, "SESSION_SECRET");

    const requestUrl = new URL(request.url);
    const requestedOrigin = requestUrl.searchParams.get("origin");
    const allowedOrigin = chooseAllowedOrigin(requestedOrigin, env)
        || requestUrl.origin;
    const returnTo = sanitizeReturnTo(requestUrl.searchParams.get("return_to"), allowedOrigin);
    const mode = requestUrl.searchParams.get("mode") === "popup" ? "popup" : "redirect";

    const state = randomToken(24);
    const codeVerifier = randomToken(48);
    const codeChallenge = await pkceChallengeFromVerifier(codeVerifier);

    const oauthPayload = {
        state,
        codeVerifier,
        mode,
        origin: allowedOrigin,
        returnTo,
        createdAt: Date.now(),
    };
    const signedOauthPayload = await encodeSignedPayload(oauthPayload, sessionSecret);

    const redirectUri = getRedirectUri(request, env);
    const scope = env.GITHUB_SCOPES || "read:user public_repo";

    const githubAuthorizeUrl = new URL("https://github.com/login/oauth/authorize");
    githubAuthorizeUrl.searchParams.set("client_id", clientId);
    githubAuthorizeUrl.searchParams.set("redirect_uri", redirectUri);
    githubAuthorizeUrl.searchParams.set("scope", scope);
    githubAuthorizeUrl.searchParams.set("state", state);
    githubAuthorizeUrl.searchParams.set("code_challenge", codeChallenge);
    githubAuthorizeUrl.searchParams.set("code_challenge_method", "S256");

    return buildRedirectResponse(
        githubAuthorizeUrl.toString(),
        302,
        {
            "Cache-Control": "no-store",
        },
        [
            serializeCookie(
                OAUTH_COOKIE_NAME,
                signedOauthPayload,
                oauthCookieOptionsForRequest(env, {
                    maxAge: OAUTH_MAX_AGE_SECONDS,
                }),
            ),
        ],
    );
}

async function handleAuthCallback(request, env) {
    const clientId = mustGetEnv(env, "GITHUB_CLIENT_ID");
    const clientSecret = mustGetEnv(env, "GITHUB_CLIENT_SECRET");
    const sessionSecret = mustGetEnv(env, "SESSION_SECRET");

    const requestUrl = new URL(request.url);
    const cookies = parseCookies(request.headers.get("Cookie"));
    const signedOauthPayload = cookies[OAUTH_COOKIE_NAME];
    const oauthPayload = await decodeSignedPayload(signedOauthPayload, sessionSecret);

    const oauthError = requestUrl.searchParams.get("error");
    if (oauthError) {
        const description = requestUrl.searchParams.get("error_description") || "GitHub OAuth denied.";
        return popupOrRedirectError(request, env, description, oauthPayload);
    }

    const code = requestUrl.searchParams.get("code");
    const returnedState = requestUrl.searchParams.get("state");
    if (!code || !returnedState) {
        return popupOrRedirectError(request, env, "Missing OAuth code or state.", oauthPayload);
    }

    if (!oauthPayload || !oauthPayload.state || !oauthPayload.codeVerifier) {
        return popupOrRedirectError(request, env, "OAuth session expired. Please try again.", null);
    }

    if (!safeStringEqual(oauthPayload.state, returnedState)) {
        return popupOrRedirectError(request, env, "OAuth state mismatch.", oauthPayload);
    }

    if (Date.now() - Number(oauthPayload.createdAt || 0) > OAUTH_MAX_AGE_SECONDS * 1000) {
        return popupOrRedirectError(request, env, "OAuth request timed out. Please try again.", oauthPayload);
    }

    const tokenResponse = await exchangeCodeForAccessToken({
        code,
        codeVerifier: oauthPayload.codeVerifier,
        redirectUri: getRedirectUri(request, env),
        clientId,
        clientSecret,
    });

    if (!tokenResponse || !tokenResponse.access_token) {
        return popupOrRedirectError(request, env, "GitHub did not return an access token.", oauthPayload);
    }

    const token = tokenResponse.access_token;
    const githubUser = await githubApiRequest("/user", { token });

    const sessionPayload = {
        token,
        scope: tokenResponse.scope || "",
        createdAt: Date.now(),
        user: {
            login: githubUser.login || "",
            name: githubUser.name || "",
            avatarUrl: githubUser.avatar_url || "",
            htmlUrl: githubUser.html_url || "",
        },
    };

    const signedSessionPayload = await encodeSignedPayload(sessionPayload, sessionSecret);
    const sessionExchangeToken = await encodeSignedPayload(
        {
            createdAt: Date.now(),
            origin: oauthPayload.origin || "",
            signedSessionPayload,
        },
        sessionSecret,
    );

    if (oauthPayload.mode === "popup") {
        const html = buildPopupCompletionHtml(
            true,
            "Authentication complete. You can close this window.",
            oauthPayload.origin,
            {
                sessionExchangeToken,
            },
        );
        const response = new Response(html, {
            status: 200,
            headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store",
            },
        });
        response.headers.append(
            "Set-Cookie",
            serializeCookie(
                OAUTH_COOKIE_NAME,
                "",
                oauthCookieOptionsForRequest(env, {
                    maxAge: 0,
                }),
            ),
        );

        return response;
    }

    const redirectTarget = sanitizeReturnTo(
        oauthPayload.returnTo,
        chooseAllowedOrigin(oauthPayload.origin, env) || requestUrl.origin,
    );

    return buildRedirectResponse(
        redirectTarget,
        302,
        {
            "Cache-Control": "no-store",
        },
        [
            serializeCookie(
                SESSION_COOKIE_NAME,
                signedSessionPayload,
                cookieOptionsForRequest(env, {
                    maxAge: SESSION_MAX_AGE_SECONDS,
                }),
            ),
            serializeCookie(
                OAUTH_COOKIE_NAME,
                "",
                oauthCookieOptionsForRequest(env, {
                    maxAge: 0,
                }),
            ),
        ],
    );
}

async function handleApiSession(request, env, corsHeaders) {
    const session = await readSession(request, env);
    if (!session) {
        return jsonResponse(
            {
                authenticated: false,
                error: "No active session.",
                hint: buildMissingSessionHint(request),
            },
            401,
            corsHeaders,
        );
    }

    const url = new URL(request.url);
    const owner = normalizeRepoOwner(url.searchParams.get("owner"));
    const repo = normalizeRepoName(url.searchParams.get("repo"));

    let repoAccess = null;
    if (owner && repo) {
        try {
            repoAccess = await getRepoAccessForUser(session.token, owner, repo);
        } catch (error) {
            if (error.status === 401) {
                const response = jsonResponse({ authenticated: false, error: "GitHub session expired." }, 401, corsHeaders);
                clearSessionCookie(response, env);
                return response;
            }
            throw error;
        }
    }

    return jsonResponse({
        authenticated: true,
        user: {
            login: session.user && session.user.login ? session.user.login : "",
            name: session.user && session.user.name ? session.user.name : "",
            avatarUrl: session.user && session.user.avatarUrl ? session.user.avatarUrl : "",
            htmlUrl: session.user && session.user.htmlUrl ? session.user.htmlUrl : "",
        },
        accessTokenScope: session.scope || "",
        repoAccess,
    }, 200, corsHeaders);
}

async function handleApiSessionExchange(request, env, corsHeaders) {
    const sessionSecret = mustGetEnv(env, "SESSION_SECRET");

    let body;
    try {
        body = await request.json();
    } catch (error) {
        return jsonResponse({ error: "Request body must be valid JSON." }, 400, corsHeaders);
    }

    const token = body && typeof body.token === "string" ? body.token : "";
    if (!token) {
        return jsonResponse({ error: "token is required." }, 400, corsHeaders);
    }

    const exchangePayload = await decodeSignedPayload(token, sessionSecret);
    if (
        !exchangePayload
        || typeof exchangePayload !== "object"
        || typeof exchangePayload.signedSessionPayload !== "string"
    ) {
        return jsonResponse({ error: "Invalid session exchange token." }, 401, corsHeaders);
    }

    const createdAt = Number(exchangePayload.createdAt || 0);
    if (!createdAt || Date.now() - createdAt > SESSION_EXCHANGE_MAX_AGE_SECONDS * 1000) {
        return jsonResponse({ error: "Session exchange token expired. Please sign in again." }, 401, corsHeaders);
    }

    const requestOrigin = normalizeOrigin(request.headers.get("Origin"));
    const expectedOrigin = chooseAllowedOrigin(exchangePayload.origin, env);
    if (requestOrigin && expectedOrigin && requestOrigin !== expectedOrigin) {
        return jsonResponse({ error: "Session exchange origin mismatch." }, 403, corsHeaders);
    }

    const signedSessionPayload = exchangePayload.signedSessionPayload;
    if (!await decodeSessionPayloadIfValid(signedSessionPayload, sessionSecret)) {
        return jsonResponse({ error: "Session exchange payload is invalid or expired." }, 401, corsHeaders);
    }

    const responseBody = { ok: true };
    if (isLoopbackOrigin(requestOrigin)) {
        responseBody.sessionHeaderToken = signedSessionPayload;
    }
    const response = jsonResponse(responseBody, 200, corsHeaders);
    response.headers.append(
        "Set-Cookie",
        serializeCookie(
            SESSION_COOKIE_NAME,
            signedSessionPayload,
            cookieOptionsForRequest(env, {
                maxAge: SESSION_MAX_AGE_SECONDS,
            }),
        ),
    );
    return response;
}

async function handleApiRepoStatus(request, env, corsHeaders) {
    const token = mustGetEnv(env, "GITHUB_STATUS_TOKEN");
    const url = new URL(request.url);
    const owner = normalizeRepoOwner(url.searchParams.get("owner"));
    const repo = normalizeRepoName(url.searchParams.get("repo"));
    const branch = normalizeBranchName(url.searchParams.get("branch")) || "main";

    if (!owner || !repo) {
        return jsonResponse({ error: "owner and repo are required." }, 400, corsHeaders);
    }

    const cacheResult = await getRepoStatusWithCache({
        token,
        owner,
        repo,
        branch,
    });

    return jsonResponse({
        ...cacheResult.data,
        cache: {
            hit: cacheResult.cacheHit,
            ageMs: cacheResult.cacheAgeMs,
            minPollMs: REPO_STATUS_MIN_POLL_MS,
        },
    }, 200, corsHeaders);
}

function summarizeGitHubCommit(commit) {
    if (!commit || typeof commit !== "object") {
        return {
            sha: "",
            url: "",
            message: "",
            committedAt: "",
            authorLogin: "",
            authorName: "",
        };
    }

    const commitData = commit.commit && typeof commit.commit === "object"
        ? commit.commit
        : {};
    const authorData = commitData.author && typeof commitData.author === "object"
        ? commitData.author
        : {};
    const author = commit.author && typeof commit.author === "object"
        ? commit.author
        : {};

    return {
        sha: typeof commit.sha === "string" ? commit.sha : "",
        url: typeof commit.html_url === "string" ? commit.html_url : "",
        message: typeof commitData.message === "string" ? commitData.message : "",
        committedAt: typeof authorData.date === "string" ? authorData.date : "",
        authorLogin: typeof author.login === "string" ? author.login : "",
        authorName: typeof authorData.name === "string" ? authorData.name : "",
    };
}

function parsePositiveInteger(value, min, max) {
    const parsed = Number.parseInt(String(value || ""), 10);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
        throw new Error(`Expected integer between ${min} and ${max}.`);
    }
    return parsed;
}

function normalizeGitReference(value) {
    if (!value) {
        return "";
    }

    const ref = String(value).trim();
    if (!ref || ref.length > 200) {
        return "";
    }
    if (/[^\w./-]/.test(ref)) {
        return "";
    }
    return ref;
}

function encodeRepoPath(path) {
    return String(path || "")
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
}

function decodeBase64Text(base64) {
    const normalized = String(base64 || "").replace(/\s+/g, "");
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return textDecoder.decode(bytes);
}

async function waitWithTimeout(promise, timeoutMs, message) {
    if (!timeoutMs) {
        return promise;
    }
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(message || "Operation timed out."));
        }, timeoutMs);
    });
    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        clearTimeout(timeoutId);
    }
}

async function handleApiFileHistory(request, env, corsHeaders) {
    const token = mustGetEnv(env, "GITHUB_STATUS_TOKEN");
    const url = new URL(request.url);
    const owner = normalizeRepoOwner(url.searchParams.get("owner"));
    const repo = normalizeRepoName(url.searchParams.get("repo"));
    const branch = normalizeBranchName(url.searchParams.get("branch")) || "main";
    const path = normalizeMarkdownRepoPath(url.searchParams.get("path"));
    const perPage = parsePositiveInteger(url.searchParams.get("per_page"), 1, 80);

    if (!owner || !repo || !path) {
        return jsonResponse({ error: "owner, repo, and path are required." }, 400, corsHeaders);
    }

    const repoPrefix = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const branchRef = encodeURIComponent(branch);
    const pathQuery = encodeURIComponent(path);

    const [headCommit, fileCommits] = await Promise.all([
        githubApiRequest(`${repoPrefix}/commits/${branchRef}`, { token }),
        githubApiRequest(`${repoPrefix}/commits?sha=${branchRef}&path=${pathQuery}&per_page=${perPage}`, { token }),
    ]);

    const commits = Array.isArray(fileCommits) ? fileCommits : [];
    return jsonResponse({
        owner,
        repo,
        branch,
        path,
        head: summarizeGitHubCommit(headCommit),
        commits: commits.map((commit) => summarizeGitHubCommit(commit)),
    }, 200, corsHeaders);
}

async function handleApiFileContent(request, env, corsHeaders) {
    const token = mustGetEnv(env, "GITHUB_STATUS_TOKEN");
    const url = new URL(request.url);
    const owner = normalizeRepoOwner(url.searchParams.get("owner"));
    const repo = normalizeRepoName(url.searchParams.get("repo"));
    const path = normalizeMarkdownRepoPath(url.searchParams.get("path"));
    const ref = normalizeGitReference(url.searchParams.get("ref"));

    if (!owner || !repo || !path || !ref) {
        return jsonResponse({ error: "owner, repo, path, and ref are required." }, 400, corsHeaders);
    }

    const repoPrefix = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const encodedPath = encodeRepoPath(path);
    const encodedRef = encodeURIComponent(ref);
    const file = await githubApiRequest(`${repoPrefix}/contents/${encodedPath}?ref=${encodedRef}`, { token });
    const content = file && typeof file.content === "string" ? file.content : "";
    const encoding = file && typeof file.encoding === "string" ? file.encoding.toLowerCase() : "";
    if (!content || encoding !== "base64") {
        return jsonResponse({ error: "Could not decode file content from GitHub." }, 502, corsHeaders);
    }

    let markdown = "";
    try {
        markdown = decodeBase64Text(content);
    } catch (error) {
        return jsonResponse({ error: "Could not decode file content from base64." }, 502, corsHeaders);
    }

    return jsonResponse({
        owner,
        repo,
        path,
        ref,
        sha: file && typeof file.sha === "string" ? file.sha : "",
        markdown,
    }, 200, corsHeaders);
}

async function handleApiLogout(request, env, corsHeaders) {
    const response = jsonResponse({ ok: true }, 200, corsHeaders);
    clearSessionCookie(response, env);
    return response;
}

async function handleApiSubmit(request, env, corsHeaders) {
    const session = await readSession(request, env);
    if (!session) {
        return jsonResponse(
            {
                error: "Not authenticated.",
                hint: buildMissingSessionHint(request),
            },
            401,
            corsHeaders,
        );
    }

    let payload;
    try {
        payload = await request.json();
    } catch (error) {
        return jsonResponse({ error: "Request body must be valid JSON." }, 400, corsHeaders);
    }

    const owner = normalizeRepoOwner(payload && payload.owner);
    const repo = normalizeRepoName(payload && payload.repo);
    const baseBranch = normalizeBranchName(payload && payload.baseBranch);
    const commitMessage = normalizeCommitMessage(payload && payload.commitMessage);

    if (!owner || !repo || !baseBranch || !commitMessage) {
        return jsonResponse({ error: "owner, repo, baseBranch, and commitMessage are required." }, 400, corsHeaders);
    }

    let files;
    try {
        files = normalizeSubmittedFiles(payload && payload.files);
    } catch (error) {
        return jsonResponse({ error: error.message || "Invalid files payload." }, 400, corsHeaders);
    }

    let binaryFiles;
    try {
        binaryFiles = normalizeSubmittedBinaryFiles(payload && payload.binaryFiles);
    } catch (error) {
        return jsonResponse({ error: error.message || "Invalid binaryFiles payload." }, 400, corsHeaders);
    }

    const hasMarkdownFiles = Object.keys(files).length > 0;
    const hasBinaryFiles = Object.keys(binaryFiles).length > 0;
    if (!hasMarkdownFiles && !hasBinaryFiles) {
        return jsonResponse({ error: "No files provided." }, 400, corsHeaders);
    }

    const duplicatePath = Object.keys(files).find((path) => Object.prototype.hasOwnProperty.call(binaryFiles, path));
    if (duplicatePath) {
        return jsonResponse({ error: `Duplicate path in files and binaryFiles: ${duplicatePath}` }, 400, corsHeaders);
    }

    let canPush = false;
    try {
        const access = await getRepoAccessForUser(session.token, owner, repo);
        canPush = !!(access && access.canPush);
    } catch (error) {
        if (error.status === 401) {
            const response = jsonResponse({ error: "GitHub session expired." }, 401, corsHeaders);
            clearSessionCookie(response, env);
            return response;
        }
        throw error;
    }

    const sortedPaths = Object.keys(files)
        .concat(Object.keys(binaryFiles))
        .sort();

    if (canPush) {
        const commit = await createCommitOnBranch({
            token: session.token,
            owner,
            repo,
            branch: baseBranch,
            commitMessage,
            files,
            binaryFiles,
        });

        return jsonResponse({
            mode: "direct",
            branch: baseBranch,
            files: sortedPaths,
            commitSha: commit.sha,
            url: commit.url,
        }, 200, corsHeaders);
    }

    const pullRequest = await createPullRequestFromFork({
        token: session.token,
        owner,
        repo,
        baseBranch,
        commitMessage,
        files,
        binaryFiles,
        actorLogin: session.user && session.user.login ? session.user.login : "contributor",
    });

    return jsonResponse({
        mode: "pull_request",
        branch: pullRequest.branch,
        files: sortedPaths,
        pullRequestNumber: pullRequest.number,
        url: pullRequest.url,
    }, 200, corsHeaders);
}

async function getRepoStatusWithCache(options) {
    const { token, owner, repo, branch } = options;
    const cacheKey = `${owner.toLowerCase()}/${repo.toLowerCase()}#${branch}`;
    const now = Date.now();
    const cached = repoStatusCache.get(cacheKey);

    if (cached && now - cached.fetchedAt < REPO_STATUS_MIN_POLL_MS) {
        return {
            data: cached.data,
            cacheHit: true,
            cacheAgeMs: now - cached.fetchedAt,
        };
    }

    const inFlight = repoStatusInFlight.get(cacheKey);
    if (inFlight) {
        try {
            const data = await waitWithTimeout(inFlight, REPO_STATUS_REQUEST_TIMEOUT_MS, "Repo status request timed out.");
            const freshCache = repoStatusCache.get(cacheKey);
            return {
                data,
                cacheHit: !!freshCache,
                cacheAgeMs: freshCache ? Math.max(0, Date.now() - freshCache.fetchedAt) : 0,
            };
        } catch (error) {
            repoStatusInFlight.delete(cacheKey);
            if (cached) {
                return {
                    data: cached.data,
                    cacheHit: true,
                    cacheAgeMs: Math.max(0, Date.now() - cached.fetchedAt),
                };
            }
            throw error;
        }
    }

    const fetchPromise = (async () => {
        const data = await fetchRepoStatusFromGitHub({
            token,
            owner,
            repo,
            branch,
        });
        repoStatusCache.set(cacheKey, {
            fetchedAt: Date.now(),
            data,
        });
        return data;
    })();

    repoStatusInFlight.set(cacheKey, fetchPromise);

    try {
        const data = await fetchPromise;
        const freshCache = repoStatusCache.get(cacheKey);
        return {
            data,
            cacheHit: false,
            cacheAgeMs: freshCache ? Math.max(0, Date.now() - freshCache.fetchedAt) : 0,
        };
    } catch (error) {
        if (cached) {
            return {
                data: cached.data,
                cacheHit: true,
                cacheAgeMs: Math.max(0, Date.now() - cached.fetchedAt),
            };
        }
        throw error;
    } finally {
        repoStatusInFlight.delete(cacheKey);
    }
}

async function fetchRepoStatusFromGitHub(options) {
    const { token, owner, repo, branch } = options;
    const repoPrefix = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const branchRef = encodeURIComponent(branch);

    const [commitResult, runsResult] = await Promise.allSettled([
        githubApiRequest(`${repoPrefix}/commits/${branchRef}`, { token, timeoutMs: REPO_STATUS_REQUEST_TIMEOUT_MS }),
        githubApiRequest(`${repoPrefix}/actions/runs?branch=${branchRef}&per_page=20`, { token, timeoutMs: REPO_STATUS_REQUEST_TIMEOUT_MS }),
    ]);

    const activity = {
        owner,
        repo,
        branch,
        updatedAt: Date.now(),
    };

    if (commitResult.status === "fulfilled") {
        const commit = commitResult.value;
        activity.commitSha = commit && commit.sha ? commit.sha : "";
        activity.commitTime = commit && commit.commit && commit.commit.author
            ? commit.commit.author.date
            : "";
        activity.commitUrl = commit && commit.html_url ? commit.html_url : "";
    } else {
        activity.commitError = commitResult.reason && commitResult.reason.message
            ? commitResult.reason.message
            : "Could not load latest commit.";
    }

    if (runsResult.status === "fulfilled") {
        const workflowRuns = runsResult.value;
        const runs = workflowRuns && Array.isArray(workflowRuns.workflow_runs)
            ? workflowRuns.workflow_runs
            : [];
        activity.deployRun = selectDeployRun(runs);
    } else {
        activity.runsError = runsResult.reason && runsResult.reason.message
            ? runsResult.reason.message
            : "Could not load deploy workflow runs.";
    }

    if (activity.commitSha) {
        try {
            const checkRunsPayload = await githubApiRequest(
                `${repoPrefix}/commits/${encodeURIComponent(activity.commitSha)}/check-runs?per_page=100`,
                { token, timeoutMs: REPO_STATUS_REQUEST_TIMEOUT_MS },
            );
            const markdownValidation = await buildMarkdownValidationSummary({
                token,
                repoPrefix,
                checkRunsPayload,
            });
            if (markdownValidation) {
                activity.markdownValidation = markdownValidation;
            }
        } catch (error) {
            activity.markdownValidation = {
                error: error && error.message ? error.message : "Could not load markdown validation check.",
            };
        }
    }

    if (!activity.commitSha && !activity.deployRun) {
        activity.error = activity.commitError || activity.runsError || "Could not load repo activity.";
    }

    return activity;
}

async function buildMarkdownValidationSummary(options) {
    const { token, repoPrefix, checkRunsPayload } = options;
    const checkRuns = checkRunsPayload && Array.isArray(checkRunsPayload.check_runs)
        ? checkRunsPayload.check_runs
        : [];
    const checkRun = findMarkdownValidationCheckRun(checkRuns);
    if (!checkRun) {
        return null;
    }

    const output = checkRun.output && typeof checkRun.output === "object"
        ? checkRun.output
        : {};
    const summary = {
        name: typeof checkRun.name === "string" ? checkRun.name : "Markdown Validation",
        status: typeof checkRun.status === "string" ? checkRun.status : "",
        conclusion: typeof checkRun.conclusion === "string" ? checkRun.conclusion : "",
        url: typeof checkRun.details_url === "string" && checkRun.details_url
            ? checkRun.details_url
            : (typeof checkRun.html_url === "string" ? checkRun.html_url : ""),
        startedAt: typeof checkRun.started_at === "string" ? checkRun.started_at : "",
        completedAt: typeof checkRun.completed_at === "string" ? checkRun.completed_at : "",
        title: typeof output.title === "string" ? output.title : "",
        summary: typeof output.summary === "string" ? output.summary : "",
        annotationsCount: Number.isFinite(Number(output.annotations_count))
            ? Number(output.annotations_count)
            : 0,
        errorCount: 0,
        warningCount: 0,
        noticeCount: 0,
        issues: [],
        issuesTruncated: false,
    };

    if (!checkRun.id || summary.annotationsCount <= 0) {
        return summary;
    }

    const perPage = Math.min(80, Math.max(20, summary.annotationsCount));
    const annotationsPayload = await githubApiRequest(
        `${repoPrefix}/check-runs/${encodeURIComponent(checkRun.id)}/annotations?per_page=${perPage}`,
        { token, timeoutMs: REPO_STATUS_REQUEST_TIMEOUT_MS },
    );
    const annotations = Array.isArray(annotationsPayload) ? annotationsPayload : [];
    const annotationSummary = summarizeCheckRunAnnotations(annotations, 25);

    summary.errorCount = annotationSummary.errorCount;
    summary.warningCount = annotationSummary.warningCount;
    summary.noticeCount = annotationSummary.noticeCount;
    summary.issues = annotationSummary.issues;
    summary.issuesTruncated = summary.annotationsCount > annotations.length;

    return summary;
}

function findMarkdownValidationCheckRun(checkRuns) {
    if (!Array.isArray(checkRuns) || checkRuns.length === 0) {
        return null;
    }

    const scored = checkRuns
        .map((checkRun) => {
            const name = String(checkRun && checkRun.name ? checkRun.name : "").toLowerCase();
            const title = String(
                checkRun
                && checkRun.output
                && typeof checkRun.output === "object"
                && checkRun.output.title
                    ? checkRun.output.title
                    : "",
            ).toLowerCase();

            const text = `${name} ${title}`.trim();
            if (!text) {
                return null;
            }

            const hasMarkdown = text.includes("markdown");
            const hasValidationWord = text.includes("validate")
                || text.includes("validation")
                || text.includes("lint")
                || text.includes("check");
            if (!hasMarkdown || !hasValidationWord) {
                return null;
            }

            return checkRun;
        })
        .filter(Boolean);

    if (scored.length === 0) {
        return null;
    }

    scored.sort((a, b) => {
        const aTime = Date.parse(a && a.started_at ? a.started_at : a && a.created_at ? a.created_at : "") || 0;
        const bTime = Date.parse(b && b.started_at ? b.started_at : b && b.created_at ? b.created_at : "") || 0;
        return bTime - aTime;
    });

    return scored[0] || null;
}

function summarizeCheckRunAnnotations(annotations, maxIssues) {
    const summary = {
        errorCount: 0,
        warningCount: 0,
        noticeCount: 0,
        issues: [],
    };

    if (!Array.isArray(annotations)) {
        return summary;
    }

    annotations.forEach((annotation) => {
        const levelRaw = String(annotation && annotation.annotation_level ? annotation.annotation_level : "")
            .toLowerCase();
        const level = levelRaw === "failure"
            ? "error"
            : (levelRaw === "warning" ? "warning" : "notice");

        if (level === "error") {
            summary.errorCount += 1;
        } else if (level === "warning") {
            summary.warningCount += 1;
        } else {
            summary.noticeCount += 1;
        }

        if (summary.issues.length >= maxIssues) {
            return;
        }

        const path = typeof annotation.path === "string" ? annotation.path : "";
        const line = Number.isFinite(Number(annotation.start_line))
            ? Number(annotation.start_line)
            : 0;
        const title = typeof annotation.title === "string"
            ? annotation.title
            : "";
        const message = typeof annotation.message === "string"
            ? annotation.message
            : "";

        summary.issues.push({
            level,
            path,
            line,
            title: title.slice(0, 220),
            message: message.slice(0, 420),
        });
    });

    return summary;
}

function selectDeployRun(runs) {
    if (!Array.isArray(runs) || runs.length === 0) {
        return null;
    }

    const deployRun = runs.find((run) => isPagesDeployRun(run)) || null;
    if (deployRun) {
        return deployRun;
    }

    // Fallback to a non-markdown workflow run when deploy heuristics do not match.
    // This avoids accidentally showing markdown validation as deploy health.
    const nonMarkdownRun = runs.find((run) => !isMarkdownValidationRun(run)) || null;
    return nonMarkdownRun;
}

function isPushLikeEvent(run) {
    const eventName = String(run && run.event ? run.event : "").toLowerCase();
    return eventName === "push"
        || eventName === "workflow_dispatch"
        || eventName === "schedule"
        || eventName === "workflow_run"
        || eventName === "deployment"
        || eventName === "deployment_status"
        || eventName === "repository_dispatch"
        || !eventName;
}

function isMarkdownValidationRun(run) {
    const name = String(run && run.name ? run.name : "").toLowerCase();
    const path = String(run && run.path ? run.path : "").toLowerCase();
    const title = String(run && run.display_title ? run.display_title : "").toLowerCase();
    const text = `${name} ${path} ${title}`;
    const hasMarkdown = text.includes("markdown");
    const hasValidationWord = text.includes("validate")
        || text.includes("validation")
        || text.includes("lint")
        || text.includes("check");
    return hasMarkdown && hasValidationWord;
}

function isPagesDeployRun(run) {
    if (isMarkdownValidationRun(run) || !isPushLikeEvent(run)) {
        return false;
    }
    const name = String(run && run.name ? run.name : "").toLowerCase();
    const path = String(run && run.path ? run.path : "").toLowerCase();
    const title = String(run && run.display_title ? run.display_title : "").toLowerCase();
    const text = `${name} ${path} ${title}`;
    const hasPages = text.includes("pages")
        || path.includes("pages")
        || text.includes("github pages");
    const hasDeploy = text.includes("deploy")
        || text.includes("deployment")
        || text.includes("publish");
    const hasBuild = text.includes("build");
    return hasPages || (hasDeploy && hasBuild);
}

async function createPullRequestFromFork(options) {
    const {
        token,
        owner,
        repo,
        baseBranch,
        commitMessage,
        files,
        binaryFiles,
        actorLogin,
    } = options;

    const forkOwner = await ensureForkExists(token, owner, repo);

    const upstreamBaseRef = await getBranchRef({
        token,
        owner,
        repo,
        branch: baseBranch,
    });

    const branch = await createUniqueBranchOnFork({
        token,
        forkOwner,
        repo,
        baseSha: upstreamBaseRef.object.sha,
        actorLogin,
    });

    await createCommitOnBranch({
        token,
        owner: forkOwner,
        repo,
        branch,
        commitMessage,
        files,
        binaryFiles,
    });

    const allPaths = Object.keys(files)
        .concat(Object.keys(binaryFiles || {}))
        .sort();
    const changeList = allPaths.map((path) => `- \`${path}\``).join("\n");
    const pullRequestBody = [
        `Created via inline editor by @${actorLogin}.`,
        "",
        "Changed files:",
        changeList,
    ].join("\n");

    const pullRequest = await githubApiRequest(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
        {
            method: "POST",
            token,
            body: {
                title: commitMessage,
                head: `${forkOwner}:${branch}`,
                base: baseBranch,
                body: pullRequestBody,
            },
        },
    );

    return {
        number: pullRequest.number,
        url: pullRequest.html_url,
        branch,
    };
}

async function createCommitOnBranch(options) {
    const {
        token,
        owner,
        repo,
        branch,
        commitMessage,
        files,
        binaryFiles,
    } = options;

    for (let attempt = 0; attempt < 2; attempt += 1) {
        const branchRef = await getBranchRef({ token, owner, repo, branch });
        const parentSha = branchRef && branchRef.object ? branchRef.object.sha : null;
        if (!parentSha) {
            throw new Error(`Could not resolve branch head for ${owner}/${repo}:${branch}`);
        }

        const parentCommit = await githubApiRequest(
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${encodeURIComponent(parentSha)}`,
            { token },
        );
        const parentTreeSha = parentCommit && parentCommit.tree ? parentCommit.tree.sha : null;
        if (!parentTreeSha) {
            throw new Error(`Could not resolve tree for ${owner}/${repo}:${branch}`);
        }

        const markdownEntries = Object.keys(files || {}).map((path) => ({
            path,
            mode: "100644",
            type: "blob",
            content: files[path],
        }));
        const binaryEntries = Object.keys(binaryFiles || {}).map((path) => ({
            path,
            mode: "100644",
            type: "blob",
            content: binaryFiles[path].contentBase64,
            encoding: "base64",
        }));
        const treeEntries = markdownEntries
            .concat(binaryEntries)
            .sort((left, right) => left.path.localeCompare(right.path));

        const tree = await githubApiRequest(
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees`,
            {
                method: "POST",
                token,
                body: {
                    base_tree: parentTreeSha,
                    tree: treeEntries,
                },
            },
        );

        const commit = await githubApiRequest(
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits`,
            {
                method: "POST",
                token,
                body: {
                    message: commitMessage,
                    tree: tree.sha,
                    parents: [parentSha],
                },
            },
        );

        try {
            await githubApiRequest(
                `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeRefName(branch)}`,
                {
                    method: "PATCH",
                    token,
                    body: {
                        sha: commit.sha,
                        force: false,
                    },
                },
            );

            return {
                sha: commit.sha,
                url: `https://github.com/${owner}/${repo}/commit/${commit.sha}`,
            };
        } catch (error) {
            if (
                attempt === 0
                && error.status === 422
                && String(error.message || "").toLowerCase().includes("not a fast forward")
            ) {
                continue;
            }
            throw error;
        }
    }

    throw new Error(`Could not update ${owner}/${repo}:${branch} after retry.`);
}

async function getBranchRef(options) {
    const { token, owner, repo, branch } = options;
    return githubApiRequest(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeRefName(branch)}`,
        { token },
    );
}

async function createUniqueBranchOnFork(options) {
    const {
        token,
        forkOwner,
        repo,
        baseSha,
        actorLogin,
    } = options;

    const actor = String(actorLogin || "editor")
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 24) || "editor";

    for (let attempt = 0; attempt < 6; attempt += 1) {
        const suffix = randomToken(4).toLowerCase();
        const branch = `inline-edit-${actor}-${suffix}`;

        try {
            await githubApiRequest(
                `/repos/${encodeURIComponent(forkOwner)}/${encodeURIComponent(repo)}/git/refs`,
                {
                    method: "POST",
                    token,
                    body: {
                        ref: `refs/heads/${branch}`,
                        sha: baseSha,
                    },
                },
            );
            return branch;
        } catch (error) {
            if (error.status === 422) {
                continue;
            }
            throw error;
        }
    }

    throw new Error("Could not create a unique branch on the fork.");
}

async function ensureForkExists(token, owner, repo) {
    const fork = await githubApiRequest(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/forks`,
        {
            method: "POST",
            token,
            body: {},
        },
    );

    const forkOwner = fork && fork.owner ? fork.owner.login : null;
    if (!forkOwner) {
        throw new Error("GitHub did not return fork owner information.");
    }

    for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
            await githubApiRequest(
                `/repos/${encodeURIComponent(forkOwner)}/${encodeURIComponent(repo)}`,
                { token },
            );
            return forkOwner;
        } catch (error) {
            if (error.status === 404 && attempt < 9) {
                await sleep(1000 + attempt * 250);
                continue;
            }
            throw error;
        }
    }

    throw new Error("Fork was not ready in time.");
}

async function getRepoAccessForUser(token, owner, repo) {
    const repository = await githubApiRequest(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        { token },
    );

    const permissions = repository && repository.permissions
        ? repository.permissions
        : {};

    return {
        owner,
        repo,
        canPush: !!permissions.push,
        canPull: !!permissions.pull,
        isAdmin: !!permissions.admin,
    };
}

async function exchangeCodeForAccessToken(options) {
    const {
        code,
        codeVerifier,
        redirectUri,
        clientId,
        clientSecret,
    } = options;

    const response = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: redirectUri,
            code_verifier: codeVerifier,
        }),
    });

    let payload = null;
    try {
        payload = await response.json();
    } catch (error) {
        payload = null;
    }

    if (!response.ok) {
        const message = payload && payload.error_description
            ? payload.error_description
            : `GitHub OAuth exchange failed (${response.status}).`;
        const err = new Error(message);
        err.status = response.status;
        throw err;
    }

    if (payload && payload.error) {
        const message = payload.error_description || payload.error;
        throw new Error(`GitHub OAuth exchange failed: ${message}`);
    }

    return payload;
}

async function githubApiRequest(path, options) {
    const { method = "GET", token, body, timeoutMs = 0 } = options || {};
    const controller = timeoutMs ? new AbortController() : null;
    let timeoutId = null;
    if (controller) {
        timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    }
    let response;
    try {
        response = await fetch(`https://api.github.com${path}`, {
            method,
            headers: {
                Accept: "application/vnd.github+json",
                Authorization: `Bearer ${token}`,
                "X-GitHub-Api-Version": "2022-11-28",
                "Content-Type": "application/json",
                "User-Agent": "kendell-github-auth-worker",
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal: controller ? controller.signal : undefined,
        });
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }

    const text = await response.text();
    let payload = null;
    if (text) {
        try {
            payload = JSON.parse(text);
        } catch (error) {
            payload = null;
        }
    }

    if (!response.ok) {
        const message = payload && payload.message
            ? payload.message
            : `GitHub API error (${response.status}).`;
        const err = new Error(message);
        err.status = response.status;
        err.payload = payload;
        throw err;
    }

    return payload;
}

function normalizeRepoOwner(value) {
    if (!value) {
        return null;
    }
    const owner = String(value).trim();
    return /^[A-Za-z0-9_.-]{1,39}$/.test(owner) ? owner : null;
}

function normalizeRepoName(value) {
    if (!value) {
        return null;
    }
    const repo = String(value).trim();
    return /^[A-Za-z0-9_.-]{1,100}$/.test(repo) ? repo : null;
}

function normalizeBranchName(value) {
    if (!value) {
        return null;
    }
    const branch = String(value).trim();
    if (!branch || branch.includes("..") || branch.startsWith("/") || branch.endsWith("/")) {
        return null;
    }
    return /^[A-Za-z0-9._/-]+$/.test(branch) ? branch : null;
}

function normalizeCommitMessage(value) {
    if (!value) {
        return null;
    }
    const message = String(value).trim();
    if (!message) {
        return null;
    }
    return message.slice(0, 240);
}

function normalizeSubmittedFiles(rawFiles) {
    if (rawFiles === undefined || rawFiles === null) {
        return {};
    }

    if (typeof rawFiles !== "object" || Array.isArray(rawFiles)) {
        throw new Error("files must be an object: { path: markdown }.");
    }

    const normalized = {};
    let totalLength = 0;

    for (const [rawPath, rawContent] of Object.entries(rawFiles)) {
        const path = normalizeMarkdownRepoPath(rawPath);
        if (!path) {
            throw new Error(`Invalid file path: ${rawPath}`);
        }

        const content = typeof rawContent === "string"
            ? rawContent
            : String(rawContent || "");

        if (content.length > 400000) {
            throw new Error(`File is too large: ${path}`);
        }

        totalLength += content.length;
        if (totalLength > 1000000) {
            throw new Error("Total payload too large.");
        }

        normalized[path] = content;
    }

    return normalized;
}

function normalizeSubmittedBinaryFiles(rawFiles) {
    if (rawFiles === undefined || rawFiles === null) {
        return {};
    }

    if (typeof rawFiles !== "object" || Array.isArray(rawFiles)) {
        throw new Error("binaryFiles must be an object: { path: { contentBase64 } }.");
    }

    const normalized = {};
    let totalBytes = 0;

    for (const [rawPath, rawValue] of Object.entries(rawFiles)) {
        const path = normalizeImageRepoPath(rawPath);
        if (!path) {
            throw new Error(`Invalid image path: ${rawPath}`);
        }

        if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
            throw new Error(`binaryFiles entry must be an object: ${rawPath}`);
        }

        const contentBase64 = normalizeBase64Payload(rawValue.contentBase64);
        if (!contentBase64) {
            throw new Error(`binaryFiles entry must include valid base64 content: ${path}`);
        }

        const byteLength = decodedByteLengthFromBase64(contentBase64);
        if (byteLength > 10000000) {
            throw new Error(`Image is too large: ${path}`);
        }

        totalBytes += byteLength;
        if (totalBytes > 20000000) {
            throw new Error("Total image payload too large.");
        }

        normalized[path] = {
            contentBase64,
            contentType: normalizeContentType(rawValue.contentType),
        };
    }

    return normalized;
}

function normalizeMarkdownRepoPath(value) {
    if (!value) {
        return null;
    }
    const path = String(value)
        .replace(/\\/g, "/")
        .replace(/^\/+/, "")
        .trim();

    if (!path || path.includes("..") || path.startsWith(".")) {
        return null;
    }

    if (!/^sections\/[A-Za-z0-9._/-]+\.md$/.test(path)) {
        return null;
    }

    return path;
}

function normalizeImageRepoPath(value) {
    if (!value) {
        return null;
    }

    const path = String(value)
        .replace(/\\/g, "/")
        .replace(/^\/+/, "")
        .trim();

    if (
        !path
        || path.includes("..")
        || path.includes("//")
        || path.includes("/.")
        || path.startsWith(".")
        || path.endsWith("/")
    ) {
        return null;
    }

    if (!/^imgs\/[A-Za-z0-9._/-]+\.(png|jpe?g|gif|webp|svg|avif)$/i.test(path)) {
        return null;
    }

    return path;
}

function normalizeBase64Payload(value) {
    if (typeof value !== "string") {
        return null;
    }

    const base64 = value.replace(/\s+/g, "");
    if (!base64 || base64.length % 4 !== 0) {
        return null;
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
        return null;
    }

    try {
        atob(base64);
        return base64;
    } catch (error) {
        return null;
    }
}

function decodedByteLengthFromBase64(base64) {
    if (!base64) {
        return 0;
    }

    let padding = 0;
    if (base64.endsWith("==")) {
        padding = 2;
    } else if (base64.endsWith("=")) {
        padding = 1;
    }

    return Math.max(0, (base64.length / 4) * 3 - padding);
}

function normalizeContentType(value) {
    if (typeof value !== "string") {
        return "";
    }

    const type = value.trim().toLowerCase();
    if (!type) {
        return "";
    }

    if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type)) {
        return "";
    }

    return type.slice(0, 80);
}

function encodeRefName(value) {
    return encodeURIComponent(value);
}

async function readSession(request, env) {
    const sessionSecret = env.SESSION_SECRET;
    if (!sessionSecret) {
        return null;
    }

    const cookies = parseCookies(request.headers.get("Cookie"));
    const cookiePayload = await decodeSessionPayloadIfValid(
        cookies[SESSION_COOKIE_NAME],
        sessionSecret,
    );
    if (cookiePayload) {
        return cookiePayload;
    }

    const headerOrigin = normalizeOrigin(request.headers.get("Origin"));
    if (!isLoopbackOrigin(headerOrigin)) {
        return null;
    }

    const headerToken = request.headers.get(SESSION_HEADER_NAME);
    if (!headerToken) {
        return null;
    }

    return decodeSessionPayloadIfValid(headerToken, sessionSecret);
}

function clearSessionCookie(response, env) {
    response.headers.append(
        "Set-Cookie",
        serializeCookie(
            SESSION_COOKIE_NAME,
            "",
            cookieOptionsForRequest(env, { maxAge: 0 }),
        ),
    );
}

function buildPopupCompletionHtml(ok, message, origin, extraPayload) {
    const safeMessage = escapeHtml(message || "Authentication complete.");
    const targetOrigin = JSON.stringify(origin || "*");
    const popupPayload = { type: "github-auth-complete", ok, message: message || "" };
    if (extraPayload && typeof extraPayload === "object" && !Array.isArray(extraPayload)) {
        Object.assign(popupPayload, extraPayload);
    }
    const payload = JSON.stringify(popupPayload);

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>GitHub Authentication</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; color: #0f172a; }
      p { margin: 0; line-height: 1.5; }
    </style>
  </head>
  <body>
    <p>${safeMessage}</p>
    <script>
      (function () {
        var payload = ${payload};
        var targetOrigin = ${targetOrigin};
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, targetOrigin);
          }
        } catch (error) {
          // Ignore cross-window messaging errors.
        }
        window.close();
      }());
    </script>
  </body>
</html>`;
}

function popupOrRedirectError(request, env, message, oauthPayload) {
    const origin = oauthPayload && oauthPayload.origin
        ? chooseAllowedOrigin(oauthPayload.origin, env)
        : chooseAllowedOrigin(null, env);
    if (!origin) {
        throw new Error("No allowed origin configured.");
    }
    const mode = oauthPayload && oauthPayload.mode ? oauthPayload.mode : "redirect";

    if (mode === "popup") {
        const response = new Response(
            buildPopupCompletionHtml(false, message, origin),
            {
                status: 400,
                headers: {
                    "Content-Type": "text/html; charset=utf-8",
                    "Cache-Control": "no-store",
                },
            },
        );
        response.headers.append(
            "Set-Cookie",
            serializeCookie(
                OAUTH_COOKIE_NAME,
                "",
                oauthCookieOptionsForRequest(env, { maxAge: 0 }),
            ),
        );
        return response;
    }

    const redirectUrl = new URL(sanitizeReturnTo(
        oauthPayload && oauthPayload.returnTo,
        origin,
    ));
    redirectUrl.searchParams.set("auth_error", message);
    return buildRedirectResponse(
        redirectUrl.toString(),
        302,
        undefined,
        [
            serializeCookie(
                OAUTH_COOKIE_NAME,
                "",
                oauthCookieOptionsForRequest(env, { maxAge: 0 }),
            ),
        ],
    );
}

function buildRedirectResponse(location, status, extraHeaders, cookieValues) {
    const headers = new Headers({
        Location: location,
    });

    Object.entries(extraHeaders || {}).forEach(([key, value]) => {
        headers.set(key, value);
    });

    (cookieValues || []).forEach((cookieValue) => {
        if (cookieValue) {
            headers.append("Set-Cookie", cookieValue);
        }
    });

    return new Response(null, {
        status: status || 302,
        headers,
    });
}

function buildPreflightHeaders(corsHeaders) {
    const headers = new Headers();
    Object.entries(corsHeaders).forEach(([key, value]) => {
        headers.set(key, value);
    });

    if (corsHeaders["Access-Control-Allow-Origin"]) {
        headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        headers.set("Access-Control-Allow-Headers", `Content-Type, ${SESSION_HEADER_NAME}`);
        headers.set("Access-Control-Max-Age", "86400");
    }

    return headers;
}

function jsonResponse(payload, status, corsHeaders) {
    const headers = new Headers({
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
    });

    Object.entries(corsHeaders || {}).forEach(([key, value]) => {
        headers.set(key, value);
    });

    return new Response(JSON.stringify(payload), {
        status,
        headers,
    });
}

function resolveCorsHeaders(request, env) {
    const normalizedOrigin = normalizeOrigin(request.headers.get("Origin"));
    if (!normalizedOrigin) {
        return {};
    }

    if (!isOriginAllowed(normalizedOrigin, env)) {
        return {};
    }

    return {
        "Access-Control-Allow-Origin": normalizedOrigin,
        "Access-Control-Allow-Credentials": "true",
        Vary: "Origin",
    };
}

function getAllowedOrigins(env) {
    const configured = (env.ALLOWED_ORIGINS || "")
        .split(",")
        .map((value) => normalizeOrigin(value))
        .filter(Boolean);

    if (configured.length > 0) {
        return configured;
    }

    return DEFAULT_ALLOWED_ORIGINS;
}

function isLoopbackOrigin(origin) {
    const normalized = normalizeOrigin(origin);
    if (!normalized) {
        return false;
    }

    try {
        const parsed = new URL(normalized);
        const hostname = String(parsed.hostname || "").toLowerCase();
        return hostname === "localhost"
            || hostname === "127.0.0.1"
            || hostname === "::1"
            || hostname === "[::1]";
    } catch (error) {
        return false;
    }
}

function isOriginAllowed(origin, env) {
    const normalized = normalizeOrigin(origin);
    if (!normalized) {
        return false;
    }

    const allowedOrigins = getAllowedOrigins(env);
    if (allowedOrigins.includes(normalized)) {
        return true;
    }

    if (isLoopbackOrigin(normalized)) {
        return true;
    }

    return false;
}

function chooseAllowedOrigin(origin, env) {
    const normalized = normalizeOrigin(origin);
    if (normalized && isOriginAllowed(normalized, env)) {
        return normalized;
    }

    const allowedOrigins = getAllowedOrigins(env);
    return allowedOrigins.length > 0 ? allowedOrigins[0] : null;
}

function sanitizeReturnTo(rawReturnTo, allowedOrigin) {
    if (!allowedOrigin) {
        return rawReturnTo || "/";
    }

    if (!rawReturnTo) {
        return allowedOrigin;
    }

    try {
        const parsed = new URL(rawReturnTo);
        const parsedOrigin = normalizeOrigin(parsed.origin);
        if (!parsedOrigin || parsedOrigin !== allowedOrigin) {
            return allowedOrigin;
        }
        return parsed.toString();
    } catch (error) {
        return allowedOrigin;
    }
}

function normalizeOrigin(value) {
    if (!value) {
        return null;
    }

    try {
        const parsed = new URL(String(value).trim());
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return null;
        }
        return `${parsed.protocol}//${parsed.host}`;
    } catch (error) {
        return null;
    }
}

function getRedirectUri(request, env) {
    if (env.GITHUB_REDIRECT_URI) {
        return env.GITHUB_REDIRECT_URI;
    }
    const requestUrl = new URL(request.url);
    return `${requestUrl.origin}/auth/callback`;
}

function cookieOptionsForRequest(env, overrides) {
    // This worker is intentionally cross-site to the main app origin.
    // Keep one stable policy: SameSite=None + Secure + Partitioned (CHIPS).
    // oauthCookieOptionsForRequest overrides partitioning for transient OAuth state.
    return {
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "None",
        partitioned: true,
        domain: env.COOKIE_DOMAIN || undefined,
        ...overrides,
    };
}

function oauthCookieOptionsForRequest(env, overrides) {
    return cookieOptionsForRequest(env, {
        sameSite: "None",
        partitioned: false,
        ...(overrides || {}),
    });
}

function buildMissingSessionHint(request) {
    const origin = request.headers.get("Origin") || "";
    if (/^http:\/\/(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/i.test(origin)) {
        return "Localhost is cross-site to github-auth.kendell.uk. Clear gha_session/gha_oauth cookies and retry.";
    }
    return "No session cookie was received. Clear gha_session/gha_oauth cookies and sign in again.";
}

async function decodeSessionPayloadIfValid(signedValue, sessionSecret) {
    const payload = await decodeSignedPayload(signedValue, sessionSecret);
    if (!payload || !payload.token || !payload.createdAt) {
        return null;
    }

    if (Date.now() - Number(payload.createdAt) > SESSION_MAX_AGE_SECONDS * 1000) {
        return null;
    }

    return payload;
}

function serializeCookie(name, value, options) {
    const opts = options || {};
    const parts = [`${name}=${encodeURIComponent(value || "")}`];

    if (typeof opts.maxAge === "number") {
        parts.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAge))}`);
    }

    parts.push(`Path=${opts.path || "/"}`);

    if (opts.domain) {
        parts.push(`Domain=${opts.domain}`);
    }

    if (opts.httpOnly !== false) {
        parts.push("HttpOnly");
    }

    if (opts.secure !== false) {
        parts.push("Secure");
    }

    if (opts.sameSite) {
        parts.push(`SameSite=${opts.sameSite}`);
    }

    if (opts.partitioned) {
        parts.push("Partitioned");
    }

    return parts.join("; ");
}

function parseCookies(cookieHeader) {
    if (!cookieHeader) {
        return {};
    }

    const cookies = {};
    cookieHeader.split(";").forEach((chunk) => {
        const [key, ...rest] = chunk.split("=");
        if (!key) {
            return;
        }

        const name = key.trim();
        const rawValue = rest.join("=").trim();
        try {
            cookies[name] = decodeURIComponent(rawValue);
        } catch (error) {
            cookies[name] = rawValue;
        }
    });

    return cookies;
}

function mustGetEnv(env, key) {
    const value = env[key];
    if (!value) {
        throw new Error(`Missing required secret: ${key}`);
    }
    return value;
}

async function encodeSignedPayload(payload, secret) {
    const json = JSON.stringify(payload);
    const base = base64UrlEncode(textEncoder.encode(json));
    const signature = await signValue(base, secret);
    return `${base}.${signature}`;
}

async function decodeSignedPayload(signedValue, secret) {
    if (!signedValue || typeof signedValue !== "string") {
        return null;
    }

    const [base, signature] = signedValue.split(".");
    if (!base || !signature) {
        return null;
    }

    const expectedSignature = await signValue(base, secret);
    if (!safeStringEqual(signature, expectedSignature)) {
        return null;
    }

    try {
        const decoded = textDecoder.decode(base64UrlDecode(base));
        return JSON.parse(decoded);
    } catch (error) {
        return null;
    }
}

async function signValue(value, secret) {
    let key = hmacKeyCache.get(secret);
    if (!key) {
        key = await crypto.subtle.importKey(
            "raw",
            textEncoder.encode(secret),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"],
        );
        hmacKeyCache.set(secret, key);
    }

    const signatureBuffer = await crypto.subtle.sign(
        "HMAC",
        key,
        textEncoder.encode(value),
    );

    return base64UrlEncode(new Uint8Array(signatureBuffer));
}

function safeStringEqual(left, right) {
    if (typeof left !== "string" || typeof right !== "string") {
        return false;
    }
    if (left.length !== right.length) {
        return false;
    }

    let mismatch = 0;
    for (let index = 0; index < left.length; index += 1) {
        mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
    }

    return mismatch === 0;
}

function base64UrlEncode(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }

    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function base64UrlDecode(value) {
    const normalized = String(value)
        .replace(/-/g, "+")
        .replace(/_/g, "/");
    const padLength = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
    const padded = normalized + "=".repeat(padLength);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
}

function randomToken(byteLength) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return base64UrlEncode(bytes);
}

async function pkceChallengeFromVerifier(verifier) {
    const digestBuffer = await crypto.subtle.digest(
        "SHA-256",
        textEncoder.encode(verifier),
    );
    return base64UrlEncode(new Uint8Array(digestBuffer));
}

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
