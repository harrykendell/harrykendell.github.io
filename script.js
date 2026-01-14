const sectionFiles = [
  "hardware",
  "boats",
  "oars",
  "gates",
  "footplates",
  "seats",
  "coxbox-wiring",
  "test",
];

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
  setupSidebarLinks();
  updateSidebarArrows();

  // Restore scroll position after sections are loaded
  restoreScrollPosition();
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

function updateSidebarArrows() {
  const sections = document.querySelectorAll(".section");
  sections.forEach((section) => {
    const sectionId = section.id;
    const isCollapsed = section.classList.contains("collapsed");
    updateSidebarArrow(sectionId, isCollapsed);
  });
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
}

document.addEventListener("DOMContentLoaded", loadSections);

// Save scroll position before unload
window.addEventListener("beforeunload", () => {
  sessionStorage.setItem("scrollPosition", window.scrollY);
});

// Restore scroll position
function restoreScrollPosition() {
  const scrollPosition = sessionStorage.getItem("scrollPosition");
  if (scrollPosition !== null) {
    window.scrollTo(0, parseInt(scrollPosition));
  }
}
