// Prevent hash updates until after initial scroll restoration
let hashUpdateEnabled = false;
const SECTION_ORDER_PATH = "sections/supplement/section-order.md";
const EDITOR_MARKDOWN_DRAFTS_STORAGE_KEY = "editor-markdown-drafts-v1";
let sectionFiles = [];

let sidebarLinksCache = [];
const ACTIVATION_OFFSET = 120;
let activeTrackingObserver = null;
let activeTrackingResizeHandler = null;
let activeTrackingScrollHandler = null;
let sectionToggleBound = false;
let sidebarLinksBound = false;

const SECTION_GROUPS = {
  order: ["maintenance", "repairs", "supplement", "other"],
  labels: {
    maintenance: "Maintenance",
    repairs: "Repairs",
    supplement: "Supplement",
    other: "Other",
  },
};

if (
  !window.AppUtils
  || typeof window.AppUtils.escapeHtml !== "function"
  || typeof window.AppUtils.escapeAttribute !== "function"
  || typeof window.AppUtils.getGitHubEditUrl !== "function"
  || typeof window.AppUtils.normalizeSectionId !== "function"
  || typeof window.AppUtils.normalizeHashValue !== "function"
  || typeof window.AppUtils.replaceUrlState !== "function"
  || typeof window.AppUtils.getInternalHashFromLink !== "function"
  || typeof window.AppUtils.normalizeInternalHashLinks !== "function"
) {
  throw new Error("AppUtils is required before script.js.");
}
const {
  escapeHtml,
  escapeAttribute,
  getGitHubEditUrl: appGetGitHubEditUrl,
  normalizeSectionId: appNormalizeSectionId,
  normalizeHashValue: appNormalizeHashValue,
  replaceUrlState: appReplaceUrlState,
  getInternalHashFromLink: appGetInternalHashFromLink,
  normalizeInternalHashLinks: appNormalizeInternalHashLinks,
} = window.AppUtils;

function setupSearchBar() {
  window.SearchBarSetup();
}

function refreshSearchBarIndex() {
  window.SearchBarRefreshIndex();
}

function scheduleNonCriticalWork(task) {
  if (typeof task !== "function") {
    return;
  }

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => {
      task();
    }, { timeout: 600 });
    return;
  }

  window.setTimeout(() => {
    task();
  }, 0);
}

function parseSectionOrderMarkdown(markdown) {
  if (typeof markdown !== "string") {
    return [];
  }

  const unique = new Set();
  markdown.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }
    const sectionId = appNormalizeSectionId(trimmed);
    if (sectionId) {
      unique.add(sectionId);
    }
  });
  return Array.from(unique);
}

function readStoredMarkdownDraftMap() {
  try {
    const raw = localStorage.getItem(EDITOR_MARKDOWN_DRAFTS_STORAGE_KEY);
    if (!raw) {
      return new Map();
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || typeof parsed.drafts !== "object") {
      return new Map();
    }
    const draftEntries = Object.entries(parsed.drafts).filter(([path, markdown]) => (
      typeof path === "string" && typeof markdown === "string"
    ));
    return new Map(draftEntries);
  } catch (error) {
    return new Map();
  }
}

