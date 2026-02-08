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
  "repairs/boats-composites",
  "repairs/oars",
  "repairs/electronics-harness",
  "supplement/QuickReferenceChecklists",
  "supplement/ToolsAndConsumables",
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

const SECTION_GROUPS = {
  order: ["maintenance", "repairs", "supplement"],
  labels: {
    maintenance: "Maintenance",
    repairs: "Repairs",
    supplement: "Supplement",
  },
};

const CONTENT_REPO_OWNER = "harrykendell";
const CONTENT_REPO_NAME = "harrykendell.github.io";
const CONTENT_REPO_BRANCH = "main";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function getGitHubEditUrl(relativePath) {
  const cleanPath = String(relativePath || "").replace(/^\/+/, "");
  if (!cleanPath) {
    return null;
  }

  const owner = encodeURIComponent(CONTENT_REPO_OWNER);
  const repo = encodeURIComponent(CONTENT_REPO_NAME);
  const branch = encodeURIComponent(CONTENT_REPO_BRANCH);
  const path = cleanPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `https://github.com/${owner}/${repo}/edit/${branch}/${path}`;
}

window.getGitHubEditUrl = getGitHubEditUrl;

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
  normalizeInternalHashLinks(container);

  // Setup click handlers after all sections are loaded
  setupSectionToggle();
  initTocDepth();
  generateSidebar();
  setupSidebarLinks();
  setupTocDepthControl();
  setupTocToggle();
  setupActiveTracking();
  setupSearchBar();
  refreshSearchBarIndex();

  // Restore scroll position after sections are loaded
  restoreScrollPosition();
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
    const { content } = extractTitleAndContentFromMarkdown(markdown);
    const introEditUrl = getGitHubEditUrl("sections/supplement/introduction.md");
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

    preface.innerHTML = marked.parse(content);
    if (typeof addHeadingIds === "function") {
      addHeadingIds(preface, "preface");
    }
    normalizeInternalHashLinks(preface);
    wrapTables(preface);
    if (typeof optimizeSectionMedia === "function") {
      optimizeSectionMedia(preface);
    }
    refreshSearchBarIndex();
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
  return "ERROR_UNKNOWN_GROUP";
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

document.addEventListener("DOMContentLoaded", () => {
  loadPreface();
  loadSections();
});


function normalizeHashValue(hash) {
  if (!hash || typeof hash !== "string") {
    return null;
  }

  const rawValue = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!rawValue) {
    return null;
  }

  let decodedValue = rawValue;
  try {
    decodedValue = decodeURIComponent(rawValue);
  } catch (error) {
    decodedValue = rawValue;
  }

  return decodedValue ? `#${decodedValue}` : null;
}

function replaceUrlState(nextHash) {
  const url = new URL(window.location.href);
  url.hash = nextHash || "";
  history.replaceState(null, document.title, `${url.pathname}${url.search}${url.hash}`);
}

function getInternalHashFromLink(link) {
  if (!link) {
    return null;
  }

  const href = link.getAttribute("href");
  if (!href) {
    return null;
  }

  if (href.startsWith("#") || href.startsWith("/#")) {
    const hashIndex = href.indexOf("#");
    return normalizeHashValue(href.slice(hashIndex));
  }

  try {
    const url = new URL(href, window.location.href);
    if (!url.hash || url.origin !== window.location.origin) {
      return null;
    }

    const currentPath = window.location.pathname.replace(/\/+$/, "") || "/";
    const targetPath = url.pathname.replace(/\/+$/, "") || "/";
    if (targetPath !== currentPath) {
      return null;
    }

    return normalizeHashValue(url.hash);
  } catch (error) {
    return null;
  }
}

function normalizeInternalHashLinks(rootEl) {
  if (!rootEl) {
    return;
  }

  const links = Array.from(rootEl.querySelectorAll("a[href]"));
  links.forEach((link) => {
    const hash = getInternalHashFromLink(link);
    if (hash) {
      link.setAttribute("href", hash);
    }
  });
}

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

  const hash = getInternalHashFromLink(link);
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
          replaceUrlState(`#${activeElement.id}`);
        }
      }
    } else {
      const contentsLink = document.querySelector(
        '.sidebar a[href="#top"]',
      );
      if (contentsLink) {
        contentsLink.classList.add("active");
        if (hashUpdateEnabled && window.location.hash !== "#top") {
          replaceUrlState("#top");
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
  const normalizedHash = normalizeHashValue(hash);
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
    const header = parentSection.querySelector(".section-header");
    if (header) {
      header.click();
    }
  }

  const targetTop = targetElement.getBoundingClientRect().top + window.scrollY;
  window.scrollTo({
    top: Math.max(targetTop - ACTIVATION_OFFSET + 5, 0),
    behavior,
  });
  return true;
}

function setupSectionToggle() {
  const sections = document.querySelectorAll(".section");

  sections.forEach((section) => {
    const header = section.querySelector(".section-header");

    if (header) {
      if (header.dataset.toggleBound === "true") {
        return;
      }

      const toggleSection = () => {
        section.classList.toggle("collapsed");
        const isCollapsed = section.classList.contains("collapsed");
        header.setAttribute("aria-expanded", String(!isCollapsed));

        const sectionId = section.id;
        if (sectionId) {
          updateSidebarArrow(sectionId, isCollapsed);
          if (typeof window.updateActiveLink === "function") {
            window.updateActiveLink();
          }
        }
      };

      header.addEventListener("click", (event) => {
        if (event.target instanceof Element && event.target.closest(".section-edit-link")) {
          return;
        }
        toggleSection();
      });
      header.addEventListener("keydown", (event) => {
        if (event.target instanceof Element && event.target.closest(".section-edit-link")) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleSection();
        }
      });
      header.dataset.toggleBound = "true";
    }
  });
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
  const sidebarLinks = document.querySelectorAll("#toc-list a, .toc-header a[href^='#']");
  const sidebarArrows = document.querySelectorAll("#toc-list .nav-arrow");

  sidebarArrows.forEach((arrow) => {
    if (arrow.dataset.sidebarBound === "true") {
      return;
    }
    arrow.addEventListener("click", (e) => {
      e.preventDefault();
      const sectionId = arrow.getAttribute("data-section");
      const section = document.getElementById(sectionId);
      if (!section) {
        return;
      }

      section.classList.toggle("collapsed");
      const isCollapsed = section.classList.contains("collapsed");
      const header = section.querySelector(".section-header");
      if (header) {
        header.setAttribute("aria-expanded", String(!isCollapsed));
      }

      updateSidebarArrow(sectionId, isCollapsed);
      window.updateActiveLink();
    });
    arrow.dataset.sidebarBound = "true";
  });

  sidebarLinks.forEach((link) => {
    if (link.dataset.sidebarBound === "true") {
      return;
    }
    link.addEventListener("click", () => {
      const hash = getInternalHashFromLink(link);
      if (!hash) {
        return;
      }

      if (window.matchMedia("(max-width: 860px)").matches) {
        if (typeof window.setTocOpen === "function") {
          window.setTocOpen(false);
        }
      }
    });
    link.dataset.sidebarBound = "true";
  });

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
