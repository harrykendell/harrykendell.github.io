(function () {
  "use strict";

  const INTRO_PATH = "sections/introduction.md";
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
  const AUTH_SESSION_HEADER_NAME = "X-GHA-Session";
  const AUTH_SESSION_TOKEN_STORAGE_KEY = "editor-auth-session-header-token";
  const AUTH_PROFILE_STORAGE_KEY = "editor-github-profile";
  const EDITOR_STATE_STORAGE_KEY = "editor-state";
  const MARKDOWN_DRAFTS_STORAGE_KEY = "editor-markdown-drafts-v1";
  const IMAGE_DRAFTS_STORAGE_KEY = "editor-image-drafts-v1";
  const EDITOR_MODAL_OPEN_CLASS = "editor-modal-open";
  const PREVIEW_STACK_MEDIA_QUERY = "(max-width: 860px)";
  const DIFF_MATCH_PATCH_MODULE_URL = "https://esm.sh/diff-match-patch@1.0.5";
  const CODEMIRROR_STATE_MODULE_URL = "https://esm.sh/@codemirror/state";
  const CODEMIRROR_VIEW_MODULE_URL = "https://esm.sh/@codemirror/view";
  const CODEMIRROR_BASIC_MODULE_URL = "https://esm.sh/codemirror";
  const CODEMIRROR_MARKDOWN_MODULE_URL = "https://esm.sh/@codemirror/lang-markdown";
  const NEW_SECTION_TITLE_PLACEHOLDER = "Section title";
  const MAX_STAGED_IMAGE_BYTES = 10 * 1024 * 1024;
  const appUtils = window.AppUtils || null;
  const state = {
    busy: false,
    authBusy: false,
    repoActivityBusy: false,
    editMode: false,
    editorAuthorized: false,
    drafts: new Map(),
    imageDrafts: new Map(),
    imageManifestPromise: null,
    sourceMarkdown: new Map(),
    currentPath: null,
    statusTimeoutId: null,
    editorHistory: [],
    editorHistoryIndex: -1,
    applyingHistoryEntry: false,
    selectedProcedureLevel: PROCEDURE_LEVELS[0],
    selectedCalloutKind: CALLOUT_KINDS[0],
    authSession: null,
    authHeaderSessionToken: "",
    authRefreshPromise: null,
    authPopupPollId: null,
    authPopupWindow: null,
    authBusyMessage: "",
    repoActivityPollId: null,
    repoActivity: null,
    compareHistoryByPath: new Map(),
    compareContentByRef: new Map(),
    compareSelectionByPath: new Map(),
    compareBaselinePath: "",
    compareBaselineRef: "current",
    compareBaselineLabel: "Current commit",
    compareBaselineText: "",
    compareBaselineTitle: "",
    compareHistoryToken: 0,
    compareBaselineToken: 0,
    compareStatusMessage: "",
    compareStatusIsError: false,
    diffMatchPatchPromise: null,
    diffEngine: null,
    diffRenderTimeoutId: null,
    editorModulesPromise: null,
    editorModules: null,
    editorViewPromise: null,
    editorView: null,
    editorBaselineEffect: null,
    editorDiffField: null,
    editorDiffStats: null,
    previewEnabled: false,
    previewRenderTimeoutId: null,
    previewLineAnchors: [],
    previewScrollAnchors: [],
    previewResyncPending: false,
    previewScrollResyncTimeoutId: null,
    previewSyncLock: "",
    previewActiveScrollSource: "",
    previewActiveScrollTimeoutId: null,
    previewIgnoreNextEditorScroll: 0,
    previewIgnoreNextPreviewScroll: 0,
    previewResizeObserver: null,
    previewEditorResizeObserver: null,
    previewPaneSplitRatio: 0.5,
    previewPaneResizePointerId: null,
    newSectionDraft: null,
    applyingNewSectionTemplate: false,
    dialogResolve: null,
    currentTitle: "",
    currentTitleFallback: "",
    currentTitleTouched: false,
    lastOpenedPath: "",
  };

  const elements = {
    toolbar: null,
    toolbarVisibilityButton: null,
    authButton: null,
    repoCommit: null,
    addSectionButton: null,
    manageSectionsButton: null,
    submitButton: null,
    clearButton: null,
    status: null,
    appDialog: null,
    appDialogPanel: null,
    appDialogTitle: null,
    appDialogMessage: null,
    appDialogInput: null,
    appDialogConfirm: null,
    appDialogCancel: null,
    modal: null,
    modalPathDisplay: null,
    modalPathInput: null,
    modalTitleInput: null,
    modalEditorHost: null,
    modalSave: null,
    modalReset: null,
    modalImageInput: null,
    modalCompareToolbar: null,
    modalCompareSelect: null,
    modalDiffSummary: null,
    modalDiffEditor: null,
    modalPaneSplitter: null,
    modalPreview: null,
    modalPreviewToggle: null,
  };
  const AUTH_USER_ICON = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="8" r="4"></circle>
      <path d="M4.5 20c1.6-3.3 4.4-5 7.5-5s5.9 1.7 7.5 5"></path>
    </svg>
  `;
  const AUTH_GITHUB_ICON = `
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"></path>
    </svg>
  `;

  function normalizeSourcePath(path) {
    if (!path) {
      return null;
    }
    return String(path).replace(/^\/+/, "");
  }

  function getSectionPath(sectionId) {
    if (appUtils && typeof appUtils.getSectionPath === "function") {
      return appUtils.getSectionPath(sectionId);
    }
    const normalized = normalizeSectionId(sectionId);
    return normalized ? `sections/${normalized}.md` : null;
  }

  function displaySourcePath(path) {
    const normalizedPath = normalizeSourcePath(path);
    const sectionId = sectionIdFromPath(normalizedPath);
    return sectionId || normalizedPath || "";
  }

  function displayImagePath(path) {
    const normalizedPath = normalizeImageRepoPath(path);
    if (appUtils && typeof appUtils.imageRefFromPath === "function") {
      return appUtils.imageRefFromPath(normalizedPath || path);
    }
    return normalizedPath ? normalizedPath.replace(/^imgs\//, "") : "";
  }

  function extractMarkdownDefinitionSuffix(markdown) {
    const source = String(markdown || "");
    const definitionLines = source.match(/^\s{0,3}\[[^\]]+\]:\s*.+$/gm) || [];
    return definitionLines
      .map((line) => String(line || "").trimEnd())
      .filter((line) => line.length > 0)
      .join("\n");
  }

  function isMarkdownSourcePath(path) {
    return !!path && /^sections\/[A-Za-z0-9._/-]+\.md$/.test(path);
  }

  function sanitizeFileStem(value) {
    const stem = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
    return stem || "image";
  }

  function normalizeImageRepoPath(value) {
    if (appUtils && typeof appUtils.normalizeImagePath === "function") {
      return appUtils.normalizeImagePath(value);
    }
    if (!value) {
      return null;
    }
    const raw = String(value).replace(/\\/g, "/").replace(/^\/+/, "").trim();
    const normalized = raw.startsWith("imgs/") ? raw : `imgs/${raw}`;
    if (normalized.includes("..") || normalized.endsWith("/") || normalized.includes("//")) {
      return null;
    }
    return /^imgs\/[A-Za-z0-9._/-]+\.(png|jpe?g|gif|webp|svg|avif)$/i.test(normalized)
      ? normalized
      : null;
  }

  function normalizeImageReferencePath(value) {
    if (!value) {
      return null;
    }

    const raw = String(value).trim();
    if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) {
      return null;
    }

    if (raw.startsWith("imgs/")) {
      return normalizeImageRepoPath(raw);
    }

    if (/^[A-Za-z0-9._/-]+\.(png|jpe?g|gif|webp|svg|avif)$/i.test(raw)) {
      return normalizeImageRepoPath(raw);
    }

    if (raw.startsWith("/imgs/")) {
      return normalizeImageRepoPath(raw.slice(1));
    }

    try {
      const parsed = new URL(raw, window.location.href);
      if (parsed.origin !== window.location.origin) {
        return null;
      }
      return normalizeImageRepoPath(parsed.pathname.replace(/^\/+/, ""));
    } catch (error) {
      return null;
    }
  }

  function buildSuggestedImagePath(fileName) {
    const extensionMatch = String(fileName || "").toLowerCase().match(/\.([a-z0-9]+)$/);
    const extension = extensionMatch ? extensionMatch[1] : "png";
    const now = new Date();
    const stamp = [
      now.getUTCFullYear(),
      String(now.getUTCMonth() + 1).padStart(2, "0"),
      String(now.getUTCDate()).padStart(2, "0"),
    ].join("");
    return `uploads/${stamp}-${sanitizeFileStem(fileName)}.${extension}`;
  }

  function inferAltTextFromFileName(fileName) {
    return "Insert Title";
  }

  function formatFileSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 1024) {
      return `${Math.max(0, Math.round(bytes || 0))} B`;
    }
    const kib = bytes / 1024;
    if (kib < 1024) {
      return `${kib.toFixed(1)} KB`;
    }
    return `${(kib / 1024).toFixed(2)} MB`;
  }

  function pickImageFile() {
    if (!elements.modalImageInput) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      const input = elements.modalImageInput;
      const handleChange = () => {
        const file = input.files && input.files.length > 0
          ? input.files[0]
          : null;
        input.removeEventListener("change", handleChange);
        input.value = "";
        resolve(file);
      };
      input.addEventListener("change", handleChange, { once: true });
      input.click();
    });
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => {
        reject(new Error(`Could not read ${file.name}.`));
      };
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        const commaIndex = result.indexOf(",");
        if (commaIndex === -1) {
          reject(new Error(`Could not read ${file.name}.`));
          return;
        }
        resolve(result.slice(commaIndex + 1));
      };
      reader.readAsDataURL(file);
    });
  }

  function buildPreviewImageDataUrl(imageDraft, path) {
    if (!imageDraft || !imageDraft.contentBase64) {
      return "";
    }

    const type = imageDraft.contentType
      || (path && path.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "application/octet-stream");
    return `data:${type};base64,${imageDraft.contentBase64}`;
  }

  async function fetchImageManifest() {
    if (state.imageManifestPromise) {
      return state.imageManifestPromise;
    }

    state.imageManifestPromise = fetchRepoList(
      "/api/image-list",
      "images",
      normalizeImageRepoPath,
    )
      .then((images) => images.sort((left, right) => left.localeCompare(right)))
      .catch((error) => {
        console.error(error);
        return [];
      });

    return state.imageManifestPromise;
  }

  async function getAvailableImageChoices() {
    const existingImages = await fetchImageManifest();
    const choicesByPath = new Map();

    existingImages.forEach((path) => {
      choicesByPath.set(path, {
        path,
        source: "repo",
        label: displayImagePath(path),
      });
    });

    state.imageDrafts.forEach((draft, path) => {
      const normalizedPath = normalizeImageRepoPath(path);
      if (!normalizedPath) {
        return;
      }
      choicesByPath.set(normalizedPath, {
        path: normalizedPath,
        source: choicesByPath.has(normalizedPath) ? "staged replacement" : "staged",
        label: displayImagePath(normalizedPath),
        draft,
      });
    });

    return Array.from(choicesByPath.values())
      .sort((left, right) => {
        const leftStaged = left.source.startsWith("staged") ? 0 : 1;
        const rightStaged = right.source.startsWith("staged") ? 0 : 1;
        if (leftStaged !== rightStaged) {
          return leftStaged - rightStaged;
        }
        return left.path.localeCompare(right.path);
      });
  }

  function getImageChoicePreviewSrc(choice) {
    if (!choice || !choice.path) {
      return "";
    }
    if (choice.draft) {
      return buildPreviewImageDataUrl(choice.draft, choice.path);
    }
    return choice.path;
  }

  function applyStagedImagePreviews(root) {
    if (!root || state.imageDrafts.size === 0) {
      return;
    }

    root.querySelectorAll("img[src]").forEach((img) => {
      const source = img.getAttribute("src");
      const repoPath = normalizeImageReferencePath(source);
      if (!repoPath) {
        return;
      }

      const imageDraft = state.imageDrafts.get(repoPath);
      if (!imageDraft) {
        return;
      }

      const previewUrl = buildPreviewImageDataUrl(imageDraft, repoPath);
      if (!previewUrl) {
        return;
      }

      img.setAttribute("src", previewUrl);
      img.setAttribute("data-staged-preview-path", repoPath);
    });
  }

  function sectionIdFromPath(path) {
    if (appUtils && typeof appUtils.sectionIdFromPath === "function") {
      return appUtils.sectionIdFromPath(path);
    }
    if (!path || !path.startsWith("sections/") || !path.endsWith(".md")) {
      return null;
    }
    return path.slice("sections/".length, -".md".length);
  }

  function resolveRepoConfig() {
    const utilConfig = appUtils && typeof appUtils.getContentRepoConfig === "function"
      ? appUtils.getContentRepoConfig()
      : null;
    const owner = utilConfig && typeof utilConfig.owner === "string"
      ? utilConfig.owner
      : "";
    const name = utilConfig && typeof utilConfig.name === "string"
      ? utilConfig.name
      : "";
    const hostname = String(window.location.hostname || "").toLowerCase();
    const configuredBaseBranch = utilConfig && typeof utilConfig.baseBranch === "string"
      ? utilConfig.baseBranch
      : "";
    const baseBranch = hostname === "dev.kendell.uk"
      ? "dev"
      : (configuredBaseBranch || "main");

    if (!owner || !name) {
      return null;
    }
    return { owner, name, baseBranch };
  }

  function buildRepoQueryParams(repo) {
    if (!repo) {
      return null;
    }

    const owner = typeof repo.owner === "string" ? repo.owner : "";
    const name = typeof repo.name === "string" ? repo.name : "";
    const branch = typeof repo.baseBranch === "string" ? repo.baseBranch : "";
    if (!owner || !name) {
      return null;
    }

    const params = new URLSearchParams({ owner, repo: name });
    if (branch) {
      params.set("branch", branch);
    }
    return params;
  }

  async function fetchRepoList(path, payloadKey, normalizeItem) {
    const repo = resolveRepoConfig();
    const params = buildRepoQueryParams(repo);
    if (!params) {
      return [];
    }

    const payload = await authRequest(`${path}?${params.toString()}`, {
      includeSessionHeader: false,
    });
    const rawItems = Array.isArray(payload && payload[payloadKey]) ? payload[payloadKey] : [];
    return rawItems
      .map((item) => normalizeItem(item))
      .filter(Boolean);
  }

  function formatCompactCommitAge(isoString) {
    if (!isoString) {
      return "";
    }
    const timestamp = Date.parse(isoString);
    if (Number.isNaN(timestamp)) {
      return "";
    }

    const deltaMs = Math.max(0, Date.now() - timestamp);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    const week = 7 * day;
    const month = 30 * day;
    const year = 365 * day;

    if (deltaMs < hour) {
      return `${Math.floor(deltaMs / minute)}m`;
    }
    if (deltaMs < day) {
      return `${Math.floor(deltaMs / hour)}h`;
    }
    if (deltaMs < week) {
      return `${Math.floor(deltaMs / day)}d`;
    }
    if (deltaMs < month) {
      return `${Math.floor(deltaMs / week)}w`;
    }
    if (deltaMs < year) {
      return `${Math.floor(deltaMs / month)}mo`;
    }
    return `${Math.floor(deltaMs / year)}y`;
  }

  function shortenSha(sha) {
    return String(sha || "").slice(0, 7);
  }

  function setCompareStatus(message, isError) {
    const nextMessage = String(message || "").trim();
    state.compareStatusMessage = nextMessage;
    state.compareStatusIsError = !!isError && nextMessage.length > 0;
    updateDiffSummaryFromStats();
  }

  function setDiffSummary(message, isError) {
    if (!elements.modalDiffSummary) {
      return;
    }
    elements.modalDiffSummary.textContent = message || "";
    elements.modalDiffSummary.classList.toggle("error", !!isError);
  }

  function isCompareDisabled() {
    return state.compareBaselineRef === "none";
  }

  function ensureDiffEngine() {
    if (state.diffEngine) {
      return Promise.resolve(state.diffEngine);
    }
    if (state.diffMatchPatchPromise) {
      return state.diffMatchPatchPromise;
    }

    state.diffMatchPatchPromise = import(DIFF_MATCH_PATCH_MODULE_URL)
      .then((moduleNs) => {
        const DiffMatchPatch = moduleNs && (moduleNs.default || moduleNs.diff_match_patch);
        if (typeof DiffMatchPatch !== "function") {
          throw new Error("Diff engine unavailable.");
        }
        const engine = new DiffMatchPatch();
        engine.Diff_Timeout = 0.2;
        engine.Diff_EditCost = 4;
        state.diffEngine = engine;
        return engine;
      })
      .catch((error) => {
        state.diffMatchPatchPromise = null;
        throw error;
      });
    return state.diffMatchPatchPromise;
  }

  async function ensureEditorModules() {
    if (state.editorModules) {
      return state.editorModules;
    }
    if (state.editorModulesPromise) {
      return state.editorModulesPromise;
    }

    state.editorModulesPromise = Promise.all([
      import(CODEMIRROR_STATE_MODULE_URL),
      import(CODEMIRROR_VIEW_MODULE_URL),
      import(CODEMIRROR_BASIC_MODULE_URL),
      import(CODEMIRROR_MARKDOWN_MODULE_URL),
      ensureDiffEngine(),
    ])
      .then(([stateModule, viewModule, basicModule, markdownModule]) => {
        const modules = {
          EditorState: stateModule.EditorState || (stateModule.default && stateModule.default.EditorState),
          Prec: stateModule.Prec || (stateModule.default && stateModule.default.Prec),
          StateField: stateModule.StateField || (stateModule.default && stateModule.default.StateField),
          StateEffect: stateModule.StateEffect || (stateModule.default && stateModule.default.StateEffect),
          EditorView: viewModule.EditorView || (viewModule.default && viewModule.default.EditorView),
          keymap: viewModule.keymap || (viewModule.default && viewModule.default.keymap),
          Decoration: viewModule.Decoration || (viewModule.default && viewModule.default.Decoration),
          WidgetType: viewModule.WidgetType || (viewModule.default && viewModule.default.WidgetType),
          minimalSetup: basicModule.minimalSetup || (basicModule.default && basicModule.default.minimalSetup),
          markdown: markdownModule.markdown || (markdownModule.default && markdownModule.default.markdown),
        };

        if (
          !modules.EditorState
          || !modules.Prec
          || !modules.StateField
          || !modules.StateEffect
          || !modules.EditorView
          || !modules.keymap
          || !modules.Decoration
          || !modules.WidgetType
          || !modules.minimalSetup
          || !modules.markdown
        ) {
          throw new Error("Editor modules unavailable.");
        }

        class DeletedWidget extends modules.WidgetType {
          constructor(text, isBlock) {
            super();
            this.text = text;
            this.isBlock = isBlock;
          }
          toDOM() {
            const span = document.createElement("span");
            span.className = `cm-diff-del${this.isBlock ? " cm-diff-del-block" : ""}`;
            span.textContent = this.text;
            return span;
          }
          ignoreEvent() {
            return true;
          }
        }

        modules.DeletedWidget = DeletedWidget;
        state.editorModules = modules;
        return modules;
      })
      .catch((error) => {
        state.editorModulesPromise = null;
        throw error;
      });

    return state.editorModulesPromise;
  }

  function buildDiffDecorations(currentText, modules) {
    if (isCompareDisabled()) {
      state.editorDiffStats = {
        inserted: 0,
        deleted: 0,
        disabled: true,
      };
      return modules.Decoration.set([]);
    }

    const engine = state.diffEngine;
    if (!engine) {
      state.editorDiffStats = null;
      return modules.Decoration.set([]);
    }

    const baseline = state.compareBaselineText || "";
    const diffs = engine.diff_main(baseline, currentText);
    engine.diff_cleanupSemantic(diffs);
    engine.diff_cleanupSemanticLossless(diffs);

    const decos = [];
    let pos = 0;
    let insertedChars = 0;
    let deletedChars = 0;

    let pendingRemoved = "";
    let pendingRemovedBlock = false;

    const flushRemoved = () => {
      if (!pendingRemoved) {
        return;
      }
      decos.push(
        modules.Decoration.widget({
          widget: new modules.DeletedWidget(pendingRemoved, pendingRemovedBlock),
          side: 1,
          block: pendingRemovedBlock,
        }).range(pos),
      );
      pendingRemoved = "";
      pendingRemovedBlock = false;
    };

    diffs.forEach(([operation, text]) => {
      const value = text || "";
      if (!value) {
        return;
      }
      if (operation === -1) {
        pendingRemoved += value;
        deletedChars += value.length;
        if (value.includes("\n")) {
          pendingRemovedBlock = true;
        }
        return;
      }

      flushRemoved();

      if (operation === 1) {
        const from = pos;
        const to = pos + value.length;
        if (to > from) {
          decos.push(
            modules.Decoration.mark({ class: "cm-diff-ins", inclusive: false }).range(from, to),
          );
        }
        insertedChars += value.length;
        pos = to;
        return;
      }

      pos += value.length;
    });

    flushRemoved();
    state.editorDiffStats = { inserted: insertedChars, deleted: deletedChars };
    return modules.Decoration.set(decos, true);
  }

  function updateDiffSummaryFromStats() {
    if (!elements.modalDiffSummary || (elements.modal && elements.modal.hidden)) {
      return;
    }

    const stats = state.editorDiffStats;
    const baselineTitle = String(state.compareBaselineTitle || "").trim();
    const currentTitle = state.currentPath
      ? getTitleInputValue(state.currentTitleFallback)
      : "";
    const titleChanged = state.currentPath
      ? normalizeTitleValue(currentTitle, "") !== normalizeTitleValue(baselineTitle, "")
      : false;
    const compareMessage = String(state.compareStatusMessage || "").trim();
    const compareError = !!state.compareStatusIsError;

    let summaryText = "";
    let summaryError = false;

    if (isCompareDisabled() || (stats && stats.disabled)) {
      summaryText = "Compare: None";
    } else if (!stats) {
      summaryText = "Live diff unavailable";
      summaryError = true;
    } else if (stats.inserted === 0 && stats.deleted === 0 && !titleChanged) {
      summaryText = "No changes";
    } else if (stats.inserted === 0 && stats.deleted === 0 && titleChanged) {
      summaryText = "Title changed";
    } else {
      const titleSuffix = titleChanged ? " Title changed." : "";
      summaryText = `+${stats.inserted} / -${stats.deleted} chars.${titleSuffix}`;
    }

    if (compareMessage) {
      summaryText = compareMessage;
      summaryError = summaryError || compareError;
    } else if (compareError) {
      summaryError = true;
    }

    setDiffSummary(summaryText, summaryError);
  }

  function shouldExitListOnEnter(view) {
    if (!view || !view.state || !view.state.selection) {
      return false;
    }
    const selection = view.state.selection.main;
    if (!selection || !selection.empty) {
      return false;
    }

    const line = view.state.doc.lineAt(selection.head);
    if (!line) {
      return false;
    }

    const offsetInLine = selection.head - line.from;
    const beforeCursor = line.text.slice(0, offsetInLine);
    const afterCursor = line.text.slice(offsetInLine);
    if (!/^\s*$/.test(afterCursor)) {
      return false;
    }

    // Empty list item markers like "-", "*", "+", "1.", "1)", including task list forms.
    if (!/^\s*(?:[-+*]|\d+[.)])(?:\s+\[[ xX]\])?\s*$/.test(beforeCursor)) {
      return false;
    }

    view.dispatch({
      changes: { from: line.from, to: line.to, insert: "" },
      selection: { anchor: line.from },
      scrollIntoView: true,
    });
    return true;
  }

  async function ensureEditorView() {
    if (state.editorView) {
      return state.editorView;
    }
    if (state.editorViewPromise) {
      return state.editorViewPromise;
    }
    if (!elements.modalEditorHost) {
      return null;
    }

    state.editorViewPromise = ensureEditorModules()
      .then((modules) => {
        if (!state.editorBaselineEffect) {
          state.editorBaselineEffect = modules.StateEffect.define();
        }
        const baselineEffect = state.editorBaselineEffect;

        if (!state.editorDiffField) {
          state.editorDiffField = modules.StateField.define({
            create(stateSnapshot) {
              return buildDiffDecorations(stateSnapshot.doc.toString(), modules);
            },
            update(deco, tr) {
              const baselineChanged = tr.effects.some((effect) => effect.is(baselineEffect));
              if (!tr.docChanged && !baselineChanged) {
                return deco;
              }
              return buildDiffDecorations(tr.newDoc.toString(), modules);
            },
            provide: (field) => modules.EditorView.decorations.from(field),
          });
        }

        const updateListener = modules.EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            recordEditorHistorySnapshot();
            if (state.newSectionDraft) {
              if (!state.applyingNewSectionTemplate) {
                state.newSectionDraft.markdownTouched = true;
              }
              state.newSectionDraft.markdown = update.state.doc.toString();
              syncNewSectionDraft();
            } else {
              syncCurrentEditorDraft();
            }
          }
        });

        const theme = modules.EditorView.theme({
          "&": {
            height: "100%",
          },
          ".cm-scroller": {
            overflow: "auto",
          },
        });

        const view = new modules.EditorView({
          state: modules.EditorState.create({
            doc: "",
            extensions: [
              modules.minimalSetup,
              modules.markdown(),
              modules.Prec.highest(modules.keymap.of([{
                key: "Enter",
                run: shouldExitListOnEnter,
              }])),
              modules.EditorView.lineWrapping,
              theme,
              state.editorDiffField,
              updateListener,
            ],
          }),
          parent: elements.modalEditorHost,
        });
        bindManualScrollSourceListeners(view.scrollDOM, "editor");
        bindManualScrollSourceListeners(view.dom, "editor");
        view.scrollDOM.addEventListener("scroll", () => {
          if (state.previewIgnoreNextEditorScroll > 0) {
            state.previewIgnoreNextEditorScroll -= 1;
            return;
          }
          if (state.previewSyncLock === "preview") {
            return;
          }
          setActivePreviewScrollSource("editor");
          syncPreviewScrollToSource();
          schedulePreviewResyncAfterScrollSettles();
        }, { passive: true });

        state.editorView = view;
        state.editorViewPromise = null;
        return view;
      })
      .catch((error) => {
        state.editorViewPromise = null;
        throw error;
      });

    return state.editorViewPromise;
  }

  function getEditorSnapshot() {
    if (state.editorView) {
      const view = state.editorView;
      const selection = view.state.selection.main;
      return {
        value: view.state.doc.toString(),
        selectionStart: selection.from,
        selectionEnd: selection.to,
      };
    }
    return null;
  }

  function setEditorContent(value, selectionStart, selectionEnd, options) {
    if (!state.editorView) {
      return;
    }

    const view = state.editorView;
    const nextValue = String(value || "");
    const docLength = view.state.doc.length;
    const maxPos = nextValue.length;
    const safeStart = Math.max(0, Math.min(maxPos, Number.isFinite(selectionStart) ? selectionStart : 0));
    const safeEnd = Math.max(0, Math.min(maxPos, Number.isFinite(selectionEnd) ? selectionEnd : safeStart));
    const shouldScroll = options && Object.prototype.hasOwnProperty.call(options, "scrollIntoView")
      ? options.scrollIntoView
      : true;
    const preserveScroll = options && options.preserveScroll;
    const priorScrollTop = preserveScroll ? view.scrollDOM.scrollTop : 0;
    const priorScrollLeft = preserveScroll ? view.scrollDOM.scrollLeft : 0;

    view.dispatch({
      changes: { from: 0, to: docLength, insert: nextValue },
      selection: { anchor: safeStart, head: safeEnd },
      scrollIntoView: shouldScroll,
    });

    if (preserveScroll) {
      view.scrollDOM.scrollTop = priorScrollTop;
      view.scrollDOM.scrollLeft = priorScrollLeft;
    }
  }

  function resetEditorScroll() {
    if (!state.editorView) {
      return;
    }
    state.editorView.scrollDOM.scrollTop = 0;
    state.editorView.scrollDOM.scrollLeft = 0;
  }

  function focusEditor() {
    if (state.editorView) {
      state.editorView.focus();
    }
  }

  function replaceEditorRange(start, end, replacement, nextSelectionStart, nextSelectionEnd) {
    if (!state.editorView) {
      return;
    }

    const view = state.editorView;
    const maxPos = view.state.doc.length;
    const safeStart = Math.max(0, Math.min(maxPos, start));
    const safeEnd = Math.max(0, Math.min(maxPos, end));
    const newDocLength = view.state.doc.length - (safeEnd - safeStart) + replacement.length;
    const rawNextStart = Number.isFinite(nextSelectionStart)
      ? nextSelectionStart
      : safeStart + replacement.length;
    const rawNextEnd = Number.isFinite(nextSelectionEnd) ? nextSelectionEnd : rawNextStart;
    const safeNextStart = Math.max(0, Math.min(newDocLength, rawNextStart));
    const safeNextEnd = Math.max(0, Math.min(newDocLength, rawNextEnd));

    view.dispatch({
      changes: { from: safeStart, to: safeEnd, insert: replacement },
      selection: { anchor: safeNextStart, head: safeNextEnd },
      scrollIntoView: true,
    });
    focusEditor();
  }

  function refreshEditorBaseline() {
    if (!state.editorView) {
      return;
    }
    if (state.editorBaselineEffect) {
      state.editorView.dispatch({ effects: state.editorBaselineEffect.of(null) });
    }
    scheduleDiffPreviewRender(true);
  }

  function scheduleDiffPreviewRender(immediate) {
    if (!state.editorView) {
      return;
    }
    if (state.diffRenderTimeoutId) {
      window.clearTimeout(state.diffRenderTimeoutId);
      state.diffRenderTimeoutId = null;
    }

    if (immediate) {
      updateDiffSummaryFromStats();
      scheduleMarkdownPreviewRender(true);
      return;
    }

    state.diffRenderTimeoutId = window.setTimeout(() => {
      state.diffRenderTimeoutId = null;
      updateDiffSummaryFromStats();
      scheduleMarkdownPreviewRender(true);
    }, 80);
  }

  function getEditorScrollOffset() {
    if (!state.editorView) {
      return 0;
    }
    return state.editorView.scrollDOM.scrollTop || 0;
  }

  function buildPreviewBlocksFromMarkdown(markdown) {
    const source = String(markdown || "");
    const fallbackEndOffset = Math.max(0, source.length);
    const procedureStartPattern = /\[!PROCEDURE:[^\]]+\]\]?/gi;
    const procedureEndPattern = /\[!\/PROCEDURE\]/gi;
    const fallbackResult = {
      blocks: [{
        markdown: source,
        sourceStart: 0,
        sourceEnd: fallbackEndOffset,
      }],
      globalDefinitionSuffix: "",
    };

    if (typeof marked === "undefined" || typeof marked.lexer !== "function") {
      return fallbackResult;
    }

    let tokens;
    try {
      tokens = marked.lexer(source);
    } catch (error) {
      console.error(error);
      return fallbackResult;
    }

    const globalDefinitionSuffix = extractMarkdownDefinitionSuffix(source);

    const blocks = [];
    let charCursor = 0;
    let pendingProcedureBlock = null;

    const countProcedureMarkers = (raw, pattern) => {
      if (!raw || !pattern) {
        return 0;
      }
      let count = 0;
      pattern.lastIndex = 0;
      while (pattern.exec(raw)) {
        count += 1;
      }
      pattern.lastIndex = 0;
      return count;
    };

    const pushBlock = (raw, sourceStart, sourceEnd) => {
      if (!raw.trim()) {
        return;
      }
      blocks.push({
        markdown: raw,
        sourceStart,
        sourceEnd,
      });
    };

    tokens.forEach((token) => {
      const raw = token && typeof token.raw === "string" ? token.raw : "";
      const blockStartOffset = charCursor;
      charCursor += raw.length;
      const blockEndOffset = Math.max(blockStartOffset, charCursor);
      const procedureStartCount = countProcedureMarkers(raw, procedureStartPattern);
      const procedureEndCount = countProcedureMarkers(raw, procedureEndPattern);

      if (pendingProcedureBlock) {
        pendingProcedureBlock.raw += raw;
        pendingProcedureBlock.sourceEnd = blockEndOffset;
        pendingProcedureBlock.depth += procedureStartCount;
        pendingProcedureBlock.depth -= procedureEndCount;
        if (pendingProcedureBlock.depth <= 0) {
          pushBlock(
            pendingProcedureBlock.raw,
            pendingProcedureBlock.sourceStart,
            pendingProcedureBlock.sourceEnd,
          );
          pendingProcedureBlock = null;
        }
        return;
      }

      if (!raw.trim() || token.type === "space" || token.type === "def") {
        return;
      }

      if (procedureStartCount > procedureEndCount) {
        pendingProcedureBlock = {
          raw,
          sourceStart: blockStartOffset,
          sourceEnd: blockEndOffset,
          depth: procedureStartCount - procedureEndCount,
        };
        return;
      }

      pushBlock(raw, blockStartOffset, blockEndOffset);
    });

    if (pendingProcedureBlock) {
      pushBlock(
        pendingProcedureBlock.raw,
        pendingProcedureBlock.sourceStart,
        pendingProcedureBlock.sourceEnd,
      );
    }

    if (!blocks.length) {
      blocks.push({
        markdown: source,
        sourceStart: 0,
        sourceEnd: fallbackEndOffset,
      });
    }

    return {
      blocks,
      globalDefinitionSuffix,
    };
  }

  function buildPreviewRenderMarkdown(markdown, globalDefinitionSuffix) {
    const blockMarkdown = String(markdown || "");
    const suffix = String(globalDefinitionSuffix || "").trim();
    if (!suffix) {
      return blockMarkdown;
    }
    if (!blockMarkdown.trim()) {
      return suffix;
    }
    return `${blockMarkdown.trimEnd()}\n\n${suffix}`;
  }

  function renderPreviewBlock(target, markdown, globalDefinitionSuffix) {
    const markdownToRender = buildPreviewRenderMarkdown(markdown, globalDefinitionSuffix);

    if (typeof window.renderMarkdownContent === "function") {
      window.renderMarkdownContent(target, markdownToRender, { downgradeHeadings: true });
    } else if (typeof marked !== "undefined" && typeof marked.parse === "function") {
      target.innerHTML = marked.parse(markdownToRender);
    } else {
      target.textContent = markdownToRender;
    }
  }

  function getPreviewProcedureStateKey(procedure, index) {
    if (!(procedure instanceof Element)) {
      return `__index__:${index}`;
    }
    const skill = String(procedure.getAttribute("data-skill") || "").trim().toLowerCase();
    const titleNode = procedure.querySelector(".procedure-title-text");
    const title = String(titleNode && titleNode.textContent ? titleNode.textContent : "")
      .trim()
      .toLowerCase();
    if (!skill && !title) {
      return `__index__:${index}`;
    }
    return `${skill}|${title}`;
  }

  function capturePreviewProcedureStates() {
    if (!elements.modalPreview) {
      return {
        byKey: new Map(),
        byIndex: [],
      };
    }
    const statesByKey = new Map();
    const statesByIndex = [];
    const procedures = Array.from(elements.modalPreview.querySelectorAll(".procedure"));
    procedures.forEach((procedure, index) => {
      const key = getPreviewProcedureStateKey(procedure, index);
      const expanded = !procedure.classList.contains("collapsed");
      statesByIndex[index] = expanded;
      const entries = statesByKey.get(key) || [];
      entries.push({ expanded });
      statesByKey.set(key, entries);
    });
    return {
      byKey: statesByKey,
      byIndex: statesByIndex,
    };
  }

  function setPreviewProcedureCollapsed(procedure, isCollapsed) {
    if (!(procedure instanceof Element)) {
      return;
    }
    const nextCollapsed = !!isCollapsed;
    procedure.classList.toggle("collapsed", nextCollapsed);
    const header = procedure.querySelector(".procedure-header");
    if (header) {
      header.setAttribute("aria-expanded", String(!nextCollapsed));
    }
  }

  function restorePreviewProcedureStates(previousStates) {
    if (!elements.modalPreview || !previousStates || typeof previousStates !== "object") {
      return;
    }
    const byKey = previousStates.byKey instanceof Map ? previousStates.byKey : new Map();
    const byIndex = Array.isArray(previousStates.byIndex) ? previousStates.byIndex : [];
    if (byKey.size === 0 && byIndex.length === 0) {
      return;
    }
    const restoreOffsets = new Map();
    const procedures = Array.from(elements.modalPreview.querySelectorAll(".procedure"));
    procedures.forEach((procedure, index) => {
      let shouldExpand = false;
      const key = getPreviewProcedureStateKey(procedure, index);
      const entries = byKey.get(key);
      if (Array.isArray(entries) && entries.length > 0) {
        const offset = restoreOffsets.get(key) || 0;
        if (offset < entries.length) {
          restoreOffsets.set(key, offset + 1);
          shouldExpand = !!(entries[offset] && entries[offset].expanded);
        }
      }
      if (!shouldExpand && index < byIndex.length) {
        shouldExpand = !!byIndex[index];
      }
      if (shouldExpand) {
        setPreviewProcedureCollapsed(procedure, false);
      }
    });
  }

  function resetPreviewScroll() {
    if (!elements.modalPreview) {
      return;
    }
    elements.modalPreview.scrollTop = 0;
    elements.modalPreview.scrollLeft = 0;
  }

  function resetPreviewSyncState() {
    state.previewSyncLock = "";
    state.previewActiveScrollSource = "";
    state.previewIgnoreNextEditorScroll = 0;
    state.previewIgnoreNextPreviewScroll = 0;
  }

  function resetEditorAndPreviewScroll() {
    resetEditorScroll();
    resetPreviewScroll();
  }

  function applyPreviewBlockMetadata(target, blockData, blockIndex) {
    if (!(target instanceof Element)) {
      return;
    }
    target.classList.add("editor-preview-block");
    target.setAttribute("data-block-index", String(blockIndex));
    target.setAttribute("data-source-start", String(blockData.sourceStart || 0));
    target.setAttribute("data-source-end", String(blockData.sourceEnd || 0));
  }

  function updatePreviewLineAnchors() {
    if (!elements.modalPreview) {
      state.previewLineAnchors = [];
      return;
    }

    state.previewLineAnchors = Array.from(
      elements.modalPreview.querySelectorAll(".editor-preview-block"),
    )
      .map((block) => {
        const indexRaw = Number.parseInt(block.getAttribute("data-block-index") || "-1", 10);
        const sourceStartRaw = Number.parseInt(block.getAttribute("data-source-start") || "0", 10);
        const sourceEndRaw = Number.parseInt(block.getAttribute("data-source-end") || String(sourceStartRaw), 10);
        const sourceStart = Number.isFinite(sourceStartRaw) ? Math.max(0, sourceStartRaw) : 0;
        const sourceEnd = Number.isFinite(sourceEndRaw) ? Math.max(sourceStart, sourceEndRaw) : sourceStart;
        return {
          block,
          blockIndex: Number.isFinite(indexRaw) ? indexRaw : -1,
          sourceStart,
          sourceEnd,
        };
      });
  }

  function buildPreviewScrollAnchors() {
    state.previewScrollAnchors = [];
    if (!state.editorView || typeof state.editorView.lineBlockAt !== "function") {
      return;
    }
    const view = state.editorView;
    const doc = view.state.doc;
    const maxDocPos = Math.max(0, doc.length);
    const totalLines = Math.max(1, doc.lines || 1);

    const mappedAnchors = state.previewLineAnchors
      .map((anchor) => {
        const startPos = Math.max(0, Math.min(maxDocPos, anchor.sourceStart));
        const rawEndPos = Math.max(startPos, Math.min(maxDocPos, anchor.sourceEnd));
        const endPos = Math.max(startPos, rawEndPos > startPos ? rawEndPos - 1 : rawEndPos);
        const startLine = Math.min(totalLines, Math.max(1, doc.lineAt(startPos).number));
        const endLine = Math.min(totalLines, Math.max(startLine, doc.lineAt(endPos).number));
        const startBlock = view.lineBlockAt(doc.line(startLine).from);
        const editorTop = Number(startBlock && startBlock.top) || 0;
        let editorBottom = 0;
        if (endLine < totalLines) {
          const nextLineBlock = view.lineBlockAt(doc.line(endLine + 1).from);
          editorBottom = Number(nextLineBlock && nextLineBlock.top) || 0;
        } else {
          editorBottom = view.scrollDOM.scrollHeight;
        }
        editorBottom = Math.max(editorTop + 1, editorBottom);
        const previewTop = anchor.block.offsetTop;
        const previewBottom = previewTop + Math.max(1, anchor.block.offsetHeight);
        return {
          blockIndex: anchor.blockIndex,
          editorTop,
          editorBottom,
          previewTop,
          previewBottom,
        };
      })
      .sort((left, right) => left.editorTop - right.editorTop);

    state.previewScrollAnchors = mappedAnchors.map((anchor) => ({
      ...anchor,
      editorBottom: Math.max(anchor.editorTop + 1, Number(anchor.editorBottom) || anchor.editorTop + 1),
      previewBottom: Math.max(anchor.previewTop + 1, Number(anchor.previewBottom) || anchor.previewTop + 1),
    }));
  }

  function shouldDefaultPreviewEnabled() {
    return !isPreviewPaneStacked();
  }

  function isPreviewPaneStacked() {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(PREVIEW_STACK_MEDIA_QUERY).matches;
  }

  function clampPreviewPaneSplitRatio(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return 0.5;
    }
    return Math.min(
      0.75,
      Math.max(0.25, numeric),
    );
  }

  function updatePreviewPaneSplitterState() {
    if (!elements.modalPaneSplitter) {
      return;
    }
    const ratioPercent = Math.round(clampPreviewPaneSplitRatio(state.previewPaneSplitRatio) * 100);
    const isActive = !!state.previewEnabled;
    elements.modalPaneSplitter.tabIndex = isActive ? 0 : -1;
    elements.modalPaneSplitter.setAttribute("aria-hidden", String(!isActive));
    elements.modalPaneSplitter.setAttribute("aria-orientation", isPreviewPaneStacked() ? "horizontal" : "vertical");
    elements.modalPaneSplitter.setAttribute("aria-valuemin", "25");
    elements.modalPaneSplitter.setAttribute("aria-valuemax", "75");
    elements.modalPaneSplitter.setAttribute("aria-valuenow", String(ratioPercent));
    elements.modalPaneSplitter.setAttribute("aria-valuetext", `Editor pane ${ratioPercent}%`);
  }

  function applyPreviewPaneSplitRatio(nextRatio, options) {
    const opts = options || {};
    const ratio = clampPreviewPaneSplitRatio(nextRatio);
    state.previewPaneSplitRatio = ratio;
    if (elements.modalDiffEditor) {
      elements.modalDiffEditor.style.setProperty("--editor-pane-split", `${(ratio * 100).toFixed(2)}%`);
    }
    updatePreviewPaneSplitterState();

    if (opts.persist !== false) {
      storeEditorState();
    }
    if (opts.resync === false || !state.previewEnabled) {
      return;
    }
    schedulePreviewResyncAfterLayout({ preserveTargetScroll: true });
  }

  function applyPreviewPaneSplitRatioQuietly(nextRatio) {
    applyPreviewPaneSplitRatio(nextRatio, { persist: false, resync: false });
  }

  function getPreviewPaneSplitMetrics() {
    if (!elements.modalDiffEditor) {
      return null;
    }
    const rect = elements.modalDiffEditor.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    const stacked = isPreviewPaneStacked();
    const splitterRect = elements.modalPaneSplitter
      ? elements.modalPaneSplitter.getBoundingClientRect()
      : null;
    const rawSplitterSize = stacked
      ? Number(splitterRect && splitterRect.height) || 0
      : Number(splitterRect && splitterRect.width) || 0;
    const splitterSize = Math.max(1, rawSplitterSize || 10);
    const span = stacked ? rect.height : rect.width;
    const start = stacked ? rect.top : rect.left;
    return { stacked, span, start, splitterSize };
  }

  function setPreviewPaneSplitRatioFromPointerEvent(event) {
    const metrics = getPreviewPaneSplitMetrics();
    if (!metrics) {
      return;
    }
    const availableSize = Math.max(1, metrics.span - metrics.splitterSize);
    const pointerPosition = metrics.stacked ? Number(event.clientY) : Number(event.clientX);
    const pointerOffset = pointerPosition - metrics.start - metrics.splitterSize / 2;
    const rawRatio = pointerOffset / availableSize;
    applyPreviewPaneSplitRatio(rawRatio, { persist: false });
  }

  function isActivePreviewPaneResizePointer(event) {
    if (state.previewPaneResizePointerId === null) {
      return false;
    }
    if (!event || !Number.isFinite(event.pointerId)) {
      return true;
    }
    return event.pointerId === state.previewPaneResizePointerId;
  }

  function endPreviewPaneResize(event) {
    if (!isActivePreviewPaneResizePointer(event)) {
      return;
    }
    const activePointerId = state.previewPaneResizePointerId;
    state.previewPaneResizePointerId = null;

    if (elements.modalDiffEditor) {
      elements.modalDiffEditor.classList.remove("is-resizing");
    }
    document.body.classList.remove("editor-pane-resize-active");

    if (
      elements.modalPaneSplitter
      && Number.isFinite(activePointerId)
      && typeof elements.modalPaneSplitter.hasPointerCapture === "function"
      && elements.modalPaneSplitter.hasPointerCapture(activePointerId)
    ) {
      elements.modalPaneSplitter.releasePointerCapture(activePointerId);
    }

    storeEditorState();
  }

  function beginPreviewPaneResize(event) {
    if (!elements.modalPaneSplitter || !state.previewEnabled || event.button !== 0) {
      return;
    }
    event.preventDefault();
    state.previewPaneResizePointerId = event.pointerId;
    if (elements.modalDiffEditor) {
      elements.modalDiffEditor.classList.add("is-resizing");
    }
    document.body.classList.add("editor-pane-resize-active");
    if (typeof elements.modalPaneSplitter.setPointerCapture === "function") {
      elements.modalPaneSplitter.setPointerCapture(event.pointerId);
    }
    setPreviewPaneSplitRatioFromPointerEvent(event);
  }

  function handlePreviewPaneResizeMove(event) {
    if (!isActivePreviewPaneResizePointer(event)) {
      return;
    }
    event.preventDefault();
    setPreviewPaneSplitRatioFromPointerEvent(event);
  }

  function updatePreviewResizeObservers() {
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    if (!state.previewResizeObserver) {
      state.previewResizeObserver = new ResizeObserver(() => {
        schedulePreviewResyncAfterLayout();
      });
    }
    state.previewResizeObserver.disconnect();
    state.previewLineAnchors.forEach((anchor) => {
      state.previewResizeObserver.observe(anchor.block);
    });
  }

  function updatePreviewEditorResizeObserver() {
    if (typeof ResizeObserver === "undefined" || !state.editorView) {
      return;
    }
    if (!state.previewEditorResizeObserver) {
      state.previewEditorResizeObserver = new ResizeObserver(() => {
        schedulePreviewResyncAfterLayout();
      });
    }
    state.previewEditorResizeObserver.disconnect();
    state.previewEditorResizeObserver.observe(state.editorView.scrollDOM);
    if (elements.modalDiffEditor) {
      state.previewEditorResizeObserver.observe(elements.modalDiffEditor);
    }
  }

  function syncPreviewOnMediaLoad() {
    if (!elements.modalPreview) {
      return;
    }
    const mediaNodes = elements.modalPreview.querySelectorAll("img, iframe, video");
    mediaNodes.forEach((node) => {
      if (!(node instanceof Element) || node.getAttribute("data-preview-sync-bound") === "true") {
        return;
      }
      node.setAttribute("data-preview-sync-bound", "true");
      node.addEventListener("load", () => {
        schedulePreviewResyncAfterLayout();
      }, { passive: true });
      if (node.tagName === "VIDEO") {
        node.addEventListener("loadedmetadata", () => {
          schedulePreviewResyncAfterLayout();
        }, { passive: true });
      }
    });
  }

  function clampToRange(value, minValue, maxValue) {
    return Math.max(minValue, Math.min(maxValue, value));
  }

  function normalizePiecewisePoints(points, maxX, maxY) {
    const sorted = points
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      .map((point) => ({
        x: clampToRange(point.x, 0, maxX),
        y: clampToRange(point.y, 0, maxY),
      }))
      .sort((left, right) => {
        if (left.x !== right.x) {
          return left.x - right.x;
        }
        return left.y - right.y;
      });

    if (!sorted.length) {
      return [{ x: 0, y: 0 }, { x: maxX, y: maxY }];
    }

    const normalized = [];
    let lastY = 0;

    sorted.forEach((point) => {
      const x = point.x;
      const y = Math.max(lastY, point.y);
      if (!normalized.length) {
        normalized.push({ x, y });
        lastY = y;
        return;
      }
      const previous = normalized[normalized.length - 1];
      if (Math.abs(x - previous.x) < 0.5) {
        previous.y = Math.max(previous.y, y);
        lastY = previous.y;
        return;
      }
      normalized.push({ x, y });
      lastY = y;
    });

    const first = normalized[0];
    if (first.x > 0.5 || first.y > 0.5) {
      normalized.unshift({ x: 0, y: 0 });
    } else {
      first.x = 0;
      first.y = 0;
    }

    const last = normalized[normalized.length - 1];
    if (Math.abs(last.x - maxX) < 0.5) {
      last.x = maxX;
      last.y = maxY;
    } else {
      normalized.push({ x: maxX, y: maxY });
    }

    for (let index = 1; index < normalized.length; index += 1) {
      normalized[index].y = Math.max(normalized[index].y, normalized[index - 1].y);
    }

    return normalized;
  }

  function interpolatePiecewise(points, targetX) {
    if (!points.length) {
      return null;
    }
    if (points.length === 1) {
      return points[0].y;
    }

    const clampedX = clampToRange(targetX, points[0].x, points[points.length - 1].x);
    if (clampedX <= points[0].x) {
      return points[0].y;
    }

    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      if (clampedX > end.x && index < points.length - 2) {
        continue;
      }
      const span = Math.max(0.0001, end.x - start.x);
      const ratio = clampToRange((clampedX - start.x) / span, 0, 1);
      return start.y + ((end.y - start.y) * ratio);
    }

    return points[points.length - 1].y;
  }

  function buildScrollSyncPiecewiseMaps(
    maxEditorScrollTop,
    maxPreviewScrollTop,
    editorViewportHeight,
    previewViewportHeight,
  ) {
    const anchors = state.previewScrollAnchors;
    const forwardRawPoints = [{ x: 0, y: 0 }];

    anchors.forEach((anchor) => {
      const editorTop = Number(anchor.editorTop) || 0;
      const previewTop = Number(anchor.previewTop) || 0;
      const editorBottomScroll = (Number(anchor.editorBottom) || 0) - editorViewportHeight;
      const previewBottomScroll = (Number(anchor.previewBottom) || 0) - previewViewportHeight;

      forwardRawPoints.push({
        x: editorTop,
        y: previewTop,
      });

      // Bottom anchors only make sense in scroll space when the block is tall
      // enough to produce a distinct bottom-scroll position in both panes.
      if (editorBottomScroll > editorTop + 0.5 && previewBottomScroll > previewTop + 0.5) {
        forwardRawPoints.push({
          x: editorBottomScroll,
          y: previewBottomScroll,
        });
      }
    });

    forwardRawPoints.push({ x: maxEditorScrollTop, y: maxPreviewScrollTop });

    const editorToPreview = normalizePiecewisePoints(
      forwardRawPoints,
      maxEditorScrollTop,
      maxPreviewScrollTop,
    );

    const previewToEditor = normalizePiecewisePoints(
      editorToPreview.map((point) => ({ x: point.y, y: point.x })),
      maxPreviewScrollTop,
      maxEditorScrollTop,
    );

    return {
      editorToPreview,
      previewToEditor,
    };
  }

  function resolvePreviewOffsetForEditorOffset(targetEditorOffset, maxEditorScrollTop, maxPreviewScrollTop) {
    const editorViewportHeight = state.editorView
      ? Math.max(1, state.editorView.scrollDOM.clientHeight || 1)
      : 1;
    const previewViewportHeight = elements.modalPreview
      ? Math.max(1, elements.modalPreview.clientHeight || 1)
      : 1;
    const maps = buildScrollSyncPiecewiseMaps(
      maxEditorScrollTop,
      maxPreviewScrollTop,
      editorViewportHeight,
      previewViewportHeight,
    );
    return interpolatePiecewise(maps.editorToPreview, targetEditorOffset);
  }

  function resolveEditorOffsetForPreviewOffset(targetPreviewOffset, maxEditorScrollTop, maxPreviewScrollTop) {
    const editorViewportHeight = state.editorView
      ? Math.max(1, state.editorView.scrollDOM.clientHeight || 1)
      : 1;
    const previewViewportHeight = elements.modalPreview
      ? Math.max(1, elements.modalPreview.clientHeight || 1)
      : 1;
    const maps = buildScrollSyncPiecewiseMaps(
      maxEditorScrollTop,
      maxPreviewScrollTop,
      editorViewportHeight,
      previewViewportHeight,
    );
    return interpolatePiecewise(maps.previewToEditor, targetPreviewOffset);
  }

  function setPreviewSyncLock(source) {
    state.previewSyncLock = source;
    window.requestAnimationFrame(() => {
      if (state.previewSyncLock === source) {
        state.previewSyncLock = "";
      }
    });
  }

  function setActivePreviewScrollSource(source) {
    state.previewActiveScrollSource = source;
    if (state.previewActiveScrollTimeoutId) {
      window.clearTimeout(state.previewActiveScrollTimeoutId);
    }
    state.previewActiveScrollTimeoutId = window.setTimeout(() => {
      if (state.previewActiveScrollSource === source) {
        state.previewActiveScrollSource = "";
      }
      state.previewActiveScrollTimeoutId = null;
    }, 260);
  }

  function bindManualScrollSourceListeners(target, source) {
    if (!target || typeof target.addEventListener !== "function") {
      return;
    }
    if (target.getAttribute && target.getAttribute("data-scroll-source-bound") === "true") {
      return;
    }
    if (target.setAttribute) {
      target.setAttribute("data-scroll-source-bound", "true");
    }

    const markSource = () => {
      setActivePreviewScrollSource(source);
    };

    target.addEventListener("wheel", markSource, { passive: true });
    target.addEventListener("touchstart", markSource, { passive: true });
    target.addEventListener("touchmove", markSource, { passive: true });
    target.addEventListener("pointerdown", markSource, { passive: true });
    target.addEventListener("keydown", (event) => {
      const key = event && typeof event.key === "string" ? event.key : "";
      if (!key) {
        return;
      }
      if (
        key === "ArrowUp"
        || key === "ArrowDown"
        || key === "PageUp"
        || key === "PageDown"
        || key === "Home"
        || key === "End"
        || key === " "
      ) {
        markSource();
      }
    });
  }

  function schedulePreviewResyncAfterScrollSettles() {
    if (!state.previewEnabled) {
      return;
    }
    if (state.previewScrollResyncTimeoutId) {
      window.clearTimeout(state.previewScrollResyncTimeoutId);
    }
    state.previewScrollResyncTimeoutId = window.setTimeout(() => {
      state.previewScrollResyncTimeoutId = null;
      schedulePreviewResyncAfterLayout({ preserveTargetScroll: true });
    }, 140);
  }

  function syncPreviewScrollToSource() {
    if (!state.previewEnabled || !elements.modalPreview || elements.modalPreview.hidden) {
      return;
    }
    if (state.previewSyncLock === "preview") {
      return;
    }
    if (state.previewActiveScrollSource && state.previewActiveScrollSource !== "editor") {
      return;
    }
    if (!state.previewScrollAnchors.length) {
      schedulePreviewResyncAfterLayout();
      return;
    }
    const maxPreviewScrollTop = Math.max(0, elements.modalPreview.scrollHeight - elements.modalPreview.clientHeight);
    if (maxPreviewScrollTop <= 0) {
      return;
    }
    const editorScroller = state.editorView ? state.editorView.scrollDOM : null;
    const maxEditorScrollTop = editorScroller
      ? Math.max(0, editorScroller.scrollHeight - editorScroller.clientHeight)
      : 0;
    const targetEditorOffset = getEditorScrollOffset();
    const nextScrollTop = resolvePreviewOffsetForEditorOffset(
      targetEditorOffset,
      maxEditorScrollTop,
      maxPreviewScrollTop,
    );
    if (!Number.isFinite(nextScrollTop)) {
      return;
    }
    const clamped = Math.max(0, Math.min(maxPreviewScrollTop, nextScrollTop));
    if (Math.abs((elements.modalPreview.scrollTop || 0) - clamped) > 0.5) {
      setPreviewSyncLock("editor");
      state.previewIgnoreNextPreviewScroll += 1;
      elements.modalPreview.scrollTop = clamped;
    }
  }

  function syncEditorScrollToPreview() {
    if (!state.previewEnabled || !elements.modalPreview || elements.modalPreview.hidden || !state.editorView) {
      return;
    }
    if (state.previewSyncLock === "editor") {
      return;
    }
    if (state.previewActiveScrollSource && state.previewActiveScrollSource !== "preview") {
      return;
    }
    if (!state.previewScrollAnchors.length) {
      schedulePreviewResyncAfterLayout();
      return;
    }
    const editorScroller = state.editorView.scrollDOM;
    const maxEditorScrollTop = Math.max(0, editorScroller.scrollHeight - editorScroller.clientHeight);
    if (maxEditorScrollTop <= 0) {
      return;
    }
    const maxPreviewScrollTop = Math.max(
      0,
      elements.modalPreview.scrollHeight - elements.modalPreview.clientHeight,
    );
    const targetPreviewOffset = elements.modalPreview.scrollTop || 0;
    const nextScrollTop = resolveEditorOffsetForPreviewOffset(
      targetPreviewOffset,
      maxEditorScrollTop,
      maxPreviewScrollTop,
    );
    if (!Number.isFinite(nextScrollTop)) {
      return;
    }
    const clamped = Math.max(0, Math.min(maxEditorScrollTop, nextScrollTop));
    if (Math.abs((editorScroller.scrollTop || 0) - clamped) > 0.5) {
      setPreviewSyncLock("preview");
      state.previewIgnoreNextEditorScroll += 1;
      editorScroller.scrollTop = clamped;
    }
  }

  function schedulePreviewResyncAfterLayout(options) {
    const preserveTargetScroll = !!(options && options.preserveTargetScroll);
    if (state.previewResyncPending) {
      return;
    }
    state.previewResyncPending = true;
    const runResync = () => {
      try {
        buildPreviewScrollAnchors();
        if (preserveTargetScroll) {
          return;
        }
        if (state.previewActiveScrollSource === "preview") {
          syncEditorScrollToPreview();
        } else {
          syncPreviewScrollToSource();
        }
      } finally {
        state.previewResyncPending = false;
      }
    };
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (state.editorView && typeof state.editorView.requestMeasure === "function") {
          state.editorView.requestMeasure({
            read() {
              return null;
            },
            write() {
              runResync();
            },
          });
          return;
        }
        runResync();
      });
    });
  }

  function renderMarkdownPreview() {
    if (!state.previewEnabled || !elements.modalPreview) {
      return;
    }
    const previousProcedureStates = capturePreviewProcedureStates();
    const snapshot = getEditorSnapshot();
    const markdown = snapshot ? snapshot.value : "";
    const previewData = buildPreviewBlocksFromMarkdown(markdown);
    const blocks = Array.isArray(previewData && previewData.blocks) ? previewData.blocks : [];
    const globalDefinitionSuffix = previewData && previewData.globalDefinitionSuffix
      ? String(previewData.globalDefinitionSuffix)
      : "";
    const fragment = document.createDocumentFragment();

    blocks.forEach((blockData, blockIndex) => {
      const blockHost = document.createElement("div");
      renderPreviewBlock(blockHost, blockData.markdown, globalDefinitionSuffix);
      const renderedElements = Array.from(blockHost.children);
      const hasMeaningfulTextNode = Array.from(blockHost.childNodes).some((node) => (
        node.nodeType === 3 && String(node.textContent || "").trim().length > 0
      ));

      if (renderedElements.length === 1 && !hasMeaningfulTextNode) {
        const onlyElement = renderedElements[0];
        applyPreviewBlockMetadata(onlyElement, blockData, blockIndex);
        fragment.appendChild(onlyElement);
        return;
      }

      // Fallback: keep a wrapper only when the rendered block has multiple roots.
      const wrapper = document.createElement("div");
      applyPreviewBlockMetadata(wrapper, blockData, blockIndex);
      while (blockHost.firstChild) {
        wrapper.appendChild(blockHost.firstChild);
      }
      fragment.appendChild(wrapper);
    });

    applyStagedImagePreviews(fragment);
    elements.modalPreview.replaceChildren(fragment);
    restorePreviewProcedureStates(previousProcedureStates);
    updatePreviewLineAnchors();
    state.previewScrollAnchors = [];
    updatePreviewResizeObservers();
    updatePreviewEditorResizeObserver();
    syncPreviewOnMediaLoad();
    schedulePreviewResyncAfterLayout();
  }

  function scheduleMarkdownPreviewRender(immediate) {
    if (!state.previewEnabled) {
      return;
    }
    if (state.previewRenderTimeoutId) {
      window.clearTimeout(state.previewRenderTimeoutId);
      state.previewRenderTimeoutId = null;
    }
    if (immediate) {
      renderMarkdownPreview();
      return;
    }
    state.previewRenderTimeoutId = window.setTimeout(() => {
      state.previewRenderTimeoutId = null;
      renderMarkdownPreview();
    }, 80);
  }

  function setPreviewEnabled(isEnabled) {
    state.previewEnabled = !!isEnabled;
    if (!state.previewEnabled) {
      endPreviewPaneResize();
    }
    if (elements.modalPreviewToggle) {
      elements.modalPreviewToggle.classList.toggle("is-active", state.previewEnabled);
      elements.modalPreviewToggle.setAttribute("aria-pressed", String(state.previewEnabled));
    }
    if (elements.modalPreview) {
      elements.modalPreview.hidden = !state.previewEnabled;
    }
    if (elements.modalDiffEditor) {
      elements.modalDiffEditor.classList.toggle("has-preview", state.previewEnabled);
    }
    updatePreviewPaneSplitterState();
    if (!state.previewEnabled) {
      if (state.previewRenderTimeoutId) {
        window.clearTimeout(state.previewRenderTimeoutId);
        state.previewRenderTimeoutId = null;
      }
      if (state.previewScrollResyncTimeoutId) {
        window.clearTimeout(state.previewScrollResyncTimeoutId);
        state.previewScrollResyncTimeoutId = null;
      }
      if (state.previewActiveScrollTimeoutId) {
        window.clearTimeout(state.previewActiveScrollTimeoutId);
        state.previewActiveScrollTimeoutId = null;
      }
      state.previewResyncPending = false;
      state.previewSyncLock = "";
      state.previewActiveScrollSource = "";
      state.previewIgnoreNextEditorScroll = 0;
      state.previewIgnoreNextPreviewScroll = 0;
      if (state.previewResizeObserver) {
        state.previewResizeObserver.disconnect();
      }
      if (state.previewEditorResizeObserver) {
        state.previewEditorResizeObserver.disconnect();
      }
      if (state.editorView && state.previewLineAnchors.length > 0) {
        schedulePreviewResyncAfterLayout();
      }
      return;
    }
    if (state.previewScrollResyncTimeoutId) {
      window.clearTimeout(state.previewScrollResyncTimeoutId);
      state.previewScrollResyncTimeoutId = null;
    }
    if (state.previewActiveScrollTimeoutId) {
      window.clearTimeout(state.previewActiveScrollTimeoutId);
      state.previewActiveScrollTimeoutId = null;
    }
    state.previewSyncLock = "";
    state.previewActiveScrollSource = "";
    state.previewIgnoreNextEditorScroll = 0;
    state.previewIgnoreNextPreviewScroll = 0;
    state.previewResyncPending = false;
    scheduleMarkdownPreviewRender(true);
    schedulePreviewResyncAfterLayout();
  }

  function buildCommitOptionLabel(commit, fallbackLabel) {
    if (!commit || typeof commit !== "object") {
      return fallbackLabel || "Commit";
    }

    const sha = shortenSha(commit.sha);
    if (!sha) {
      return fallbackLabel || "Commit";
    }

    const age = formatCompactCommitAge(commit.committedAt);
    return age ? `${sha} | ${age}` : sha;
  }

  function resetCompareSelectToCurrent(path, label, options) {
    if (!elements.modalCompareSelect) {
      return;
    }

    const opts = options || {};
    const currentLabel = label || "Current commit";
    elements.modalCompareSelect.innerHTML = "";
    const noneOption = document.createElement("option");
    noneOption.value = "none";
    noneOption.textContent = "None";
    noneOption.title = "Turn off inline diff highlighting";
    elements.modalCompareSelect.appendChild(noneOption);

    const currentOption = document.createElement("option");
    currentOption.value = "current";
    currentOption.textContent = currentLabel;
    elements.modalCompareSelect.appendChild(currentOption);
    elements.modalCompareSelect.value = "current";
    if (path && opts.persist !== false) {
      state.compareSelectionByPath.set(path, "current");
    }
  }

  function updateCompareSelect(path, historyPayload) {
    if (!elements.modalCompareSelect) {
      return;
    }

    const select = elements.modalCompareSelect;
    const previousSelection = state.compareSelectionByPath.get(path) || "current";
    const headCommit = historyPayload && historyPayload.head ? historyPayload.head : null;
    const currentLabel = buildCommitOptionLabel(headCommit, "Current commit");
    resetCompareSelectToCurrent(path, currentLabel, { persist: false });

    const commits = historyPayload && Array.isArray(historyPayload.commits)
      ? historyPayload.commits
      : [];
    const seenShas = new Set();
    commits.forEach((commit) => {
      const sha = String(commit && commit.sha ? commit.sha : "");
      if (!sha || seenShas.has(sha)) {
        return;
      }
      seenShas.add(sha);
      if (headCommit && sha === headCommit.sha) {
        return;
      }

      const option = document.createElement("option");
      option.value = `sha:${sha}`;
      option.textContent = buildCommitOptionLabel(commit, "Previous commit");
      const firstLineMessage = String(commit && commit.message ? commit.message : "")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      if (firstLineMessage) {
        option.title = firstLineMessage;
      }
      select.appendChild(option);
    });

    const hasPreviousSelection = Array.from(select.options).some((option) => option.value === previousSelection);
    select.value = hasPreviousSelection ? previousSelection : "current";
    state.compareSelectionByPath.set(path, select.value);
  }

  async function fetchFileHistory(path, force) {
    const normalizedPath = normalizeSourcePath(path);
    if (!normalizedPath || !isMarkdownSourcePath(normalizedPath)) {
      return null;
    }

    const cached = state.compareHistoryByPath.get(normalizedPath);
    const now = Date.now();
    if (!force && cached && now - cached.fetchedAt < 90 * 1000) {
      return cached.payload;
    }

    const repo = resolveRepoConfig();
    if (!repo) {
      return null;
    }

    const params = new URLSearchParams({
      owner: repo.owner,
      repo: repo.name,
      branch: repo.baseBranch,
      path: normalizedPath,
      per_page: "35",
      compact: "1",
    });
    const payload = await authRequest(`/api/file-history?${params.toString()}`, {
      includeSessionHeader: false,
    });
    state.compareHistoryByPath.set(normalizedPath, {
      fetchedAt: now,
      payload,
    });
    return payload;
  }

  async function fetchMarkdownAtCommit(path, ref) {
    const normalizedPath = normalizeSourcePath(path);
    const normalizedRef = String(ref || "").trim();
    if (!normalizedPath || !normalizedRef) {
      return "";
    }

    const cacheKey = `${normalizedPath}@${normalizedRef}`;
    if (state.compareContentByRef.has(cacheKey)) {
      return state.compareContentByRef.get(cacheKey);
    }

    const repo = resolveRepoConfig();
    if (!repo) {
      return "";
    }

    const params = new URLSearchParams({
      owner: repo.owner,
      repo: repo.name,
      path: normalizedPath,
      ref: normalizedRef,
      compact: "1",
    });
    const payload = await authRequest(`/api/file-content?${params.toString()}`, {
      includeSessionHeader: false,
    });
    const markdown = payload && typeof payload.markdown === "string"
      ? payload.markdown
      : "";
    state.compareContentByRef.set(cacheKey, markdown);
    return markdown;
  }

  async function applyCompareSelection(path) {
    if (!elements.modalCompareSelect || !path || state.currentPath !== path) {
      return;
    }

    const select = elements.modalCompareSelect;
    const selectedValue = select.value || "current";
    const selectedOption = select.selectedOptions && select.selectedOptions[0]
      ? select.selectedOptions[0]
      : null;
    const selectionLabel = selectedOption && selectedOption.textContent
      ? selectedOption.textContent.trim()
      : "Current commit";
    state.compareSelectionByPath.set(path, selectedValue);

    const baselineToken = ++state.compareBaselineToken;
    if (selectedValue === "none") {
      state.compareBaselinePath = path;
      state.compareBaselineRef = "none";
      state.compareBaselineLabel = "None";
      state.compareBaselineText = "";
      state.compareBaselineTitle = getTitleInputValue(state.currentTitleFallback);
      setCompareStatus("");
      refreshEditorBaseline();
      return;
    }

    if (selectedValue === "current") {
      try {
        const sourceMarkdown = await getSourceMarkdown(path);
        if (baselineToken !== state.compareBaselineToken || state.currentPath !== path) {
          return;
        }
        const baselineSplit = splitMarkdownTitle(sourceMarkdown);
        state.compareBaselinePath = path;
        state.compareBaselineRef = "current";
        state.compareBaselineLabel = selectionLabel || "Current commit";
        state.compareBaselineText = baselineSplit.body;
        state.compareBaselineTitle = baselineSplit.title;
        setCompareStatus("");
        refreshEditorBaseline();
      } catch (error) {
        if (baselineToken !== state.compareBaselineToken || state.currentPath !== path) {
          return;
        }
        setCompareStatus(error.message || "Could not load current section content.", true);
      }
      return;
    }

    const selectedSha = selectedValue.startsWith("sha:") ? selectedValue.slice(4) : "";
    if (!selectedSha) {
      return;
    }

    setCompareStatus("Loading selected commit content…");
    try {
      const markdown = await fetchMarkdownAtCommit(path, selectedSha);
      if (baselineToken !== state.compareBaselineToken || state.currentPath !== path) {
        return;
      }
      const baselineSplit = splitMarkdownTitle(markdown);
      state.compareBaselinePath = path;
      state.compareBaselineRef = selectedSha;
      state.compareBaselineLabel = selectionLabel || buildCommitOptionLabel({ sha: selectedSha }, "Previous commit");
      state.compareBaselineText = baselineSplit.body;
      state.compareBaselineTitle = baselineSplit.title;
      setCompareStatus("");
      refreshEditorBaseline();
    } catch (error) {
      if (baselineToken !== state.compareBaselineToken || state.currentPath !== path) {
        return;
      }
      setCompareStatus(error.message || "Could not load commit content.", true);
    }
  }

  async function openCompareCommitDialog() {
    if (!elements.modalCompareSelect || !state.currentPath || state.newSectionDraft) {
      return;
    }

    const options = Array.from(elements.modalCompareSelect.options || []);
    if (!options.length) {
      setCompareStatus("Commit history is still loading.");
      return;
    }

    const rows = options.map((option, index) => {
      const selected = option.value === elements.modalCompareSelect.value;
      const title = option.title || option.textContent || "Commit";
      return `
        <button
          type="button"
          class="compare-picker-option${selected ? " is-selected" : ""}"
          data-compare-value="${escapeDialogHtml(option.value)}"
          aria-pressed="${selected ? "true" : "false"}"
        >
          <span class="compare-picker-label">${escapeDialogHtml(option.textContent || `Commit ${index + 1}`)}</span>
          <span class="compare-picker-title">${escapeDialogHtml(title)}</span>
        </button>
      `;
    }).join("");

    const dialogPromise = openAppDialog({
      title: "Compare with",
      messageHtml: `<div class="compare-picker">${rows}</div>`,
      confirmText: "Close",
      showCancel: false,
      panelClassName: "compare-picker-dialog-panel",
      messageClassName: "compare-picker-dialog",
    });

    const optionButtons = elements.appDialogMessage
      ? Array.from(elements.appDialogMessage.querySelectorAll(".compare-picker-option"))
      : [];
    optionButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const value = button.getAttribute("data-compare-value") || "current";
        elements.modalCompareSelect.value = value;
        closeAppDialog(true);
        applyCompareSelection(state.currentPath);
      });
    });

    await dialogPromise;
  }

  async function loadComparisonContext(path, initialMarkdown, forceRefresh) {
    if (!path || !elements.modalCompareSelect) {
      return;
    }

    const storedSelection = state.compareSelectionByPath.get(path) || "current";
    const baselineMarkdown = state.sourceMarkdown.get(path) || String(initialMarkdown || "");
    const baselineSplit = splitMarkdownTitle(baselineMarkdown);
    state.compareBaselinePath = path;
    state.compareBaselineRef = "current";
    state.compareBaselineLabel = "Current commit";
    state.compareBaselineText = baselineSplit.body;
    state.compareBaselineTitle = baselineSplit.title;
    resetCompareSelectToCurrent(path, "Current commit", { persist: false });
    if (storedSelection === "none") {
      elements.modalCompareSelect.value = "none";
      state.compareBaselineRef = "none";
      state.compareBaselineLabel = "None";
      state.compareBaselineText = "";
      state.compareBaselineTitle = getTitleInputValue(state.currentTitleFallback);
      state.compareSelectionByPath.set(path, "none");
    }
    refreshEditorBaseline();

    const historyToken = ++state.compareHistoryToken;
    setCompareStatus("Loading commit history…");
    elements.modalCompareSelect.disabled = true;

    try {
      const historyPayload = await fetchFileHistory(path, !!forceRefresh);
      if (historyToken !== state.compareHistoryToken || state.currentPath !== path) {
        return;
      }
      updateCompareSelect(path, historyPayload);
      elements.modalCompareSelect.disabled = false;
      await applyCompareSelection(path);
      const compareDisabled = elements.modalCompareSelect.value === "none";
      const commitCount = historyPayload && Array.isArray(historyPayload.commits)
        ? historyPayload.commits.length
        : 0;
      const hasCompareError = state.compareStatusIsError;
      if (!hasCompareError && !compareDisabled) {
        if (commitCount === 0 && state.currentPath === path) {
          setCompareStatus("No previous commits for this section.");
        } else if (state.currentPath === path) {
          setCompareStatus("");
        }
      }
    } catch (error) {
      if (historyToken !== state.compareHistoryToken || state.currentPath !== path) {
        return;
      }
      resetCompareSelectToCurrent(path, "Current commit", { persist: false });
      if (storedSelection === "none") {
        elements.modalCompareSelect.value = "none";
      }
      elements.modalCompareSelect.disabled = false;
      setCompareStatus(error.message || "Could not load commit history.", true);
      await applyCompareSelection(path);
    }
  }

  function clearComparisonUi() {
    state.compareHistoryToken += 1;
    state.compareBaselineToken += 1;
    state.compareBaselinePath = "";
    state.compareBaselineRef = "current";
    state.compareBaselineLabel = "Current commit";
    state.compareBaselineText = "";
    state.compareBaselineTitle = "";
    if (state.diffRenderTimeoutId) {
      window.clearTimeout(state.diffRenderTimeoutId);
      state.diffRenderTimeoutId = null;
    }
    if (elements.modalCompareSelect) {
      elements.modalCompareSelect.innerHTML = "";
      elements.modalCompareSelect.disabled = false;
    }
    state.compareStatusMessage = "";
    state.compareStatusIsError = false;
    state.editorDiffStats = null;
    setDiffSummary("Live diff preview");
  }

  function classifyDeployState(run) {
    if (!run) {
      return { label: "unknown", cssClass: "unknown" };
    }

    if (run.status && run.status !== "completed") {
      return { label: run.status, cssClass: "running" };
    }

    const conclusion = String(run.conclusion || "").toLowerCase();
    if (conclusion === "success") {
      return { label: "success", cssClass: "success" };
    }
    if (conclusion === "cancelled" || conclusion === "timed_out" || conclusion === "failure" || conclusion === "action_required") {
      return { label: conclusion || "failed", cssClass: "failed" };
    }
    if (conclusion === "skipped" || conclusion === "neutral") {
      return { label: conclusion, cssClass: "neutral" };
    }
    return { label: conclusion || "unknown", cssClass: "unknown" };
  }

  async function refreshRepoActivity(force) {
    if (state.repoActivityBusy && !force) {
      return;
    }

    const repo = resolveRepoConfig();
    if (!repo) {
      return;
    }

    const showLoadingState = !state.repoActivity;
    state.repoActivityBusy = true;
    if (showLoadingState) {
      updateRepoActivityUi();
    }

    try {
      const query = new URLSearchParams({
        owner: repo.owner,
        repo: repo.name,
        branch: repo.baseBranch,
      });
      const activity = await authRequest(`/api/repo-status?${query.toString()}`, {
        includeSessionHeader: false,
        timeoutMs: 8000,
      });
      if (!activity || typeof activity !== "object") {
        throw new Error("Invalid repo status response.");
      }
      state.repoActivity = activity;
    } catch (error) {
      console.error(error);
      state.repoActivity = {
        error: error.message || "Could not load repo activity.",
      };
    } finally {
      state.repoActivityBusy = false;
      updateRepoActivityUi();
    }
  }

  function isRepoActivityVisible() {
    return !!(elements.toolbar && !elements.toolbar.hidden && state.editorAuthorized);
  }

  function startRepoActivityPolling() {
    if (!isRepoActivityVisible()) {
      stopRepoActivityPolling();
      return;
    }
    if (state.repoActivityPollId) {
      return;
    }
    state.repoActivityPollId = window.setInterval(() => {
      if (document.hidden || !isRepoActivityVisible()) {
        return;
      }
      refreshRepoActivity(false);
    }, 10000);
  }

  function stopRepoActivityPolling() {
    if (!state.repoActivityPollId) {
      return;
    }
    window.clearInterval(state.repoActivityPollId);
    state.repoActivityPollId = null;
  }

  function setAttributeIfChanged(el, name, value) {
    if (el.getAttribute(name) !== value) {
      el.setAttribute(name, value);
    }
  }

  function removeAttributeIfPresent(el, name) {
    if (el.hasAttribute(name)) {
      el.removeAttribute(name);
    }
  }

  function setActivityLink(el, text, href, cssClass) {
    if (!el) {
      return;
    }
    const nextText = String(text || "");
    if (el.textContent !== nextText) {
      el.textContent = nextText;
    }
    const nextClassName = `inline-repo-link ${cssClass || ""}`.trim();
    if (el.className !== nextClassName) {
      el.className = nextClassName;
    }
    const nextHref = typeof href === "string" ? href : "";
    if (nextHref) {
      setAttributeIfChanged(el, "href", nextHref);
      setAttributeIfChanged(el, "target", "_blank");
      setAttributeIfChanged(el, "rel", "noopener noreferrer");
      removeAttributeIfPresent(el, "aria-disabled");
    } else {
      removeAttributeIfPresent(el, "href");
      removeAttributeIfPresent(el, "target");
      removeAttributeIfPresent(el, "rel");
      setAttributeIfChanged(el, "aria-disabled", "true");
    }
  }

  function getValidationIssueLevel(issue) {
    const level = String(issue && issue.level ? issue.level : "").toLowerCase();
    if (level === "error" || level === "failure") {
      return "error";
    }
    return "warning";
  }

  function escapeDialogHtml(value) {
    const text = String(value == null ? "" : value);
    if (appUtils && typeof appUtils.escapeHtml === "function") {
      return appUtils.escapeHtml(text);
    }
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getValidationIssueLocation(issue) {
    const path = typeof issue.path === "string" ? issue.path : "";
    const line = Number.isFinite(Number(issue.line)) ? Number(issue.line) : 0;
    return path
      ? `${path}${line > 0 ? `:${line}` : ""}`
      : "Unknown location";
  }

  function getValidationIssueMessage(issue) {
    const rawMessage = typeof issue.message === "string" && issue.message.trim()
      ? issue.message
      : (typeof issue.title === "string" ? issue.title : "");
    return rawMessage.replace(/\s+/g, " ").trim() || "No details provided.";
  }

  function getDeployStatusSummary(activity) {
    const deployRun = activity && activity.deployRun && typeof activity.deployRun === "object"
      ? activity.deployRun
      : null;
    if (!deployRun) {
      return {
        label: "Unavailable",
        className: "is-error",
      };
    }

    const deployState = classifyDeployState(deployRun);

    if (deployState.cssClass === "running") {
      return {
        label: "Running",
        className: "is-warning",
      };
    }
    if (deployState.cssClass === "success") {
      return {
        label: "Success",
        className: "is-success",
      };
    }

    return {
      label: "Failed",
      className: "is-error",
    };
  }

  function buildDeployStatusDialogText(activity) {
    const summary = getDeployStatusSummary(activity);
    return `Deploy status: ${summary.label}`;
  }

  function buildDeployStatusDialogHtml(activity) {
    const summary = getDeployStatusSummary(activity);
    return `
      <div class="markdown-validation-deploy">
        <p class="markdown-validation-deploy-title">Deploy status:</p>
        <p class="markdown-validation-deploy-state ${summary.className}">${escapeDialogHtml(summary.label)}</p>
      </div>
    `;
  }

  function sortValidationIssues(issues) {
    const levelWeight = {
      error: 0,
      warning: 1,
    };
    return issues.slice().sort((a, b) => {
      const aLevel = getValidationIssueLevel(a);
      const bLevel = getValidationIssueLevel(b);
      const aRank = Object.prototype.hasOwnProperty.call(levelWeight, aLevel) ? levelWeight[aLevel] : 3;
      const bRank = Object.prototype.hasOwnProperty.call(levelWeight, bLevel) ? levelWeight[bLevel] : 3;
      if (aRank !== bRank) {
        return aRank - bRank;
      }
      const aPath = String(a && a.path ? a.path : "");
      const bPath = String(b && b.path ? b.path : "");
      if (aPath !== bPath) {
        return aPath.localeCompare(bPath);
      }
      return Number(a && a.line ? a.line : 0) - Number(b && b.line ? b.line : 0);
    });
  }

  function readValidationCounts(validation, issues) {
    const errorCount = Number.isFinite(Number(validation && validation.errorCount))
      ? Number(validation.errorCount)
      : 0;
    const warningCount = Number.isFinite(Number(validation && validation.warningCount))
      ? Number(validation.warningCount)
      : 0;
    const issueList = Array.isArray(issues)
      ? issues
      : (Array.isArray(validation && validation.issues) ? validation.issues : []);
    const issueCount = Math.max(
      errorCount + warningCount,
      issueList.length,
    );

    return {
      errorCount,
      warningCount,
      issueCount,
      issues: issueList,
    };
  }

  function buildValidationCountsSummary(validation) {
    const counts = readValidationCounts(validation);
    const errorCount = counts.errorCount;
    const warningCount = counts.warningCount;

    const parts = [];
    if (errorCount > 0) {
      parts.push(`${errorCount} error${errorCount === 1 ? "" : "s"}`);
    }
    if (warningCount > 0) {
      parts.push(`${warningCount} warning${warningCount === 1 ? "" : "s"}`);
    }
    return parts.join(", ");
  }

  function buildMarkdownIssueDialogHtml(validation) {
    const issues = Array.isArray(validation && validation.issues)
      ? validation.issues
      : [];
    const counts = readValidationCounts(validation, issues);
    const sorted = sortValidationIssues(counts.issues);
    const visibleIssues = sorted.slice(0, 18);
    const grouped = {
      error: [],
      warning: [],
    };

    visibleIssues.forEach((issue) => {
      const level = getValidationIssueLevel(issue);
      grouped[level].push(issue);
    });

    const bodyParts = [];
    const groups = [
      { level: "error", label: "Errors" },
      { level: "warning", label: "Warnings" },
    ];

    groups.forEach((group) => {
      const entries = grouped[group.level];
      if (!entries || entries.length === 0) {
        return;
      }

      const rows = entries.map((issue) => {
        const location = escapeDialogHtml(getValidationIssueLocation(issue));
        const message = escapeDialogHtml(getValidationIssueMessage(issue));
        return `
          <li class="markdown-validation-issue is-${group.level}">
            <p class="markdown-validation-location"><code>${location}</code></p>
            <p class="markdown-validation-message">${message}</p>
          </li>
        `;
      }).join("");

      bodyParts.push(`
        <section class="markdown-validation-group is-${group.level}">
          <h4>${group.label} (${entries.length})</h4>
          <ol>${rows}</ol>
        </section>
      `);
    });

    if (visibleIssues.length === 0) {
      bodyParts.push("<p class=\"markdown-validation-empty\">No issue details returned by GitHub API.</p>");
    }

    const hiddenIssueCount = Math.max(0, counts.issueCount - visibleIssues.length);
    const showTruncatedMessage = !!(validation && validation.issuesTruncated)
      || hiddenIssueCount > 0;
    if (showTruncatedMessage) {
      bodyParts.push(`
        <p class="markdown-validation-truncated">
          Showing ${visibleIssues.length} of ${counts.issueCount} issue${counts.issueCount === 1 ? "" : "s"}.
          Open the commit for full annotations.
        </p>
      `);
    }

    return `
      <div class="markdown-validation-summary">
      </div>
      <div class="markdown-validation-groups">${bodyParts.join("")}</div>
    `;
  }

  function buildMarkdownIssueDialogText(validation) {
    const issues = Array.isArray(validation && validation.issues)
      ? validation.issues
      : [];
    const countsSummary = buildValidationCountsSummary(validation);
    const sorted = sortValidationIssues(issues);

    const lines = [];
    if (countsSummary) {
      lines.push(`Summary: ${countsSummary}`);
    }
    lines.push("");
    lines.push("Top issues:");

    const visibleIssues = sorted.slice(0, 12);
    if (visibleIssues.length === 0) {
      lines.push("No issue details returned by GitHub API.");
    } else {
      visibleIssues.forEach((issue, index) => {
        const level = getValidationIssueLevel(issue);
        const badge = level === "error" ? "[ERROR]" : "[WARN ]";
        const location = getValidationIssueLocation(issue);
        const message = getValidationIssueMessage(issue);

        lines.push(`${index + 1}. ${badge} ${location}`);
        lines.push(`   ${message}`);
      });
    }

    if (validation && validation.issuesTruncated) {
      lines.push("");
      lines.push("Additional issues were omitted.");
    }

    return lines.join("\n");
  }

  function updateRepoActivityUi() {
    if (!elements.repoCommit) {
      return;
    }

    const applyCombinedStatus = ({
      text = "—",
      href = "",
      baseClass = "",
      statusClass = "",
      title = "",
      ariaLabel = "",
      hasIssues = false,
    } = {}) => {
      const className = [baseClass, statusClass].filter(Boolean).join(" ").trim();
      setActivityLink(elements.repoCommit, text, href, className);
      setAttributeIfChanged(elements.repoCommit, "aria-label", ariaLabel || title || text);
      setAttributeIfChanged(elements.repoCommit, "title", title || ariaLabel || text);
      setAttributeIfChanged(elements.repoCommit, "data-has-issues", hasIssues ? "true" : "false");
    };

    const getValidationState = (validation) => {
      if (!validation || typeof validation !== "object") {
        return {
          unavailable: true,
          running: false,
          hasErrors: true,
          hasWarnings: false,
          hasIssues: false,
          title: "Markdown validation status unavailable.",
        };
      }

      if (validation.error) {
        return {
          unavailable: true,
          running: false,
          hasErrors: true,
          hasWarnings: false,
          hasIssues: false,
          title: `Markdown validation status unavailable: ${validation.error}`,
        };
      }

      const checkName = typeof validation.name === "string" && validation.name
        ? validation.name
        : "Markdown validation";
      const status = String(validation.status || "").toLowerCase();
      const conclusion = String(validation.conclusion || "").toLowerCase();
      const counts = readValidationCounts(validation);
      const countsSummary = buildValidationCountsSummary(validation);
      const detailsSuffix = countsSummary ? ` (${countsSummary})` : "";
      const running = !!(status && status !== "completed");
      const hasErrors = counts.errorCount > 0
        || (!running
          && (conclusion === "failure" || conclusion === "cancelled" || conclusion === "timed_out" || conclusion === "action_required"));
      const hasWarnings = !hasErrors && counts.warningCount > 0;
      const hasIssues = counts.issueCount > 0;

      let title = `${checkName} status unavailable.`;
      if (running) {
        title = `${checkName} is running${detailsSuffix}.`;
      } else if (hasErrors) {
        title = `${checkName} has errors${detailsSuffix}.`;
      } else if (hasWarnings) {
        title = `${checkName} has warnings${detailsSuffix}.`;
      } else {
        title = `${checkName} passed${detailsSuffix}.`;
      }

      return {
        unavailable: false,
        running,
        hasErrors,
        hasWarnings,
        hasIssues,
        title,
      };
    };

    const activity = state.repoActivity;
    if (state.repoActivityBusy && !activity) {
      applyCombinedStatus({
        text: "…",
        href: "",
        baseClass: "is-muted",
        statusClass: "is-running",
        title: "Checking deploy and markdown validation status.",
        ariaLabel: "Checking deploy and markdown validation status.",
      });
      return;
    }

    if (!activity) {
      applyCombinedStatus({
        text: "—",
        href: "",
        baseClass: "is-muted",
        statusClass: "is-failed",
        title: "Deploy and markdown validation status unavailable.",
        ariaLabel: "Deploy and markdown validation status unavailable.",
      });
      return;
    }

    if (activity.error) {
      applyCombinedStatus({
        text: "—",
        href: "",
        baseClass: "is-muted",
        statusClass: "is-failed",
        title: activity.error,
        ariaLabel: "Deploy and markdown validation status unavailable.",
      });
      return;
    }

    const commitAge = formatCompactCommitAge(activity.commitTime);
    const commitText = activity.commitSha
      ? `${shortenSha(activity.commitSha)}${commitAge ? ` | ${commitAge}` : ""}`
      : "—";
    const commitBaseClass = activity.commitSha ? "" : (activity.commitError ? "is-warning" : "is-muted");
    const commitTitle = activity.commitSha
      ? (commitAge
        ? `Latest commit ${shortenSha(activity.commitSha)} (${commitAge})`
        : `Latest commit ${shortenSha(activity.commitSha)}`)
      : "Latest commit unavailable";

    const deployRun = activity.deployRun;
    const deployState = classifyDeployState(deployRun);
    const deployRunning = !!deployRun && deployState.cssClass === "running";
    const deploySuccess = !!deployRun && deployState.cssClass === "success";
    const deployFailed = !deployRun || (!deployRunning && !deploySuccess);

    const validationState = getValidationState(activity.markdownValidation);
    const hasMdErrors = validationState.hasErrors;
    const hasMdWarningsOnly = !hasMdErrors && validationState.hasWarnings;
    const hasMdIssues = validationState.hasIssues;
    const isRunning = state.repoActivityBusy || deployRunning || validationState.running;

    const deployTitle = !deployRun
      ? (activity.runsError || "Deploy workflow status unavailable.")
      : (deployRunning
        ? "Deploy workflow running."
        : (deploySuccess ? "Deploy workflow successful." : "Deploy workflow failed."));
    const mdTitle = validationState.title + (hasMdIssues ? " Click for details." : "");
    const combinedTitle = `${commitTitle}. ${deployTitle} ${mdTitle}`.trim();

    let statusClass = "is-muted";
    if (isRunning) {
      statusClass = "is-running";
    } else if (deployFailed || hasMdErrors) {
      statusClass = "is-failed";
    } else if (hasMdWarningsOnly) {
      statusClass = "is-warning";
    } else if (deploySuccess) {
      statusClass = "is-success";
    }

    applyCombinedStatus({
      text: commitText,
      href: activity.commitUrl,
      baseClass: commitBaseClass,
      statusClass,
      title: combinedTitle,
      ariaLabel: combinedTitle,
      hasIssues: hasMdIssues,
    });
  }

  async function showMarkdownValidationIssues(event) {
    if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) {
      return;
    }

    const activity = state.repoActivity;
    const validation = activity && activity.markdownValidation && typeof activity.markdownValidation === "object"
      ? activity.markdownValidation
      : null;
    if (!validation || validation.error) {
      return;
    }

    const issues = Array.isArray(validation.issues)
      ? validation.issues
      : [];
    const hasIssues = issues.length > 0
      || Number(validation.errorCount || 0) > 0
      || Number(validation.warningCount || 0) > 0;
    if (!hasIssues) {
      return;
    }

    if (event) {
      event.preventDefault();
    }

    const deployStatusText = buildDeployStatusDialogText(activity);
    const deployStatusHtml = buildDeployStatusDialogHtml(activity);
    const dialogMessage = `${deployStatusText}\n\n${buildMarkdownIssueDialogText(validation)}`;
    const dialogMessageHtml = `${deployStatusHtml}${buildMarkdownIssueDialogHtml(validation)}`;

    const commitUrl = activity && typeof activity.commitUrl === "string" ? activity.commitUrl : "";
    const canOpenCommit = !!commitUrl;
    const dialog = await openAppDialog({
      title: "",
      message: dialogMessage,
      messageHtml: dialogMessageHtml,
      messageClassName: "markdown-validation-dialog",
      panelClassName: "markdown-validation-dialog-panel",
      confirmText: canOpenCommit ? "Open commit" : "OK",
      cancelText: "Close",
      showCancel: canOpenCommit,
    });

    if (canOpenCommit && dialog.confirmed) {
      window.open(commitUrl, "_blank", "noopener,noreferrer");
    }
  }

  function resolveAuthWorkerOrigin() {
    const meta = document.querySelector("meta[name='github-auth-origin']");
    const fromMeta = meta ? meta.getAttribute("content") : "";
    const fromWindow = typeof window.GITHUB_AUTH_ORIGIN === "string"
      ? window.GITHUB_AUTH_ORIGIN
      : "";
    const origin = String(fromMeta || fromWindow).replace(/\/+$/, "");
    if (!origin) {
      throw new Error("Missing GitHub auth origin configuration.");
    }
    return origin;
  }

  function isLoopbackHost(hostname) {
    const value = String(hostname || "").toLowerCase();
    return value === "localhost" || value === "127.0.0.1" || value === "::1" || value === "[::1]";
  }

  function readStoredAuthHeaderSessionToken() {
    if (!isLoopbackHost(window.location.hostname)) {
      return "";
    }
    try {
      const raw = sessionStorage.getItem(AUTH_SESSION_TOKEN_STORAGE_KEY);
      return typeof raw === "string" ? raw : "";
    } catch (error) {
      return "";
    }
  }

  function storeAuthHeaderSessionToken(value) {
    const token = typeof value === "string" ? value : "";
    state.authHeaderSessionToken = token;
    if (!isLoopbackHost(window.location.hostname)) {
      return;
    }
    try {
      if (token) {
        sessionStorage.setItem(AUTH_SESSION_TOKEN_STORAGE_KEY, token);
      } else {
        sessionStorage.removeItem(AUTH_SESSION_TOKEN_STORAGE_KEY);
      }
    } catch (error) {
      // Ignore storage errors (privacy mode / policy).
    }
  }

  function stopAuthPopupTracking() {
    if (state.authPopupPollId) {
      window.clearInterval(state.authPopupPollId);
      state.authPopupPollId = null;
    }
    state.authPopupWindow = null;
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

  function readStoredMarkdownDrafts() {
    try {
      const raw = localStorage.getItem(MARKDOWN_DRAFTS_STORAGE_KEY);
      if (!raw) {
        return new Map();
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || typeof parsed.drafts !== "object") {
        return new Map();
      }

      const nextDrafts = new Map();
      Object.entries(parsed.drafts).forEach(([path, markdown]) => {
        const normalizedPath = normalizeSourcePath(path);
        if (!normalizedPath || !isMarkdownSourcePath(normalizedPath)) {
          return;
        }
        if (typeof markdown !== "string") {
          return;
        }
        nextDrafts.set(normalizedPath, markdown);
      });
      return nextDrafts;
    } catch (error) {
      return new Map();
    }
  }

  function readStoredImageDrafts() {
    try {
      const raw = localStorage.getItem(IMAGE_DRAFTS_STORAGE_KEY);
      if (!raw) {
        return new Map();
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || typeof parsed.drafts !== "object") {
        return new Map();
      }

      const nextDrafts = new Map();
      Object.entries(parsed.drafts).forEach(([path, draft]) => {
        const normalizedPath = normalizeImageRepoPath(path);
        if (!normalizedPath || !draft || typeof draft !== "object") {
          return;
        }
        const contentBase64 = typeof draft.contentBase64 === "string" ? draft.contentBase64 : "";
        if (!contentBase64) {
          return;
        }
        nextDrafts.set(normalizedPath, {
          contentBase64,
          contentType: typeof draft.contentType === "string" ? draft.contentType : "",
          size: Number.isFinite(draft.size) ? draft.size : 0,
          fileName: typeof draft.fileName === "string" ? draft.fileName : "",
        });
      });
      return nextDrafts;
    } catch (error) {
      return new Map();
    }
  }

  function storeMarkdownDrafts() {
    try {
      if (state.drafts.size === 0) {
        localStorage.removeItem(MARKDOWN_DRAFTS_STORAGE_KEY);
        return;
      }

      const draftEntries = Array.from(state.drafts.entries())
        .filter(([path, markdown]) => isMarkdownSourcePath(path) && typeof markdown === "string")
        .sort((left, right) => left[0].localeCompare(right[0]));
      if (draftEntries.length === 0) {
        localStorage.removeItem(MARKDOWN_DRAFTS_STORAGE_KEY);
        return;
      }

      const drafts = {};
      draftEntries.forEach(([path, markdown]) => {
        drafts[path] = markdown;
      });

      localStorage.setItem(
        MARKDOWN_DRAFTS_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          updatedAt: Date.now(),
          drafts,
        }),
      );
    } catch (error) {
      // Ignore storage errors.
    }
  }

  function storeImageDrafts() {
    try {
      if (state.imageDrafts.size === 0) {
        localStorage.removeItem(IMAGE_DRAFTS_STORAGE_KEY);
        return;
      }

      const draftEntries = Array.from(state.imageDrafts.entries())
        .filter(([path, draft]) => {
          if (!normalizeImageRepoPath(path) || !draft || typeof draft !== "object") {
            return false;
          }
          return typeof draft.contentBase64 === "string" && draft.contentBase64.length > 0;
        })
        .sort((left, right) => left[0].localeCompare(right[0]));
      if (draftEntries.length === 0) {
        localStorage.removeItem(IMAGE_DRAFTS_STORAGE_KEY);
        return;
      }

      const drafts = {};
      draftEntries.forEach(([path, draft]) => {
        drafts[path] = {
          contentBase64: draft.contentBase64,
          contentType: typeof draft.contentType === "string" ? draft.contentType : "",
          size: Number.isFinite(draft.size) ? draft.size : 0,
          fileName: typeof draft.fileName === "string" ? draft.fileName : "",
        };
      });

      localStorage.setItem(
        IMAGE_DRAFTS_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          updatedAt: Date.now(),
          drafts,
        }),
      );
    } catch (error) {
      // Ignore storage errors.
    }
  }

  function restoreMarkdownDrafts() {
    const storedDrafts = readStoredMarkdownDrafts();
    if (storedDrafts.size === 0) {
      return;
    }

    state.drafts.clear();
    storedDrafts.forEach((markdown, path) => {
      state.drafts.set(path, markdown);
    });

    state.drafts.forEach((markdown, path) => {
      renderSectionFromDraft(path, markdown);
    });
  }

  function restoreImageDrafts() {
    const storedDrafts = readStoredImageDrafts();
    state.imageDrafts.clear();
    storedDrafts.forEach((draft, path) => {
      state.imageDrafts.set(path, draft);
    });

    if (state.imageDrafts.size > 0) {
      applyStagedImagePreviews(document);
    }
  }

  function readStoredEditorState() {
    try {
      const raw = localStorage.getItem(EDITOR_STATE_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return null;
      }
      const nextState = {};
      if (typeof parsed.toolbarVisible === "boolean") {
        nextState.toolbarVisible = parsed.toolbarVisible;
      }
      if (typeof parsed.editMode === "boolean") {
        nextState.editMode = parsed.editMode;
      }
      if (Number.isFinite(parsed.previewPaneSplitRatio)) {
        nextState.previewPaneSplitRatio = clampPreviewPaneSplitRatio(parsed.previewPaneSplitRatio);
      }
      return nextState;
    } catch (error) {
      return null;
    }
  }

  function storeEditorState() {
    try {
      localStorage.setItem(
        EDITOR_STATE_STORAGE_KEY,
        JSON.stringify({
          toolbarVisible: elements.toolbar ? !elements.toolbar.hidden : false,
          editMode: !!state.editMode,
          previewPaneSplitRatio: clampPreviewPaneSplitRatio(state.previewPaneSplitRatio),
        }),
      );
    } catch (error) {
      // Ignore storage errors.
    }
  }

  function setEditMode(isEnabled) {
    const shouldEnable = !!isEnabled;
    const allowEdit = shouldEnable && hasEditorAccess(state.authSession);
    state.editMode = allowEdit && (!elements.toolbar || !elements.toolbar.hidden);
    document.body.classList.toggle("edit-mode", state.editMode);
    updateToolbarVisibilityButton();
    storeEditorState();
  }

  function restoreEditorState() {
    const storedState = readStoredEditorState() || {};
    const restoredSplitRatio = typeof storedState.previewPaneSplitRatio === "number"
      ? storedState.previewPaneSplitRatio
      : state.previewPaneSplitRatio;
    applyPreviewPaneSplitRatioQuietly(restoredSplitRatio);
    if (typeof storedState.editMode === "boolean") {
      setEditMode(storedState.editMode);
    } else {
      document.body.classList.toggle("edit-mode", state.editMode);
    }
  }

  async function authRequest(path, options) {
    const {
      method = "GET",
      body,
      includeSessionHeader = true,
      timeoutMs = 0,
    }
      = options || {};
    const headers = {};
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (includeSessionHeader && state.authHeaderSessionToken && isLoopbackHost(window.location.hostname)) {
      headers[AUTH_SESSION_HEADER_NAME] = state.authHeaderSessionToken;
    }
    const controller = timeoutMs ? new AbortController() : null;
    let timeoutId = null;
    if (controller) {
      timeoutId = window.setTimeout(() => {
        controller.abort();
      }, timeoutMs);
    }

    const response = await fetch(`${AUTH_WORKER_ORIGIN}${path}`, {
      method,
      credentials: "include",
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller ? controller.signal : undefined,
    });
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }

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

  function wait(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function hasEditorAccess(sessionPayload) {
    if (!sessionPayload || !sessionPayload.authenticated) {
      return false;
    }
    const repoAccess = sessionPayload.repoAccess;
    if (!repoAccess) {
      return false;
    }
    return !!(repoAccess.canPush || repoAccess.canPull);
  }

  function getAuthAccessLabel(sessionPayload) {
    const repoAccess = sessionPayload && sessionPayload.repoAccess
      ? sessionPayload.repoAccess
      : null;
    if (!repoAccess) {
      return "no repo access";
    }
    if (repoAccess.canPush) {
      return "direct commit";
    }
    if (repoAccess.canPull) {
      return "pull request";
    }
    return "no repo access";
  }

  function setAuthButtonVisual(config) {
    if (!elements.authButton) {
      return;
    }

    const {
      label = "Sign in with GitHub",
      title = "Sign in with GitHub",
      glyph = "?",
      avatarUrl = "",
      signedIn = false,
      busy = false,
    }
      = config || {};

    elements.authButton.replaceChildren();
    elements.authButton.classList.toggle("has-avatar", !!avatarUrl);
    elements.authButton.classList.toggle("is-busy", !!busy);

    if (busy) {
      const wrapper = document.createElement("span");
      wrapper.className = "inline-auth-glyph inline-auth-glyph-dots";
      wrapper.innerHTML = `
        <span class="inline-auth-dot"></span>
        <span class="inline-auth-dot"></span>
        <span class="inline-auth-dot"></span>
      `;
      elements.authButton.appendChild(wrapper);
    } else if (avatarUrl) {
      const image = document.createElement("img");
      image.src = avatarUrl;
      image.alt = "";
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      elements.authButton.appendChild(image);
    } else if (glyph === "user") {
      const wrapper = document.createElement("span");
      wrapper.className = "inline-auth-glyph inline-auth-glyph-user";
      wrapper.innerHTML = AUTH_USER_ICON;
      elements.authButton.appendChild(wrapper);
    } else if (glyph === "github") {
      const wrapper = document.createElement("span");
      wrapper.className = "inline-auth-glyph inline-auth-glyph-github";
      wrapper.innerHTML = AUTH_GITHUB_ICON;
      elements.authButton.appendChild(wrapper);
    } else {
      const wrapper = document.createElement("span");
      wrapper.className = "inline-auth-glyph";
      wrapper.textContent = String(glyph);
      elements.authButton.appendChild(wrapper);
    }

    elements.authButton.setAttribute("aria-label", label);
    elements.authButton.setAttribute("title", title);
    elements.authButton.setAttribute("data-auth-state", signedIn ? "signed-in" : "signed-out");
  }

  function updateEditorAccessState() {
    const authorized = hasEditorAccess(state.authSession);
    const accessChanged = state.editorAuthorized !== authorized;
    if (elements.toolbar) {
      elements.toolbar.hidden = false;
      elements.toolbar.classList.toggle("is-auth-only", !authorized);
      elements.toolbar.classList.toggle("is-authenticated", authorized);
    }

    if (state.editMode !== authorized) {
      setEditMode(authorized);
    }

    if (accessChanged) {
      state.editorAuthorized = authorized;
      if (authorized) {
        startRepoActivityPolling();
        refreshRepoActivity(true);
      } else {
        stopRepoActivityPolling();
      }
    }
    updateToolbar();
  }

  function updateAuthUi() {
    updateEditorAccessState();
    if (!elements.authButton) {
      return;
    }

    const sessionPayload = state.authSession;
    if (state.authBusy) {
      elements.authButton.disabled = true;
      setAuthButtonVisual({
        glyph: "…",
        label: state.authBusyMessage || "Working",
        title: state.authBusyMessage || "Working",
        busy: true,
      });
      return;
    }

    if (sessionPayload && sessionPayload.authenticated) {
      const login = sessionPayload.user && sessionPayload.user.login
        ? sessionPayload.user.login
        : "";
      elements.authButton.disabled = state.busy;
      setAuthButtonVisual({
        glyph: "user",
        avatarUrl: sessionPayload.user && sessionPayload.user.avatarUrl
          ? sessionPayload.user.avatarUrl
          : "",
        signedIn: true,
        label: login ? `Signed in as @${login}. Click to sign out.` : "Signed in. Click to sign out.",
        title: login
          ? `@${login} (${getAuthAccessLabel(sessionPayload)}) · Click to sign out`
          : "Signed in · Click to sign out",
      });
      return;
    }

    const cached = readStoredAuthProfile();
    elements.authButton.disabled = state.busy;
    setAuthButtonVisual({
      glyph: "github",
      signedIn: false,
      label: "Sign in with GitHub",
      title: cached && cached.login
        ? `Sign in with GitHub (last: @${cached.login})`
        : "Sign in with GitHub",
    });
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
          storeAuthHeaderSessionToken("");
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

  async function refreshAuthSessionWithRetry(retries = 1, delayMs = 300) {
    let session = await refreshAuthSession();
    if (session && session.authenticated) {
      return session;
    }

    for (let attempt = 0; attempt < retries; attempt += 1) {
      await wait(delayMs * (attempt + 1));
      session = await refreshAuthSession();
      if (session && session.authenticated) {
        break;
      }
    }

    return session;
  }

  function startAuthPopupPolling(popupWindow) {
    stopAuthPopupTracking();
    state.authPopupWindow = popupWindow;

    state.authPopupPollId = window.setInterval(() => {
      if (state.authPopupWindow !== popupWindow) {
        return;
      }
      if (!popupWindow || popupWindow.closed) {
        stopAuthPopupTracking();
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
      storeAuthHeaderSessionToken("");
      clearAuthProfile();
      setStatus("Signed out.");
      refreshRepoActivity(true);
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

    stopAuthPopupTracking();

    if (!payload.ok) {
      setAuthBusy(false);
      setStatus(payload.message || "GitHub sign-in failed.", true);
      return;
    }

    const finalizeSignIn = async () => {
      const sessionExchangeToken = typeof payload.sessionExchangeToken === "string"
        ? payload.sessionExchangeToken
        : "";
      if (!sessionExchangeToken) {
        throw new Error("Missing session exchange token.");
      }

      const exchangePayload = await authRequest("/api/session/exchange", {
        method: "POST",
        body: { token: sessionExchangeToken },
      });
      if (exchangePayload && typeof exchangePayload.sessionHeaderToken === "string" && isLoopbackHost(window.location.hostname)) {
        storeAuthHeaderSessionToken(exchangePayload.sessionHeaderToken);
      }

      await refreshAuthSessionWithRetry(2, 350);
      if (state.authSession && state.authSession.authenticated) {
        setStatus("GitHub sign-in complete.");
        refreshRepoActivity(true);
      } else {
        setStatus("GitHub sign-in completed but session was not available. Retry once.", true);
      }
    };

    setAuthBusy(true, "Finalizing GitHub sign-in...");
    finalizeSignIn()
      .catch((error) => {
        console.error(error);
        setStatus(error.message || "GitHub sign-in failed while finalizing session.", true);
      })
      .finally(() => {
        setAuthBusy(false);
      });
  }

  async function ensureSignedIn() {
    if (state.authBusy) {
      setStatus("GitHub sign-in is already in progress.");
      return false;
    }

    if (state.authSession && state.authSession.authenticated) {
      if (hasEditorAccess(state.authSession)) {
        return true;
      }
      setStatus("GitHub account does not have access to publish to this repo.", true);
      return false;
    }

    await refreshAuthSession();
    if (state.authSession && state.authSession.authenticated) {
      if (hasEditorAccess(state.authSession)) {
        return true;
      }
      setStatus("GitHub account does not have access to publish to this repo.", true);
      return false;
    }

    const signInDialog = await openAppDialog({
      title: "Sign in required",
      message: "Sign in with GitHub to publish your drafts?",
      confirmText: "Sign in",
      cancelText: "Cancel",
    });
    if (!signInDialog.confirmed) {
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

  async function reportError(title, message) {
    const text = String(message || "Something went wrong.").trim();
    setStatus(text, true);
    if (!elements.appDialog) {
      return;
    }
    await openAppDialog({
      title: title || "Action failed",
      message: text,
      confirmText: "OK",
      showCancel: false,
    });
  }

  function isAppDialogOpen() {
    return !!(elements.appDialog && !elements.appDialog.hidden);
  }

  function closeAppDialog(confirmed) {
    if (!elements.appDialog || elements.appDialog.hidden) {
      return;
    }

    const resolve = state.dialogResolve;
    state.dialogResolve = null;
    const value = elements.appDialogInput && !elements.appDialogInput.hidden
      ? elements.appDialogInput.value
      : "";
    elements.appDialog.hidden = true;
    if (resolve) {
      resolve({ confirmed: !!confirmed, value });
    }
  }

  function openAppDialog(options) {
    if (!elements.appDialog) {
      return Promise.resolve({ confirmed: false, value: "" });
    }

    if (state.dialogResolve) {
      state.dialogResolve({ confirmed: false, value: "" });
      state.dialogResolve = null;
    }

    const config = options || {};
    const hasExplicitTitle = Object.prototype.hasOwnProperty.call(config, "title");
    const title = hasExplicitTitle ? String(config.title || "") : "Confirm";
    const message = config.message || "";
    const confirmText = config.confirmText || "OK";
    const cancelText = config.cancelText || "Cancel";
    const showCancel = config.showCancel !== false;
    const wantsInput = !!config.input;
    const inputValue = config.inputValue || "";
    const inputPlaceholder = config.inputPlaceholder || "";
    const inputLabel = config.inputLabel || "";
    const messageClassName = typeof config.messageClassName === "string"
      ? config.messageClassName.trim()
      : "";
    const panelClassName = typeof config.panelClassName === "string"
      ? config.panelClassName.trim()
      : "";
    const messageHtml = typeof config.messageHtml === "string" ? config.messageHtml : "";

    if (elements.appDialogPanel) {
      elements.appDialogPanel.className = ["app-dialog-panel", panelClassName].filter(Boolean).join(" ");
    }

    if (elements.appDialogTitle) {
      elements.appDialogTitle.textContent = title;
      elements.appDialogTitle.hidden = !title;
    }
    if (elements.appDialogMessage) {
      elements.appDialogMessage.className = ["app-dialog-message", messageClassName].filter(Boolean).join(" ");
      if (messageHtml) {
        elements.appDialogMessage.innerHTML = messageHtml;
      } else {
        elements.appDialogMessage.textContent = message;
      }
    }
    if (elements.appDialogInput) {
      elements.appDialogInput.hidden = !wantsInput;
      elements.appDialogInput.value = inputValue;
      elements.appDialogInput.placeholder = inputPlaceholder;
      if (inputLabel) {
        elements.appDialogInput.setAttribute("aria-label", inputLabel);
      } else {
        elements.appDialogInput.removeAttribute("aria-label");
      }
    }
    if (elements.appDialogConfirm) {
      elements.appDialogConfirm.textContent = confirmText;
    }
    if (elements.appDialogCancel) {
      elements.appDialogCancel.textContent = cancelText;
      elements.appDialogCancel.hidden = !showCancel;
    }

    elements.appDialog.hidden = false;

    return new Promise((resolve) => {
      state.dialogResolve = resolve;
      window.requestAnimationFrame(() => {
        if (wantsInput && elements.appDialogInput) {
          elements.appDialogInput.focus();
          elements.appDialogInput.select();
          return;
        }
        if (elements.appDialogConfirm) {
          elements.appDialogConfirm.focus();
        }
      });
    });
  }

  function handleAppDialogShortcut(event) {
    if (!isAppDialogOpen()) {
      return false;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeAppDialog(false);
      return true;
    }

    if (
      event.key === "Enter"
      && elements.appDialogInput
      && !elements.appDialogInput.hidden
      && document.activeElement === elements.appDialogInput
    ) {
      event.preventDefault();
      closeAppDialog(true);
      return true;
    }

    return false;
  }

  function getStagedFileCounts() {
    return {
      markdown: state.drafts.size,
      images: state.imageDrafts.size,
    };
  }

  function getTotalStagedFileCount() {
    const counts = getStagedFileCounts();
    return counts.markdown + counts.images;
  }

  function setBusy(isBusy) {
    state.busy = isBusy;
    const totalStaged = getTotalStagedFileCount();
    const disableToolbarActions = isBusy || state.authBusy;
    if (elements.toolbarVisibilityButton) {
      elements.toolbarVisibilityButton.disabled = disableToolbarActions;
    }
    if (elements.submitButton) {
      elements.submitButton.disabled = disableToolbarActions || totalStaged === 0;
    }
    if (elements.clearButton) {
      elements.clearButton.disabled = disableToolbarActions || totalStaged === 0;
    }
    if (elements.authButton) {
      elements.authButton.disabled = disableToolbarActions;
    }
    if (elements.addSectionButton) {
      elements.addSectionButton.disabled = disableToolbarActions;
    }
    if (elements.manageSectionsButton) {
      elements.manageSectionsButton.disabled = disableToolbarActions || !state.editMode;
    }
    if (elements.modalSave) {
      elements.modalSave.disabled = disableToolbarActions;
    }
    if (elements.modalCompareSelect) {
      elements.modalCompareSelect.disabled = disableToolbarActions;
    }
    if (elements.modal) {
      elements.modal.querySelectorAll("button[data-format-action], button[data-format-cycle]").forEach((button) => {
        button.disabled = disableToolbarActions || !state.editorView;
      });
    }
  }

  function updateToolbarVisibilityButton() {
    if (!elements.toolbarVisibilityButton || !elements.toolbar) {
      return;
    }

    const isVisible = !elements.toolbar.hidden;
    const actionLabel = state.editMode ? "Done editing" : "Edit manual";
    elements.toolbarVisibilityButton.setAttribute("aria-expanded", String(isVisible));
    elements.toolbarVisibilityButton.setAttribute("aria-pressed", String(state.editMode));
    elements.toolbarVisibilityButton.setAttribute("aria-label", actionLabel);
    elements.toolbarVisibilityButton.setAttribute("title", actionLabel);
  }

  function setToolbarVisible(isVisible) {
    if (!elements.toolbar) {
      return;
    }

    const wasVisible = !elements.toolbar.hidden;
    const shouldShow = !!isVisible || getTotalStagedFileCount() > 0;
    elements.toolbar.hidden = !shouldShow;
    const isNowVisible = !elements.toolbar.hidden;
    if (!shouldShow && state.editMode) {
      setEditMode(false);
    }
    if (isNowVisible) {
      startRepoActivityPolling();
      if (!wasVisible) {
        refreshRepoActivity(true);
      }
    } else {
      stopRepoActivityPolling();
    }
    updateToolbarVisibilityButton();
    storeEditorState();
  }

  function updateToolbar() {
    if (!elements.submitButton || !elements.clearButton) {
      return;
    }

    const counts = getStagedFileCounts();
    const totalStaged = counts.markdown + counts.images;
    const hasDrafts = totalStaged > 0;
    if (hasDrafts && elements.toolbar && elements.toolbar.hidden) {
      setToolbarVisible(true);
    }
    elements.submitButton.textContent = `Push (${totalStaged})`;
    elements.clearButton.textContent = "Reset";
    elements.submitButton.hidden = !hasDrafts;
    elements.clearButton.hidden = !hasDrafts;
    elements.submitButton.disabled = state.busy || state.authBusy || !hasDrafts;
    elements.clearButton.disabled = state.busy || state.authBusy || !hasDrafts;
    if (elements.addSectionButton) {
      elements.addSectionButton.disabled = state.busy || state.authBusy || !state.editMode;
    }
    if (elements.manageSectionsButton) {
      elements.manageSectionsButton.disabled = state.busy || state.authBusy || !state.editMode;
    }
    updateRepoActivityUi();
  }

  function renderPreface(markdown) {
    const preface = document.getElementById("preface-content");
    if (!preface) {
      return;
    }

    const titleAndContent = typeof extractTitleAndContentFromMarkdown === "function"
      ? extractTitleAndContentFromMarkdown(markdown)
      : { content: markdown };
    const introTitle = titleAndContent && typeof titleAndContent.title === "string"
      ? titleAndContent.title
      : "";
    const introContent = titleAndContent && typeof titleAndContent.content === "string"
      ? titleAndContent.content
      : markdown;
    const introEditUrl = appUtils && typeof appUtils.getGitHubEditUrl === "function"
      ? appUtils.getGitHubEditUrl(INTRO_PATH)
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

    let renderedBySharedPipeline = false;
    if (typeof renderMarkdownContent === "function") {
      renderedBySharedPipeline = renderMarkdownContent(preface, introContent, {
        documentTitle: introTitle || "Introduction",
        headingScopeId: "preface",
      });
    }
    if (!renderedBySharedPipeline) {
      preface.innerHTML = marked.parse(introContent);
      wrapTables(preface);
      optimizeSectionMedia(preface);
    }
    appUtils.normalizeInternalHashLinks(preface);
    applyStagedImagePreviews(preface);
  }

  function refreshSearchIndexAfterRender() {
    refreshSearchBarIndex();
  }

  function requestSearchIndexRefresh() {
    scheduleSearchIndexRefresh();
  }

  function renderSectionFromDraft(path, markdown) {
    if (path === INTRO_PATH) {
      renderPreface(markdown);
      refreshSearchIndexAfterRender();
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
    applyStagedImagePreviews(replacement);
    ensureSectionOrderActions(replacement);

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
    refreshSearchIndexAfterRender();

    return true;
  }

  function getSectionOrderPath() {
    return "sections/section-order.md";
  }

  function normalizeSectionId(sectionId) {
    if (!appUtils || typeof appUtils.normalizeSectionId !== "function") {
      return null;
    }
    return appUtils.normalizeSectionId(sectionId);
  }

  const SECTION_GROUPS = {
    order: ["maintenance", "repairs", "supplement", "other"],
    labels: {
      maintenance: "Maintenance",
      repairs: "Repairs",
      supplement: "Supplement",
      other: "Other",
    },
  };
  let sectionGroupOverrides = new Map();
  let sectionGroupOrder = SECTION_GROUPS.order.slice();

  function normalizeGroupKey(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function resolveGroupKeyFromHeading(headingText) {
    const normalized = normalizeGroupKey(headingText);
    if (!normalized) {
      return null;
    }

    if (SECTION_GROUPS.labels[normalized]) {
      return normalized;
    }

    const match = Object.entries(SECTION_GROUPS.labels)
      .find(([, label]) => normalizeGroupKey(label) === normalized);
    return match ? match[0] : null;
  }

  function updateSectionGroupState(parsedManifest) {
    sectionGroupOverrides = parsedManifest && parsedManifest.groupMap instanceof Map
      ? new Map(parsedManifest.groupMap)
      : new Map();
    sectionGroupOrder = parsedManifest && Array.isArray(parsedManifest.groupOrder) && parsedManifest.groupOrder.length
      ? parsedManifest.groupOrder.slice()
      : SECTION_GROUPS.order.slice();
  }

  function getSectionGroupKey(sectionId) {
    const normalized = normalizeSectionId(sectionId) || "";
    if (typeof window.getSectionGroup === "function") {
      const externalGroup = window.getSectionGroup(normalized);
      if (externalGroup) {
        return externalGroup;
      }
    }
    const override = sectionGroupOverrides.get(normalized);
    if (override) {
      return override;
    }
    const groupKey = normalized.split("/")[0] || "other";
    return groupKey.toLowerCase();
  }

  function getSectionGroupLabel(groupKey) {
    return SECTION_GROUPS.labels[groupKey] || "Other";
  }

  function getOrderedGroupKeys(groupKeys) {
    const order = sectionGroupOrder.length
      ? sectionGroupOrder.slice()
      : SECTION_GROUPS.order.slice();
    groupKeys.forEach((groupKey) => {
      if (!order.includes(groupKey)) {
        order.push(groupKey);
      }
    });
    return order.filter((groupKey) => groupKeys.includes(groupKey));
  }

  function getSectionContainer() {
    return document.getElementById("sections-container");
  }

  function getTopLevelSections(container) {
    if (!container) {
      return [];
    }
    return Array.from(container.children).filter((child) => (
      child instanceof Element && child.classList.contains("section")
    ));
  }

  function rebuildSectionGroupDividers() {
    const container = getSectionContainer();
    if (!container) {
      return;
    }

    Array.from(container.children).forEach((child) => {
      if (child instanceof Element && child.classList.contains("section-group")) {
        child.remove();
      }
    });

    const sections = getTopLevelSections(container);
    let previousGroupKey = "";
    sections.forEach((section) => {
      const sectionId = section.id || "";
      const groupKey = getSectionGroupKey(sectionId);
      if (groupKey === previousGroupKey) {
        return;
      }
      previousGroupKey = groupKey;
      const groupLabel = getSectionGroupLabel(groupKey);
      const groupEl = document.createElement("div");
      groupEl.className = "section-group";
      groupEl.innerHTML = `
        <div class="section-group-divider" aria-hidden="true"></div>
        <div class="section-group-title">${appUtils && typeof appUtils.escapeHtml === "function"
          ? appUtils.escapeHtml(groupLabel)
          : groupLabel}</div>
      `;
      container.insertBefore(groupEl, section);
    });
  }

  function getSectionOrderIdsFromDom() {
    return getTopLevelSections(getSectionContainer())
      .map((section) => normalizeSectionId(section.id))
      .filter(Boolean);
  }

  function serializeSectionOrderDraft(sectionIds, options = {}) {
    const groupMap = options.groupMap instanceof Map ? options.groupMap : null;
    const groupOrderOverride = Array.isArray(options.groupOrder) ? options.groupOrder : null;
    const grouped = sectionIds.reduce((acc, sectionId) => {
      const groupKey = groupMap && groupMap.has(sectionId)
        ? groupMap.get(sectionId)
        : getSectionGroupKey(sectionId);
      if (!acc[groupKey]) {
        acc[groupKey] = [];
      }
      acc[groupKey].push(sectionId);
      return acc;
    }, {});

    const lines = ["# Section Order", ""];
    const orderedGroups = (groupOrderOverride && groupOrderOverride.length)
      ? groupOrderOverride.slice()
      : (sectionGroupOrder.length
        ? sectionGroupOrder.slice()
        : SECTION_GROUPS.order.slice());
    Object.keys(grouped).forEach((groupKey) => {
      if (!orderedGroups.includes(groupKey)) {
        orderedGroups.push(groupKey);
      }
    });

    orderedGroups.forEach((groupKey) => {
      const items = grouped[groupKey] || [];
      if (!items.length) {
        return;
      }
      lines.push(`## ${getSectionGroupLabel(groupKey)}`, "");
      items.forEach((sectionId) => {
        lines.push(`- ${sectionId}`);
      });
      lines.push("");
    });

    return `${lines.join("\n").trimEnd()}\n`;
  }

  async function stageSectionOrderDraftFromDom() {
    const sectionIds = getSectionOrderIdsFromDom();
    const path = getSectionOrderPath();
    if (!path) {
      return;
    }

    const nextMarkdown = serializeSectionOrderDraft(sectionIds);
    let sourceMarkdown = state.sourceMarkdown.get(path);
    if (typeof sourceMarkdown !== "string") {
      try {
        sourceMarkdown = await fetchMarkdownFromSource(path);
        state.sourceMarkdown.set(path, sourceMarkdown);
      } catch (error) {
        sourceMarkdown = "";
      }
    }

    const parsedSource = parseSectionOrderMarkdownWithGroups(sourceMarkdown);
    const sourceSectionIds = parsedSource.sectionIds;
    const sourceNormalized = serializeSectionOrderDraft(sourceSectionIds, {
      groupMap: parsedSource.groupMap,
      groupOrder: parsedSource.groupOrder,
    });

    if (sourceNormalized.trim() === nextMarkdown.trim()) {
      state.drafts.delete(path);
    } else {
      state.drafts.set(path, nextMarkdown);
    }
    storeMarkdownDrafts();
    updateToolbar();
  }

  function parseSectionOrderMarkdownValue(markdown) {
    const parsed = parseSectionOrderMarkdownWithGroups(markdown);
    updateSectionGroupState(parsed);
    return parsed.sectionIds;
  }

  function parseSectionOrderMarkdownWithGroups(markdown) {
    const sectionIds = [];
    const groupMap = new Map();
    const groupOrder = [];
    const seenIds = new Set();
    const seenGroups = new Set();
    let currentGroup = null;

    String(markdown || "").split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      const headingMatch = /^(#{2,6})\s+(.+?)\s*$/.exec(trimmed);
      if (headingMatch) {
        const groupKey = resolveGroupKeyFromHeading(headingMatch[2]);
        if (groupKey) {
          currentGroup = groupKey;
          if (!seenGroups.has(groupKey)) {
            seenGroups.add(groupKey);
            groupOrder.push(groupKey);
          }
        } else {
          currentGroup = null;
        }
        return;
      }

      if (trimmed.startsWith("#")) {
        return;
      }

      const sectionId = normalizeSectionId(trimmed);
      if (!sectionId || seenIds.has(sectionId)) {
        return;
      }
      seenIds.add(sectionId);
      sectionIds.push(sectionId);
      if (currentGroup) {
        groupMap.set(sectionId, currentGroup);
      }
    });

    return { sectionIds, groupMap, groupOrder };
  }

  function getSectionTitleFromMarkdown(sectionId, markdown) {
    if (typeof extractTitleAndContentFromMarkdown === "function") {
      const titleAndContent = extractTitleAndContentFromMarkdown(markdown);
      if (titleAndContent && typeof titleAndContent.title === "string" && titleAndContent.title.trim()) {
        return titleAndContent.title.trim();
      }
    }
    return sectionId;
  }

  async function restoreSectionsFromSourceOrder() {
    const sectionOrderPath = getSectionOrderPath();
    let sectionOrderMarkdown = "";
    try {
      sectionOrderMarkdown = await fetchMarkdownFromSource(sectionOrderPath);
      state.sourceMarkdown.set(sectionOrderPath, sectionOrderMarkdown);
    } catch (error) {
      throw new Error(`Could not load ${sectionOrderPath}.`, { cause: error });
    }

    const orderedSectionIds = parseSectionOrderMarkdownValue(sectionOrderMarkdown);
    if (orderedSectionIds.length === 0) {
      throw new Error(`No valid sections in ${sectionOrderPath}.`);
    }

    const sectionRecords = await Promise.all(orderedSectionIds.map(async (sectionId) => {
      const path = `sections/${sectionId}.md`;
      try {
        const markdown = await fetchMarkdownFromSource(path);
        return {
          sectionId,
          path,
          markdown,
          title: getSectionTitleFromMarkdown(sectionId, markdown),
        };
      } catch (error) {
        console.error(error);
        return null;
      }
    }));

    const validRecords = sectionRecords.filter(Boolean);
    if (validRecords.length === 0) {
      throw new Error("Could not restore section content from source.");
    }

    const container = getSectionContainer();
    if (!container) {
      throw new Error("Sections container missing.");
    }

    const validIdSet = new Set(validRecords.map((record) => record.sectionId));
    validRecords.forEach((record) => {
      const existing = document.getElementById(record.sectionId);
      const section = existing || buildSectionShell(record.sectionId, record.title);
      container.appendChild(section);
    });

    getTopLevelSections(container).forEach((section) => {
      if (!validIdSet.has(section.id)) {
        section.remove();
      }
    });

    validRecords.forEach((record) => {
      state.sourceMarkdown.set(record.path, record.markdown);
      renderSectionFromDraft(record.path, record.markdown);
    });

    refreshSectionStructureUi();
  }

  async function restoreManualFromSource() {
    const introSourceMarkdown = await fetchMarkdownFromSource(INTRO_PATH);
    state.sourceMarkdown.set(INTRO_PATH, introSourceMarkdown);
    renderPreface(introSourceMarkdown);
    await restoreSectionsFromSourceOrder();
  }

  function refreshSectionStructureUi() {
    rebuildSectionGroupDividers();
    ensureAllSectionOrderActions();
    if (typeof generateSidebar === "function") {
      generateSidebar();
    }
    if (typeof setupSidebarLinks === "function") {
      setupSidebarLinks();
    }
    if (typeof setupSectionToggle === "function") {
      setupSectionToggle();
    }
    if (typeof setupActiveTracking === "function") {
      setupActiveTracking();
    }
    if (typeof window.updateActiveLink === "function") {
      window.updateActiveLink();
    }
    refreshSearchIndexAfterRender();
  }

  function syncSectionStructureDrafts() {
    refreshSectionStructureUi();
    stageSectionOrderDraftFromDom().catch((error) => {
      console.error(error);
    });
  }

  function ensureSectionOrderActions(section) {
    if (!(section instanceof Element)) {
      return;
    }
    section.querySelectorAll(".section-order-actions").forEach((node) => node.remove());
  }

  function ensureAllSectionOrderActions() {
    getTopLevelSections(getSectionContainer()).forEach((section) => {
      ensureSectionOrderActions(section);
    });
  }

  function reorderSectionByOffset(sectionId, offset) {
    const normalizedSectionId = normalizeSectionId(sectionId);
    const direction = Number(offset);
    if (!normalizedSectionId || !Number.isFinite(direction) || direction === 0) {
      return;
    }

    const container = getSectionContainer();
    const sections = getTopLevelSections(container);
    const index = sections.findIndex((section) => section.id === normalizedSectionId);
    if (index === -1) {
      return;
    }

    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= sections.length) {
      return;
    }

    const currentGroup = getSectionGroupKey(normalizedSectionId);
    const targetGroup = getSectionGroupKey(sections[targetIndex].id);
    const targetSectionId = sections[targetIndex].id;
    let insertBeforeTarget = direction < 0;
    if (currentGroup !== targetGroup) {
      insertBeforeTarget = direction > 0;
      sectionGroupOverrides.set(normalizedSectionId, targetGroup);
      if (!sectionGroupOrder.includes(targetGroup)) {
        sectionGroupOrder.push(targetGroup);
      }
      if (typeof window.setSectionGroupOverride === "function") {
        window.setSectionGroupOverride(normalizedSectionId, targetGroup);
      }
    }
    const reordered = sections.slice();
    const [moved] = reordered.splice(index, 1);
    const targetAfterRemoval = reordered.findIndex((section) => section.id === targetSectionId);
    if (targetAfterRemoval === -1) {
      return;
    }
    const insertionIndex = insertBeforeTarget ? targetAfterRemoval : targetAfterRemoval + 1;
    const clampedIndex = Math.max(0, Math.min(reordered.length, insertionIndex));
    reordered.splice(clampedIndex, 0, moved);
    reordered.forEach((section) => {
      container.appendChild(section);
    });
    syncSectionStructureDrafts();
    setStatus(`Moved ${normalizedSectionId} ${direction < 0 ? "up" : "down"}.`);
  }

  async function removeSectionFromManual(sectionId) {
    const normalizedSectionId = normalizeSectionId(sectionId);
    if (!normalizedSectionId) {
      return;
    }

    const dialog = await openAppDialog({
      title: "Remove section",
      message: `Remove ${normalizedSectionId} from this manual?`,
      confirmText: "Remove",
      cancelText: "Cancel",
    });
    if (!dialog.confirmed) {
      return;
    }

    const section = document.getElementById(normalizedSectionId);
    if (section) {
      section.remove();
    }

    const path = `sections/${normalizedSectionId}.md`;
    state.drafts.delete(path);
    state.sourceMarkdown.delete(path);
    state.compareHistoryByPath.delete(path);
    state.compareSelectionByPath.delete(path);
    Array.from(state.compareContentByRef.keys()).forEach((cacheKey) => {
      if (cacheKey.startsWith(`${path}@`)) {
        state.compareContentByRef.delete(cacheKey);
      }
    });
    if (state.currentPath === path) {
      closeModal();
    }

    storeMarkdownDrafts();
    syncSectionStructureDrafts();
    updateToolbar();
    setStatus(`Removed ${normalizedSectionId} from section order.`);
  }

  function buildManageSectionsButton() {
    const button = document.createElement("button");
    button.id = "toc-manage-sections";
    button.type = "button";
    button.className = "toc-manage-sections";
    button.textContent = "Manage";
    button.title = "Manage sections";
    button.disabled = !state.editMode;
    return button;
  }

  async function fetchSectionManifestIds() {
    try {
      const sections = await fetchRepoList(
        "/api/section-list",
        "sections",
        normalizeSectionId,
      );
      return sections.sort((left, right) => left.localeCompare(right));
    } catch (error) {
      console.error(error);
      return [];
    }
  }

  function buildManageSectionRow(sectionId, options = {}) {
    const safeId = escapeDialogHtml(sectionId);
    const missing = !!options.missing;
    const disableUp = !!options.disableUp;
    const disableDown = !!options.disableDown;
    return `
      <li class="section-manager-row${missing ? " is-missing" : ""}">
        <span class="section-manager-id">${safeId}</span>
        <span class="section-manager-actions">
          ${missing ? `<button type="button" data-section-manager-action="add-existing" data-section-id="${safeId}">Add</button>` : ""}
          ${missing ? "" : `<button type="button" data-section-manager-action="up" data-section-id="${safeId}"${disableUp ? " disabled" : ""}>Up</button>`}
          ${missing ? "" : `<button type="button" data-section-manager-action="down" data-section-id="${safeId}"${disableDown ? " disabled" : ""}>Down</button>`}
          ${missing ? "" : `<button type="button" class="is-danger" data-section-manager-action="remove" data-section-id="${safeId}">Remove</button>`}
        </span>
      </li>
    `;
  }

  let manageSectionsHandler = null;

  function buildManageSectionsDialogHtml(manifestIds) {
    const currentIds = getSectionOrderIdsFromDom();
    const currentSet = new Set(currentIds);
    const missingIds = (manifestIds || []).filter((sectionId) => !currentSet.has(sectionId));
    const grouped = currentIds.reduce((acc, sectionId) => {
      const group = getSectionGroupKey(sectionId).toLowerCase();
      if (!acc[group]) {
        acc[group] = [];
      }
      acc[group].push(sectionId);
      return acc;
    }, {});

    const orderedGroups = getOrderedGroupKeys(Object.keys(grouped));
    const flatIds = orderedGroups.flatMap((group) => grouped[group] || []);
    const firstId = flatIds[0] || "";
    const lastId = flatIds[flatIds.length - 1] || "";

    const groupsHtml = orderedGroups.map((group) => {
      const groupIds = grouped[group] || [];
      return `
      <section class="section-manager-group">
        <h4>${escapeDialogHtml(getSectionGroupLabel(group))}</h4>
        <ol>${groupIds.map((sectionId) => buildManageSectionRow(sectionId, {
          disableUp: sectionId === firstId,
          disableDown: sectionId === lastId,
        })).join("")}</ol>
      </section>
    `;
    }).join("");
    const missingHtml = missingIds.length
      ? `
        <section class="section-manager-group section-manager-missing">
          <h4>Missing / unlisted</h4>
          <ol>${missingIds.map((sectionId) => buildManageSectionRow(sectionId, { missing: true })).join("")}</ol>
        </section>
      `
      : "";

    return `
        <div class="section-manager">
          <button type="button" class="section-manager-add" data-section-manager-action="add-new">Add section</button>
          ${groupsHtml}
          ${missingHtml}
        </div>
      `;
  }

  function refreshManageSectionsDialog(manifestIds) {
    if (!elements.appDialogMessage) {
      return;
    }
    elements.appDialogMessage.innerHTML = buildManageSectionsDialogHtml(manifestIds);
  }

  async function addExistingSectionToManual(sectionId) {
    const normalizedSectionId = normalizeSectionId(sectionId);
    if (!normalizedSectionId || document.getElementById(normalizedSectionId)) {
      return;
    }
    const path = getSectionPath(normalizedSectionId);
    if (!path) {
      return;
    }
    const markdown = await fetchMarkdownFromSource(path);
    state.sourceMarkdown.set(path, markdown);
    const title = getSectionTitleFromMarkdown(normalizedSectionId, markdown);
    const shell = buildSectionShell(normalizedSectionId, title);
    insertSectionByGroup(shell);
    renderSectionFromDraft(path, markdown);
    syncSectionStructureDrafts();
    updateToolbar();
    setStatus(`Added section ${normalizedSectionId}.`);
  }

  async function openManageSectionsDialog() {
    if (!state.editMode || state.busy || state.authBusy) {
      return;
    }
    const manifestIds = await fetchSectionManifestIds();
    const dialogPromise = openAppDialog({
      title: "Manage sections",
      messageHtml: buildManageSectionsDialogHtml(manifestIds),
      confirmText: "Close",
      showCancel: false,
      panelClassName: "section-manager-dialog-panel",
      messageClassName: "section-manager-dialog",
    });

    refreshManageSectionsDialog(manifestIds);
    if (elements.appDialogMessage) {
      if (manageSectionsHandler) {
        elements.appDialogMessage.removeEventListener("click", manageSectionsHandler);
      }
      manageSectionsHandler = async (event) => {
        const target = event.target instanceof Element
          ? event.target.closest("[data-section-manager-action]")
          : null;
        if (!target) {
          return;
        }

        const action = target.getAttribute("data-section-manager-action");
        const sectionId = target.getAttribute("data-section-id") || "";
        try {
          if (action === "add-new") {
            await openNewSectionModal();
          } else if (action === "add-existing") {
            await addExistingSectionToManual(sectionId);
          } else if (action === "up") {
            reorderSectionByOffset(sectionId, -1);
          } else if (action === "down") {
            reorderSectionByOffset(sectionId, 1);
          } else if (action === "remove") {
            await removeSectionFromManual(sectionId);
          }
          refreshManageSectionsDialog(manifestIds);
        } catch (error) {
          console.error(error);
          await reportError("Manage sections failed", error.message || "Could not update sections.");
        }
      };
      elements.appDialogMessage.addEventListener("click", manageSectionsHandler);
    }

    await dialogPromise;
    if (elements.appDialogMessage && manageSectionsHandler) {
      elements.appDialogMessage.removeEventListener("click", manageSectionsHandler);
      manageSectionsHandler = null;
    }
  }

  function buildSectionShell(sectionId, title) {
    const sectionPath = `sections/${sectionId}.md`;
    const section = document.createElement("section");
    section.className = "section collapsed";
    section.id = sectionId;
    section.setAttribute("data-source-path", sectionPath);

    const header = document.createElement("div");
    header.className = "section-header";
    header.setAttribute("role", "button");
    header.setAttribute("tabindex", "0");
    header.setAttribute("aria-expanded", "false");

    const headerMain = document.createElement("div");
    headerMain.className = "section-header-main";

    const toggle = document.createElement("span");
    toggle.className = "section-toggle";
    toggle.textContent = "▼";

    const heading = document.createElement("h2");
    heading.textContent = title || sectionId;

    headerMain.appendChild(toggle);
    headerMain.appendChild(heading);
    header.appendChild(headerMain);

    const headerActions = document.createElement("div");
    headerActions.className = "section-header-actions";
    header.appendChild(headerActions);

    if (appUtils && typeof appUtils.getGitHubEditUrl === "function") {
      const editUrl = appUtils.getGitHubEditUrl(sectionPath);
      if (editUrl) {
        const editLink = document.createElement("a");
        editLink.className = "section-edit-link";
        editLink.setAttribute("data-source-path", sectionPath);
        editLink.href = editUrl;
        editLink.target = "_blank";
        editLink.rel = "noopener noreferrer";
        editLink.textContent = "Edit";
        headerActions.appendChild(editLink);
      }
    }

    section.appendChild(header);
    const content = document.createElement("div");
    content.className = "section-content";
    section.appendChild(content);
    ensureSectionOrderActions(section);
    return section;
  }

  function insertSectionByGroup(section) {
    const container = getSectionContainer();
    if (!container || !(section instanceof Element)) {
      return;
    }

    const nextGroup = getSectionGroupKey(section.id);
    const sections = getTopLevelSections(container);
    let insertAfter = null;
    sections.forEach((existing) => {
      if (getSectionGroupKey(existing.id) === nextGroup) {
        insertAfter = existing;
      }
    });

    if (!insertAfter) {
      container.appendChild(section);
      return;
    }
    container.insertBefore(section, insertAfter.nextSibling);
  }

  function buildSectionBodyTemplate() {
    return "Add section content.\n";
  }

  function splitMarkdownTitle(markdown) {
    const text = String(markdown || "");
    const lines = text.split(/\r?\n/);
    if (!lines.length) {
      return { title: "", body: "", hasTitle: false };
    }
    const match = /^#\s+(.*)$/.exec(lines[0]);
    if (!match) {
      return { title: "", body: text, hasTitle: false };
    }

    const title = match[1].trim();
    let bodyLines = lines.slice(1);
    if (bodyLines.length && bodyLines[0].trim() === "") {
      bodyLines = bodyLines.slice(1);
    }
    return { title, body: bodyLines.join("\n"), hasTitle: true };
  }

  function normalizeTitleValue(value, fallbackTitle) {
    const trimmed = String(value || "").trim();
    if (trimmed) {
      return trimmed;
    }
    const fallback = String(fallbackTitle || "").trim();
    return fallback || "Untitled";
  }

  function composeMarkdownWithTitle(titleValue, bodyValue, fallbackTitle) {
    const title = normalizeTitleValue(titleValue, fallbackTitle);
    let body = String(bodyValue || "");
    body = body.replace(/^\n+/, "");
    if (!body) {
      return `# ${title}\n`;
    }
    return `# ${title}\n\n${body}`;
  }

  function getDefaultSectionTitle(sectionId) {
    if (typeof window.formatSectionTitleFromId === "function") {
      return window.formatSectionTitleFromId(sectionId);
    }
    return sectionId.split("/").slice(-1)[0] || "Untitled";
  }

  function setNewSectionMode(isNew) {
    if (elements.modalPathDisplay) {
      elements.modalPathDisplay.hidden = isNew;
    }
    if (elements.modalPathInput) {
      elements.modalPathInput.hidden = !isNew;
      elements.modalPathInput.disabled = !isNew;
      if (!isNew) {
        elements.modalPathInput.value = "";
        elements.modalPathInput.classList.remove("is-invalid");
      }
    }
    if (elements.modalTitleInput && !isNew) {
      elements.modalTitleInput.value = "";
    }
    if (elements.modalCompareToolbar) {
      elements.modalCompareToolbar.hidden = !!isNew;
    }
    if (elements.modalDiffSummary) {
      elements.modalDiffSummary.disabled = !!isNew;
    }
    if (!isNew) {
      state.newSectionDraft = null;
      state.currentTitle = "";
      state.currentTitleFallback = "";
      state.currentTitleTouched = false;
    }
  }

  function getTitleInputValue(fallbackTitle) {
    if (elements.modalTitleInput) {
      return normalizeTitleValue(elements.modalTitleInput.value, fallbackTitle);
    }
    return normalizeTitleValue(state.currentTitle, fallbackTitle);
  }

  function setEditorModalOpen(isOpen) {
    const shouldOpen = !!isOpen;
    const body = document.body;
    if (!body) {
      return;
    }

    body.classList.toggle(EDITOR_MODAL_OPEN_CLASS, shouldOpen);
  }

  async function openNewSectionModal() {
    if (!elements.modal || !elements.modalEditorHost) {
      return;
    }

    state.currentPath = null;
    state.newSectionDraft = {
      rawPath: "",
      sectionId: "",
      draftPath: "",
      title: "",
      titleTouched: false,
      markdownTouched: false,
      markdown: "",
    };
    setNewSectionMode(true);

    if (elements.modalPathDisplay) {
      elements.modalPathDisplay.textContent = "";
    }
    if (elements.modalPathInput) {
      elements.modalPathInput.value = "";
      elements.modalPathInput.classList.remove("is-invalid");
    }
    if (elements.modalTitleInput) {
      elements.modalTitleInput.value = "";
    }

    try {
      await ensureEditorView();
    } catch (error) {
      console.error(error);
      setStatus("Editor failed to load.", true);
      state.newSectionDraft = null;
      setNewSectionMode(false);
      return;
    }

    clearComparisonUi();
    state.compareBaselinePath = "";
    state.compareBaselineRef = "empty";
    state.compareBaselineLabel = "Empty";
    state.compareBaselineText = "";
    state.compareBaselineTitle = "";

    const initialMarkdown = buildSectionBodyTemplate();
    state.newSectionDraft.markdown = initialMarkdown;
    state.applyingNewSectionTemplate = true;
    setEditorContent(initialMarkdown, 0, 0);
    state.applyingNewSectionTemplate = false;
    resetEditorScroll();
    initializeEditorHistory();
    updateVariantControlState();
    elements.modal.hidden = false;
    setEditorModalOpen(true);
    refreshEditorBaseline();

    if (elements.modalPathInput) {
      elements.modalPathInput.focus();
    } else if (elements.modalTitleInput) {
      elements.modalTitleInput.focus();
    } else {
      focusEditor();
    }
    scheduleMarkdownPreviewRender(true);
  }

  function handleAddSection() {
    if (!state.editMode) {
      setStatus("Enable edit mode to add sections.", true);
      return;
    }
    openNewSectionModal();
  }

  function closeModal() {
    if (!elements.modal) {
      return;
    }
    endPreviewPaneResize();
    const closingPath = state.currentPath;
    const closingDraft = closingPath ? state.drafts.get(closingPath) : null;
    elements.modal.hidden = true;
    setEditorModalOpen(false);
    state.currentPath = null;
    setNewSectionMode(false);
    clearComparisonUi();
    setEditorContent("", 0, 0);
    resetEditorScroll();
    if (state.previewResizeObserver) {
      state.previewResizeObserver.disconnect();
    }
    if (state.previewEditorResizeObserver) {
      state.previewEditorResizeObserver.disconnect();
    }
    if (state.previewScrollResyncTimeoutId) {
      window.clearTimeout(state.previewScrollResyncTimeoutId);
      state.previewScrollResyncTimeoutId = null;
    }
    if (state.previewActiveScrollTimeoutId) {
      window.clearTimeout(state.previewActiveScrollTimeoutId);
      state.previewActiveScrollTimeoutId = null;
    }
    state.previewResyncPending = false;
    state.previewSyncLock = "";
    state.previewActiveScrollSource = "";
    state.previewIgnoreNextEditorScroll = 0;
    state.previewIgnoreNextPreviewScroll = 0;
    state.previewLineAnchors = [];
    state.previewScrollAnchors = [];
    if (closingPath && typeof closingDraft === "string") {
      renderSectionFromDraft(closingPath, closingDraft);
    }
    requestSearchIndexRefresh();
  }

  async function openModal(path, markdown) {
    if (!elements.modal || !elements.modalPathDisplay || !elements.modalEditorHost) {
      return;
    }
    const wasPath = state.lastOpenedPath;
    const isDifferentPath = wasPath !== path;
    setNewSectionMode(false);
    state.currentPath = path;
    elements.modalPathDisplay.textContent = displaySourcePath(path);
    const sectionId = sectionIdFromPath(path);
    const fallbackTitle = getDefaultSectionTitle(sectionId);
    const split = splitMarkdownTitle(markdown);
    const titleValue = split.title || fallbackTitle;
    state.currentTitle = titleValue;
    state.currentTitleFallback = fallbackTitle;
    state.currentTitleTouched = false;
    if (elements.modalTitleInput) {
      elements.modalTitleInput.value = titleValue;
    }
    try {
      await ensureEditorView();
    } catch (error) {
      console.error(error);
      setStatus("Editor failed to load.", true);
      state.currentPath = null;
      setNewSectionMode(false);
      return;
    }
    state.lastOpenedPath = path;
    setEditorContent(split.body, 0, 0);
    if (isDifferentPath) {
      resetPreviewSyncState();
      resetEditorAndPreviewScroll();
    }
    initializeEditorHistory();
    updateVariantControlState();
    elements.modal.hidden = false;
    setEditorModalOpen(true);
    loadComparisonContext(path, markdown, false);
    const formatToolbar = elements.modal.querySelector(".editor-format-toolbar");
    if (formatToolbar) {
      formatToolbar.scrollLeft = 0;
    }
    window.requestAnimationFrame(() => {
      updateFormatToolbarScrollState();
    });
    focusEditor();
    if (isDifferentPath) {
      resetEditorAndPreviewScroll();
    }
    scheduleMarkdownPreviewRender(true);
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
    const formatToolbar = elements.modal.querySelector(".editor-format-toolbar");
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
              if (
                state.currentPath === normalizedPath
                && state.compareBaselinePath === normalizedPath
                && state.compareBaselineRef === "current"
              ) {
                const baselineSplit = splitMarkdownTitle(sourceMarkdown);
                state.compareBaselineText = baselineSplit.body;
                state.compareBaselineTitle = baselineSplit.title;
                refreshEditorBaseline();
              }
            })
            .catch((error) => {
              if (error && error.status === 404) {
                state.sourceMarkdown.set(normalizedPath, "");
                return;
              }
              console.error(error);
            });
        }
        await openModal(normalizedPath, draft);
        return;
      }

      const response = await fetch(normalizedPath, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Unable to load ${displaySourcePath(normalizedPath)} (${response.status})`);
      }
      const markdown = await response.text();
      state.sourceMarkdown.set(normalizedPath, markdown);
      await openModal(normalizedPath, markdown);
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Could not open editor.", true);
    }
  }

  async function fetchMarkdownFromSource(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
      const error = new Error(`Unable to reload ${displaySourcePath(path)} (${response.status})`);
      error.status = response.status;
      throw error;
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

    try {
      const sourceMarkdown = await fetchMarkdownFromSource(path);
      state.sourceMarkdown.set(path, sourceMarkdown);
      return sourceMarkdown;
    } catch (error) {
      if (error && error.status === 404) {
        state.sourceMarkdown.set(path, "");
        return "";
      }
      throw error;
    }
  }

  async function saveDraft() {
    const snapshot = getEditorSnapshot();
    if (!snapshot) {
      return;
    }

    if (state.newSectionDraft) {
      const rawPath = elements.modalPathInput ? elements.modalPathInput.value : "";
      const normalizedSectionId = normalizeSectionId(rawPath);
      if (!normalizedSectionId) {
        if (elements.modalPathInput) {
          elements.modalPathInput.classList.add("is-invalid");
        }
        setStatus("Section location must look like category/name (letters, numbers, -, _, .).", true);
        return;
      }

      if (document.getElementById(normalizedSectionId)) {
        setStatus(`Section already exists: ${normalizedSectionId}`, true);
        return;
      }

      const titleInput = elements.modalTitleInput ? elements.modalTitleInput.value : "";
      const title = normalizeTitleValue(titleInput, getDefaultSectionTitle(normalizedSectionId));

      let body = snapshot.value;
      if (!state.newSectionDraft.markdownTouched || !body.trim()) {
        body = buildSectionBodyTemplate();
      }
      const markdown = composeMarkdownWithTitle(title, body, getDefaultSectionTitle(normalizedSectionId));

      const shell = buildSectionShell(normalizedSectionId, title || normalizedSectionId);
      insertSectionByGroup(shell);

      const path = `sections/${normalizedSectionId}.md`;
      state.sourceMarkdown.set(path, "");
      state.drafts.set(path, markdown);
      storeMarkdownDrafts();
      const rendered = renderSectionFromDraft(path, markdown);
      if (!rendered) {
        shell.remove();
        state.drafts.delete(path);
        storeMarkdownDrafts();
        await reportError("Add section failed", `Could not add ${normalizedSectionId}.`);
        return;
      }

      syncSectionStructureDrafts();
      updateToolbar();
      setStatus(`Added section ${normalizedSectionId}.`);
      closeModal();
      return;
    }

    if (!state.currentPath) {
      return;
    }

    const path = state.currentPath;
    const sectionId = sectionIdFromPath(path);
    const fallbackTitle = state.currentTitleFallback || getDefaultSectionTitle(sectionId);
    const title = getTitleInputValue(fallbackTitle);
    const markdown = composeMarkdownWithTitle(title, snapshot.value, fallbackTitle);

    try {
      const sourceMarkdown = await getSourceMarkdown(path);
      if (markdown === sourceMarkdown) {
        state.drafts.delete(path);
        storeMarkdownDrafts();
        renderSectionFromDraft(path, sourceMarkdown);
        updateToolbar();
        setStatus(`No changes in ${displaySourcePath(path)}; draft discarded.`);
        closeModal();
        return;
      }

      state.drafts.set(path, markdown);
      storeMarkdownDrafts();
      renderSectionFromDraft(path, markdown);
      updateToolbar();
      setStatus(`Draft saved for ${displaySourcePath(path)}`);
      closeModal();
    } catch (error) {
      console.error(error);
      await reportError("Save failed", error.message || "Could not save draft.");
    }
  }

  function syncNewSectionDraft() {
    if (!state.newSectionDraft) {
      return;
    }

    const rawPath = elements.modalPathInput ? elements.modalPathInput.value : state.newSectionDraft.rawPath;
    const normalizedSectionId = normalizeSectionId(rawPath);
    const nextPath = normalizedSectionId ? `sections/${normalizedSectionId}.md` : "";
    const previousPath = state.newSectionDraft.draftPath || "";

    if (previousPath && previousPath !== nextPath) {
      state.drafts.delete(previousPath);
    }

    if (!normalizedSectionId || !nextPath || document.getElementById(normalizedSectionId)) {
      state.newSectionDraft.draftPath = "";
      storeMarkdownDrafts();
      updateToolbar();
      scheduleDiffPreviewRender();
      return;
    }

    const snapshot = getEditorSnapshot();
    let body = snapshot ? snapshot.value : state.newSectionDraft.markdown || "";
    if (!state.newSectionDraft.markdownTouched || !body.trim()) {
      body = buildSectionBodyTemplate();
    }

    const titleInput = elements.modalTitleInput ? elements.modalTitleInput.value : state.newSectionDraft.title;
    const fallbackTitle = getDefaultSectionTitle(normalizedSectionId);
    const title = normalizeTitleValue(titleInput, fallbackTitle);
    const markdown = composeMarkdownWithTitle(title, body, fallbackTitle);

    state.newSectionDraft.rawPath = String(rawPath || "");
    state.newSectionDraft.sectionId = normalizedSectionId;
    state.newSectionDraft.markdown = snapshot ? snapshot.value : state.newSectionDraft.markdown;
    state.newSectionDraft.title = titleInput;
    state.newSectionDraft.draftPath = nextPath;
    state.drafts.set(nextPath, markdown);
    storeMarkdownDrafts();
    updateToolbar();
    scheduleDiffPreviewRender();
  }

  function syncCurrentEditorDraft() {
    const snapshot = getEditorSnapshot();
    if (!state.currentPath || !snapshot) {
      return;
    }

    const path = state.currentPath;
    const sectionId = sectionIdFromPath(path);
    const fallbackTitle = state.currentTitleFallback || getDefaultSectionTitle(sectionId);
    const title = getTitleInputValue(fallbackTitle);
    const markdown = composeMarkdownWithTitle(title, snapshot.value, fallbackTitle);
    const sourceMarkdown = state.sourceMarkdown.get(path);

    if (typeof sourceMarkdown === "string" && markdown === sourceMarkdown) {
      state.drafts.delete(path);
    } else {
      state.drafts.set(path, markdown);
    }

    storeMarkdownDrafts();
    updateToolbar();
    scheduleDiffPreviewRender();
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
    const snapshot = getEditorSnapshot();
    if (!snapshot) {
      return;
    }

    const value = snapshot.value;
    let start = snapshot.selectionStart;
    let end = snapshot.selectionEnd;

    if (start === end) {
      const expanded = expandCollapsedSelectionToWord(value, start);
      if (expanded) {
        start = expanded.start;
        end = expanded.end;
      }
    }

    const selected = value.slice(start, end);

    const hasOuterMarkers = start >= prefix.length && end + suffix.length <= value.length && value.slice(start - prefix.length, start) === prefix && value.slice(end, end + suffix.length) === suffix;

    const isSingleCharSymmetricWrapper = prefix.length === 1 && suffix.length === 1 && prefix === suffix;

    let shouldUnwrapOuter = hasOuterMarkers;
    if (shouldUnwrapOuter && isSingleCharSymmetricWrapper) {
      const marker = prefix;
      const leftRun = countRunBackward(value, start, marker);
      const rightRun = countRunForward(value, end, marker);
      shouldUnwrapOuter = leftRun % 2 === 1 && rightRun % 2 === 1;
    }

    if (shouldUnwrapOuter) {
      replaceEditorRange(
        start - prefix.length,
        end + suffix.length,
        selected,
        start - prefix.length,
        start - prefix.length + selected.length,
      );
      return;
    }

    const selectedHasMarkers = selected.length >= prefix.length + suffix.length && selected.startsWith(prefix) && selected.endsWith(suffix);

    let shouldUnwrapSelected = selectedHasMarkers;
    if (shouldUnwrapSelected && isSingleCharSymmetricWrapper) {
      const marker = prefix;
      const leftRun = countRunFromStart(selected, marker);
      const rightRun = countRunFromEnd(selected, marker);
      shouldUnwrapSelected = leftRun % 2 === 1 && rightRun % 2 === 1;
    }

    if (shouldUnwrapSelected) {
      const unwrapped = selected.slice(prefix.length, selected.length - suffix.length);
      replaceEditorRange(start, end, unwrapped, start, start + unwrapped.length);
      return;
    }

    const content = selected || placeholder;
    const replacement = `${prefix}${content}${suffix}`;
    const nextStart = start + prefix.length;
    const nextEnd = nextStart + content.length;
    replaceEditorRange(start, end, replacement, nextStart, nextEnd);
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
    const snapshot = getEditorSnapshot();
    if (!snapshot) {
      return;
    }

    const start = snapshot.selectionStart;
    const end = snapshot.selectionEnd;
    const value = snapshot.value;
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
    replaceEditorRange(start, end, replacement, nextStart, nextEnd);
  }

  function insertProcedureBlockAtCursor(skillLevel) {
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
    const snapshot = getEditorSnapshot();
    if (!snapshot || (delta !== 1 && delta !== -1)) {
      return;
    }

    const value = snapshot.value;
    const selectionStart = snapshot.selectionStart;
    const selectionEnd = snapshot.selectionEnd;
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
    })
      .join("\n");

    replaceEditorRange(lineStart, lineEnd, adjustedBlock, lineStart, lineStart + adjustedBlock.length);
  }

  function formatInlineImageOptions(options) {
    const config = options || {};
    const parts = [];
    if (config.size) {
      parts.push(`size=${config.size}`);
    }
    if (config.float) {
      parts.push(`float=${config.float}`);
    }
    return parts.length ? `{${parts.join(" ")}}` : "";
  }

  function insertMarkdownImageAtSelection(imagePath, options) {
    const snapshot = getEditorSnapshot();
    if (!snapshot) {
      return;
    }

    const normalizedPath = normalizeImageRepoPath(imagePath);
    if (!normalizedPath) {
      setStatus("Invalid image path. Choose an image under the image library with a valid extension.", true);
      return;
    }

    const start = snapshot.selectionStart;
    const end = snapshot.selectionEnd;
    const imageRef = displayImagePath(normalizedPath);
    const selectedAlt = snapshot.value.slice(start, end).trim() || "Insert Title";
    const markdown = `![${selectedAlt}](${imageRef})${formatInlineImageOptions(options || { size: "-1" })}`;
    const pathStartOffset = markdown.indexOf(imageRef);
    const pathEndOffset = pathStartOffset + imageRef.length;
    replaceEditorRange(start, end, markdown, start + pathStartOffset, start + pathEndOffset);
  }

  async function openImagePickerDialog() {
    const choices = await getAvailableImageChoices();
    if (choices.length === 0) {
      setStatus("No images found. Upload an image first to get started.", true);
      return "";
    }

    const choiceHtml = choices.map((choice, index) => {
      const previewSrc = getImageChoicePreviewSrc(choice);
      const sourceLabel = choice.source === "repo" ? "GitHub" : choice.source;
      const displayPath = displayImagePath(choice.path);
      const slashIndex = displayPath.lastIndexOf("/");
      const imageDir = slashIndex >= 0 ? displayPath.slice(0, slashIndex) : "";
      const imageName = slashIndex >= 0 ? displayPath.slice(slashIndex + 1) : displayPath;
      const sourceIcon = choice.source === "repo"
        ? AUTH_GITHUB_ICON
        : `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M10 13V4"></path><path d="M6.5 7.5L10 4L13.5 7.5"></path><path d="M4 12.5V15.5H16V12.5"></path></svg>`;
      return `
        <button
          type="button"
          class="image-picker-item${index === 0 ? " is-selected" : ""}"
          data-image-path="${escapeDialogHtml(displayPath)}"
          aria-pressed="${index === 0 ? "true" : "false"}"
        >
          <span class="image-picker-thumb">
            <img src="${escapeDialogHtml(previewSrc)}" alt="" loading="lazy" decoding="async" />
            <span class="image-picker-source-icon" title="${escapeDialogHtml(sourceLabel)}" aria-label="${escapeDialogHtml(sourceLabel)}">${sourceIcon}</span>
          </span>
          <span class="image-picker-meta">
            <span class="image-picker-dir">${escapeDialogHtml(imageDir || "root")}</span>
            <span class="image-picker-name">${escapeDialogHtml(imageName)}</span>
          </span>
        </button>
      `;
    }).join("");

    const dialogPromise = openAppDialog({
      title: "Insert image",
      messageHtml: `
        <div class="image-picker">
          <div class="image-picker-grid">${choiceHtml}</div>
        </div>
      `,
      input: true,
      inputValue: displayImagePath(choices[0].path),
      inputPlaceholder: "your-folder/your-image.jpg",
      inputLabel: "Selected image path",
      confirmText: "Insert image",
      cancelText: "Cancel",
      panelClassName: "image-picker-dialog-panel",
      messageClassName: "image-picker-dialog",
    });

    const dialogRoot = elements.appDialogMessage;
    const selectedPathInput = elements.appDialogInput;
    const items = dialogRoot ? Array.from(dialogRoot.querySelectorAll(".image-picker-item")) : [];

    const selectItem = (item) => {
      if (!item || !selectedPathInput) {
        return;
      }
      items.forEach((candidate) => {
        const isSelected = candidate === item;
        candidate.classList.toggle("is-selected", isSelected);
        candidate.setAttribute("aria-pressed", String(isSelected));
      });
      selectedPathInput.value = item.getAttribute("data-image-path") || "";
    };

    items.forEach((item) => {
      item.addEventListener("click", () => selectItem(item));
    });

    const result = await dialogPromise;
    if (!result.confirmed) {
      return "";
    }

    return normalizeImageRepoPath(result.value) || "";
  }

  async function insertInlineImageTemplate(options) {
    const selectedPath = await openImagePickerDialog();
    if (!selectedPath) {
      return;
    }
    insertMarkdownImageAtSelection(selectedPath, options || { size: "-1" });
  }

  async function stageImageUploadIntoDraft() {
    if (!state.editorView) {
      return;
    }

    const imageFile = await pickImageFile();
    if (!imageFile) {
      return;
    }

    if (imageFile.size > MAX_STAGED_IMAGE_BYTES) {
      setStatus(
        `Image is too large (${formatFileSize(imageFile.size)}). Max ${formatFileSize(MAX_STAGED_IMAGE_BYTES)}.`,
        true,
      );
      return;
    }

    const suggestedPath = buildSuggestedImagePath(imageFile.name);
    const extensionMatch = suggestedPath.match(/(\.[A-Za-z0-9]+)$/);
    const lockedExtension = extensionMatch ? extensionMatch[1] : ".png";
    const suggestedStem = suggestedPath.slice(0, -lockedExtension.length);
    const pathDialog = await openAppDialog({
      title: "Image path",
      message: `Image path under the image library. File type is fixed as ${lockedExtension}.`,
      input: true,
      inputValue: suggestedStem,
      inputPlaceholder: "uploads/your-image",
      inputLabel: "Image path without file extension",
      confirmText: "Use path",
      cancelText: "Cancel",
    });
    if (!pathDialog.confirmed) {
      return;
    }

    const chosenStem = String(pathDialog.value || "").trim().replace(/\.[A-Za-z0-9]+$/i, "");
    const chosenPath = `${chosenStem}${lockedExtension}`;
    if (!chosenPath) {
      return;
    }

    const normalizedPath = normalizeImageRepoPath(chosenPath);
    if (!normalizedPath) {
      setStatus("Invalid image path. Use a path under the image library.", true);
      return;
    }

    const replacingExisting = state.imageDrafts.has(normalizedPath);
    if (replacingExisting) {
      const replaceDialog = await openAppDialog({
        title: "Replace staged image",
        message: `Replace staged image at ${displayImagePath(normalizedPath)}?`,
        confirmText: "Replace",
        cancelText: "Cancel",
      });
      if (!replaceDialog.confirmed) {
        return;
      }
    }

    try {
      const contentBase64 = await readFileAsBase64(imageFile);
      state.imageDrafts.set(normalizedPath, {
        contentBase64,
        contentType: imageFile.type || "application/octet-stream",
        size: imageFile.size,
        fileName: imageFile.name || "",
      });
      storeImageDrafts();

      const snapshot = getEditorSnapshot();
      if (!snapshot) {
        return;
      }
      const start = snapshot.selectionStart;
      const end = snapshot.selectionEnd;
      const selected = snapshot.value.slice(start, end).trim();
      const alt = selected || inferAltTextFromFileName(imageFile.name);
      const imageRef = displayImagePath(normalizedPath);
      const markdown = `![${alt}](${imageRef}){size=-1}`;
      const pathStartOffset = markdown.indexOf(imageRef);
      const pathEndOffset = pathStartOffset + imageRef.length;
      replaceEditorRange(start, end, markdown, start + pathStartOffset, start + pathEndOffset);

      setStatus(`Staged ${displayImagePath(normalizedPath)} (${formatFileSize(imageFile.size)}).`);
      updateToolbar();
    } catch (error) {
      console.error(error);
      await reportError("Image upload failed", error && error.message ? error.message : "Could not stage image upload.");
    }
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

  function getEditorHistoryEntry() {
    const snapshot = getEditorSnapshot();
    if (!snapshot) {
      return null;
    }

    return {
      value: snapshot.value,
      selectionStart: snapshot.selectionStart,
      selectionEnd: snapshot.selectionEnd,
    };
  }

  function applyEditorHistoryEntry(entry) {
    if (!entry) {
      return;
    }

    state.applyingHistoryEntry = true;
    setEditorContent(entry.value, entry.selectionStart, entry.selectionEnd, {
      scrollIntoView: false,
      preserveScroll: true,
    });
    focusEditor();
    state.applyingHistoryEntry = false;
  }

  function initializeEditorHistory() {
    const entry = getEditorHistoryEntry();
    state.editorHistory = entry ? [entry] : [];
    state.editorHistoryIndex = entry ? 0 : -1;
  }

  function recordEditorHistorySnapshot() {
    if (state.applyingHistoryEntry) {
      return;
    }

    const entry = getEditorHistoryEntry();
    if (!entry) {
      return;
    }

    if (state.editorHistoryIndex === -1 || state.editorHistory.length === 0) {
      state.editorHistory = [entry];
      state.editorHistoryIndex = 0;
      return;
    }

    const current = state.editorHistory[state.editorHistoryIndex];
    const unchanged = current && current.value === entry.value && current.selectionStart === entry.selectionStart && current.selectionEnd === entry.selectionEnd;
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
    if (!state.editorView || state.editorHistory.length === 0) {
      return;
    }

    if (action === "undo") {
      if (state.editorHistoryIndex <= 0) {
        return;
      }
      state.editorHistoryIndex -= 1;
      applyEditorHistoryEntry(state.editorHistory[state.editorHistoryIndex]);
      syncCurrentEditorDraft();
      return;
    }

    if (action === "redo") {
      if (state.editorHistoryIndex >= state.editorHistory.length - 1) {
        return;
      }
      state.editorHistoryIndex += 1;
      applyEditorHistoryEntry(state.editorHistory[state.editorHistoryIndex]);
      syncCurrentEditorDraft();
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
      case "image-upload":
        stageImageUploadIntoDraft();
        break;
      case "image-left":
        insertInlineImageTemplate({ size: "0.5", float: "left" });
        break;
      case "image-right":
        insertInlineImageTemplate({ size: "0.5", float: "right" });
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
      case "preview-toggle":
        applyPreviewPaneSplitRatio(0.5);
        setPreviewEnabled(!state.previewEnabled);
        break;
      case "comment-line":
        toggleLineComment();
        break;
      default:
        break;
    }
  }

  function toggleLineComment() {
    const snapshot = getEditorSnapshot();
    if (!snapshot) {
      return;
    }

    const value = snapshot.value;
    const selectionStart = snapshot.selectionStart;
    const selectionEnd = snapshot.selectionEnd;
    const blockStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
    let blockEnd = value.indexOf("\n", selectionEnd);
    if (blockEnd === -1) {
      blockEnd = value.length;
    }

    const selectedBlock = value.slice(blockStart, blockEnd);
    const lines = selectedBlock.split("\n");
    const nonEmptyLines = lines.filter((line) => line.trim() !== "");
    const commentPattern = /^(\s*)<!--\s?(.*?)\s?-->\s*$/;
    const allCommented = nonEmptyLines.length > 0 && nonEmptyLines.every((line) => commentPattern.test(line));

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
    replaceEditorRange(blockStart, blockEnd, replacement, blockStart, blockStart + replacement.length);
  }

  function handleEditorShortcut(event) {
    if (!elements.modal || elements.modal.hidden || !state.editorView) {
      return false;
    }

    if (!state.editorView.hasFocus) {
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
    } else if (event.altKey && !event.shiftKey && key === "u") {
      action = "image-upload";
    } else if (event.altKey && !event.shiftKey && key === "l") {
      action = "image-left";
    } else if (event.altKey && !event.shiftKey && key === "r") {
      action = "image-right";
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
    const counts = getStagedFileCounts();
    const totalStaged = counts.markdown + counts.images;
    if (totalStaged === 0) {
      return;
    }

    let confirmMessage = `Discard ${totalStaged} staged file${totalStaged === 1 ? "" : "s"}?`;
    if (counts.images > 0 && counts.markdown > 0) {
      confirmMessage = `Discard ${counts.markdown} markdown draft${counts.markdown === 1 ? "" : "s"} and ${counts.images} staged image${counts.images === 1 ? "" : "s"}?`;
    } else if (counts.images > 0) {
      confirmMessage = `Discard ${counts.images} staged image${counts.images === 1 ? "" : "s"}?`;
    }
    const confirmDialog = await openAppDialog({
      title: "Discard drafts",
      message: confirmMessage,
      confirmText: "Discard",
      cancelText: "Cancel",
    });
    if (!confirmDialog.confirmed) {
      return;
    }

    setBusy(true);
    setStatus("Discarding drafts...");
    closeModal();

    try {
      state.imageDrafts.clear();
      storeImageDrafts();
      await restoreManualFromSource();
      state.drafts.clear();
      storeMarkdownDrafts();
      state.sourceMarkdown.clear();
      state.compareHistoryByPath.clear();
      state.compareContentByRef.clear();
      state.compareSelectionByPath.clear();
      updateToolbar();
      setStatus(`Discarded ${totalStaged} staged file${totalStaged === 1 ? "" : "s"}.`);
    } catch (error) {
      console.error(error);
      await reportError("Reset failed", error.message || "Could not discard drafts.");
    } finally {
      setBusy(false);
    }
  }

  async function resetCurrentSectionDraft() {
    if (!state.currentPath || !state.editorView) {
      return;
    }

    const path = state.currentPath;
    try {
      const sourceMarkdown = await getSourceMarkdown(path);
      const snapshot = getEditorSnapshot();
      const split = splitMarkdownTitle(sourceMarkdown);
      const sectionId = sectionIdFromPath(path);
      const fallbackTitle = getDefaultSectionTitle(sectionId);
      const currentBody = snapshot ? snapshot.value : "";
      const currentTitle = getTitleInputValue(fallbackTitle);
      const currentMarkdown = composeMarkdownWithTitle(currentTitle, currentBody, fallbackTitle);
      const hasChanges = currentMarkdown !== sourceMarkdown;
      if (hasChanges) {
        const confirmDialog = await openAppDialog({
          title: "Reset draft",
          message: `Discard unsaved changes for ${displaySourcePath(path)}?`,
          confirmText: "Reset",
          cancelText: "Cancel",
        });
        if (!confirmDialog.confirmed) {
          return;
        }
      }
      const titleValue = split.title || fallbackTitle;
      state.currentTitle = titleValue;
      state.currentTitleFallback = fallbackTitle;
      state.currentTitleTouched = false;
      if (elements.modalTitleInput) {
        elements.modalTitleInput.value = titleValue;
      }
      state.drafts.delete(path);
      storeMarkdownDrafts();
      renderSectionFromDraft(path, sourceMarkdown);
      setEditorContent(split.body, 0, 0);
      resetEditorScroll();
      initializeEditorHistory();
      updateToolbar();
      refreshEditorBaseline();
      setStatus(`Reset draft for ${displaySourcePath(path)}.`);
    } catch (error) {
      console.error(error);
      await reportError("Reset failed", error.message || "Could not reset section draft.");
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
    const counts = getStagedFileCounts();
    const totalStaged = counts.markdown + counts.images;
    if (state.busy || totalStaged === 0) {
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

    const changedMarkdownPaths = Array.from(state.drafts.keys()).sort();
    const changedImagePaths = Array.from(state.imageDrafts.keys()).sort();

    let defaultCommitMessage = "";
    if (counts.images > 0 && counts.markdown > 0) {
      defaultCommitMessage = `docs: update ${totalStaged} files (${counts.markdown} markdown, ${counts.images} images)`;
    } else if (counts.images > 0) {
      defaultCommitMessage = `docs: add ${counts.images} image${counts.images === 1 ? "" : "s"}`;
    } else {
      defaultCommitMessage = `docs: update ${counts.markdown} markdown file${counts.markdown === 1 ? "" : "s"}`;
    }
    const markdownSummary = changedMarkdownPaths.length
      ? `Markdown (${changedMarkdownPaths.length}):\n${changedMarkdownPaths.map((path) => `- ${displaySourcePath(path)}`).join("\n")}`
      : "Markdown: none";
    const imageSummary = changedImagePaths.length
      ? `Images (${changedImagePaths.length}):\n${changedImagePaths.map((path) => `- ${displayImagePath(path)}`).join("\n")}`
      : "Images: none";
    const commitDialog = await openAppDialog({
      title: "Commit message",
      message: `Enter the commit message to publish:\n\n${markdownSummary}\n\n${imageSummary}`,
      input: true,
      inputValue: defaultCommitMessage,
      inputLabel: "Commit message",
      confirmText: "Publish",
      cancelText: "Cancel",
    });
    if (!commitDialog.confirmed) {
      return;
    }

    const commitMessage = String(commitDialog.value || "").trim();
    if (!commitMessage) {
      setStatus("Commit message required.", true);
      return;
    }

    setBusy(true);
    setStatus(`Publishing ${totalStaged} staged file${totalStaged === 1 ? "" : "s"} to ${repo.baseBranch}...`);

    try {
      const files = {};
      changedMarkdownPaths.forEach((path) => {
        files[path] = state.drafts.get(path);
      });

      const binaryFiles = {};
      changedImagePaths.forEach((path) => {
        const imageDraft = state.imageDrafts.get(path);
        if (!imageDraft) {
          return;
        }
        binaryFiles[path] = {
          contentBase64: imageDraft.contentBase64,
          contentType: imageDraft.contentType || "",
        };
      });

      const result = await authRequest("/api/submit", {
        method: "POST",
        body: {
          owner: repo.owner,
          repo: repo.name,
          baseBranch: repo.baseBranch,
          commitMessage,
          files,
          binaryFiles,
        },
      });

      if (result && result.mode === "pull_request") {
        setStatus(`Opened PR #${result.pullRequestNumber} for ${totalStaged} file${totalStaged === 1 ? "" : "s"}.`);
        if (result.url) {
          await openAppDialog({
            title: "Pull request created",
            message: `Pull request created:\n${result.url}`,
            confirmText: "OK",
            showCancel: false,
          });
        }
      } else {
        setStatus(`Committed ${totalStaged} file${totalStaged === 1 ? "" : "s"} to ${repo.baseBranch}.`);
        if (result && result.url) {
          await openAppDialog({
            title: "Commit created",
            message: `Commit created:\n${result.url}`,
            confirmText: "OK",
            showCancel: false,
          });
        }
      }

      state.drafts.clear();
      storeMarkdownDrafts();
      state.imageDrafts.clear();
      storeImageDrafts();
      state.imageManifestPromise = null;
      updateToolbar();
      refreshRepoActivity(true);
      window.setTimeout(() => {
        refreshRepoActivity(true);
      }, 11000);
    } catch (error) {
      console.error(error);
      if (error && error.status === 401) {
        state.authSession = null;
        updateAuthUi();
      }
      const message = error && error.message
        ? error.message
        : "Could not publish drafts.";
      const enhancedMessage = counts.images > 0 && /invalid files payload|files must be an object|binary/i.test(String(message).toLowerCase())
        ? `${message} The worker may need image upload support enabled.`
        : message;
      setStatus(enhancedMessage, true);
      await openAppDialog({
        title: "Publish failed",
        message: enhancedMessage,
        confirmText: "OK",
        showCancel: false,
      });
    } finally {
      setBusy(false);
    }
  }

  function buildUi() {
    const toolbar = document.createElement("div");
    toolbar.id = "editor-toolbar";
    toolbar.hidden = false;
    toolbar.classList.add("is-auth-only");
    toolbar.innerHTML = `
      <div class="inline-toolbar-row inline-toolbar-row-main">
        <button id="inline-auth-action" type="button" class="inline-auth-icon-button" aria-label="Sign in with GitHub" title="Sign in with GitHub">
          <span class="inline-auth-glyph inline-auth-glyph-github">${AUTH_GITHUB_ICON}</span>
        </button>
        <div class="editor-repo" aria-live="polite">
          <a id="inline-repo-commit" class="inline-repo-link is-muted" aria-label="Repository status">—</a>
        </div>
        <button id="inline-section-add" type="button">Add</button>
        <button id="inline-edit-submit" type="button" disabled>Push (0)</button>
        <button id="inline-edit-clear" type="button" disabled>Reset</button>
      </div>
      <span id="editor-status"></span>
    `;
    document.body.appendChild(toolbar);

    const modal = document.createElement("div");
    modal.id = "editor-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="editor-backdrop"></div>
      <div class="editor-dialog" role="dialog" aria-modal="true" aria-labelledby="editor-path-display">
        <div class="editor-header">
          <div class="editor-header-main">
            <input
              id="editor-title-input"
              class="editor-title-input"
              type="text"
              placeholder="${NEW_SECTION_TITLE_PLACEHOLDER}"
              spellcheck="true"
              autocomplete="off"
              autocapitalize="sentences"
              aria-label="Section title"
            />
            <div class="editor-path">
              <span id="editor-path-display" class="editor-path-display"></span>
              <input
                id="editor-path-input"
                class="editor-path-input"
                type="text"
                placeholder="category/filename"
                spellcheck="false"
                autocomplete="off"
                autocapitalize="off"
                aria-label="Section location"
                hidden
              />
            </div>
          </div>
          <div class="editor-history-controls" role="toolbar" aria-label="History actions">
            <div class="editor-header-side">
              <div class="editor-history-controls-row" role="group" aria-label="Undo and redo">
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
              <div class="editor-compare-toolbar" role="group" aria-label="Comparison controls">
                <select id="editor-compare-commit" aria-label="Compare with commit"></select>
              </div>
            </div>
          </div>
        </div>
        <div class="editor-format-toolbar" role="toolbar" aria-label="Markdown formatting">
          <div class="editor-format-group editor-format-group-text" role="group" aria-label="Text and heading formatting">
            <button type="button" data-format-action="bold" title="Bold (Cmd/Ctrl+B)">
              <span class="editor-tool-icon editor-tool-icon-text" aria-hidden="true"><strong>B</strong></span>
              <span class="editor-tool-label">Bold</span>
            </button>
            <button type="button" data-format-action="italic" title="Italic (Cmd/Ctrl+I)">
              <span class="editor-tool-icon editor-tool-icon-text" aria-hidden="true"><em>I</em></span>
              <span class="editor-tool-label">Italic</span>
            </button>
            <button type="button" data-format-action="comment-line" title="Toggle line comment (Cmd/Ctrl+/)">
              <span class="editor-tool-icon editor-tool-icon-code" aria-hidden="true">&lt;!--</span>
              <span class="editor-tool-label">Comment</span>
            </button>
            <button type="button" data-format-action="heading-increase" title="Increase heading (Cmd/Ctrl+])">
              <span class="editor-tool-icon editor-tool-icon-code" aria-hidden="true">#+</span>
              <span class="editor-tool-label">Heading +</span>
            </button>
            <button type="button" data-format-action="heading-decrease" title="Decrease heading (Cmd/Ctrl+[)">
              <span class="editor-tool-icon editor-tool-icon-code" aria-hidden="true">#-</span>
              <span class="editor-tool-label">Heading -</span>
            </button>
          </div>
          <div class="editor-format-group editor-format-group-structures" role="group" aria-label="Procedure and callout tools">
            <div class="editor-variant-control" role="group" aria-label="Procedure insertion">
              <button type="button" data-format-action="procedure-insert" title="Insert procedure (Cmd/Ctrl+Alt+1)">
                <span class="editor-tool-icon" aria-hidden="true">
                  <svg viewBox="0 0 20 20" focusable="false">
                    <path d="M6 5H14"></path>
                    <path d="M6 10H14"></path>
                    <path d="M6 15H11"></path>
                    <rect x="3" y="3.5" width="14" height="13" rx="2"></rect>
                  </svg>
                </span>
                <span class="editor-tool-label" data-variant-label="procedure">Procedure: Beginner</span>
              </button>
              <button type="button" class="editor-variant-swap" data-format-cycle="procedure" title="Switch procedure level (Cmd/Ctrl+Alt+Shift+1)" aria-label="Switch procedure level">
                <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <path d="M7 4L4 7L7 10"></path>
                  <path d="M4 7H12C14.209 7 16 8.791 16 11"></path>
                  <path d="M13 16L16 13L13 10"></path>
                  <path d="M16 13H8C5.791 13 4 11.209 4 9"></path>
                </svg>
              </button>
            </div>
            <div class="editor-variant-control" role="group" aria-label="Callout insertion">
              <button type="button" data-format-action="callout-insert" title="Insert callout (Cmd/Ctrl+Alt+2)">
                <span class="editor-tool-icon" aria-hidden="true">
                  <svg viewBox="0 0 20 20" focusable="false">
                    <path d="M10 4.5L3.5 15.5H16.5L10 4.5Z"></path>
                    <path d="M10 8.2V11.3"></path>
                    <circle cx="10" cy="13.6" r="0.8"></circle>
                  </svg>
                </span>
                <span class="editor-tool-label" data-variant-label="callout">Callout: Info</span>
              </button>
              <button type="button" class="editor-variant-swap" data-format-cycle="callout" title="Switch callout type (Cmd/Ctrl+Alt+Shift+2)" aria-label="Switch callout type">
                <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <path d="M7 4L4 7L7 10"></path>
                  <path d="M4 7H12C14.209 7 16 8.791 16 11"></path>
                  <path d="M13 16L16 13L13 10"></path>
                  <path d="M16 13H8C5.791 13 4 11.209 4 9"></path>
                </svg>
              </button>
            </div>
          </div>
          <div class="editor-format-group editor-format-group-media" role="group" aria-label="Media tools">
            <button type="button" data-format-action="image-upload" title="Upload image (Cmd/Ctrl+Alt+U)" aria-label="Upload image">
              <span class="editor-tool-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" focusable="false">
                  <path d="M10 13V4"></path>
                  <path d="M6.5 7.5L10 4L13.5 7.5"></path>
                  <path d="M4 12.5V15.5H16V12.5"></path>
                </svg>
              </span>
              <span class="editor-tool-label">Upload</span>
            </button>
            <button type="button" data-format-action="image-inline" title="Inline image (Cmd/Ctrl+Alt+M)" aria-label="Insert inline image">
              <span class="editor-tool-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" focusable="false">
                  <rect x="3" y="4" width="14" height="12" rx="2"></rect>
                  <circle cx="8" cy="8" r="1.3"></circle>
                  <path d="M6 13L9.2 9.8L11.6 12.2L14 9.8L16 13"></path>
                </svg>
              </span>
              <span class="editor-tool-label">Inline</span>
            </button>
            <button type="button" data-format-action="image-left" title="Left floated image (Cmd/Ctrl+Alt+L)" aria-label="Insert left floated image">
              <span class="editor-tool-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" focusable="false">
                  <path d="M3.5 4V16"></path>
                  <rect x="6" y="5" width="11" height="10" rx="1.8"></rect>
                  <path d="M8 12L10 10L12 12"></path>
                </svg>
              </span>
              <span class="editor-tool-label">Left</span>
            </button>
            <button type="button" data-format-action="image-right" title="Right floated image (Cmd/Ctrl+Alt+R)" aria-label="Insert right floated image">
              <span class="editor-tool-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" focusable="false">
                  <path d="M16.5 4V16"></path>
                  <rect x="3" y="5" width="11" height="10" rx="1.8"></rect>
                  <path d="M5 12L7 10L9 12"></path>
                </svg>
              </span>
              <span class="editor-tool-label">Right</span>
            </button>
            <button type="button" data-format-action="video" title="Insert video (Cmd/Ctrl+Alt+V)">
              <span class="editor-tool-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" focusable="false">
                  <rect x="3" y="4.5" width="14" height="11" rx="2"></rect>
                  <path d="M9 8L13 10L9 12Z"></path>
                </svg>
              </span>
              <span class="editor-tool-label">Video</span>
            </button>
          </div>
        </div>
        <div class="editor-diff-editor" role="region" aria-label="Live diff editor">
          <div class="editor-pane editor-pane-editor">
            <div id="editor-codemirror" class="editor-codemirror"></div>
          </div>
          <div
            class="editor-pane-splitter"
            role="separator"
            aria-label="Resize editor and preview panes"
            aria-orientation="vertical"
            aria-valuemin="25"
            aria-valuemax="75"
            aria-valuenow="50"
            tabindex="-1"
          ></div>
          <div class="editor-pane editor-pane-preview">
            <div id="editor-markdown-preview" class="editor-markdown-preview" aria-label="Parsed markdown preview" hidden></div>
          </div>
        </div>
        <input id="editor-image-upload" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/avif" hidden />
        <div class="editor-actions">
          <button type="button" id="editor-reset">Reset</button>
          <button type="button" id="editor-diff-summary" class="editor-diff-summary">Live diff preview</button>
          <button type="button" id="editor-preview-toggle" data-format-action="preview-toggle" aria-pressed="false" title="Toggle parsed markdown preview">Preview</button>
          <button class="primary" type="button" id="editor-save">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const appDialog = document.createElement("div");
    appDialog.id = "app-dialog";
    appDialog.className = "app-dialog";
    appDialog.hidden = true;
    appDialog.innerHTML = `
      <div class="app-dialog-backdrop"></div>
      <div class="app-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title">
        <h3 id="app-dialog-title" class="app-dialog-title">Confirm</h3>
        <div id="app-dialog-message" class="app-dialog-message"></div>
        <input
          id="app-dialog-input"
          class="app-dialog-input"
          type="text"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          hidden
        />
        <div class="app-dialog-actions">
          <button type="button" id="app-dialog-cancel">Cancel</button>
          <button type="button" id="app-dialog-confirm" class="primary">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(appDialog);

    elements.toolbar = toolbar;
    elements.toolbarVisibilityButton = document.getElementById("inline-toolbar-toggle");
    elements.authButton = toolbar.querySelector("#inline-auth-action");
    elements.repoCommit = toolbar.querySelector("#inline-repo-commit");
    elements.addSectionButton = toolbar.querySelector("#inline-section-add");
    elements.submitButton = toolbar.querySelector("#inline-edit-submit");
    elements.clearButton = toolbar.querySelector("#inline-edit-clear");
    elements.status = toolbar.querySelector("#editor-status");
    elements.appDialog = appDialog;
    elements.appDialogPanel = appDialog.querySelector(".app-dialog-panel");
    elements.appDialogTitle = appDialog.querySelector("#app-dialog-title");
    elements.appDialogMessage = appDialog.querySelector("#app-dialog-message");
    elements.appDialogInput = appDialog.querySelector("#app-dialog-input");
    elements.appDialogConfirm = appDialog.querySelector("#app-dialog-confirm");
    elements.appDialogCancel = appDialog.querySelector("#app-dialog-cancel");
    elements.modal = modal;
    elements.modalPathDisplay = modal.querySelector("#editor-path-display");
    elements.modalPathInput = modal.querySelector("#editor-path-input");
    elements.modalTitleInput = modal.querySelector("#editor-title-input");
    elements.modalEditorHost = modal.querySelector("#editor-codemirror");
    elements.modalImageInput = modal.querySelector("#editor-image-upload");
    elements.modalCompareToolbar = modal.querySelector(".editor-compare-toolbar");
    elements.modalCompareSelect = modal.querySelector("#editor-compare-commit");
    elements.modalDiffSummary = modal.querySelector("#editor-diff-summary");
    elements.modalDiffEditor = modal.querySelector(".editor-diff-editor");
    elements.modalPaneSplitter = modal.querySelector(".editor-pane-splitter");
    elements.modalPreview = modal.querySelector("#editor-markdown-preview");
    elements.modalPreviewToggle = modal.querySelector("#editor-preview-toggle");
    elements.modalSave = modal.querySelector("#editor-save");
    elements.modalReset = modal.querySelector("#editor-reset");
    elements.manageSectionsButton = buildManageSectionsButton();
    const tocHeader = document.querySelector(".toc-header");
    if (tocHeader && elements.manageSectionsButton) {
      tocHeader.appendChild(elements.manageSectionsButton);
    }
    applyPreviewPaneSplitRatioQuietly(state.previewPaneSplitRatio);
    setPreviewEnabled(shouldDefaultPreviewEnabled());
    updateVariantControlState();
    updateToolbarVisibilityButton();
  }

  function bindPreviewPaneSplitterEvents() {
    if (!elements.modalPaneSplitter) {
      return;
    }
    const splitter = elements.modalPaneSplitter;
    splitter.addEventListener("pointerdown", beginPreviewPaneResize);
    splitter.addEventListener("pointermove", handlePreviewPaneResizeMove);
    splitter.addEventListener("pointerup", endPreviewPaneResize);
    splitter.addEventListener("pointercancel", endPreviewPaneResize);
    splitter.addEventListener("lostpointercapture", endPreviewPaneResize);
  }

  function setupEvents() {
    if (!elements.submitButton || !elements.clearButton || !elements.modal) {
      return;
    }

    if (elements.toolbarVisibilityButton) {
      elements.toolbarVisibilityButton.addEventListener("click", () => {
        if (typeof window.setTocOpen === "function") {
          window.setTocOpen(false);
        }
        if (state.editMode) {
          setEditMode(false);
          setToolbarVisible(false);
        } else {
          setToolbarVisible(true);
          setEditMode(true);
        }
        updateToolbar();
      });
    }

    if (elements.authButton) {
      elements.authButton.addEventListener("click", () => {
        handleAuthButtonClick();
      });
    }

    if (elements.repoCommit) {
      elements.repoCommit.addEventListener("click", (event) => {
        showMarkdownValidationIssues(event);
      });
    }

    elements.submitButton.addEventListener("click", () => {
      submitDrafts();
    });

    elements.clearButton.addEventListener("click", () => {
      clearDrafts();
    });

    if (elements.appDialogConfirm) {
      elements.appDialogConfirm.addEventListener("click", () => {
        closeAppDialog(true);
      });
    }

    if (elements.appDialogCancel) {
      elements.appDialogCancel.addEventListener("click", () => {
        closeAppDialog(false);
      });
    }

    if (elements.appDialog) {
      elements.appDialog.addEventListener("click", (event) => {
        const target = event.target;
        if (target && target.classList.contains("app-dialog-backdrop")) {
          closeAppDialog(false);
        }
      });
    }

    if (elements.appDialogInput) {
      elements.appDialogInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          closeAppDialog(true);
        }
      });
    }

    if (elements.addSectionButton) {
      elements.addSectionButton.addEventListener("click", () => {
        handleAddSection();
      });
    }

    if (elements.manageSectionsButton) {
      elements.manageSectionsButton.addEventListener("click", () => {
        openManageSectionsDialog();
      });
    }

    if (elements.modalReset) {
      elements.modalReset.addEventListener("click", () => {
        resetCurrentSectionDraft();
      });
    }

    if (elements.modalSave) {
      elements.modalSave.addEventListener("click", saveDraft);
    }

    if (elements.modalPathInput) {
      elements.modalPathInput.addEventListener("input", () => {
        if (!state.newSectionDraft) {
          return;
        }
        const rawValue = elements.modalPathInput.value;
        state.newSectionDraft.rawPath = rawValue;
        const normalized = normalizeSectionId(rawValue);
        state.newSectionDraft.sectionId = normalized || "";
        if (normalized) {
          elements.modalPathInput.classList.remove("is-invalid");
          if (elements.modalTitleInput && !state.newSectionDraft.titleTouched) {
            const inferredTitle = getDefaultSectionTitle(normalized);
            if (inferredTitle) {
              elements.modalTitleInput.value = inferredTitle;
              state.newSectionDraft.title = inferredTitle;
            }
          }
        } else if (rawValue.trim().length > 0) {
          elements.modalPathInput.classList.add("is-invalid");
        } else {
          elements.modalPathInput.classList.remove("is-invalid");
        }
        syncNewSectionDraft();
      });
    }

    if (elements.modalTitleInput) {
      elements.modalTitleInput.addEventListener("input", () => {
        const value = elements.modalTitleInput.value;
        if (state.newSectionDraft) {
          state.newSectionDraft.title = value;
          state.newSectionDraft.titleTouched = value.trim().length > 0;
          syncNewSectionDraft();
          return;
        }
        if (!state.currentPath) {
          return;
        }
        state.currentTitle = value;
        state.currentTitleTouched = value.trim().length > 0;
        syncCurrentEditorDraft();
        scheduleDiffPreviewRender(true);
      });
    }

    if (elements.modalCompareSelect) {
      elements.modalCompareSelect.addEventListener("change", () => {
        if (!state.currentPath) {
          return;
        }
        applyCompareSelection(state.currentPath);
      });
    }

    if (elements.modalDiffSummary) {
      elements.modalDiffSummary.addEventListener("click", () => {
        openCompareCommitDialog();
      });
    }

    if (elements.modalPreview) {
      const resyncAfterPreviewToggle = () => {
        schedulePreviewResyncAfterLayout();
      };

      bindManualScrollSourceListeners(elements.modalPreview, "preview");
      elements.modalPreview.addEventListener("scroll", () => {
        if (state.previewIgnoreNextPreviewScroll > 0) {
          state.previewIgnoreNextPreviewScroll -= 1;
          return;
        }
        if (state.previewSyncLock === "editor") {
          return;
        }
        setActivePreviewScrollSource("preview");
        syncEditorScrollToPreview();
        schedulePreviewResyncAfterScrollSettles();
      }, { passive: true });

      elements.modalPreview.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }
        if (target.closest(".procedure-header")) {
          resyncAfterPreviewToggle();
        }
      });

      elements.modalPreview.addEventListener("keydown", (event) => {
        const target = event.target;
        if (!(target instanceof Element) || !target.closest(".procedure-header")) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          resyncAfterPreviewToggle();
        }
      });
    }

    bindPreviewPaneSplitterEvents();

    const backdrop = elements.modal.querySelector(".editor-backdrop");
    if (backdrop) {
      backdrop.addEventListener("click", closeModal);
    }

    const dialog = elements.modal.querySelector(".editor-dialog");
    if (dialog) {
      // dialog.addEventListener("mousedown", (event) => {
      //   const target = event.target;
      //   if (!(target instanceof Element)) {
      //     return;
      //   }
      //   const isFormatButton = !!target.closest(
      //     "button[data-format-action], button[data-format-cycle]",
      //   );
      //   if (!isFormatButton) {
      //     return;
      //   }
      //   // Keep CodeMirror selection visible when using toolbar controls.
      //   event.preventDefault();
      // });

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

    const formatToolbar = elements.modal.querySelector(".editor-format-toolbar");
    if (formatToolbar) {
      formatToolbar.addEventListener("scroll", updateFormatToolbarScrollState, { passive: true });
    }

    window.addEventListener("resize", () => {
      if (isPreviewPaneStacked()) {
        endPreviewPaneResize();
      }
      updatePreviewPaneSplitterState();
      if (!elements.modal || elements.modal.hidden) {
        return;
      }
      updateFormatToolbarScrollState();
      schedulePreviewResyncAfterLayout();
    });

    window.addEventListener("message", handleAuthPopupMessage);

    window.addEventListener("focus", () => {
      if (!state.authSession || !state.authSession.authenticated) {
        refreshAuthSession();
      }
      if (!isRepoActivityVisible()) {
        return;
      }
      refreshRepoActivity(false);
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden || !isRepoActivityVisible()) {
        return;
      }
      refreshRepoActivity(false);
    });

    window.addEventListener("beforeunload", () => {
      stopRepoActivityPolling();
      stopAuthPopupTracking();
    });

    document.addEventListener("keydown", (event) => {
      if (handleAppDialogShortcut(event)) {
        return;
      }
      if (isAppDialogOpen()) {
        return;
      }
      if (handleEditorShortcut(event)) {
        return;
      }
      if (event.key === "Escape" && elements.modal && !elements.modal.hidden) {
        closeModal();
      }
    }, true);

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
    restoreEditorState();
    storeAuthHeaderSessionToken(readStoredAuthHeaderSessionToken());
    setupEvents();
    restoreImageDrafts();
    restoreMarkdownDrafts();
    ensureAllSectionOrderActions();
    updateToolbar();
    updateAuthUi();
    updateRepoActivityUi();
    showAuthErrorFromUrl();
    refreshAuthSession();
    startRepoActivityPolling();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}());