async function resolveSectionFiles() {
  const response = await fetch(SECTION_ORDER_PATH, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load section order manifest (${response.status}).`);
  }
  const markdown = await response.text();
  const parsed = parseSectionOrderMarkdown(markdown);
  if (parsed.length === 0) {
    throw new Error("Section order manifest is empty.");
  }

  const draftMap = readStoredMarkdownDraftMap();
  const draftManifest = draftMap.get(SECTION_ORDER_PATH);
  if (typeof draftManifest === "string") {
    const parsedDraft = parseSectionOrderMarkdown(draftManifest);
    if (parsedDraft.length > 0) {
      nextSectionIds = parsedDraft;
    }
  }

  sectionFiles = parsed.slice();
  return sectionFiles;
}

function loadEditorAssets() {
  if (!document.head) {
    return;
  }

  if (!document.getElementById("editor-css")) {
    const link = document.createElement("link");
    link.id = "editor-css";
    link.rel = "stylesheet";
    link.href = "editor.css?v=3";
    document.head.appendChild(link);
  }

  if (!document.getElementById("editor-script")) {
    const script = document.createElement("script");
    script.id = "editor-script";
    script.src = "editor.js?v=17";
    script.async = true;
    document.head.appendChild(script);
  }
}

const sectionMetaCache = new Map();
const renderedSections = new Set();
let sectionRenderObserver = null;
let searchIndexRefreshTimer = null;
let activeTrackingRefreshTimer = null;
const SECTION_RENDER_IDLE_TIME_MS = 12;
const SECTION_RENDER_INITIAL_COUNT = 1;

function createSectionShell(sectionId, title) {
  const safeTitle = escapeHtml(title || sectionId);
  const safeSectionId = escapeAttribute(sectionId);
  const sectionPath = `sections/${sectionId}.md`;
  const editUrl = appGetGitHubEditUrl(sectionPath);
  const editLinkHtml = editUrl
    ? `<a class="section-edit-link" data-source-path="${escapeAttribute(sectionPath)}" href="${escapeAttribute(editUrl)}" target="_blank" rel="noopener noreferrer">Edit</a>`
    : "";
  const template = document.createElement("template");
  template.innerHTML = `
    <section class="section collapsed" id="${safeSectionId}" data-source-path="${escapeAttribute(sectionPath)}">
      <div class="section-header" role="button" tabindex="0" aria-expanded="false">
        <div class="section-header-main">
          <span class="section-toggle">▼</span>
          <h2>${safeTitle}</h2>
        </div>
        <div class="section-header-actions">
          ${editLinkHtml}
        </div>
      </div>
      <div class="section-content"></div>
    </section>
  `;
  return template.content.firstElementChild;
}

function scheduleSearchIndexRefresh() {
  if (searchIndexRefreshTimer) {
    window.clearTimeout(searchIndexRefreshTimer);
  }
  searchIndexRefreshTimer = window.setTimeout(() => {
    refreshSearchBarIndex();
  }, 120);
}

function scheduleActiveTrackingRefresh() {
  if (activeTrackingRefreshTimer) {
    window.clearTimeout(activeTrackingRefreshTimer);
  }
  activeTrackingRefreshTimer = window.setTimeout(() => {
    setupActiveTracking();
  }, 150);
}

function renderSectionSubItems(section) {
  const sectionId = section.id;
  const safeSectionId = escapeAttribute(sectionId);
  const headings = section.querySelectorAll(
    ".section-content h2[id], .section-content h3[id]",
  );

  return Array.from(headings).map((heading) => {
    const headingId = escapeAttribute(heading.id);
    const headingText = escapeHtml(heading.textContent);
    return `
      <li class="sub">
        <a href="#${headingId}" data-parent="${safeSectionId}">${headingText}</a>
      </li>
    `;
  }).join("");
}

function updateSidebarSectionTitle(sectionId, title) {
  const sidebarLink = document.querySelector(
    `#toc-list a[data-section="${sectionId}"]`,
  );
  if (sidebarLink) {
    sidebarLink.textContent = title;
  }
}

function renderSectionContent(sectionId) {
  if (!sectionId || renderedSections.has(sectionId)) {
    return;
  }
  const meta = sectionMetaCache.get(sectionId);
  if (!meta) {
    return;
  }
  const section = document.getElementById(sectionId);
  if (!section) {
    return;
  }
  const contentEl = section.querySelector(".section-content");
  if (!contentEl) {
    return;
  }

  const rendered = typeof renderMarkdownContent === "function"
    ? renderMarkdownContent(contentEl, meta.content, {
      documentTitle: meta.title || sectionId,
      headingScopeId: sectionId,
      downgradeHeadings: true,
    })
    : false;

  if (!rendered) {
    contentEl.textContent = meta.content;
  }

  renderedSections.add(sectionId);
  section.dataset.rendered = "true";

  appNormalizeInternalHashLinks(section);

  const subList = document.querySelector(
    `.sidebar .sub-list[data-parent-section="${sectionId}"]`,
  );
  if (subList) {
    subList.innerHTML = renderSectionSubItems(section);
  }

  refreshSidebarLinksCache();
  scheduleSearchIndexRefresh();
  scheduleActiveTrackingRefresh();

  if (sectionRenderObserver && renderedSections.size >= sectionFiles.length) {
    sectionRenderObserver.disconnect();
  }
}

