(function () {
  "use strict";

  const INTRO_PATH = "sections/supplement/introduction.md";
  const PROCEDURE_LEVELS = ["beginner", "intermediate", "advanced"];
  const PROCEDURE_LABELS = {
    beginner: "Beginner",
    intermediate: "Intermediate",
    advanced: "Advanced",
  };
  const CALLOUT_KINDS = ["info", "warning", "danger"];
  const CALLOUT_LABELS = {
    info: "Info",
    warning: "Warning",
    danger: "Danger",
  };
  const AUTH_WORKER_ORIGIN = resolveAuthWorkerOrigin();
  const AUTH_POPUP_NAME = "github-auth-popup";
  const AUTH_POPUP_FEATURES = "popup=yes,width=620,height=780,resizable=yes,scrollbars=yes";
  const AUTH_MESSAGE_TYPE = "github-auth-complete";
  const AUTH_PROFILE_STORAGE_KEY = "inline-editor-github-profile";
  const state = {
    busy: false,
    authBusy: false,
    editMode: false,
    drafts: new Map(),
    sourceMarkdown: new Map(),
    currentPath: null,
    statusTimeoutId: null,
    editorHistory: [],
    editorHistoryIndex: -1,
    applyingHistoryEntry: false,
    selectedProcedureLevel: PROCEDURE_LEVELS[0],
    selectedCalloutKind: CALLOUT_KINDS[0],
    authSession: null,
    authRefreshPromise: null,
    authPopupPollId: null,
    authPopupWindow: null,
    authBusyMessage: "",
  };

  const elements = {
    toolbar: null,
    authButton: null,
    authUser: null,
    toggleButton: null,
    submitButton: null,
    clearButton: null,
    status: null,
    modal: null,
    modalPath: null,
    modalTextarea: null,
    modalSave: null,
    modalReset: null,
  };

  function normalizeSourcePath(path) {
    if (!path) {
      return null;
    }
    return String(path).replace(/^\/+/, "");
  }

  function sectionIdFromPath(path) {
    if (!path || !path.startsWith("sections/") || !path.endsWith(".md")) {
      return null;
    }
    return path.slice("sections/".length, -".md".length);
  }

  function resolveRepoConfig() {
    const owner = typeof CONTENT_REPO_OWNER === "string"
      ? CONTENT_REPO_OWNER
      : "";
    const name = typeof CONTENT_REPO_NAME === "string"
      ? CONTENT_REPO_NAME
      : "";
    const baseBranch = typeof CONTENT_REPO_BRANCH === "string"
      ? CONTENT_REPO_BRANCH
      : "unknown";

    if (!owner || !name) {
      return null;
    }
    console.log(`Resolved content repository: ${owner}/${name} (branch: ${baseBranch})`);
    return { owner, name, baseBranch };
  }

  function resolveAuthWorkerOrigin() {
    const meta = document.querySelector("meta[name='github-auth-origin']");
    const fromMeta = meta ? meta.getAttribute("content") : "";
    const fromWindow = typeof window.GITHUB_AUTH_ORIGIN === "string"
      ? window.GITHUB_AUTH_ORIGIN
      : "";
    const fallback = "https://github-auth.kendell.uk";
    return String(fromMeta || fromWindow || fallback).replace(/\/+$/, "");
  }

  function readStoredAuthProfile() {
    try {
      const raw = localStorage.getItem(AUTH_PROFILE_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function storeAuthProfile(sessionPayload) {
    if (!sessionPayload || !sessionPayload.user || !sessionPayload.user.login) {
      return;
    }
    const profile = {
      login: sessionPayload.user.login,
      name: sessionPayload.user.name || "",
      avatarUrl: sessionPayload.user.avatarUrl || "",
      lastSeenAt: Date.now(),
    };
    try {
      localStorage.setItem(AUTH_PROFILE_STORAGE_KEY, JSON.stringify(profile));
    } catch (error) {
      // Ignore storage errors (privacy mode / quota).
    }
  }

  function clearAuthProfile() {
    try {
      localStorage.removeItem(AUTH_PROFILE_STORAGE_KEY);
    } catch (error) {
      // Ignore storage errors.
    }
  }

  async function authRequest(path, options) {
    const { method = "GET", body } = options || {};
    const response = await fetch(`${AUTH_WORKER_ORIGIN}${path}`, {
      method,
      credentials: "include",
      headers: body === undefined
        ? undefined
        : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }

    if (!response.ok) {
      const message = payload && payload.error
        ? payload.error
        : `Auth request failed (${response.status})`;
      const err = new Error(message);
      err.status = response.status;
      err.payload = payload;
      throw err;
    }

    return payload;
  }

  function setAuthBusy(isBusy, message) {
    state.authBusy = isBusy;
    state.authBusyMessage = isBusy ? String(message || "") : "";
    updateToolbar();
    updateAuthUi();
  }

  function getAuthAccessLabel(sessionPayload) {
    const repoAccess = sessionPayload && sessionPayload.repoAccess
      ? sessionPayload.repoAccess
      : null;
    if (!repoAccess) {
      return "publish";
    }
    return repoAccess.canPush ? "direct commit" : "PR fallback";
  }

  function updateAuthUi() {
    if (!elements.authButton || !elements.authUser) {
      return;
    }

    const sessionPayload = state.authSession;
    if (state.authBusy) {
      elements.authButton.textContent = "Working...";
      elements.authButton.disabled = true;
      elements.authUser.textContent = state.authBusyMessage || "Checking GitHub session...";
      return;
    }

    if (sessionPayload && sessionPayload.authenticated) {
      const login = sessionPayload.user && sessionPayload.user.login
        ? sessionPayload.user.login
        : "";
      elements.authButton.textContent = "Sign Out";
      elements.authButton.disabled = state.busy;
      elements.authButton.setAttribute("data-auth-state", "signed-in");
      elements.authUser.textContent = login
        ? `@${login} (${getAuthAccessLabel(sessionPayload)})`
        : "Signed in";
      return;
    }

    const cached = readStoredAuthProfile();
    elements.authButton.textContent = "Sign In";
    elements.authButton.disabled = state.busy;
    elements.authButton.setAttribute("data-auth-state", "signed-out");
    elements.authUser.textContent = cached && cached.login
      ? `Signed out (last: @${cached.login})`
      : "Not signed in";
  }

  async function refreshAuthSession() {
    if (state.authRefreshPromise) {
      return state.authRefreshPromise;
    }

    const repo = resolveRepoConfig();
    if (!repo) {
      state.authSession = null;
      updateAuthUi();
      return null;
    }

    state.authRefreshPromise = (async () => {
      try {
        const query = new URLSearchParams({
          owner: repo.owner,
          repo: repo.name,
        });
        const sessionPayload = await authRequest(`/api/session?${query.toString()}`);
        state.authSession = sessionPayload;
        if (sessionPayload && sessionPayload.authenticated) {
          storeAuthProfile(sessionPayload);
        }
      } catch (error) {
        if (error && error.status === 401) {
          state.authSession = null;
        } else {
          console.error(error);
        }
      } finally {
        updateAuthUi();
      }
      return state.authSession;
    })();

    try {
      return await state.authRefreshPromise;
    } finally {
      state.authRefreshPromise = null;
    }
  }

  function startAuthPopupPolling(popupWindow) {
    if (state.authPopupPollId) {
      window.clearInterval(state.authPopupPollId);
      state.authPopupPollId = null;
    }

    state.authPopupPollId = window.setInterval(() => {
      if (!popupWindow || popupWindow.closed) {
        window.clearInterval(state.authPopupPollId);
        state.authPopupPollId = null;
        state.authPopupWindow = null;
        setAuthBusy(false);
        refreshAuthSession().then((sessionPayload) => {
          if (!sessionPayload || !sessionPayload.authenticated) {
            setStatus("GitHub sign-in was cancelled or did not complete.", true);
          }
        });
      }
    }, 600);
  }

  function buildAuthLoginUrl(mode) {
    const authUrl = new URL(`${AUTH_WORKER_ORIGIN}/auth/login`);
    authUrl.searchParams.set("origin", window.location.origin);
    authUrl.searchParams.set("return_to", window.location.href);
    authUrl.searchParams.set("mode", mode || "popup");
    return authUrl.toString();
  }

  function startGitHubSignIn() {
    if (state.authBusy) {
      return;
    }

    if (state.authPopupWindow && !state.authPopupWindow.closed) {
      try {
        state.authPopupWindow.focus();
      } catch (error) {
        // Ignore focus failures.
      }
      setStatus("GitHub sign-in is already in progress.");
      return;
    }

    setAuthBusy(true, "Complete GitHub sign-in in the popup.");

    const popupWindow = window.open(
      buildAuthLoginUrl("popup"),
      AUTH_POPUP_NAME,
      AUTH_POPUP_FEATURES,
    );

    if (!popupWindow || popupWindow.closed || typeof popupWindow.closed === "undefined") {
      setAuthBusy(false);
      window.location.href = buildAuthLoginUrl("redirect");
      return;
    }

    state.authPopupWindow = popupWindow;
    try {
      popupWindow.focus();
    } catch (error) {
      // Ignore focus failures.
    }
    setStatus("Complete GitHub sign-in in the popup.");
    startAuthPopupPolling(popupWindow);
  }

  async function signOutGitHub() {
    setAuthBusy(true, "Signing out...");
    try {
      await authRequest("/api/logout", { method: "POST" });
      state.authSession = null;
      clearAuthProfile();
      setStatus("Signed out.");
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Could not sign out.", true);
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleAuthButtonClick() {
    if (state.authBusy || state.busy) {
      return;
    }

    if (state.authSession && state.authSession.authenticated) {
      await signOutGitHub();
      return;
    }

    startGitHubSignIn();
  }

  function handleAuthPopupMessage(event) {
    if (event.origin !== AUTH_WORKER_ORIGIN) {
      return;
    }

    const payload = event.data;
    if (!payload || payload.type !== AUTH_MESSAGE_TYPE) {
      return;
    }

    if (state.authPopupPollId) {
      window.clearInterval(state.authPopupPollId);
      state.authPopupPollId = null;
    }
    state.authPopupWindow = null;

    if (!payload.ok) {
      setAuthBusy(false);
      setStatus(payload.message || "GitHub sign-in failed.", true);
      return;
    }

    setAuthBusy(false);
    refreshAuthSession().then(() => {
      if (state.authSession && state.authSession.authenticated) {
        setStatus("GitHub sign-in complete.");
      } else {
        setStatus("GitHub sign-in completed but session was not available. Retry once.", true);
      }
    });
  }

  async function ensureSignedIn() {
    if (state.authBusy) {
      setStatus("GitHub sign-in is already in progress.");
      return false;
    }

    if (state.authSession && state.authSession.authenticated) {
      return true;
    }

    await refreshAuthSession();
    if (state.authSession && state.authSession.authenticated) {
      return true;
    }

    const shouldSignIn = window.confirm("Sign in with GitHub to publish your drafts?");
    if (!shouldSignIn) {
      return false;
    }

    startGitHubSignIn();
    setStatus("Sign in, then click Publish again.", true);
    return false;
  }

  function showAuthErrorFromUrl() {
    const url = new URL(window.location.href);
    const authError = url.searchParams.get("auth_error");
    if (!authError) {
      return;
    }

    setStatus(`GitHub sign-in failed: ${authError}`, true);
    url.searchParams.delete("auth_error");
    window.history.replaceState({}, document.title, url.toString());
  }

  function setStatus(message, isError) {
    if (!elements.status) {
      return;
    }

    if (state.statusTimeoutId) {
      clearTimeout(state.statusTimeoutId);
      state.statusTimeoutId = null;
    }

    elements.status.textContent = message || "";
    elements.status.classList.toggle("error", !!isError);

    if (!message) {
      return;
    }

    const timeoutMs = isError ? 5000 : 2000;
    state.statusTimeoutId = window.setTimeout(() => {
      if (!elements.status) {
        return;
      }
      elements.status.textContent = "";
      elements.status.classList.remove("error");
      state.statusTimeoutId = null;
    }, timeoutMs);
  }

  function setBusy(isBusy) {
    state.busy = isBusy;
    const disableToolbarActions = isBusy || state.authBusy;
    if (elements.toggleButton) {
      elements.toggleButton.disabled = disableToolbarActions;
    }
    if (elements.submitButton) {
      elements.submitButton.disabled = disableToolbarActions || state.drafts.size === 0;
    }
    if (elements.clearButton) {
      elements.clearButton.disabled = disableToolbarActions || state.drafts.size === 0;
    }
    if (elements.authButton) {
      elements.authButton.disabled = disableToolbarActions;
    }
    if (elements.modalSave) {
      elements.modalSave.disabled = disableToolbarActions;
    }
  }

  function updateToolbar() {
    if (!elements.toggleButton || !elements.submitButton || !elements.clearButton) {
      return;
    }

    const hasDrafts = state.drafts.size > 0;
    elements.toggleButton.textContent = state.editMode
      ? "Disable Edit Mode"
      : "Enable Edit Mode";
    elements.submitButton.textContent = `Publish (${state.drafts.size})`;
    elements.submitButton.hidden = !hasDrafts;
    elements.clearButton.hidden = !hasDrafts;
    elements.submitButton.disabled = state.busy || state.authBusy || !hasDrafts;
    elements.clearButton.disabled = state.busy || state.authBusy || !hasDrafts;
    updateAuthUi();
  }

  function renderPreface(markdown) {
    const preface = document.getElementById("preface-content");
    if (!preface || typeof marked === "undefined") {
      return;
    }

    const titleAndContent = typeof extractTitleAndContentFromMarkdown === "function"
      ? extractTitleAndContentFromMarkdown(markdown)
      : { content: markdown };
    const introEditUrl = typeof getGitHubEditUrl === "function"
      ? getGitHubEditUrl(INTRO_PATH)
      : null;
    const introEditLink = document.getElementById("intro-edit-link");
    if (introEditLink) {
      introEditLink.setAttribute("data-source-path", INTRO_PATH);
      if (introEditUrl) {
        introEditLink.setAttribute("href", introEditUrl);
        introEditLink.setAttribute("target", "_blank");
        introEditLink.setAttribute("rel", "noopener noreferrer");
      } else {
        introEditLink.removeAttribute("href");
        introEditLink.removeAttribute("target");
        introEditLink.removeAttribute("rel");
      }
    }

    preface.innerHTML = marked.parse(titleAndContent.content);
    if (typeof normalizeInternalHashLinks === "function") {
      normalizeInternalHashLinks(preface);
    }
    if (typeof wrapTables === "function") {
      wrapTables(preface);
    }
    if (typeof optimizeSectionMedia === "function") {
      optimizeSectionMedia(preface);
    }
  }

  function renderSectionFromDraft(path, markdown) {
    if (path === INTRO_PATH) {
      renderPreface(markdown);
      return true;
    }

    const sectionId = sectionIdFromPath(path);
    if (!sectionId || typeof markdownToSection !== "function") {
      return false;
    }

    const existing = document.getElementById(sectionId);
    if (!existing) {
      return false;
    }

    const wasCollapsed = existing.classList.contains("collapsed");
    const replacement = markdownToSection(markdown, sectionId);
    replacement.classList.toggle("collapsed", wasCollapsed);

    const replacementHeader = replacement.querySelector(".section-header");
    if (replacementHeader) {
      replacementHeader.setAttribute("aria-expanded", String(!wasCollapsed));
    }

    existing.replaceWith(replacement);

    if (typeof setupSectionToggle === "function") {
      setupSectionToggle();
    }
    if (typeof generateSidebar === "function") {
      generateSidebar();
    }
    if (typeof setupSidebarLinks === "function") {
      setupSidebarLinks();
    }
    if (typeof setupActiveTracking === "function") {
      setupActiveTracking();
    }
    if (typeof window.updateActiveLink === "function") {
      window.updateActiveLink();
    }

    return true;
  }

  function closeModal() {
    if (!elements.modal) {
      return;
    }
    elements.modal.hidden = true;
    state.currentPath = null;
    if (elements.modalTextarea) {
      elements.modalTextarea.value = "";
    }
  }

  function openModal(path, markdown) {
    if (!elements.modal || !elements.modalPath || !elements.modalTextarea) {
      return;
    }
    state.currentPath = path;
    elements.modalPath.textContent = path;
    elements.modalTextarea.value = markdown;
    elements.modalTextarea.scrollTop = 0;
    elements.modalTextarea.scrollLeft = 0;
    elements.modalTextarea.setSelectionRange(0, 0);
    initializeEditorHistory();
    updateVariantControlState();
    syncCurrentEditorDraft();
    elements.modal.hidden = false;
    const formatToolbar = elements.modal.querySelector(".inline-editor-format-toolbar");
    if (formatToolbar) {
      formatToolbar.scrollLeft = 0;
    }
    window.requestAnimationFrame(() => {
      updateFormatToolbarScrollState();
    });
    elements.modalTextarea.focus();
    elements.modalTextarea.scrollTop = 0;
    elements.modalTextarea.scrollLeft = 0;
  }

  function nextValueInCycle(values, currentValue) {
    const currentIndex = values.indexOf(currentValue);
    if (currentIndex === -1) {
      return values[0];
    }
    return values[(currentIndex + 1) % values.length];
  }

  function updateFormatToolbarScrollState() {
    if (!elements.modal) {
      return;
    }
    const formatToolbar = elements.modal.querySelector(".inline-editor-format-toolbar");
    if (!formatToolbar) {
      return;
    }

    const overflowDistance = formatToolbar.scrollWidth - formatToolbar.clientWidth;
    const isScrollable = overflowDistance > 1;
    const maxScrollLeft = Math.max(0, overflowDistance);
    const scrollLeft = formatToolbar.scrollLeft;
    const atStart = scrollLeft <= 1;
    const atEnd = scrollLeft >= maxScrollLeft - 1;

    formatToolbar.classList.toggle("is-scrollable", isScrollable);
    formatToolbar.classList.toggle("is-centered", !isScrollable);
    formatToolbar.classList.toggle("at-start", atStart);
    formatToolbar.classList.toggle("at-end", atEnd);
  }

  function updateVariantControlState() {
    if (!elements.modal) {
      return;
    }

    const procedureInsertButton = elements.modal.querySelector(
      "button[data-format-action=\"procedure-insert\"]",
    );
    const procedureLabel = elements.modal.querySelector("[data-variant-label=\"procedure\"]");
    const procedureCycleButton = elements.modal.querySelector(
      "button[data-format-cycle=\"procedure\"]",
    );
    const procedureLevelLabel = PROCEDURE_LABELS[state.selectedProcedureLevel] || PROCEDURE_LABELS.beginner;
    if (procedureInsertButton) {
      procedureInsertButton.setAttribute("data-selected-level", state.selectedProcedureLevel);
      procedureInsertButton.setAttribute(
        "title",
        `Insert ${procedureLevelLabel.toLowerCase()} procedure (Cmd/Ctrl+Alt+1)`,
      );
      procedureInsertButton.setAttribute(
        "aria-label",
        `Insert ${procedureLevelLabel.toLowerCase()} procedure`,
      );
    }
    if (procedureLabel) {
      procedureLabel.textContent = `Procedure: ${procedureLevelLabel}`;
    }
    if (procedureCycleButton) {
      procedureCycleButton.setAttribute(
        "title",
        `Switch procedure level (Cmd/Ctrl+Alt+Shift+1). Current: ${procedureLevelLabel}`,
      );
      procedureCycleButton.setAttribute(
        "aria-label",
        `Switch procedure level. Current: ${procedureLevelLabel}`,
      );
    }

    const calloutInsertButton = elements.modal.querySelector(
      "button[data-format-action=\"callout-insert\"]",
    );
    const calloutLabel = elements.modal.querySelector("[data-variant-label=\"callout\"]");
    const calloutCycleButton = elements.modal.querySelector(
      "button[data-format-cycle=\"callout\"]",
    );
    const calloutKindLabel = CALLOUT_LABELS[state.selectedCalloutKind] || CALLOUT_LABELS.info;
    if (calloutInsertButton) {
      calloutInsertButton.setAttribute("data-selected-kind", state.selectedCalloutKind);
      calloutInsertButton.setAttribute(
        "title",
        `Insert ${calloutKindLabel.toLowerCase()} callout (Cmd/Ctrl+Alt+2)`,
      );
      calloutInsertButton.setAttribute(
        "aria-label",
        `Insert ${calloutKindLabel.toLowerCase()} callout`,
      );
    }
    if (calloutLabel) {
      calloutLabel.textContent = `Callout: ${calloutKindLabel}`;
    }
    if (calloutCycleButton) {
      calloutCycleButton.setAttribute(
        "title",
        `Switch callout type (Cmd/Ctrl+Alt+Shift+2). Current: ${calloutKindLabel}`,
      );
      calloutCycleButton.setAttribute(
        "aria-label",
        `Switch callout type. Current: ${calloutKindLabel}`,
      );
    }
    updateFormatToolbarScrollState();
  }

  function cycleProcedureLevel() {
    state.selectedProcedureLevel = nextValueInCycle(
      PROCEDURE_LEVELS,
      state.selectedProcedureLevel,
    );
    updateVariantControlState();
  }

  function cycleCalloutKind() {
    state.selectedCalloutKind = nextValueInCycle(
      CALLOUT_KINDS,
      state.selectedCalloutKind,
    );
    updateVariantControlState();
  }

  async function openEditor(path) {
    const normalizedPath = normalizeSourcePath(path);
    if (!normalizedPath) {
      return;
    }

    try {
      setStatus("");
      const draft = state.drafts.get(normalizedPath);
      if (typeof draft === "string") {
        if (!state.sourceMarkdown.has(normalizedPath)) {
          fetchMarkdownFromSource(normalizedPath)
            .then((sourceMarkdown) => {
              state.sourceMarkdown.set(normalizedPath, sourceMarkdown);
            })
            .catch((error) => {
              console.error(error);
            });
        }
        openModal(normalizedPath, draft);
        return;
      }

      const response = await fetch(normalizedPath, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Unable to load ${normalizedPath} (${response.status})`);
      }
      const markdown = await response.text();
      state.sourceMarkdown.set(normalizedPath, markdown);
      openModal(normalizedPath, markdown);
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Could not open editor.", true);
    }
  }

  async function fetchMarkdownFromSource(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Unable to reload ${path} (${response.status})`);
    }
    return response.text();
  }

  async function getSourceMarkdown(path) {
    if (!path) {
      return "";
    }

    if (state.sourceMarkdown.has(path)) {
      return state.sourceMarkdown.get(path);
    }

    const sourceMarkdown = await fetchMarkdownFromSource(path);
    state.sourceMarkdown.set(path, sourceMarkdown);
    return sourceMarkdown;
  }

  async function saveDraft() {
    if (!state.currentPath || !elements.modalTextarea) {
      return;
    }

    const markdown = elements.modalTextarea.value;
    const path = state.currentPath;

    try {
      const sourceMarkdown = await getSourceMarkdown(path);
      if (markdown === sourceMarkdown) {
        state.drafts.delete(path);
        renderSectionFromDraft(path, sourceMarkdown);
        updateToolbar();
        setStatus(`No changes in ${path}; draft discarded.`);
        closeModal();
        return;
      }

      state.drafts.set(path, markdown);
      renderSectionFromDraft(path, markdown);
      updateToolbar();
      setStatus(`Draft saved for ${path}`);
      closeModal();
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Could not save draft.", true);
    }
  }

  function syncCurrentEditorDraft() {
    if (!state.currentPath || !elements.modalTextarea) {
      return;
    }

    const path = state.currentPath;
    const markdown = elements.modalTextarea.value;
    const sourceMarkdown = state.sourceMarkdown.get(path);

    if (typeof sourceMarkdown === "string" && markdown === sourceMarkdown) {
      state.drafts.delete(path);
    } else {
      state.drafts.set(path, markdown);
    }

    updateToolbar();
  }

  function replaceTextRange(textarea, start, end, replacement, nextSelectionStart, nextSelectionEnd) {
    textarea.setRangeText(replacement, start, end, "end");
    textarea.focus();
    textarea.setSelectionRange(nextSelectionStart, nextSelectionEnd);
    recordEditorHistorySnapshot();
    syncCurrentEditorDraft();
  }

  function countRunBackward(text, endIndexExclusive, marker) {
    let count = 0;
    for (let index = endIndexExclusive - 1; index >= 0; index -= 1) {
      if (text[index] !== marker) {
        break;
      }
      count += 1;
    }
    return count;
  }

  function countRunForward(text, startIndexInclusive, marker) {
    let count = 0;
    for (let index = startIndexInclusive; index < text.length; index += 1) {
      if (text[index] !== marker) {
        break;
      }
      count += 1;
    }
    return count;
  }

  function countRunFromStart(text, marker) {
    let count = 0;
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] !== marker) {
        break;
      }
      count += 1;
    }
    return count;
  }

  function countRunFromEnd(text, marker) {
    let count = 0;
    for (let index = text.length - 1; index >= 0; index -= 1) {
      if (text[index] !== marker) {
        break;
      }
      count += 1;
    }
    return count;
  }

  function toggleWrapSelection(prefix, suffix, placeholder) {
    if (!elements.modalTextarea) {
      return;
    }

    const textarea = elements.modalTextarea;
    const value = textarea.value;
    let start = textarea.selectionStart;
    let end = textarea.selectionEnd;

    if (start === end) {
      const expanded = expandCollapsedSelectionToWord(value, start);
      if (expanded) {
        start = expanded.start;
        end = expanded.end;
      }
    }

    const selected = value.slice(start, end);

    const hasOuterMarkers =
      start >= prefix.length &&
      end + suffix.length <= value.length &&
      value.slice(start - prefix.length, start) === prefix &&
      value.slice(end, end + suffix.length) === suffix;

    const isSingleCharSymmetricWrapper =
      prefix.length === 1 &&
      suffix.length === 1 &&
      prefix === suffix;

    let shouldUnwrapOuter = hasOuterMarkers;
    if (shouldUnwrapOuter && isSingleCharSymmetricWrapper) {
      const marker = prefix;
      const leftRun = countRunBackward(value, start, marker);
      const rightRun = countRunForward(value, end, marker);
      shouldUnwrapOuter = leftRun % 2 === 1 && rightRun % 2 === 1;
    }

    if (shouldUnwrapOuter) {
      replaceTextRange(
        textarea,
        start - prefix.length,
        end + suffix.length,
        selected,
        start - prefix.length,
        start - prefix.length + selected.length,
      );
      return;
    }

    const selectedHasMarkers =
      selected.length >= prefix.length + suffix.length &&
      selected.startsWith(prefix) &&
      selected.endsWith(suffix);

    let shouldUnwrapSelected = selectedHasMarkers;
    if (shouldUnwrapSelected && isSingleCharSymmetricWrapper) {
      const marker = prefix;
      const leftRun = countRunFromStart(selected, marker);
      const rightRun = countRunFromEnd(selected, marker);
      shouldUnwrapSelected = leftRun % 2 === 1 && rightRun % 2 === 1;
    }

    if (shouldUnwrapSelected) {
      const unwrapped = selected.slice(prefix.length, selected.length - suffix.length);
      replaceTextRange(textarea, start, end, unwrapped, start, start + unwrapped.length);
      return;
    }

    const content = selected || placeholder;
    const replacement = `${prefix}${content}${suffix}`;
    const nextStart = start + prefix.length;
    const nextEnd = nextStart + content.length;
    replaceTextRange(textarea, start, end, replacement, nextStart, nextEnd);
  }

  function isWordChar(character) {
    return /[A-Za-z0-9_]/.test(character);
  }

  function expandCollapsedSelectionToWord(text, cursorIndex) {
    if (!text) {
      return null;
    }

    let index = cursorIndex;
    const atCursor = text[index] || "";
    const beforeCursor = text[index - 1] || "";

    if (!isWordChar(atCursor) && isWordChar(beforeCursor)) {
      index -= 1;
    } else if (!isWordChar(atCursor)) {
      return null;
    }

    let start = index;
    let end = index + 1;
    while (start > 0 && isWordChar(text[start - 1])) {
      start -= 1;
    }
    while (end < text.length && isWordChar(text[end])) {
      end += 1;
    }

    if (start === end) {
      return null;
    }
    return { start, end };
  }

  function insertBlockAtSelection(block, selectStartOffset, selectEndOffset) {
    if (!elements.modalTextarea) {
      return;
    }

    const textarea = elements.modalTextarea;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    const before = value.slice(0, start);
    const after = value.slice(end);

    const needsLeadingNewline = before.length > 0 && !before.endsWith("\n");
    const needsTrailingNewline = after.length > 0 && !after.startsWith("\n");
    const prefix = needsLeadingNewline ? "\n" : "";
    const suffix = needsTrailingNewline ? "\n" : "";
    const replacement = `${prefix}${block}${suffix}`;

    const base = start + prefix.length;
    const nextStart = base + selectStartOffset;
    const nextEnd = base + selectEndOffset;
    replaceTextRange(textarea, start, end, replacement, nextStart, nextEnd);
  }

  function insertProcedureBlockAtCursor(skillLevel) {
    if (!elements.modalTextarea) {
      return;
    }

    const skill = skillLevel || "beginner";
    const procedureTag = `[!PROCEDURE:${skill}]`;
    const procedureTitle = "Procedure title";
    const procedureBlock = [
      `${procedureTag} ${procedureTitle}`,
      "",
      "Brief description.",
      "",
      "1. Step one",
      "",
      "[!/PROCEDURE]",
    ].join("\n");

    const titleStartOffset = `${procedureTag} `.length;
    const titleEndOffset = titleStartOffset + procedureTitle.length;
    insertBlockAtSelection(procedureBlock, titleStartOffset, titleEndOffset);
  }

  function insertCalloutBlockAtCursor(kind) {
    const typeMap = {
      info: { tag: "INFO", title: "Info title" },
      warning: { tag: "WARNING", title: "Warning title" },
      danger: { tag: "DANGER", title: "Danger title" },
    };
    const normalizedKind = typeof kind === "string" ? kind.toLowerCase() : "info";
    const config = typeMap[normalizedKind] || typeMap.info;
    const calloutBody = "Callout details.";
    const calloutBlock = [
      `> [!${config.tag}] ${config.title}`,
      `> ${calloutBody}`,
      ">",
      "> Add supporting details.",
    ].join("\n");

    const titleStartOffset = `> [!${config.tag}] `.length;
    const titleEndOffset = titleStartOffset + config.title.length;
    insertBlockAtSelection(calloutBlock, titleStartOffset, titleEndOffset);
  }

  function changeHeadingLevel(delta) {
    if (!elements.modalTextarea || (delta !== 1 && delta !== -1)) {
      return;
    }

    const textarea = elements.modalTextarea;
    const value = textarea.value;
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const lineStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
    let lineEnd = value.indexOf("\n", selectionEnd);
    if (lineEnd === -1) {
      lineEnd = value.length;
    }

    const selectedBlock = value.slice(lineStart, lineEnd);
    const adjustedBlock = selectedBlock.split("\n").map((line) => {
      const headingMatch = /^(\s{0,3})(#{1,6})\s+(.*)$/.exec(line);
      if (delta === 1) {
        if (headingMatch) {
          const hashes = headingMatch[2];
          if (hashes.length >= 6) {
            return line;
          }
          return `${headingMatch[1]}#${hashes} ${headingMatch[3]}`;
        }
        if (!line.trim()) {
          return line;
        }
        return `# ${line}`;
      }

      if (!headingMatch) {
        return line;
      }
      const hashes = headingMatch[2];
      if (hashes.length === 1) {
        return `${headingMatch[1]}${headingMatch[3]}`;
      }
      return `${headingMatch[1]}${hashes.slice(0, -1)} ${headingMatch[3]}`;
    }).join("\n");

    replaceTextRange(textarea, lineStart, lineEnd, adjustedBlock, lineStart, lineStart + adjustedBlock.length);
  }

  function insertInlineImageTemplate() {
    if (!elements.modalTextarea) {
      return;
    }

    const textarea = elements.modalTextarea;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedAlt = textarea.value.slice(start, end).trim() || "Image description";
    const pathPlaceholder = "imgs/your-image.jpg";
    const markdown = `![${selectedAlt}](${pathPlaceholder})`;
    const pathStartOffset = markdown.indexOf(pathPlaceholder);
    const pathEndOffset = pathStartOffset + pathPlaceholder.length;
    replaceTextRange(
      textarea,
      start,
      end,
      markdown,
      start + pathStartOffset,
      start + pathEndOffset,
    );
  }

  function insertVideoTemplate() {
    const videoId = "VIDEO_ID";
    const embed = `<div class="video-wrapper">
      <iframe src="https://www.youtube-nocookie.com/embed/${videoId}" title="Video title"></iframe>
</div>`;
    const idStartOffset = embed.indexOf(videoId);
    const idEndOffset = idStartOffset + videoId.length;
    insertBlockAtSelection(embed, idStartOffset, idEndOffset);
  }

  function insertFigureTemplate(variant) {
    const figureClassMap = {
      left: "figure figure-float-left",
      right: "figure figure-float-right",
      wide: "figure",
    };
    const figureClass = figureClassMap[variant] || "figure";
    const srcPath = "imgs/your-image.jpg";
    const figureTemplate = [
      `<figure class="${figureClass}">`,
      `  <img src="${srcPath}" alt="Describe image" />`,
      "  <div class=\"figure-body\">",
      "    <p class=\"figure-title\">Figure title</p>",
      "    <!-- <p class=\"figure-caption\">Caption text</p> -->",
      "  </div>",
      "</figure>",
    ].join("\n");

    const srcStartOffset = figureTemplate.indexOf(srcPath);
    const srcEndOffset = srcStartOffset + srcPath.length;
    insertBlockAtSelection(figureTemplate, srcStartOffset, srcEndOffset);
  }

  function getEditorHistoryEntryFromTextarea() {
    if (!elements.modalTextarea) {
      return null;
    }

    return {
      value: elements.modalTextarea.value,
      selectionStart: elements.modalTextarea.selectionStart,
      selectionEnd: elements.modalTextarea.selectionEnd,
    };
  }

  function applyEditorHistoryEntry(entry) {
    if (!elements.modalTextarea || !entry) {
      return;
    }

    state.applyingHistoryEntry = true;
    elements.modalTextarea.value = entry.value;
    elements.modalTextarea.focus();
    elements.modalTextarea.setSelectionRange(entry.selectionStart, entry.selectionEnd);
    state.applyingHistoryEntry = false;
  }

  function initializeEditorHistory() {
    const entry = getEditorHistoryEntryFromTextarea();
    state.editorHistory = entry ? [entry] : [];
    state.editorHistoryIndex = entry ? 0 : -1;
  }

  function recordEditorHistorySnapshot() {
    if (state.applyingHistoryEntry) {
      return;
    }

    const entry = getEditorHistoryEntryFromTextarea();
    if (!entry) {
      return;
    }

    if (state.editorHistoryIndex === -1 || state.editorHistory.length === 0) {
      state.editorHistory = [entry];
      state.editorHistoryIndex = 0;
      return;
    }

    const current = state.editorHistory[state.editorHistoryIndex];
    const unchanged = current &&
      current.value === entry.value &&
      current.selectionStart === entry.selectionStart &&
      current.selectionEnd === entry.selectionEnd;
    if (unchanged) {
      return;
    }

    if (state.editorHistoryIndex < state.editorHistory.length - 1) {
      state.editorHistory = state.editorHistory.slice(0, state.editorHistoryIndex + 1);
    }

    state.editorHistory.push(entry);
    state.editorHistoryIndex = state.editorHistory.length - 1;
  }

  function runHistoryAction(action) {
    if (!elements.modalTextarea || state.editorHistory.length === 0) {
      return;
    }

    if (action === "undo") {
      if (state.editorHistoryIndex <= 0) {
        return;
      }
      state.editorHistoryIndex -= 1;
      applyEditorHistoryEntry(state.editorHistory[state.editorHistoryIndex]);
      return;
    }

    if (action === "redo") {
      if (state.editorHistoryIndex >= state.editorHistory.length - 1) {
        return;
      }
      state.editorHistoryIndex += 1;
      applyEditorHistoryEntry(state.editorHistory[state.editorHistoryIndex]);
    }
  }

  function runFormatAction(action) {
    switch (action) {
      case "bold":
        toggleWrapSelection("**", "**", "bold text");
        break;
      case "italic":
        toggleWrapSelection("*", "*", "italic text");
        break;
      case "heading-increase":
        changeHeadingLevel(1);
        break;
      case "heading-decrease":
        changeHeadingLevel(-1);
        break;
      case "procedure-insert":
        insertProcedureBlockAtCursor(state.selectedProcedureLevel);
        break;
      case "procedure-cycle":
        cycleProcedureLevel();
        break;
      case "procedure-beginner":
        state.selectedProcedureLevel = "beginner";
        updateVariantControlState();
        insertProcedureBlockAtCursor("beginner");
        break;
      case "procedure-intermediate":
        state.selectedProcedureLevel = "intermediate";
        updateVariantControlState();
        insertProcedureBlockAtCursor("intermediate");
        break;
      case "procedure-advanced":
        state.selectedProcedureLevel = "advanced";
        updateVariantControlState();
        insertProcedureBlockAtCursor("advanced");
        break;
      case "callout-insert":
        insertCalloutBlockAtCursor(state.selectedCalloutKind);
        break;
      case "callout-cycle":
        cycleCalloutKind();
        break;
      case "callout-info":
        state.selectedCalloutKind = "info";
        updateVariantControlState();
        insertCalloutBlockAtCursor("info");
        break;
      case "callout-warning":
        state.selectedCalloutKind = "warning";
        updateVariantControlState();
        insertCalloutBlockAtCursor("warning");
        break;
      case "callout-danger":
        state.selectedCalloutKind = "danger";
        updateVariantControlState();
        insertCalloutBlockAtCursor("danger");
        break;
      case "image-inline":
        insertInlineImageTemplate();
        break;
      case "image-left":
        insertFigureTemplate("left");
        break;
      case "image-right":
        insertFigureTemplate("right");
        break;
      case "image-wide":
        insertFigureTemplate("wide");
        break;
      case "video":
        insertVideoTemplate();
        break;
      case "undo":
        runHistoryAction("undo");
        break;
      case "redo":
        runHistoryAction("redo");
        break;
      case "comment-line":
        toggleLineComment();
        break;
      default:
        break;
    }
  }

  function toggleLineComment() {
    if (!elements.modalTextarea) {
      return;
    }

    const textarea = elements.modalTextarea;
    const value = textarea.value;
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const blockStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
    let blockEnd = value.indexOf("\n", selectionEnd);
    if (blockEnd === -1) {
      blockEnd = value.length;
    }

    const selectedBlock = value.slice(blockStart, blockEnd);
    const lines = selectedBlock.split("\n");
    const nonEmptyLines = lines.filter((line) => line.trim() !== "");
    const commentPattern = /^(\s*)<!--\s?(.*?)\s?-->\s*$/;
    const allCommented = nonEmptyLines.length > 0 &&
      nonEmptyLines.every((line) => commentPattern.test(line));

    const nextLines = lines.map((line) => {
      if (!line.trim()) {
        return line;
      }

      if (allCommented) {
        const match = commentPattern.exec(line);
        return match ? `${match[1]}${match[2]}` : line;
      }

      const indent = (line.match(/^\s*/) || [""])[0];
      const content = line.slice(indent.length);
      return `${indent}<!-- ${content} -->`;
    });

    const replacement = nextLines.join("\n");
    replaceTextRange(
      textarea,
      blockStart,
      blockEnd,
      replacement,
      blockStart,
      blockStart + replacement.length,
    );
  }

  function handleEditorShortcut(event) {
    if (!elements.modal || elements.modal.hidden || !elements.modalTextarea) {
      return false;
    }

    const activeEl = document.activeElement;
    if (activeEl !== elements.modalTextarea) {
      return false;
    }

    const hasPrimaryModifier = event.metaKey || event.ctrlKey;
    if (!hasPrimaryModifier) {
      return false;
    }

    const key = (event.key || "").toLowerCase();
    const code = event.code || "";
    let action = null;

    if (!event.altKey && !event.shiftKey && key === "b") {
      action = "bold";
    } else if (!event.altKey && !event.shiftKey && key === "i") {
      action = "italic";
    } else if (!event.altKey && !event.shiftKey && key === "z") {
      action = "undo";
    } else if (!event.altKey && event.shiftKey && key === "z") {
      action = "redo";
    } else if (!event.altKey && !event.shiftKey && key === "y") {
      action = "redo";
    } else if (!event.altKey && (key === "/" || event.code === "Slash")) {
      action = "comment-line";
    } else if (!event.altKey && !event.shiftKey && key === "]") {
      action = "heading-increase";
    } else if (!event.altKey && !event.shiftKey && key === "[") {
      action = "heading-decrease";
    } else if (event.altKey && !event.shiftKey && (key === "1" || code === "Digit1")) {
      action = "procedure-insert";
    } else if (event.altKey && event.shiftKey && (key === "1" || code === "Digit1")) {
      action = "procedure-cycle";
    } else if (event.altKey && !event.shiftKey && (key === "2" || code === "Digit2")) {
      action = "callout-insert";
    } else if (event.altKey && event.shiftKey && (key === "2" || code === "Digit2")) {
      action = "callout-cycle";
    } else if (event.altKey && !event.shiftKey && key === "m") {
      action = "image-inline";
    } else if (event.altKey && !event.shiftKey && key === "l") {
      action = "image-left";
    } else if (event.altKey && !event.shiftKey && key === "r") {
      action = "image-right";
    } else if (event.altKey && !event.shiftKey && key === "w") {
      action = "image-wide";
    } else if (event.altKey && !event.shiftKey && key === "v") {
      action = "video";
    }

    if (!action) {
      return false;
    }

    event.preventDefault();
    runFormatAction(action);
    return true;
  }

  async function clearDrafts() {
    if (state.drafts.size === 0) {
      return;
    }

    const confirmed = window.confirm("Discard all staged markdown drafts?");
    if (!confirmed) {
      return;
    }

    setBusy(true);
    setStatus("Discarding drafts...");

    const draftPaths = Array.from(state.drafts.keys());
    try {
      const originalMarkdownByPath = new Map();
      const originalMarkdownEntries = await Promise.all(
        draftPaths.map(async (path) => [path, await fetchMarkdownFromSource(path)]),
      );
      originalMarkdownEntries.forEach(([path, markdown]) => {
        originalMarkdownByPath.set(path, markdown);
      });

      for (const path of draftPaths) {
        const markdown = originalMarkdownByPath.get(path);
        const restored = renderSectionFromDraft(path, markdown);
        if (!restored) {
          throw new Error(`Unable to restore ${path}`);
        }
      }

      state.drafts.clear();
      updateToolbar();
      setStatus("Drafts discarded.");
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Could not discard drafts.", true);
    } finally {
      setBusy(false);
    }
  }

  async function resetCurrentSectionDraft() {
    if (!state.currentPath || !elements.modalTextarea) {
      return;
    }

    const path = state.currentPath;
    try {
      const sourceMarkdown = await getSourceMarkdown(path);
      state.drafts.delete(path);
      renderSectionFromDraft(path, sourceMarkdown);
      elements.modalTextarea.value = sourceMarkdown;
      elements.modalTextarea.scrollTop = 0;
      elements.modalTextarea.scrollLeft = 0;
      elements.modalTextarea.setSelectionRange(0, 0);
      initializeEditorHistory();
      updateToolbar();
      setStatus(`Reset draft for ${path}.`);
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Could not reset section draft.", true);
    }
  }

  function getSourcePathFromEditLink(link) {
    if (!link) {
      return null;
    }

    const explicitPath = normalizeSourcePath(link.getAttribute("data-source-path"));
    if (explicitPath) {
      return explicitPath;
    }

    const section = link.closest(".section");
    if (section) {
      const sectionPath = normalizeSourcePath(section.getAttribute("data-source-path"));
      if (sectionPath) {
        return sectionPath;
      }
      if (section.id) {
        return `sections/${section.id}.md`;
      }
    }

    return null;
  }

  async function submitDrafts() {
    if (state.busy || state.drafts.size === 0) {
      return;
    }

    const repo = resolveRepoConfig();
    if (!repo) {
      setStatus("Repo config missing in script.js.", true);
      return;
    }

    const authenticated = await ensureSignedIn();
    if (!authenticated) {
      return;
    }

    const changedPaths = Array.from(state.drafts.keys()).sort();
    const defaultCommitMessage =
      `docs: update ${changedPaths.length} markdown file${changedPaths.length === 1 ? "" : "s"}`;
    const commitMessage = window.prompt("Commit message:", defaultCommitMessage);
    if (!commitMessage) {
      return;
    }

    setBusy(true);
    setStatus(`Publishing drafts to ${repo.baseBranch}...`);

    try {
      const files = {};
      changedPaths.forEach((path) => {
        files[path] = state.drafts.get(path);
      });

      const result = await authRequest("/api/submit", {
        method: "POST",
        body: {
          owner: repo.owner,
          repo: repo.name,
          baseBranch: repo.baseBranch,
          commitMessage,
          files,
        },
      });

      if (result && result.mode === "pull_request") {
        setStatus(`Opened PR #${result.pullRequestNumber} for ${changedPaths.length} file${changedPaths.length === 1 ? "" : "s"}.`);
        alert(`Pull request created:\n${result.url}`);
      } else {
        setStatus(`Committed ${changedPaths.length} file${changedPaths.length === 1 ? "" : "s"} to ${repo.baseBranch}.`);
        if (result && result.url) {
          alert(`Commit created:\n${result.url}`);
        }
      }

      state.drafts.clear();
      updateToolbar();
    } catch (error) {
      console.error(error);
      if (error && error.status === 401) {
        state.authSession = null;
        updateAuthUi();
      }
      const message = error && error.message
        ? error.message
        : "Could not publish drafts.";
      setStatus(message, true);
      alert(message);
    } finally {
      setBusy(false);
    }
  }

  function buildUi() {
    const toolbar = document.createElement("div");
    toolbar.id = "inline-editor-toolbar";
    toolbar.innerHTML = `
      <div class="inline-editor-auth">
        <button id="inline-auth-action" type="button">Sign In</button>
        <span id="inline-auth-user">Not signed in</span>
      </div>
      <button id="inline-edit-toggle" type="button">Enable Edit Mode</button>
      <button id="inline-edit-submit" type="button" disabled>Publish (0)</button>
      <button id="inline-edit-clear" type="button" disabled>Discard Drafts</button>
      <span id="inline-editor-status"></span>
    `;
    document.body.appendChild(toolbar);

    const modal = document.createElement("div");
    modal.id = "inline-editor-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="inline-editor-backdrop"></div>
      <div class="inline-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="inline-editor-path">
        <div class="inline-editor-header">
          <p id="inline-editor-path" class="inline-editor-path"></p>
          <div class="inline-editor-history-controls" role="toolbar" aria-label="History actions">
            <button type="button" data-format-action="undo" title="Undo (Cmd/Ctrl+Z)" aria-label="Undo">
              <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                <path d="M9 4L5 8L9 12"></path>
                <path d="M5 8H12C14.209 8 16 9.791 16 12C16 14.209 14.209 16 12 16H10"></path>
              </svg>
            </button>
            <button type="button" data-format-action="redo" title="Redo (Cmd/Ctrl+Shift+Z)" aria-label="Redo">
              <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                <path d="M11 4L15 8L11 12"></path>
                <path d="M15 8H8C5.791 8 4 9.791 4 12C4 14.209 5.791 16 8 16H10"></path>
              </svg>
            </button>
          </div>
        </div>
        <div class="inline-editor-format-toolbar" role="toolbar" aria-label="Markdown formatting">
          <div class="inline-editor-format-group inline-editor-format-group-text" role="group" aria-label="Text and heading formatting">
            <button type="button" data-format-action="bold" title="Bold (Cmd/Ctrl+B)">
              <span class="inline-editor-tool-icon inline-editor-tool-icon-text" aria-hidden="true"><strong>B</strong></span>
              <span class="inline-editor-tool-label">Bold</span>
            </button>
            <button type="button" data-format-action="italic" title="Italic (Cmd/Ctrl+I)">
              <span class="inline-editor-tool-icon inline-editor-tool-icon-text" aria-hidden="true"><em>I</em></span>
              <span class="inline-editor-tool-label">Italic</span>
            </button>
            <button type="button" data-format-action="comment-line" title="Toggle line comment (Cmd/Ctrl+/)">
              <span class="inline-editor-tool-icon inline-editor-tool-icon-code" aria-hidden="true">&lt;!--</span>
              <span class="inline-editor-tool-label">Comment</span>
            </button>
            <button type="button" data-format-action="heading-increase" title="Increase heading (Cmd/Ctrl+])">
              <span class="inline-editor-tool-icon inline-editor-tool-icon-code" aria-hidden="true">#+</span>
              <span class="inline-editor-tool-label">Heading +</span>
            </button>
            <button type="button" data-format-action="heading-decrease" title="Decrease heading (Cmd/Ctrl+[)">
              <span class="inline-editor-tool-icon inline-editor-tool-icon-code" aria-hidden="true">#-</span>
              <span class="inline-editor-tool-label">Heading -</span>
            </button>
          </div>
          <div class="inline-editor-format-group inline-editor-format-group-structures" role="group" aria-label="Procedure and callout tools">
            <div class="inline-editor-variant-control" role="group" aria-label="Procedure insertion">
              <button type="button" data-format-action="procedure-insert" title="Insert procedure (Cmd/Ctrl+Alt+1)">
                <span class="inline-editor-tool-icon" aria-hidden="true">
                  <svg viewBox="0 0 20 20" focusable="false">
                    <path d="M6 5H14"></path>
                    <path d="M6 10H14"></path>
                    <path d="M6 15H11"></path>
                    <rect x="3" y="3.5" width="14" height="13" rx="2"></rect>
                  </svg>
                </span>
                <span class="inline-editor-tool-label" data-variant-label="procedure">Procedure: Beginner</span>
              </button>
              <button type="button" class="inline-editor-variant-swap" data-format-cycle="procedure" title="Switch procedure level (Cmd/Ctrl+Alt+Shift+1)" aria-label="Switch procedure level">
                <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <path d="M7 4L4 7L7 10"></path>
                  <path d="M4 7H12C14.209 7 16 8.791 16 11"></path>
                  <path d="M13 16L16 13L13 10"></path>
                  <path d="M16 13H8C5.791 13 4 11.209 4 9"></path>
                </svg>
              </button>
            </div>
            <div class="inline-editor-variant-control" role="group" aria-label="Callout insertion">
              <button type="button" data-format-action="callout-insert" title="Insert callout (Cmd/Ctrl+Alt+2)">
                <span class="inline-editor-tool-icon" aria-hidden="true">
                  <svg viewBox="0 0 20 20" focusable="false">
                    <path d="M10 4.5L3.5 15.5H16.5L10 4.5Z"></path>
                    <path d="M10 8.2V11.3"></path>
                    <circle cx="10" cy="13.6" r="0.8"></circle>
                  </svg>
                </span>
                <span class="inline-editor-tool-label" data-variant-label="callout">Callout: Info</span>
              </button>
              <button type="button" class="inline-editor-variant-swap" data-format-cycle="callout" title="Switch callout type (Cmd/Ctrl+Alt+Shift+2)" aria-label="Switch callout type">
                <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <path d="M7 4L4 7L7 10"></path>
                  <path d="M4 7H12C14.209 7 16 8.791 16 11"></path>
                  <path d="M13 16L16 13L13 10"></path>
                  <path d="M16 13H8C5.791 13 4 11.209 4 9"></path>
                </svg>
              </button>
            </div>
          </div>
          <div class="inline-editor-format-group inline-editor-format-group-media" role="group" aria-label="Media tools">
            <button type="button" data-format-action="image-inline" title="Inline image (Cmd/Ctrl+Alt+M)" aria-label="Insert inline image">
              <span class="inline-editor-tool-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" focusable="false">
                  <rect x="3" y="4" width="14" height="12" rx="2"></rect>
                  <circle cx="8" cy="8" r="1.3"></circle>
                  <path d="M6 13L9.2 9.8L11.6 12.2L14 9.8L16 13"></path>
                </svg>
              </span>
              <span class="inline-editor-tool-label">Inline</span>
            </button>
            <button type="button" data-format-action="image-left" title="Left-aligned figure (Cmd/Ctrl+Alt+L)" aria-label="Insert left-aligned figure">
              <span class="inline-editor-tool-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" focusable="false">
                  <path d="M3.5 4V16"></path>
                  <rect x="6" y="5" width="11" height="10" rx="1.8"></rect>
                  <path d="M8 12L10 10L12 12"></path>
                </svg>
              </span>
              <span class="inline-editor-tool-label">Left</span>
            </button>
            <button type="button" data-format-action="image-right" title="Right-aligned figure (Cmd/Ctrl+Alt+R)" aria-label="Insert right-aligned figure">
              <span class="inline-editor-tool-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" focusable="false">
                  <path d="M16.5 4V16"></path>
                  <rect x="3" y="5" width="11" height="10" rx="1.8"></rect>
                  <path d="M5 12L7 10L9 12"></path>
                </svg>
              </span>
              <span class="inline-editor-tool-label">Right</span>
            </button>
            <button type="button" data-format-action="image-wide" title="Wide figure (Cmd/Ctrl+Alt+W)" aria-label="Insert wide figure">
              <span class="inline-editor-tool-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" focusable="false">
                  <rect x="2.5" y="6" width="15" height="8" rx="1.8"></rect>
                  <path d="M5 12L8 9L10 11L12.5 8.5L15 12"></path>
                </svg>
              </span>
              <span class="inline-editor-tool-label">Wide</span>
            </button>
            <button type="button" data-format-action="video" title="Insert video (Cmd/Ctrl+Alt+V)">
              <span class="inline-editor-tool-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" focusable="false">
                  <rect x="3" y="4.5" width="14" height="11" rx="2"></rect>
                  <path d="M9 8L13 10L9 12Z"></path>
                </svg>
              </span>
              <span class="inline-editor-tool-label">Video</span>
            </button>
          </div>
        </div>
        <textarea id="inline-editor-textarea"></textarea>
        <div class="inline-editor-actions">
          <button type="button" id="inline-editor-reset">Reset Section</button>
          <button class="primary" type="button" id="inline-editor-save">Save Draft</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    elements.toolbar = toolbar;
    elements.authButton = toolbar.querySelector("#inline-auth-action");
    elements.authUser = toolbar.querySelector("#inline-auth-user");
    elements.toggleButton = toolbar.querySelector("#inline-edit-toggle");
    elements.submitButton = toolbar.querySelector("#inline-edit-submit");
    elements.clearButton = toolbar.querySelector("#inline-edit-clear");
    elements.status = toolbar.querySelector("#inline-editor-status");
    elements.modal = modal;
    elements.modalPath = modal.querySelector("#inline-editor-path");
    elements.modalTextarea = modal.querySelector("#inline-editor-textarea");
    elements.modalSave = modal.querySelector("#inline-editor-save");
    elements.modalReset = modal.querySelector("#inline-editor-reset");
    updateVariantControlState();
  }

  function setupEvents() {
    if (!elements.toggleButton || !elements.submitButton || !elements.clearButton || !elements.modal) {
      return;
    }

    if (elements.authButton) {
      elements.authButton.addEventListener("click", () => {
        handleAuthButtonClick();
      });
    }

    elements.toggleButton.addEventListener("click", () => {
      state.editMode = !state.editMode;
      document.body.classList.toggle("edit-mode", state.editMode);
      updateToolbar();
    });

    elements.submitButton.addEventListener("click", () => {
      submitDrafts();
    });

    elements.clearButton.addEventListener("click", () => {
      clearDrafts();
    });

    if (elements.modalReset) {
      elements.modalReset.addEventListener("click", () => {
        resetCurrentSectionDraft();
      });
    }

    if (elements.modalSave) {
      elements.modalSave.addEventListener("click", saveDraft);
    }

    if (elements.modalTextarea) {
      elements.modalTextarea.addEventListener("input", () => {
        recordEditorHistorySnapshot();
        syncCurrentEditorDraft();
      });
    }

    const backdrop = elements.modal.querySelector(".inline-editor-backdrop");
    if (backdrop) {
      backdrop.addEventListener("click", closeModal);
    }

    const dialog = elements.modal.querySelector(".inline-editor-dialog");
    if (dialog) {
      dialog.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }
        const cycleButton = target.closest("button[data-format-cycle]");
        if (cycleButton) {
          const cycleTarget = cycleButton.getAttribute("data-format-cycle");
          if (!cycleTarget) {
            return;
          }
          runFormatAction(`${cycleTarget}-cycle`);
          return;
        }
        const button = target.closest("button[data-format-action]");
        if (!button) {
          return;
        }
        const action = button.getAttribute("data-format-action");
        if (!action) {
          return;
        }
        runFormatAction(action);
      });
    }

    const formatToolbar = elements.modal.querySelector(".inline-editor-format-toolbar");
    if (formatToolbar) {
      formatToolbar.addEventListener("scroll", updateFormatToolbarScrollState, { passive: true });
    }

    window.addEventListener("resize", () => {
      if (!elements.modal || elements.modal.hidden) {
        return;
      }
      updateFormatToolbarScrollState();
    });

    window.addEventListener("message", handleAuthPopupMessage);

    window.addEventListener("focus", () => {
      if (!state.authSession || !state.authSession.authenticated) {
        refreshAuthSession();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (handleEditorShortcut(event)) {
        return;
      }
      if (event.key === "Escape" && elements.modal && !elements.modal.hidden) {
        closeModal();
      }
    });

    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const editLink = target.closest(".section-edit-link");
      if (!editLink || !state.editMode) {
        return;
      }

      const path = getSourcePathFromEditLink(editLink);
      if (!path) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      openEditor(path);
    });
  }

  function init() {
    buildUi();
    setupEvents();
    updateToolbar();
    updateAuthUi();
    showAuthErrorFromUrl();
    refreshAuthSession();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}());
