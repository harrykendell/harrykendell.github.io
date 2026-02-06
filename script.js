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

const SECTION_GROUPS = {
  order: ["maintenance", "repairs", "supplement"],
  labels: {
    maintenance: "Maintenance",
    repairs: "Repairs",
    supplement: "Supplement",
  },
};

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

function getEffectiveTocLevel() {
  return Math.min(6, tocDepth + 1);
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
      setInitialSectionState(sectionEl);
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

  // Setup click handlers after all sections are loaded
  setupSectionToggle();
  initTocDepth();
  generateSidebar();
  setupSidebarLinks();
  setupTocDepthControl();
  setupTocToggle();
  setupActiveTracking();

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
    preface.innerHTML = marked.parse(content);
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
  return "guides";
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


document.addEventListener("click", function (event) {
  const hash = event.target.hash;
  if (hash) {
    scrollToSection(hash)
    event.preventDefault();
  }
});

function generateSidebar() {
  const sections = document.querySelectorAll(".section");
  const sidebarList = document.querySelector(".sidebar ul");

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
  const headings = document.querySelectorAll(
    ".section[id], .section .section-content h2[id], .section .section-content h3[id], .section .section-content h4[id], .section .section-content h5[id], .section .section-content h6[id]",
  );
  function isCollapsedHeading(heading) {
    if (heading.classList && heading.classList.contains("section")) {
      return false;
    }

    const parentSection = heading.closest(".section");
    return parentSection
      ? parentSection.classList.contains("collapsed")
      : false;
  }

  function updateActiveLink() {
    const sidebarLinks = sidebarLinksCache;
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

    sidebarLinks.forEach((link) => link.classList.remove("active"));

    if (activeElement) {
      let activeLink;
      activeLink = document.querySelector(
        `.sidebar a[href="#${activeElement.id}"]`,
      );

      if (activeLink) {
        activeLink.classList.add("active");
        // Update the URL hash to match the active heading, but only if it changed and hash updates are enabled
        if (hashUpdateEnabled && window.location.hash !== `#${activeElement.id}`) {
          history.replaceState(null, document.title, `#${activeElement.id}`);
        }
      }
    } else {
      const contentsLink = document.querySelector(
        '.sidebar a[href="#top"]',
      );
      if (contentsLink) {
        contentsLink.classList.add("active");
        if (hashUpdateEnabled && window.location.hash !== "#top") {
          history.replaceState(null, document.title, `#top`);
        }
      }
    }
  }

  window.updateActiveLink = updateActiveLink;

  // Debounce scroll listener for better performance
  let scrollTimeout;
  window.addEventListener(
    "scroll",
    () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(updateActiveLink, 10);
    },
    { passive: true },
  );
  updateActiveLink();
}

function scrollToSection(hash, behavior = "smooth") {
  const targetId = hash.startsWith("#") ? hash.slice(1) : hash;
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
  console.log("Scrolled to section:", targetId);
  console.groupEnd();
  return true;
}

function setInitialSectionState(section) {
  const header = section.querySelector(".section-header");
  const sectionId = section.id;
  if (sectionId) {
    const state = localStorage.getItem(`section-${sectionId}`);
    if (state === "expanded") {
      section.classList.remove("collapsed");
    } else {
      section.classList.add("collapsed");
    }
  } else {
    // If no ID, collapse by default
    section.classList.add("collapsed");
  }

  if (header) {
    header.setAttribute(
      "aria-expanded",
      String(!section.classList.contains("collapsed")),
    );
  }
}

function setupSectionToggle() {
  const sections = document.querySelectorAll(".section");

  sections.forEach((section) => {
    const header = section.querySelector(".section-header");

    if (header) {
      const toggleSection = () => {
        section.classList.toggle("collapsed");
        const isCollapsed = section.classList.contains("collapsed");
        header.setAttribute("aria-expanded", String(!isCollapsed));

        // Store preference in localStorage
        const sectionId = section.id;
        if (sectionId) {
          localStorage.setItem(
            `section-${sectionId}`,
            isCollapsed ? "collapsed" : "expanded",
          );
          // Update sidebar arrow
          updateSidebarArrow(sectionId, isCollapsed);
          if (typeof window.updateActiveLink === "function") {
            window.updateActiveLink();
          }
        }
      };

      header.addEventListener("click", toggleSection);
      header.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleSection();
        }
      });
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
  const sidebarLinks = document.querySelectorAll(".sidebar a");
  const sidebarArrows = document.querySelectorAll(".sidebar .nav-arrow");

  sidebarArrows.forEach((arrow) => {
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

      localStorage.setItem(`section-${sectionId}`, isCollapsed ? "collapsed" : "expanded");
      updateSidebarArrow(sectionId, isCollapsed);
      window.updateActiveLink();
    });
  });

  sidebarLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      const href = link.getAttribute("href");
      if (href && href.startsWith("#")) {
        e.preventDefault();

        if (window.matchMedia("(max-width: 860px)").matches) {
          if (typeof window.setTocOpen === "function") {
            window.setTocOpen(false);
          }
        }
      }
    });
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