function setupSectionRenderObserver() {
  if (!("IntersectionObserver" in window)) {
    return;
  }
  if (sectionRenderObserver) {
    sectionRenderObserver.disconnect();
  }
  sectionRenderObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const section = entry.target;
        if (section && section.id) {
          renderSectionContent(section.id);
        }
      }
    });
  }, {
    root: null,
    rootMargin: "800px 0px",
    threshold: 0.01,
  });

  document.querySelectorAll(".section").forEach((section) => {
    sectionRenderObserver.observe(section);
  });
}

function processSectionRenderQueue(queue) {
  if (!queue || queue.length === 0) {
    return;
  }

  const runBatch = (deadline) => {
    let remaining = typeof deadline?.timeRemaining === "function"
      ? deadline.timeRemaining()
      : SECTION_RENDER_IDLE_TIME_MS;
    let renderedOne = false;

    while (queue.length && (remaining > SECTION_RENDER_IDLE_TIME_MS || !renderedOne)) {
      const sectionId = queue.shift();
      renderSectionContent(sectionId);
      renderedOne = true;
      remaining = typeof deadline?.timeRemaining === "function"
        ? deadline.timeRemaining()
        : SECTION_RENDER_IDLE_TIME_MS;
    }

    if (queue.length) {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(runBatch, { timeout: 600 });
      } else {
        window.setTimeout(() => runBatch(), 120);
      }
    }
  };

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(runBatch, { timeout: 600 });
  } else {
    window.setTimeout(() => runBatch(), 120);
  }
}

async function loadSections() {
  const container = document.getElementById("sections-container");
  if (!container) {
    return;
  }
  const markdownDraftMap = readStoredMarkdownDraftMap();

  let currentGroup = null;
  const groupLabels = SECTION_GROUPS.labels;

  const loadedSections = await Promise.all(sectionFiles.map(async (section) => {
    try {
      const sectionPath = `sections/${section}.md`;
      const draftMarkdown = markdownDraftMap.get(sectionPath);
      let markdown = null;
      if (typeof draftMarkdown === "string") {
        markdown = draftMarkdown;
      } else {
        const response = await fetch(sectionPath);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        markdown = await response.text();
      }
      const titleAndContent = typeof extractTitleAndContentFromMarkdown === "function"
        ? extractTitleAndContentFromMarkdown(markdown)
        : { title: null, content: markdown };
      const title = (titleAndContent && titleAndContent.title) || formatSectionTitleFromId(section);
      const content = (titleAndContent && titleAndContent.content) || markdown;
      sectionMetaCache.set(section, { title, content });
      const sectionEl = createSectionShell(section, title);
      return { section, sectionEl, title };
    } catch (error) {
      console.error(`Failed to load section: ${section}`, error);
      return null;
    }
  }));

  const fragment = document.createDocumentFragment();
  loadedSections.forEach((loadedSection) => {
    if (!loadedSection) {
      return;
    }

    const { section, sectionEl, title } = loadedSection;
    const groupKey = getSectionGroup(section);
    if (groupKey !== currentGroup) {
      currentGroup = groupKey;
      const groupLabel = groupLabels[groupKey];
      if (groupLabel) {
        const groupEl = document.createElement("div");
        groupEl.className = "section-group";
        groupEl.innerHTML = `
          <div class="section-group-divider" aria-hidden="true"></div>
          <div class="section-group-title">${escapeHtml(groupLabel)}</div>
        `;
        fragment.appendChild(groupEl);
      }
    }
    fragment.appendChild(sectionEl);
    if (title) {
      updateSidebarSectionTitle(section, title);
    }
  });

  container.appendChild(fragment);
  appNormalizeInternalHashLinks(container);

  // Setup click handlers after all sections are loaded
  setupSectionToggle();
  setupSidebarLinks();
  setupTocToggle();
  setupSearchBar();

  // Restore scroll position after sections are loaded
  restoreScrollPosition();

  setupSectionRenderObserver();
  const initialQueue = sectionFiles.slice(0);
  processSectionRenderQueue(initialQueue);

  // Render a few sections early so there is content near the top.
  sectionFiles.slice(0, SECTION_RENDER_INITIAL_COUNT).forEach((sectionId) => {
    scheduleNonCriticalWork(() => renderSectionContent(sectionId));
  });
}

