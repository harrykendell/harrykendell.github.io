const sectionFiles = [
  "hardware",
  "boats",
  "oars",
  "gates",
  "footplates",
  "seats",
  "coxbox-wiring",
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
    } catch (error) {
      console.error(`Failed to load section: ${section}`, error);
    }
  }

  // Setup click handlers after all sections are loaded
  setupSectionToggle();
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
        }
      });
    }

    // Set initial state: collapsed by default, unless user previously expanded it
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
  });
}

document.addEventListener("DOMContentLoaded", loadSections);
