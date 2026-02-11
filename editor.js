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
  const AUTH_SESSION_HEADER_NAME = "X-GHA-Session";
  const AUTH_SESSION_TOKEN_STORAGE_KEY = "editor-auth-session-header-token";
  const AUTH_PROFILE_STORAGE_KEY = "editor-github-profile";
  const EDITOR_STATE_STORAGE_KEY = "editor-state";
  const MARKDOWN_DRAFTS_STORAGE_KEY = "editor-markdown-drafts-v1";
  const IMAGE_DRAFTS_STORAGE_KEY = "editor-image-drafts-v1";
  const EDITOR_MODAL_OPEN_CLASS = "editor-modal-open";
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
    drafts: new Map(),
    imageDrafts: new Map(),
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
    newSectionDraft: null,
    applyingNewSectionTemplate: false,
    dialogResolve: null,
    currentTitle: "",
    currentTitleFallback: "",
    currentTitleTouched: false,
  };

  const elements = {
    toolbar: null,
    toolbarVisibilityButton: null,
    authButton: null,
    repoCommit: null,
    addSectionButton: null,
    submitButton: null,
    clearButton: null,
    status: null,
    appDialog: null,
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
  };
  const AUTH_USER_ICON = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="8" r="4"></circle>
      <path d="M4.5 20c1.6-3.3 4.4-5 7.5-5s5.9 1.7 7.5 5"></path>
    </svg>
  `;

  function normalizeSourcePath(path) {
    if (!path) {
      return null;
    }
    return String(path).replace(/^\/+/, "");
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
    if (!value) {
      return null;
    }

    const normalized = String(value)
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .trim();

    if (!normalized.startsWith("imgs/")) {
      return null;
    }
    if (normalized.includes("..") || normalized.endsWith("/") || normalized.includes("//")) {
      return null;
    }

    const valid = /^imgs\/[A-Za-z0-9._/-]+\.(png|jpe?g|gif|webp|svg|avif)$/i.test(normalized);
    return valid ? normalized : null;
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
    return `imgs/uploads/${stamp}-${sanitizeFileStem(fileName)}.${extension}`;
  }

  function inferAltTextFromFileName(fileName) {
    const stem = sanitizeFileStem(fileName).replace(/[._-]+/g, " ").trim();
    if (!stem) {
      return "Image description";
    }
    return stem.charAt(0).toUpperCase() + stem.slice(1);
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
    const baseBranch = utilConfig && typeof utilConfig.baseBranch === "string"
      ? utilConfig.baseBranch
      : "unknown";

    if (!owner || !name) {
      return null;
    }
    return { owner, name, baseBranch };
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
          StateField: stateModule.StateField || (stateModule.default && stateModule.default.StateField),
          StateEffect: stateModule.StateEffect || (stateModule.default && stateModule.default.StateEffect),
          EditorView: viewModule.EditorView || (viewModule.default && viewModule.default.EditorView),
          Decoration: viewModule.Decoration || (viewModule.default && viewModule.default.Decoration),
          WidgetType: viewModule.WidgetType || (viewModule.default && viewModule.default.WidgetType),
          minimalSetup: basicModule.minimalSetup || (basicModule.default && basicModule.default.minimalSetup),
          markdown: markdownModule.markdown || (markdownModule.default && markdownModule.default.markdown),
        };

        if (
          !modules.EditorState
          || !modules.StateField
          || !modules.StateEffect
          || !modules.EditorView
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

    if (!stats) {
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
              modules.EditorView.lineWrapping,
              theme,
              state.editorDiffField,
              updateListener,
            ],
          }),
          parent: elements.modalEditorHost,
        });

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
      return;
    }

    state.diffRenderTimeoutId = window.setTimeout(() => {
      state.diffRenderTimeoutId = null;
      updateDiffSummaryFromStats();
    }, 80);
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

  function resetCompareSelectToCurrent(path, label) {
    if (!elements.modalCompareSelect) {
      return;
    }

    const currentLabel = label || "Current commit";
    elements.modalCompareSelect.innerHTML = "";
    const currentOption = document.createElement("option");
    currentOption.value = "current";
    currentOption.textContent = currentLabel;
    elements.modalCompareSelect.appendChild(currentOption);
    elements.modalCompareSelect.value = "current";
    if (path) {
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
    resetCompareSelectToCurrent(path, currentLabel);

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

  async function loadComparisonContext(path, initialMarkdown, forceRefresh) {
    if (!path || !elements.modalCompareSelect) {
      return;
    }

    const baselineMarkdown = state.sourceMarkdown.get(path) || String(initialMarkdown || "");
    const baselineSplit = splitMarkdownTitle(baselineMarkdown);
    state.compareBaselinePath = path;
    state.compareBaselineRef = "current";
    state.compareBaselineLabel = "Current commit";
    state.compareBaselineText = baselineSplit.body;
    state.compareBaselineTitle = baselineSplit.title;
    resetCompareSelectToCurrent(path, "Current commit");
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
      const commitCount = historyPayload && Array.isArray(historyPayload.commits)
        ? historyPayload.commits.length
        : 0;
      const hasCompareError = state.compareStatusIsError;
      if (!hasCompareError) {
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
      resetCompareSelectToCurrent(path, "Current commit");
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
    return !!(elements.toolbar && !elements.toolbar.hidden);
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

  function updateRepoActivityUi() {
    if (!elements.repoCommit) {
      return;
    }

    const applyCommitStatus = ({
      text = "—",
      href = "",
      baseClass = "",
      statusClass = "is-failed",
      title = "",
      ariaLabel = "",
    } = {}) => {
      const className = [baseClass, statusClass].filter(Boolean).join(" ").trim();
      setActivityLink(elements.repoCommit, text, href, className);
      setAttributeIfChanged(elements.repoCommit, "aria-label", ariaLabel || title || text);
      setAttributeIfChanged(elements.repoCommit, "title", title || ariaLabel || text);
    };

    const activity = state.repoActivity;
    if (state.repoActivityBusy && !activity) {
      applyCommitStatus({
        text: "…",
        href: "",
        baseClass: "is-muted",
        statusClass: "is-running",
        title: "Checking latest commit and workflow status",
        ariaLabel: "Checking latest commit and workflow status",
      });
      return;
    }

    if (!activity) {
      applyCommitStatus({
        text: "—",
        href: "",
        baseClass: "is-muted",
        statusClass: "is-failed",
        title: "Latest commit unavailable. Workflow status unavailable.",
        ariaLabel: "Latest commit unavailable. Workflow status unavailable.",
      });
      return;
    }

    if (activity.error) {
      applyCommitStatus({
        text: "—",
        href: "",
        baseClass: "is-warning",
        statusClass: "is-failed",
        title: "Latest commit unavailable. Workflow status unavailable.",
        ariaLabel: "Latest commit unavailable. Workflow status unavailable.",
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
    if (!deployRun) {
      const statusLabel = activity.runsError || "No recent workflow run";
      applyCommitStatus({
        text: commitText,
        href: activity.commitUrl,
        baseClass: commitBaseClass,
        statusClass: "is-failed",
        title: `${commitTitle}. ${statusLabel}.`,
        ariaLabel: `${commitTitle}. ${statusLabel}.`,
      });
      return;
    }

    const deployState = classifyDeployState(deployRun);
    if (deployState.cssClass === "running") {
      applyCommitStatus({
        text: commitText,
        href: activity.commitUrl,
        baseClass: commitBaseClass,
        statusClass: "is-running",
        title: `${commitTitle}. Workflow running.`,
        ariaLabel: `${commitTitle}. Workflow running.`,
      });
      return;
    }
    if (deployState.cssClass === "success") {
      applyCommitStatus({
        text: commitText,
        href: activity.commitUrl,
        baseClass: commitBaseClass,
        statusClass: "is-success",
        title: `${commitTitle}. Workflow successful.`,
        ariaLabel: `${commitTitle}. Workflow successful.`,
      });
      return;
    }
    applyCommitStatus({
      text: commitText,
      href: activity.commitUrl,
      baseClass: commitBaseClass,
      statusClass: "is-failed",
      title: `${commitTitle}. Workflow failed or unavailable.`,
      ariaLabel: `${commitTitle}. Workflow failed or unavailable.`,
    });
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
        }),
      );
    } catch (error) {
      // Ignore storage errors.
    }
  }

  function setEditMode(isEnabled) {
    const shouldEnable = !!isEnabled;
    state.editMode = shouldEnable && (!elements.toolbar || !elements.toolbar.hidden);
    document.body.classList.toggle("edit-mode", state.editMode);
    updateToolbarVisibilityButton();
    storeEditorState();
  }

  function restoreEditorState() {
    const storedState = readStoredEditorState();
    if (!storedState) {
      document.body.classList.toggle("edit-mode", state.editMode);
      return;
    }
    if (typeof storedState.toolbarVisible === "boolean") {
      setToolbarVisible(storedState.toolbarVisible);
    }
    if (typeof storedState.editMode === "boolean") {
      setEditMode(storedState.editMode);
      return;
    }
    document.body.classList.toggle("edit-mode", state.editMode);
  }

  async function authRequest(path, options) {
    const {
      method = "GET",
      body,
      includeSessionHeader = true,
    }
      = options || {};
    const headers = {};
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (includeSessionHeader && state.authHeaderSessionToken && isLoopbackHost(window.location.hostname)) {
      headers[AUTH_SESSION_HEADER_NAME] = state.authHeaderSessionToken;
    }
    const response = await fetch(`${AUTH_WORKER_ORIGIN}${path}`, {
      method,
      credentials: "include",
      headers: Object.keys(headers).length > 0 ? headers : undefined,
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
    return repoAccess.canPush ? "direct commit" : "pull request";
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

    if (avatarUrl) {
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

  function updateAuthUi() {
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
      glyph: "?",
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

      await refreshAuthSession();
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
      return true;
    }

    await refreshAuthSession();
    if (state.authSession && state.authSession.authenticated) {
      return true;
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
    const title = config.title || "Confirm";
    const message = config.message || "";
    const confirmText = config.confirmText || "OK";
    const cancelText = config.cancelText || "Cancel";
    const showCancel = config.showCancel !== false;
    const wantsInput = !!config.input;
    const inputValue = config.inputValue || "";
    const inputPlaceholder = config.inputPlaceholder || "";
    const inputLabel = config.inputLabel || "";

    if (elements.appDialogTitle) {
      elements.appDialogTitle.textContent = title;
    }
    if (elements.appDialogMessage) {
      elements.appDialogMessage.textContent = message;
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
    if (elements.modalSave) {
      elements.modalSave.disabled = disableToolbarActions;
    }
    if (elements.modalCompareSelect) {
      elements.modalCompareSelect.disabled = disableToolbarActions;
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
    updateAuthUi();
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
    return "sections/supplement/section-order.md";
  }

  function normalizeSectionId(sectionId) {
    if (!appUtils || typeof appUtils.normalizeSectionId !== "function") {
      return null;
    }
    return appUtils.normalizeSectionId(sectionId);
  }

  function getSectionGroupKey(sectionId) {
    const normalized = normalizeSectionId(sectionId) || "";
    const groupKey = normalized.split("/")[0] || "other";
    return groupKey.charAt(0).toUpperCase() + groupKey.slice(1);
  }

  function getSectionGroupLabel(groupKey) {
    if (groupKey === "maintenance") {
      return "Maintenance";
    }
    if (groupKey === "repairs") {
      return "Repairs";
    }
    if (groupKey === "supplement") {
      return "Supplement";
    }
    return "Other";
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

  function serializeSectionOrderDraft(sectionIds) {
    const lines = sectionIds.map((sectionId) => `- ${sectionId}`);
    return `# Section Order\n\n${lines.join("\n")}\n`;
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

    const sourceSectionIds = parseSectionOrderMarkdownValue(sourceMarkdown);
    const matchesSourceOrder = sourceSectionIds.length === sectionIds.length
      && sourceSectionIds.every((sectionId, index) => sectionId === sectionIds[index]);

    if (matchesSourceOrder) {
      state.drafts.delete(path);
    } else {
      state.drafts.set(path, nextMarkdown);
    }
    storeMarkdownDrafts();
    updateToolbar();
  }

  function parseSectionOrderMarkdownValue(markdown) {
    return String(markdown || "")
      .split(/\r?\n/)
      .map((line) => normalizeSectionId(line))
      .filter(Boolean);
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
    if (!section.classList.contains("section")) {
      return;
    }
    const header = section.querySelector(".section-header");
    if (!header) {
      return;
    }

    let headerActions = header.querySelector(".section-header-actions");
    if (!(headerActions instanceof Element)) {
      headerActions = document.createElement("div");
      headerActions.className = "section-header-actions";
      const existingEditLink = header.querySelector(".section-edit-link");
      if (existingEditLink) {
        headerActions.appendChild(existingEditLink);
      }
      header.appendChild(headerActions);
    }

    if (headerActions.querySelector(".section-order-actions")) {
      return;
    }

    const actions = document.createElement("div");
    actions.className = "section-order-actions";
    actions.innerHTML = `
      <button type="button" class="section-order-action" data-section-order-action="move-up" title="Move section up" aria-label="Move section up">↑</button>
      <button type="button" class="section-order-action" data-section-order-action="move-down" title="Move section down" aria-label="Move section down">↓</button>
      <button type="button" class="section-order-action is-danger" data-section-order-action="remove" title="Remove section from manual" aria-label="Remove section from manual">×</button>
    `;
    headerActions.appendChild(actions);
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
    if (currentGroup !== targetGroup) {
      setStatus("Sections can be reordered within their group only.", true);
      return;
    }

    const reordered = sections.slice();
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
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
    const normalized = String(sectionId || "").trim();
    if (!normalized) {
      return "";
    }
    const segments = normalized.split("/").filter(Boolean);
    return segments.length ? segments[segments.length - 1] : normalized;
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
    const root = document.documentElement;
    if (root) {
      root.classList.toggle(EDITOR_MODAL_OPEN_CLASS, shouldOpen);
    }
    if (document.body) {
      document.body.classList.toggle(EDITOR_MODAL_OPEN_CLASS, shouldOpen);
    }
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
    const closingPath = state.currentPath;
    const closingDraft = closingPath ? state.drafts.get(closingPath) : null;
    elements.modal.hidden = true;
    setEditorModalOpen(false);
    state.currentPath = null;
    setNewSectionMode(false);
    clearComparisonUi();
    setEditorContent("", 0, 0);
    resetEditorScroll();
    if (closingPath && typeof closingDraft === "string") {
      renderSectionFromDraft(closingPath, closingDraft);
    }
    requestSearchIndexRefresh();
  }

  async function openModal(path, markdown) {
    if (!elements.modal || !elements.modalPathDisplay || !elements.modalEditorHost) {
      return;
    }
    setNewSectionMode(false);
    state.currentPath = path;
    elements.modalPathDisplay.textContent = path;
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
    setEditorContent(split.body, 0, 0);
    resetEditorScroll();
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
    resetEditorScroll();
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
        throw new Error(`Unable to load ${normalizedPath} (${response.status})`);
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
      const error = new Error(`Unable to reload ${path} (${response.status})`);
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
        setStatus(`Could not add ${normalizedSectionId}.`, true);
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
        setStatus(`No changes in ${path}; draft discarded.`);
        closeModal();
        return;
      }

      state.drafts.set(path, markdown);
      storeMarkdownDrafts();
      renderSectionFromDraft(path, markdown);
      updateToolbar();
      setStatus(`Draft saved for ${path}`);
      closeModal();
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Could not save draft.", true);
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

  function insertInlineImageTemplate() {
    const snapshot = getEditorSnapshot();
    if (!snapshot) {
      return;
    }

    const start = snapshot.selectionStart;
    const end = snapshot.selectionEnd;
    const selectedAlt = snapshot.value.slice(start, end).trim() || "Image description";
    const pathPlaceholder = "imgs/your-image.jpg";
    const markdown = `![${selectedAlt}](${pathPlaceholder})`;
    const pathStartOffset = markdown.indexOf(pathPlaceholder);
    const pathEndOffset = pathStartOffset + pathPlaceholder.length;
    replaceEditorRange(start, end, markdown, start + pathStartOffset, start + pathEndOffset);
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
    const pathDialog = await openAppDialog({
      title: "Image path",
      message: "Image path in repo (must start with imgs/):",
      input: true,
      inputValue: suggestedPath,
      inputPlaceholder: "imgs/your-image.png",
      inputLabel: "Image path in repo",
      confirmText: "Use path",
      cancelText: "Cancel",
    });
    if (!pathDialog.confirmed) {
      return;
    }

    const chosenPath = String(pathDialog.value || "").trim();
    if (!chosenPath) {
      return;
    }

    const normalizedPath = normalizeImageRepoPath(chosenPath);
    if (!normalizedPath) {
      setStatus("Invalid image path. Use imgs/... with a valid image extension.", true);
      return;
    }

    const replacingExisting = state.imageDrafts.has(normalizedPath);
    if (replacingExisting) {
      const replaceDialog = await openAppDialog({
        title: "Replace staged image",
        message: `Replace staged image at ${normalizedPath}?`,
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
      const markdown = `![${alt}](${normalizedPath})`;
      const pathStartOffset = markdown.indexOf(normalizedPath);
      const pathEndOffset = pathStartOffset + normalizedPath.length;
      replaceEditorRange(start, end, markdown, start + pathStartOffset, start + pathEndOffset);

      setStatus(`Staged ${normalizedPath} (${formatFileSize(imageFile.size)}).`);
      updateToolbar();
    } catch (error) {
      console.error(error);
      setStatus(error && error.message ? error.message : "Could not stage image upload.", true);
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
      setStatus(error.message || "Could not discard drafts.", true);
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
      const split = splitMarkdownTitle(sourceMarkdown);
      const sectionId = sectionIdFromPath(path);
      const fallbackTitle = getDefaultSectionTitle(sectionId);
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
      ? `Markdown (${changedMarkdownPaths.length}):\n${changedMarkdownPaths.map((path) => `- ${path}`).join("\n")}`
      : "Markdown: none";
    const imageSummary = changedImagePaths.length
      ? `Images (${changedImagePaths.length}):\n${changedImagePaths.map((path) => `- ${path}`).join("\n")}`
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
    toolbar.hidden = true;
    toolbar.innerHTML = `
      <div class="inline-toolbar-row inline-toolbar-row-main">
        <button id="inline-auth-action" type="button" class="inline-auth-icon-button" aria-label="Sign in with GitHub" title="Sign in with GitHub">?</button>
        <div class="editor-repo" aria-live="polite">
          <a id="inline-repo-commit" class="inline-repo-link is-muted" aria-label="Latest commit">—</a>
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
                placeholder="category/filename.md"
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
            <button type="button" data-format-action="image-upload" title="Upload image to imgs/ (Cmd/Ctrl+Alt+U)" aria-label="Upload image">
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
            <button type="button" data-format-action="image-left" title="Left-aligned figure (Cmd/Ctrl+Alt+L)" aria-label="Insert left-aligned figure">
              <span class="editor-tool-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" focusable="false">
                  <path d="M3.5 4V16"></path>
                  <rect x="6" y="5" width="11" height="10" rx="1.8"></rect>
                  <path d="M8 12L10 10L12 12"></path>
                </svg>
              </span>
              <span class="editor-tool-label">Left</span>
            </button>
            <button type="button" data-format-action="image-right" title="Right-aligned figure (Cmd/Ctrl+Alt+R)" aria-label="Insert right-aligned figure">
              <span class="editor-tool-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" focusable="false">
                  <path d="M16.5 4V16"></path>
                  <rect x="3" y="5" width="11" height="10" rx="1.8"></rect>
                  <path d="M5 12L7 10L9 12"></path>
                </svg>
              </span>
              <span class="editor-tool-label">Right</span>
            </button>
            <button type="button" data-format-action="image-wide" title="Wide figure (Cmd/Ctrl+Alt+W)" aria-label="Insert wide figure">
              <span class="editor-tool-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" focusable="false">
                  <rect x="2.5" y="6" width="15" height="8" rx="1.8"></rect>
                  <path d="M5 12L8 9L10 11L12.5 8.5L15 12"></path>
                </svg>
              </span>
              <span class="editor-tool-label">Wide</span>
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
          <div id="editor-codemirror" class="editor-codemirror"></div>
        </div>
        <input id="editor-image-upload" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/avif" hidden />
        <div class="editor-actions">
          <button type="button" id="editor-reset">Reset Section</button>
          <p id="editor-diff-summary" class="editor-diff-summary">Live diff preview</p>
          <button class="primary" type="button" id="editor-save">Save Draft</button>
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
        <p id="app-dialog-message" class="app-dialog-message"></p>
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
    elements.modalSave = modal.querySelector("#editor-save");
    elements.modalReset = modal.querySelector("#editor-reset");
    updateVariantControlState();
    updateToolbarVisibilityButton();
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

    const backdrop = elements.modal.querySelector(".editor-backdrop");
    if (backdrop) {
      backdrop.addEventListener("click", closeModal);
    }

    const dialog = elements.modal.querySelector(".editor-dialog");
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

    const formatToolbar = elements.modal.querySelector(".editor-format-toolbar");
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

      const sectionAction = target.closest(".section-order-action");
      if (sectionAction && state.editMode) {
        const action = sectionAction.getAttribute("data-section-order-action");
        const section = sectionAction.closest(".section");
        const sectionId = section && section.id ? section.id : "";
        if (action && sectionId) {
          event.preventDefault();
          event.stopPropagation();
          if (action === "move-up") {
            reorderSectionByOffset(sectionId, -1);
          } else if (action === "move-down") {
            reorderSectionByOffset(sectionId, 1);
          } else if (action === "remove") {
            removeSectionFromManual(sectionId);
          }
        }
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