async function loadPreface() {
  const preface = document.getElementById("preface-content");
  if (!preface) {
    return;
  }

  try {
    const introPath = "sections/supplement/introduction.md";
    const markdownDraftMap = readStoredMarkdownDraftMap();
    const draftMarkdown = markdownDraftMap.get(introPath);
    let markdown = null;
    if (typeof draftMarkdown === "string") {
      markdown = draftMarkdown;
    } else {
      const response = await fetch(introPath);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      markdown = await response.text();
    }
    const titleAndContent = typeof extractTitleAndContentFromMarkdown === "function"
      ? extractTitleAndContentFromMarkdown(markdown)
      : { content: markdown };
    const introTitle = titleAndContent && typeof titleAndContent.title === "string"
      ? titleAndContent.title
      : "";
    const content = titleAndContent && typeof titleAndContent.content === "string"
      ? titleAndContent.content
      : markdown;
    const introEditUrl = appGetGitHubEditUrl("sections/supplement/introduction.md");
    const introEditLink = document.getElementById("intro-edit-link");
    if (introEditLink) {
      introEditLink.setAttribute("data-source-path", "sections/supplement/introduction.md");
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

    renderMarkdownContent(preface, content, {
      documentTitle: introTitle || "Introduction",
      headingScopeId: "preface",
    });
    appNormalizeInternalHashLinks(preface);
  } catch (error) {
    console.error("Failed to load preface introduction", error);
  }
}

function refreshSidebarLinksCache() {
  sidebarLinksCache = Array.from(
    document.querySelectorAll(".sidebar a[href^='#']"));
}

function setupTocToggle() {
  const toggleButton = document.getElementById("toc-toggle");
  const sidebar = document.getElementById("sidebar");
  const mainContent = document.querySelector("main");

  if (!toggleButton || !sidebar) {
    return;
  }

  const setExpanded = (expanded) => {
    sidebar.classList.toggle("is-open", expanded);
    toggleButton.setAttribute("aria-expanded", String(expanded));
    if (mainContent) {
      mainContent.classList.toggle("toc-dim", expanded);
    }
  };

  window.setTocOpen = setExpanded;

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (toggleButton.contains(target)) { // Clicked the toggle button - switch state
      setExpanded(!sidebar.classList.contains("is-open"));
    }
    else if (!sidebar.contains(target)) { // Clicked outside sidebar - close it
      setExpanded(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && sidebar.classList.contains("is-open")) {
      setExpanded(false);
      toggleButton.focus();
    }
  });
}

function getSectionGroup(sectionId) {
  if (sectionId.startsWith("maintenance/")) {
    return "maintenance";
  }
  if (sectionId.startsWith("repairs/")) {
    return "repairs";
  }
  if (sectionId.startsWith("supplement/")) {
    return "supplement";
  }
  return "other";
}

function renderSectionNavItem(section) {
  const sectionId = section.id;
  const sectionTitle = section.querySelector("h2").textContent;
  const safeSectionId = escapeAttribute(sectionId);
  const safeSectionTitle = escapeHtml(sectionTitle);

  const headings = section.querySelectorAll(
    ".section-content h2[id], .section-content h3[id]",
  );

  const subItems = Array.from(headings).map((heading) => {
    const headingId = escapeAttribute(heading.id);
    const headingText = escapeHtml(heading.textContent);
    return `
            <li class="sub">
                <a href="#${headingId}" data-parent="${safeSectionId}">${headingText}</a>
            </li>
        `;
  }).join("");

  return `
        <li>
            <div class="nav-row">
                <button class="nav-arrow" type="button" data-section="${safeSectionId}" aria-label="Toggle section">▼</button>
                <a href="#${safeSectionId}" data-section="${safeSectionId}">${safeSectionTitle}</a>
            </div>
            <ul class="sub-list" data-parent-section="${safeSectionId}">
                ${subItems}
            </ul>
        </li>
      `;

}

