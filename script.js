// Prevent hash updates until after initial scroll restoration
let hashUpdateEnabled = false;
const sectionFiles = [
  "maintenance/rigging",
  "maintenance/boats",
  "maintenance/oars",
  "maintenance/gates",
  "maintenance/footplates",
  "maintenance/seats",
  "maintenance/coxbox-wiring",
  "maintenance/hardware",
  "repairs/boat-composites",
  "repairs/oars",
  "repairs/coxbox-wiring",
  "supplement/quick-reference-checklists",
  "supplement/tools-and-consumables",
];

const DEFAULT_TOC_DEPTH = 4;
const MIN_TOC_DEPTH = 1;
const MAX_TOC_DEPTH = 5;
let tocDepth = DEFAULT_TOC_DEPTH;
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
  normalizeHashValue: appNormalizeHashValue,
  replaceUrlState: appReplaceUrlState,
  getInternalHashFromLink: appGetInternalHashFromLink,
  normalizeInternalHashLinks: appNormalizeInternalHashLinks,
} = window.AppUtils;

function getEffectiveTocLevel() {
  return Math.min(6, tocDepth + 1);
}

function setupSearchBar() {
  if (!window.SearchBar || typeof window.SearchBar.setup !== "function") {
    return;
  }
  window.SearchBar.setup();
}

function refreshSearchBarIndex() {
  if (!window.SearchBar || typeof window.SearchBar.refreshIndex !== "function") {
    return;
  }
  window.SearchBar.refreshIndex();
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

  window.setTimeout(task, 0);
}

async function loadSections() {
  const container = document.getElementById("sections-container");
  if (!container) {
    return;
  }

  let currentGroup = null;
  const groupLabels = SECTION_GROUPS.labels;

  const loadedSections = await Promise.all(sectionFiles.map(async (section) => {
    try {
      const response = await fetch(`sections/${section}.md`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const markdown = await response.text();
      const sectionEl = markdownToSection(markdown, section);
      return { section, sectionEl };
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

    const { section, sectionEl } = loadedSection;
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
  });

  container.appendChild(fragment);
  appNormalizeInternalHashLinks(container);

  // Setup click handlers after all sections are loaded
  setupSectionToggle();
  initTocDepth();
  generateSidebar();
  setupSidebarLinks();
  setupTocDepthControl();
  setupTocToggle();
  setupSearchBar();

  // Restore scroll position after sections are loaded
  restoreScrollPosition();

  // Defer active tracking setup so first paint (sections + TOC) is not blocked.
  window.requestAnimationFrame(() => {
    setupActiveTracking();
  });
}

async function loadPreface() {
  const preface = document.getElementById("preface-content");
  if (!preface) {
    return;
  }

  try {
    const response = await fetch("sections/supplement/introduction.md");
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const markdown = await response.text();
    const titleAndContent = typeof extractTitleAndContentFromMarkdown === "function"
      ? extractTitleAndContentFromMarkdown(markdown)
      : { content: markdown };
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

    if (typeof marked !== "undefined" && typeof marked.parse === "function") {
      preface.innerHTML = marked.parse(content);
    } else {
      preface.textContent = content;
    }
    if (typeof addHeadingIds === "function") {
      addHeadingIds(preface, "preface");
    }
    appNormalizeInternalHashLinks(preface);
    wrapTables(preface);
    if (typeof optimizeSectionMedia === "function") {
      optimizeSectionMedia(preface);
    }
  } catch (error) {
    console.error("Failed to load preface introduction", error);
  }
}

function initTocDepth() {
  const stored = parseInt(localStorage.getItem("toc-depth"), 10);
  if (!Number.isNaN(stored) && stored >= MIN_TOC_DEPTH && stored <= MAX_TOC_DEPTH) {
    tocDepth = stored;
  } else {
    tocDepth = DEFAULT_TOC_DEPTH;
  }
}

function setTocDepth(depth) {
  tocDepth = depth;
  localStorage.setItem("toc-depth", String(depth));
}

function refreshSidebarLinksCache() {
  sidebarLinksCache = Array.from(
    document.querySelectorAll(".sidebar a[href^='#']"));
}

function setupTocDepthControl() {
  const control = document.getElementById("toc-depth");
  if (!control) {
    return;
  }

  if (control.options.length === 0) {
    for (let value = MIN_TOC_DEPTH; value <= MAX_TOC_DEPTH; value += 1) {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = String(value);
      control.appendChild(option);
    }
  }

  control.value = String(tocDepth);

  control.addEventListener("change", () => {
    const nextDepth = parseInt(control.value, 10);
    if (!Number.isNaN(nextDepth) && nextDepth >= MIN_TOC_DEPTH && nextDepth <= MAX_TOC_DEPTH) {
      setTocDepth(nextDepth);
      generateSidebar();
      setupSidebarLinks();
      if (typeof window.updateActiveLink === "function") {
        window.updateActiveLink();
      }
    }
  });
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

function renderSectionNavItem(section, effectiveDepth) {
  const sectionId = section.id;
  const sectionTitle = section.querySelector("h2").textContent;
  const safeSectionId = escapeAttribute(sectionId);
  const safeSectionTitle = escapeHtml(sectionTitle);

  const headings = section.querySelectorAll(
    ".section-content h2[id], .section-content h3[id], .section-content h4[id], .section-content h5[id], .section-content h6[id]",
  );
  const visibleHeadings = Array.from(headings).filter((heading) => {
    const level = parseInt(heading.tagName.slice(1), 10);
    return !Number.isNaN(level) && level <= effectiveDepth;
  });

  const subItems = visibleHeadings.map((heading) => {
    const headingId = escapeAttribute(heading.id);
    const headingText = escapeHtml(heading.textContent);
    const level = parseInt(heading.tagName.slice(1), 10);
    const levelClass = !Number.isNaN(level) ? ` toc-level-${level}` : "";
    return `
            <li class="sub${levelClass}">
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
  renderInitialSidebar();
  setupSidebarLinks();

  await Promise.all([loadPreface(), loadSections()]);
  scheduleNonCriticalWork(() => {
    refreshSearchBarIndex();
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

  const effectiveDepth = getEffectiveTocLevel();

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
      .map((section) => renderSectionNavItem(section, effectiveDepth))
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
    ".section[id], .section .section-content h2[id], .section .section-content h3[id], .section .section-content h4[id], .section .section-content h5[id], .section .section-content h6[id]",
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

    const effectiveDepth = getEffectiveTocLevel();

    headings.forEach((heading) => {
      if (isCollapsedHeading(heading)) {
        return;
      }

      const tagName = heading.tagName || "";
      if (/^H[2-6]$/.test(tagName)) {
        const level = parseInt(tagName.slice(1), 10);
        if (!Number.isNaN(level) && level > effectiveDepth) {
          return;
        }
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

  if ("IntersectionObserver" in window) {
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
  } else {
    console.warn("IntersectionObserver not supported - active link tracking may be less accurate and more resource-intensive.");
    // Fallback for very old browsers without IntersectionObserver.
    let scrollTimeout;
    activeTrackingScrollHandler = () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(updateActiveLink, 10);
    };
    window.addEventListener("scroll", activeTrackingScrollHandler, { passive: true });
  }

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

  const targetElement = document.getElementById(targetId);
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

  if (target.closest(".section-edit-link")) {
    return;
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
