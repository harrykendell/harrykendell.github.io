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
let tocDepth = DEFAULT_TOC_DEPTH;
let sidebarLinksCache = [];
const ACTIVATION_OFFSET = 120;

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
  initLazyYouTubeEmbeds();

  // Restore scroll position after sections are loaded
  restoreScrollPosition();
}

function initTocDepth() {
  const stored = parseInt(localStorage.getItem("toc-depth"), 10);
  if (!Number.isNaN(stored) && stored >= 1 && stored <= 6) {
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
    document.querySelectorAll(".sidebar a[href^='#']")
  );
}

function setupTocDepthControl() {
  const control = document.getElementById("toc-depth");
  if (!control) {
    return;
  }

  control.value = String(tocDepth);

  control.addEventListener("change", () => {
    const nextDepth = parseInt(control.value, 10);
    if (!Number.isNaN(nextDepth) && nextDepth >= 1 && nextDepth <= 6) {
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

  const isMobile = () => window.matchMedia("(max-width: 860px)").matches;

  const setExpanded = (expanded) => {
    toggleButton.setAttribute("aria-expanded", expanded ? "true" : "false");
    sidebar.classList.toggle("is-open", expanded);
    if (mainContent) {
      const shouldDim = expanded && isMobile();
      mainContent.classList.toggle("toc-dim", shouldDim);
    }
  };

  window.setTocOpen = setExpanded;

  if (isMobile()) {
    setExpanded(false);
  } else {
    setExpanded(true);
  }

  toggleButton.addEventListener("click", () => {
    const isOpen = sidebar.classList.contains("is-open");
    setExpanded(!isOpen);
  });

  document.addEventListener("click", (event) => {
    if (!isMobile()) {
      return;
    }

    if (!sidebar.classList.contains("is-open")) {
      return;
    }

    const target = event.target;
    const clickedInsideSidebar = sidebar.contains(target);
    const clickedToggle = toggleButton.contains(target);

    if (!clickedInsideSidebar && !clickedToggle) {
      setExpanded(false);
    }
  });

  window.addEventListener("resize", () => {
    if (isMobile()) {
      setExpanded(false);
    } else {
      setExpanded(true);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  loadSections();
});

function initLazyYouTubeEmbeds() {
  const buttons = document.querySelectorAll(".youtube-embed__button");
  buttons.forEach((button) => {
    if (button.dataset.bound === "true") {
      return;
    }

    button.dataset.bound = "true";
    button.addEventListener("click", () => {
      const wrapper = button.closest(".youtube-embed");
      if (!wrapper) {
        return;
      }

      const iframe = wrapper.querySelector("iframe");
      if (!iframe) {
        return;
      }

      const src = iframe.getAttribute("data-src");
      if (!src) {
        return;
      }

      iframe.setAttribute("src", src);
      wrapper.classList.add("is-playing");
      button.setAttribute("aria-hidden", "true");
      button.disabled = true;
    });
  });
}

function generateSidebar() {
  const sections = document.querySelectorAll(".section");
  const sidebarList = document.querySelector(".sidebar ul");

  // Debugging helpers to trace sidebar generation
  console.groupCollapsed("Sidebar: generate");
  console.debug("Sidebar: sections found", sections.length);
  if (!sidebarList) {
    console.error("Sidebar: sidebar list element not found");
    console.groupEnd();
    return;
  }

  // Clear existing sidebar content
  sidebarList.innerHTML = "";

  sections.forEach((section) => {
    const sectionId = section.id;
    if (!sectionId) {
      console.warn("Sidebar: section missing id", section);
      return;
    }

    // Get section title from h2
    const titleElement = section.querySelector("h2");
    if (!titleElement) {
      console.warn("Sidebar: section missing h2", sectionId);
      return;
    }
    const sectionTitle = titleElement.textContent;

    // Create main list item
    const li = document.createElement("li");
    const navRow = document.createElement("div");
    navRow.className = "nav-row";

    const arrow = document.createElement("button");
    arrow.className = "nav-arrow";
    arrow.type = "button";
    arrow.setAttribute("data-section", sectionId);
    arrow.setAttribute("aria-label", "Toggle section");

    const a = document.createElement("a");
    a.href = `#${sectionId}`;
    a.setAttribute("data-section", sectionId);

    // Create sub-list for content headings if any exist
    const headings = section.querySelectorAll(
      ".section-content h2[id], .section-content h3[id], .section-content h4[id], .section-content h5[id], .section-content h6[id]"
    );
    const effectiveDepth = getEffectiveTocLevel();
    const visibleHeadings = Array.from(headings).filter((heading) => {
      const level = parseInt(heading.tagName.slice(1), 10);
      return !Number.isNaN(level) && level <= effectiveDepth;
    });

    if (visibleHeadings.length > 0) {
      arrow.textContent = "▼";
      navRow.appendChild(arrow);
      a.appendChild(document.createTextNode(sectionTitle));
      navRow.appendChild(a);
      li.appendChild(navRow);

      const subList = document.createElement("ul");
      subList.className = "sub-list";
      subList.setAttribute("data-parent-section", sectionId);

      visibleHeadings.forEach((heading) => {
        const headingId = heading.id;
        const headingText = heading.textContent;
        const level = parseInt(heading.tagName.slice(1), 10);

        const subLi = document.createElement("li");
        subLi.className = "sub";
        if (!Number.isNaN(level)) {
          subLi.classList.add(`toc-level-${level}`);
        }
        const subA = document.createElement("a");
        subA.href = `#${headingId}`;
        subA.textContent = headingText;
        subA.setAttribute("data-parent", sectionId);
        subLi.appendChild(subA);
        subList.appendChild(subLi);
      });

      li.appendChild(subList);
    } else {
      arrow.textContent = "⚫︎";
      arrow.setAttribute("aria-hidden", "true");
      arrow.disabled = true;
      navRow.appendChild(arrow);
      a.appendChild(document.createTextNode(sectionTitle));
      navRow.appendChild(a);
      li.appendChild(navRow);
    }

    sidebarList.appendChild(li);
  });

  console.debug(
    "Sidebar: items rendered",
    sidebarList.querySelectorAll("li").length
  );
  console.groupEnd();
  refreshSidebarLinksCache();
}

function setupActiveTracking() {
  const headings = document.querySelectorAll(
    ".section[id], .section .section-content h2[id], .section .section-content h3[id], .section .section-content h4[id], .section .section-content h5[id], .section .section-content h6[id]"
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
          `.sidebar a[href="#${activeElement.id}"]`
        );
      } else {
        activeLink = document.querySelector(
          `.sidebar a[data-section="${activeElement.id}"]`
        );
      }
      if (activeLink) {
        activeLink.classList.add("active");
      }
    } else {
      const contentsLink = document.querySelector('.sidebar a[href="#top"]');
      if (contentsLink) {
        contentsLink.classList.add("active");
      }
    }
  }

  window.updateActiveLink = updateActiveLink;

  window.addEventListener("scroll", updateActiveLink, { passive: true });
  updateActiveLink();
}

function scrollToSection(hash) {
  if (!hash || !hash.startsWith("#")) {
    return;
  }

  const target = document.getElementById(hash.slice(1));
  if (!target) {
    return;
  }

  const targetTop = target.getBoundingClientRect().top + window.scrollY;
  const destination = Math.max(targetTop - ACTIVATION_OFFSET + 5, 0);

  window.scrollTo({ top: destination, behavior: "smooth" });

  if (typeof history.replaceState === "function") {
    history.replaceState(null, "", hash);
  }
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
            isCollapsed ? "collapsed" : "expanded"
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
    `.sidebar .nav-arrow[data-section="${sectionId}"]`
  );

  if (arrow) {
    arrow.classList.toggle("collapsed", !!isCollapsed);
  }

  const sublist = document.querySelector(
    `.sidebar .sub-list[data-parent-section="${sectionId}"]`
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
      e.stopPropagation();

      const sectionId = arrow.getAttribute("data-section");
      const section = document.getElementById(sectionId);

      if (section && section.classList.contains("section")) {
        const isCurrentlyCollapsed = section.classList.contains("collapsed");

        if (isCurrentlyCollapsed) {
          section.classList.remove("collapsed");
          localStorage.setItem(`section-${sectionId}`, "expanded");
          updateSidebarArrow(sectionId, false);
        } else {
          section.classList.add("collapsed");
          localStorage.setItem(`section-${sectionId}`, "collapsed");
          updateSidebarArrow(sectionId, true);
        }
        if (typeof window.updateActiveLink === "function") {
          window.updateActiveLink();
        }
      }
    });
  });

  sidebarLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      const href = link.getAttribute("href");
      if (href && href.startsWith("#")) {
        e.preventDefault();

        const targetSectionId =
          link.getAttribute("data-parent") || link.getAttribute("data-section");

        if (targetSectionId) {
          const section = document.getElementById(targetSectionId);
          if (section && section.classList.contains("section")) {
            const wasCollapsed = section.classList.contains("collapsed");

            if (wasCollapsed) {
              section.classList.remove("collapsed");
              localStorage.setItem(`section-${targetSectionId}`, "expanded");
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
