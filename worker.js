const SESSION_COOKIE_NAME = "gha_session";
const OAUTH_COOKIE_NAME = "gha_oauth";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const OAUTH_MAX_AGE_SECONDS = 60 * 10;

const DEFAULT_ALLOWED_ORIGINS = [
    "https://kendell.uk",
    "https://www.kendell.uk",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
];

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const hmacKeyCache = new Map();

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
        cookieOptionsForRequest(request, env, {
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

    if (oauthPayload.mode === "popup") {
        const html = buildPopupCompletionHtml(
            true,
            "Authentication complete. You can close this window.",
            oauthPayload.origin,
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
                SESSION_COOKIE_NAME,
                signedSessionPayload,
                cookieOptionsForRequest(request, env, {
                    maxAge: SESSION_MAX_AGE_SECONDS,
                }),
            ),
        );
        response.headers.append(
            "Set-Cookie",
            serializeCookie(
                OAUTH_COOKIE_NAME,
                "",
                cookieOptionsForRequest(request, env, {
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
        cookieOptionsForRequest(request, env, {
          maxAge: SESSION_MAX_AGE_SECONDS,
        }),
      ),
      serializeCookie(
        OAUTH_COOKIE_NAME,
        "",
        cookieOptionsForRequest(request, env, {
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
                clearSessionCookie(response, request, env);
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

async function handleApiLogout(request, env, corsHeaders) {
    const response = jsonResponse({ ok: true }, 200, corsHeaders);
    clearSessionCookie(response, request, env);
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

    if (Object.keys(files).length === 0) {
        return jsonResponse({ error: "No files provided." }, 400, corsHeaders);
    }

    let canPush = false;
    try {
        const access = await getRepoAccessForUser(session.token, owner, repo);
        canPush = !!(access && access.canPush);
    } catch (error) {
        if (error.status === 401) {
            const response = jsonResponse({ error: "GitHub session expired." }, 401, corsHeaders);
            clearSessionCookie(response, request, env);
            return response;
        }
        throw error;
    }

    const sortedPaths = Object.keys(files).sort();

    if (canPush) {
        try {
            const commit = await createCommitOnBranch({
                token: session.token,
                owner,
                repo,
                branch: baseBranch,
                commitMessage,
                files,
            });

            return jsonResponse({
                mode: "direct",
                branch: baseBranch,
                files: sortedPaths,
                commitSha: commit.sha,
                url: commit.url,
            }, 200, corsHeaders);
        } catch (error) {
            if (!shouldFallbackToPullRequest(error)) {
                throw error;
            }
        }
    }

    const pullRequest = await createPullRequestFromFork({
        token: session.token,
        owner,
        repo,
        baseBranch,
        commitMessage,
        files,
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

function shouldFallbackToPullRequest(error) {
    if (!error || typeof error !== "object") {
        return false;
    }

    if (error.status === 403 || error.status === 404) {
        return true;
    }

    if (error.status === 422) {
        const message = String(error.message || "").toLowerCase();
        return message.includes("protected branch")
            || message.includes("resource not accessible")
            || message.includes("not a fast forward");
    }

    return false;
}

async function createPullRequestFromFork(options) {
    const {
        token,
        owner,
        repo,
        baseBranch,
        commitMessage,
        files,
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
    });

    const changeList = Object.keys(files).sort().map((path) => `- \`${path}\``).join("\n");
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

        const treeEntries = Object.keys(files).sort().map((path) => ({
            path,
            mode: "100644",
            type: "blob",
            content: files[path],
        }));

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
    const { method = "GET", token, body } = options || {};
    const response = await fetch(`https://api.github.com${path}`, {
        method,
        headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
            "User-Agent": "kendell-github-auth-worker",
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });

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
    if (!rawFiles || typeof rawFiles !== "object" || Array.isArray(rawFiles)) {
        throw new Error("files must be an object: { path: markdown }.");
    }

    const normalized = {};
    let totalLength = 0;

    for (const [rawPath, rawContent] of Object.entries(rawFiles)) {
        const path = normalizeRepoPath(rawPath);
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

function normalizeRepoPath(value) {
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

function encodeRefName(value) {
    return encodeURIComponent(value);
}

async function readSession(request, env) {
    const sessionSecret = env.SESSION_SECRET;
    if (!sessionSecret) {
        return null;
    }

    const cookies = parseCookies(request.headers.get("Cookie"));
    const signed = cookies[SESSION_COOKIE_NAME];
    if (!signed) {
        return null;
    }

    const payload = await decodeSignedPayload(signed, sessionSecret);
    if (!payload || !payload.token || !payload.createdAt) {
        return null;
    }

    if (Date.now() - Number(payload.createdAt) > SESSION_MAX_AGE_SECONDS * 1000) {
        return null;
    }

    return payload;
}

function clearSessionCookie(response, request, env) {
    response.headers.append(
        "Set-Cookie",
        serializeCookie(
            SESSION_COOKIE_NAME,
            "",
            cookieOptionsForRequest(request, env, { maxAge: 0 }),
        ),
    );
}

function buildPopupCompletionHtml(ok, message, origin) {
    const safeMessage = escapeHtml(message || "Authentication complete.");
    const targetOrigin = JSON.stringify(origin || "*");
    const payload = JSON.stringify({ type: "github-auth-complete", ok, message: message || "" });

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
    const fallbackOrigin = chooseAllowedOrigin(null, env) || new URL(request.url).origin;
    const origin = oauthPayload && oauthPayload.origin
        ? chooseAllowedOrigin(oauthPayload.origin, env) || fallbackOrigin
        : fallbackOrigin;
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
                cookieOptionsForRequest(request, env, { maxAge: 0 }),
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
        cookieOptionsForRequest(request, env, { maxAge: 0 }),
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
        headers.set("Access-Control-Allow-Headers", "Content-Type");
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
    const origin = request.headers.get("Origin");
    if (!origin) {
        return {};
    }

    const allowedOrigins = getAllowedOrigins(env);
    if (!allowedOrigins.includes(origin)) {
        return {};
    }

    return {
        "Access-Control-Allow-Origin": origin,
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

function chooseAllowedOrigin(origin, env) {
    const normalized = normalizeOrigin(origin);
    const allowedOrigins = getAllowedOrigins(env);
    if (normalized && allowedOrigins.includes(normalized)) {
        return normalized;
    }
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

function cookieOptionsForRequest(request, env, overrides) {
  const requestUrl = new URL(request.url);
  const secureByDefault = requestUrl.protocol === "https:";
  const partitioned = String(env.COOKIE_PARTITIONED || "").toLowerCase() === "true";
  let sameSite = resolveCookieSameSite(env.COOKIE_SAME_SITE);
  let secure = env.COOKIE_SECURE === "false" ? false : secureByDefault;

  if (partitioned) {
    // CHIPS cookies are cross-site by design and need SameSite=None.
    sameSite = "None";
  }

  if (sameSite === "None") {
    // Browsers require Secure when SameSite=None.
    secure = true;
  }

  return {
    path: "/",
    httpOnly: true,
    secure,
    sameSite,
    partitioned,
    domain: env.COOKIE_DOMAIN || undefined,
    ...overrides,
  };
}

function buildMissingSessionHint(request) {
  const origin = request.headers.get("Origin") || "";
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
    return "Localhost is cross-site to github-auth.kendell.uk. Set COOKIE_SAME_SITE=None and COOKIE_PARTITIONED=true, keep COOKIE_SECURE enabled, and clear gha_session/gha_oauth cookies before retrying.";
  }
  return "No session cookie was received. Clear gha_session/gha_oauth cookies and sign in again.";
}

function resolveCookieSameSite(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "none") {
    return "None";
  }
  if (normalized === "strict") {
    return "Strict";
  }
  return "Lax";
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
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
