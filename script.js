const sectionFiles = [
  "hardware",
  "boats",
  "oars",
  "gates",
  "footplates",
  "seats",
  "coxbox-wiring",
];

// Mobile menu toggle
function setupMobileMenu() {
  const menuToggle = document.getElementById("menuToggle");
  const sidebar = document.getElementById("sidebar");
  const layout = document.getElementById("layout");

  if (!menuToggle || !sidebar) return;

  menuToggle.addEventListener("click", () => {
    menuToggle.classList.toggle("active");
    sidebar.classList.toggle("active");
  });

  // Close menu when a link is clicked
  const sidebarLinks = sidebar.querySelectorAll("a");
  sidebarLinks.forEach((link) => {
    link.addEventListener("click", () => {
      menuToggle.classList.remove("active");
      sidebar.classList.remove("active");
    });
  });

  // Close menu when clicking outside
  document.addEventListener("click", (e) => {
    if (!sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
      menuToggle.classList.remove("active");
      sidebar.classList.remove("active");
    }
  });
}

async function loadSections() {
  const container = document.getElementById("sections-container");

  for (const section of sectionFiles) {
    try {
      const response = await fetch(`sections/${section}.html`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const html = await response.text();
      container.insertAdjacentHTML("beforeend", html);

      // Set initial state immediately after insertion to prevent flash
      const lastSection = container.lastElementChild;
      if (lastSection && lastSection.classList.contains("section")) {
        setInitialSectionState(lastSection);
      }
    } catch (error) {
      console.error(`Failed to load section: ${section}`, error);
    }
  }

  // Setup click handlers after all sections are loaded
  setupSectionToggle();
  generateSidebar();
  setupSidebarLinks();
  setupActiveTracking();

  // Restore scroll position after sections are loaded
  restoreScrollPosition();
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
    const a = document.createElement("a");
    a.href = `#${sectionId}`;
    a.setAttribute("data-section", sectionId);

    // Add arrow for all sections
    const arrow = document.createElement("span");
    arrow.className = "nav-arrow";
    arrow.textContent = "▼";
    a.appendChild(arrow);

    a.appendChild(document.createTextNode(sectionTitle));
    li.appendChild(a);

    // Create sub-list for h3 headings if any exist
    const headings = section.querySelectorAll("h3[id]");
    if (headings.length > 0) {
      const subList = document.createElement("ul");
      subList.className = "sub-list";
      subList.setAttribute("data-parent-section", sectionId);

      headings.forEach((heading) => {
        const headingId = heading.id;
        const headingText = heading.textContent;

        const subLi = document.createElement("li");
        subLi.className = "sub";
        const subA = document.createElement("a");
        subA.href = `#${headingId}`;
        subA.textContent = headingText;
        subA.setAttribute("data-parent", sectionId);
        subLi.appendChild(subA);
        subList.appendChild(subLi);
      });

      li.appendChild(subList);
    }

    sidebarList.appendChild(li);
  });

  console.debug("Sidebar: items rendered", sidebarList.children.length);
  console.groupEnd();
}

function setupActiveTracking() {
  const sidebarLinks = document.querySelectorAll(".sidebar a[href^='#']");
  const headings = document.querySelectorAll(".section[id], .section h3[id]");
  const ACTIVATION_OFFSET = 120;

  function updateActiveLink() {
    const targetLine = window.scrollY + ACTIVATION_OFFSET;
    let activeElement = null;
    let nearestTop = -Infinity;

    headings.forEach((heading) => {
      const rect = heading.getBoundingClientRect();
      const absoluteTop = window.scrollY + rect.top;

      if (absoluteTop <= targetLine && absoluteTop > nearestTop) {
        activeElement = heading;
        nearestTop = absoluteTop;
      }
    });

    if (!activeElement && headings.length) {
      activeElement = headings[0];
    }

    sidebarLinks.forEach((link) => link.classList.remove("active"));

    if (activeElement) {
      let activeLink;
      if (activeElement.tagName === "H3") {
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
    }
  }

  window.addEventListener("scroll", updateActiveLink, { passive: true });
  updateActiveLink();
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
        }
      });
    }
  });
}

function updateSidebarArrow(sectionId, isCollapsed) {
  const link = document.querySelector(
    `.sidebar a[data-section="${sectionId}"]`
  );
  if (link) {
    if (isCollapsed) {
      link.classList.add("collapsed");
    } else {
      link.classList.remove("collapsed");
    }
  }

  // Also update the sublist visibility
  const sublist = document.querySelector(
    `.sidebar .sub-list[data-parent-section="${sectionId}"]`
  );
  if (sublist) {
    if (isCollapsed) {
      sublist.classList.add("collapsed");
    } else {
      sublist.classList.remove("collapsed");
    }
  }
}

function setupSidebarLinks() {
  const sidebarLinks = document.querySelectorAll(".sidebar a");

  sidebarLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      const href = link.getAttribute("href");
      if (href && href.startsWith("#")) {
        // Check if this is a subheading
        const parentSection = link.getAttribute("data-parent");

        if (parentSection) {
          // Expand parent section for subheadings (always expand, don't toggle)
          const section = document.getElementById(parentSection);
          if (section && section.classList.contains("section")) {
            section.classList.remove("collapsed");
            localStorage.setItem(`section-${parentSection}`, "expanded");
            updateSidebarArrow(parentSection, false);
          }
        } else {
          // Main section link - toggle behavior
          const sectionId = link.getAttribute("data-section");
          const section = document.getElementById(sectionId);

          if (section && section.classList.contains("section")) {
            // Toggle the section
            const isCurrentlyCollapsed =
              section.classList.contains("collapsed");

            if (isCurrentlyCollapsed) {
              section.classList.remove("collapsed");
              localStorage.setItem(`section-${sectionId}`, "expanded");
              updateSidebarArrow(sectionId, false);
            } else {
              section.classList.add("collapsed");
              localStorage.setItem(`section-${sectionId}`, "collapsed");
              updateSidebarArrow(sectionId, true);
            }
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

document.addEventListener("DOMContentLoaded", () => {
  setupMobileMenu();
  loadSections();
});

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
  document.documentElement.style.scrollBehavior = "";
}
