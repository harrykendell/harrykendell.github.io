const sectionFiles = [
  "introduction",
  "hardware",
  "boats",
  "oars",
  "gates",
  "footplates",
  "seats",
  "coxbox-wiring",
  // "test",
];

const DEFAULT_TOC_DEPTH = 4;
const MIN_TOC_DEPTH = 1;
const MAX_TOC_DEPTH = 5;
let tocDepth = DEFAULT_TOC_DEPTH;
let sidebarLinksCache = [];
const ACTIVATION_OFFSET = 120;

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

  for (const section of sectionFiles) {
    try {
      const response = await fetch(`sections/${section}.md`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const markdown = await response.text();
      const sectionEl = markdownToSection(markdown, section);
      container.appendChild(sectionEl);

      // Set initial state immediately after insertion to prevent flash
      setInitialSectionState(sectionEl);
    } catch (error) {
      console.error(`Failed to load section: ${section}`, error);
    }
  }

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
    mainContent.classList.toggle("toc-dim", expanded);
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
}

document.addEventListener("DOMContentLoaded", () => {
  loadSections();
});

function generateSidebar() {
  const sections = document.querySelectorAll(".section");
  const sidebarList = document.querySelector(".sidebar ul");

  const effectiveDepth = getEffectiveTocLevel();
  const sidebarHtml = Array.from(sections).map((section) => {
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

    if (visibleHeadings.length > 0) {
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

    return `
      <li>
          <div class="nav-row">
              <button class="nav-arrow" type="button" data-section="${safeSectionId}" aria-hidden="true" disabled>⚫︎</button>
              <a href="#${safeSectionId}" data-section="${safeSectionId}">${safeSectionTitle}</a>
          </div>
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
      if (
        activeElement.tagName === "H2" ||
        activeElement.tagName === "H3" ||
        activeElement.tagName === "H4" ||
        activeElement.tagName === "H5" ||
        activeElement.tagName === "H6"
      ) {
        activeLink = document.querySelector(
          `.sidebar a[href="#${activeElement.id}"]`,
        );
      } else {
        activeLink = document.querySelector(
          `.sidebar a[data-section="${activeElement.id}"]`,
        );
      }
      if (activeLink) {
        activeLink.classList.add("active");
      }
    } else {
      const contentsLink = document.querySelector(
        '.sidebar a[href="#top"]',
      );
      if (contentsLink) {
        contentsLink.classList.add("active");
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
      scrollTimeout = setTimeout(updateActiveLink, 50);
    },
    { passive: true },
  );
  updateActiveLink();
}

function scrollToSection(hash) {

  const targetTop = document
    .getElementById(hash.slice(1))
    .getBoundingClientRect().top + window.scrollY;

  window.scrollTo({ top: Math.max(targetTop - ACTIVATION_OFFSET + 5, 0), behavior: "smooth" });
}

function setInitialSectionState(section) {
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
}

function setupSectionToggle() {
  const sections = document.querySelectorAll(".section");

  sections.forEach((section) => {
    const header = section.querySelector(".section-header");

    if (header) {
      header.addEventListener("click", () => {
        section.classList.toggle("collapsed");

        // Store preference in localStorage
        const sectionId = section.id;
        if (sectionId) {
          const isCollapsed = section.classList.contains("collapsed");
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
      const sectionId = arrow.getAttribute("data-section");
      const section = document.getElementById(sectionId);

      section.classList.toggle("collapsed");
      const isCollapsed = section.classList.contains("collapsed");

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

        const targetSectionId =
          link.getAttribute("data-parent") ||
          link.getAttribute("data-section");

        if (targetSectionId) {
          const section = document.getElementById(targetSectionId);
          if (section && section.classList.contains("section")) {
            const wasCollapsed =
              section.classList.contains("collapsed");

            if (wasCollapsed) {
              section.classList.remove("collapsed");
              localStorage.setItem(
                `section-${targetSectionId}`,
                "expanded",
              );
              updateSidebarArrow(targetSectionId, false);
            }

            if (typeof window.updateActiveLink === "function") {
              // Always refresh highlight after navigation
              window.updateActiveLink();
            }
          }
        }

        if (window.matchMedia("(max-width: 860px)").matches) {
          if (typeof window.setTocOpen === "function") {
            window.setTocOpen(false);
          }
        }

        scrollToSection(href);
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

// Save scroll position before unload
window.addEventListener("beforeunload", () => {
  sessionStorage.setItem("scrollPosition", window.scrollY);
});

// Restore scroll position
function restoreScrollPosition() {
  const scrollPosition = sessionStorage.getItem("scrollPosition");

  document.documentElement.style.scrollBehavior = "auto";
  if (scrollPosition !== null) {
    window.scrollTo(0, parseInt(scrollPosition));
  }
  document.documentElement.style.scrollBehavior = "auto";
}