function formatSectionTitleFromId(sectionId) {
  const raw = String(sectionId || "");
  const lastSegment = raw.includes("/") ? raw.split("/").pop() : raw;
  const slug = String(lastSegment || raw).trim().toLowerCase();
  if (!slug) {
    return raw;
  }

  const lowercaseWords = new Set([
    "a",
    "an",
    "and",
    "as",
    "at",
    "but",
    "by",
    "for",
    "if",
    "in",
    "nor",
    "of",
    "on",
    "or",
    "per",
    "the",
    "to",
    "via",
  ]);

  const words = slug.split(/[-_]+/).filter(Boolean);
  return words
    .map((word, index) => {
      const isConnector = lowercaseWords.has(word);
      const isFirstOrLast = index === 0 || index === words.length - 1;
      if (isConnector && !isFirstOrLast) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function renderInitialSidebar() {
  const sidebarList = document.getElementById("toc-list");
  if (!sidebarList) {
    return;
  }

  const groupOrder = SECTION_GROUPS.order;
  const groupLabels = SECTION_GROUPS.labels;
  const groupedSections = groupOrder.reduce((acc, groupKey) => {
    acc[groupKey] = [];
    return acc;
  }, {});

  sectionFiles.forEach((sectionId) => {
    const groupKey = getSectionGroup(sectionId);
    if (!groupedSections[groupKey]) {
      groupedSections[groupKey] = [];
    }
    groupedSections[groupKey].push(sectionId);
  });

  const sidebarHtml = groupOrder.map((groupKey) => {
    const groupSectionIds = groupedSections[groupKey] || [];
    if (groupSectionIds.length === 0) {
      return "";
    }

    const groupItemsHtml = groupSectionIds.map((sectionId) => {
      const sectionTitle = formatSectionTitleFromId(sectionId);
      const safeSectionId = escapeAttribute(sectionId);
      const safeSectionTitle = escapeHtml(sectionTitle);
      return `
        <li>
          <div class="nav-row">
            <button class="nav-arrow collapsed" type="button" data-section="${safeSectionId}" aria-label="Toggle section">▼</button>
            <a href="#${safeSectionId}" data-section="${safeSectionId}">${safeSectionTitle}</a>
          </div>
          <ul class="sub-list collapsed" data-parent-section="${safeSectionId}"></ul>
        </li>
      `;
    }).join("");

    const groupLabel = groupLabels[groupKey];
    const safeGroupLabel = groupLabel ? escapeHtml(groupLabel) : "";
    const titleHtml = safeGroupLabel
      ? `<div class="toc-group-title">${safeGroupLabel}</div>`
      : "";

    return `
      <li class="toc-group">
        ${titleHtml}
        <ul class="toc-group-list">
          ${groupItemsHtml}
        </ul>
      </li>
    `;
  }).join("");

  sidebarList.innerHTML = sidebarHtml;
  refreshSidebarLinksCache();
}

async function initApp() {
  await resolveSectionFiles();
  renderInitialSidebar();
  setupSidebarLinks();

  await Promise.all([loadPreface(), loadSections()]);
  scheduleNonCriticalWork(() => {
    refreshSearchBarIndex();
  });
  scheduleNonCriticalWork(() => {
    loadEditorAssets();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initApp().catch((error) => {
    console.error("App initialization failed", error);
  });
});


document.addEventListener("click", function (event) {
  if (event.defaultPrevented || event.button !== 0) {
    return;
  }
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }

  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const link = target.closest("a[href]");
  if (!link) {
    return;
  }

  const hash = appGetInternalHashFromLink(link);
  if (hash && scrollToSection(hash)) {
    event.preventDefault();
  }
});

function generateSidebar() {
  const sections = document.querySelectorAll(".section");
  const sidebarList = document.getElementById("toc-list");
  if (!sidebarList) {
    return;
  }

  const groupOrder = SECTION_GROUPS.order;
  const groupLabels = SECTION_GROUPS.labels;

  const groupedSections = groupOrder.reduce((acc, groupKey) => {
    acc[groupKey] = [];
    return acc;
  }, {});

  Array.from(sections).forEach((section) => {
    const groupKey = getSectionGroup(section.id);
    if (!groupedSections[groupKey]) {
      groupedSections[groupKey] = [];
    }
    groupedSections[groupKey].push(section);
  });

  const sidebarHtml = groupOrder.map((groupKey) => {
    const groupSections = groupedSections[groupKey] || [];
    if (groupSections.length === 0) {
      return "";
    }

    const groupItemsHtml = groupSections
      .map((section) => renderSectionNavItem(section))
      .join("");

    const groupLabel = groupLabels[groupKey];
    const safeGroupLabel = groupLabel ? escapeHtml(groupLabel) : "";
    const titleHtml = safeGroupLabel
      ? `<div class="toc-group-title">${safeGroupLabel}</div>`
      : "";

    return `
      <li class="toc-group">
        ${titleHtml}
        <ul class="toc-group-list">
          ${groupItemsHtml}
        </ul>
      </li>
    `;
  }).join("");

  // Clear existing sidebar content
  sidebarList.innerHTML = sidebarHtml;

  refreshSidebarLinksCache();
}

function setupActiveTracking() {
  if (activeTrackingObserver) {
    activeTrackingObserver.disconnect();
    activeTrackingObserver = null;
  }
  if (activeTrackingResizeHandler) {
    window.removeEventListener("resize", activeTrackingResizeHandler);
    activeTrackingResizeHandler = null;
  }
  if (activeTrackingScrollHandler) {
    window.removeEventListener("scroll", activeTrackingScrollHandler);
    activeTrackingScrollHandler = null;
  }

  const headings = Array.from(document.querySelectorAll(
    ".section[id], .section .section-content h2[id], .section .section-content h3[id]",
  ));
  function isCollapsedHeading(heading) {
    if (heading.classList && heading.classList.contains("section")) {
      return false;
    }

    const parentSection = heading.closest(".section");
    return parentSection
      ? parentSection.classList.contains("collapsed")
      : false;
  }

  function resolveActiveElement() {
    const targetLine = window.scrollY + ACTIVATION_OFFSET;
    let activeElement = null;
    let nearestTop = -Infinity;

    headings.forEach((heading) => {
      if (isCollapsedHeading(heading)) {
        return;
      }

      const rect = heading.getBoundingClientRect();
      const absoluteTop = window.scrollY + rect.top;

      if (absoluteTop <= targetLine && absoluteTop > nearestTop) {
        activeElement = heading;
        nearestTop = absoluteTop;
      }
    });

    return activeElement;
  }

  function setActiveLink(activeElement) {
    const sidebarLinks = sidebarLinksCache;
    sidebarLinks.forEach((link) => link.classList.remove("active"));

    if (activeElement) {
      const activeHash = `#${activeElement.id}`;
      const activeLink = sidebarLinks.find(
        (link) => link.getAttribute("href") === activeHash,
      );

      if (activeLink) {
        activeLink.classList.add("active");
        // Update the URL hash to match the active heading, but only if it changed and hash updates are enabled
        if (hashUpdateEnabled && window.location.hash !== `#${activeElement.id}`) {
          appReplaceUrlState(`#${activeElement.id}`);
        }
      }
    } else {
      const contentsLink = document.querySelector(
        '.sidebar a[href="#top"]',
      );
      if (contentsLink) {
        contentsLink.classList.add("active");
        if (hashUpdateEnabled && window.location.hash !== "#top") {
          appReplaceUrlState("#top");
        }
      }
    }
  }

  function updateActiveLink() {
    setActiveLink(resolveActiveElement());
  }

  window.updateActiveLink = updateActiveLink;

  activeTrackingObserver = new IntersectionObserver(
    () => {
      updateActiveLink();
    },
    {
      root: null,
      rootMargin: `-${ACTIVATION_OFFSET}px 0px -60% 0px`,
      threshold: [0, 0.25, 0.5, 0.75, 1],
    },
  );
  headings.forEach((heading) => activeTrackingObserver.observe(heading));
  activeTrackingResizeHandler = updateActiveLink;
  window.addEventListener("resize", activeTrackingResizeHandler, { passive: true });

  updateActiveLink();
}

function scrollToSection(hash, behavior = "smooth") {
  const normalizedHash = appNormalizeHashValue(hash);
  if (!normalizedHash) {
    return false;
  }

  const targetId = normalizedHash.slice(1);
  if (!targetId) {
    return false;
  }

  let targetElement = document.getElementById(targetId);
  if (!targetElement) {
    const matchingSection = sectionFiles.find((sectionId) => (
      targetId === sectionId || targetId.startsWith(`${sectionId}/`)
    ));
    if (matchingSection) {
      renderSectionContent(matchingSection);
      targetElement = document.getElementById(targetId);
    }
  }
  if (!targetElement) {
    return false;
  }

  const parentSection = targetElement.closest(".section");
  if (parentSection && parentSection.classList.contains("collapsed")) {
    setSectionCollapsed(parentSection, false, { syncActive: false });
  }

  const targetTop = targetElement.getBoundingClientRect().top + window.scrollY;
  window.scrollTo({
    top: Math.max(targetTop - ACTIVATION_OFFSET + 5, 0),
    behavior,
  });
  return true;
}

function setCollapsibleState(container, headerSelector, isCollapsed) {
  if (!(container instanceof Element)) {
    return false;
  }

  const nextCollapsed = !!isCollapsed;
  const changed = container.classList.contains("collapsed") !== nextCollapsed;
  container.classList.toggle("collapsed", nextCollapsed);

  const header = container.querySelector(headerSelector);
  if (header) {
    header.setAttribute("aria-expanded", String(!nextCollapsed));
  }

  return changed;
}

function setSectionCollapsed(section, isCollapsed, options) {
  if (!(section instanceof Element)) {
    return false;
  }

  const config = options || {};
  const changed = setCollapsibleState(section, ".section-header", isCollapsed);
  const sectionId = section.id;
  if (sectionId) {
    updateSidebarArrow(sectionId, section.classList.contains("collapsed"));
  }

  if (config.syncActive !== false && typeof window.updateActiveLink === "function") {
    window.updateActiveLink();
  }

  return changed;
}

function toggleSectionCollapsed(section, options) {
  if (!(section instanceof Element)) {
    return false;
  }
  return setSectionCollapsed(section, !section.classList.contains("collapsed"), options);
}

function handleSectionHeaderToggle(event) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const header = target.closest(".section-header");
  if (!header) {
    return;
  }

  const section = header.closest(".section");
  if (!section) {
    return;
  }

  if (target.closest(".section-edit-link") || target.closest(".section-order-actions")) {
    return;
  }

  if (section.id) {
    renderSectionContent(section.id);
  }

  if (event.type === "keydown") {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
  }

  toggleSectionCollapsed(section);
}

function setupSectionToggle() {
  if (sectionToggleBound) {
    return;
  }
  document.addEventListener("click", handleSectionHeaderToggle);
  document.addEventListener("keydown", handleSectionHeaderToggle);
  sectionToggleBound = true;
}

function updateSidebarArrow(sectionId, isCollapsed) {
  const arrow = document.querySelector(
    `.sidebar .nav-arrow[data-section="${sectionId}"]`,
  );

  if (arrow) {
    arrow.classList.toggle("collapsed", !!isCollapsed);
  }

  const sublist = document.querySelector(
    `.sidebar .sub-list[data-parent-section="${sectionId}"]`,
  );
  if (sublist) {
    sublist.classList.toggle("collapsed", !!isCollapsed);
  }
}

function setupSidebarLinks() {
  if (!sidebarLinksBound) {
    const sidebar = document.getElementById("sidebar");
    if (sidebar) {
      sidebar.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }

        const arrow = target.closest("#toc-list .nav-arrow");
        if (arrow) {
          event.preventDefault();
          const sectionId = arrow.getAttribute("data-section");
          const section = document.getElementById(sectionId);
          if (!section) {
            return;
          }
          toggleSectionCollapsed(section);
          return;
        }

        const link = target.closest("#toc-list a[href^='#'], .toc-header a[href^='#']");
        if (!link) {
          return;
        }

        const hash = appGetInternalHashFromLink(link);
        if (!hash) {
          return;
        }

        if (window.matchMedia("(max-width: 860px)").matches) {
          if (typeof window.setTocOpen === "function") {
            window.setTocOpen(false);
          }
        }
      });
      sidebarLinksBound = true;
    }
  }

  const sections = document.querySelectorAll(".section");
  sections.forEach((section) => {
    const sectionId = section.id;
    const isCollapsed = section.classList.contains("collapsed");
    updateSidebarArrow(sectionId, isCollapsed);
  });
}

// Restore scroll position
function restoreScrollPosition() {
  document.documentElement.style.scrollBehavior = "auto";
  // if we have a hash, scroll to it
  if (window.location.hash) {
    scrollToSection(window.location.hash, "auto");
  }
  document.documentElement.style.scrollBehavior = "";
  // Now allow hash updates
  hashUpdateEnabled = true;
}
