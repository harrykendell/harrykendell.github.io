/**
 * Converts a Markdown file to a styled HTML section element.
 * Handles callouts, tables, headings, and reference-style links.
 */

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function preprocessCallouts(markdown) {
  // Convert GitHub-style callouts into our .callout HTML blocks
  // Patterns like:
  // > [!TIP]\n> Title\n> body...
  const lines = markdown.split(/\r?\n/);
  const result = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const match = /^>\s*\[!(TIP|WARNING|NOTE)\]\s*$/.exec(line);
    if (!match) {
      result.push(line);
      i++;
      continue;
    }

    const kind = match[1];
    const classMap = {
      TIP: "callout callout--ok",
      WARNING: "callout callout--danger",
      NOTE: "callout callout--warn",
    };
    i++;
    let title = "";
    const bodyLines = [];
    // Next line(s) starting with "> " belong to the callout
    while (i < lines.length && /^>\s*/.test(lines[i])) {
      const content = lines[i].replace(/^>\s*/, "");
      if (!title && content.trim()) {
        title = content.trim();
      } else {
        bodyLines.push(content);
      }
      i++;
    }

    const calloutHtml = [
      `<div class="${classMap[kind]}">`,
      `<div class="callout-icon">${
        kind === "TIP" ? "✔️" : kind === "WARNING" ? "🚫" : "ℹ️"
      }</div>`,
      `<div class="callout-body">`,
      title ? `<div class="callout-title">${title}</div>` : "",
      marked.parse(bodyLines.join("\n")),
      `</div>`,
      `</div>`,
    ].join("");

    // Inject raw HTML by using an HTML block fence
    result.push(calloutHtml);
  }
  return result.join("\n");
}

function extractTitleAndContentFromMarkdown(md) {
  const lines = md.split(/\r?\n/);
  let title = null;
  let start = 0;
  for (let idx = 0; idx < lines.length; idx++) {
    const m = /^\s*#\s+(.+?)\s*$/.exec(lines[idx]);
    if (m) {
      title = m[1].trim();
      start = idx + 1;
      break;
    }
  }
  const content = lines.slice(start).join("\n");
  return { title, content };
}

function retagHeadingsToH3WithIds(rootEl) {
  const headings = rootEl.querySelectorAll("h2, h3");
  headings.forEach((h) => {
    const text = h.textContent || "";
    const id = slugify(text);
    const newH = document.createElement("h3");
    newH.id = id;
    newH.innerHTML = h.innerHTML;
    h.replaceWith(newH);
  });
}

function wrapTables(rootEl) {
  const tables = Array.from(rootEl.querySelectorAll("table"));
  tables.forEach((table) => {
    if (
      table.parentElement &&
      table.parentElement.classList.contains("table-scroll")
    ) {
      return;
    }
    const wrapper = document.createElement("div");
    wrapper.className = "table-scroll";
    table.parentElement.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  });
}

/**
 * Converts Markdown content to a section element.
 * @param {string} markdown - The Markdown content
 * @param {string} sectionId - The section ID
 * @returns {HTMLElement} The section element
 */
function markdownToSection(markdown, sectionId) {
  // Preprocess custom callouts
  let md = preprocessCallouts(markdown);

  const { title, content } = extractTitleAndContentFromMarkdown(md);
  const html = marked.parse(content);

  const sectionEl = document.createElement("section");
  sectionEl.className = "section";
  sectionEl.id = sectionId;

  const headerEl = document.createElement("div");
  headerEl.className = "section-header";
  const toggleEl = document.createElement("span");
  toggleEl.className = "section-toggle";
  toggleEl.textContent = "▼";
  const h2El = document.createElement("h2");
  h2El.textContent = title || sectionId;
  headerEl.appendChild(toggleEl);
  headerEl.appendChild(h2El);

  const contentEl = document.createElement("div");
  contentEl.className = "section-content";
  contentEl.innerHTML = html;

  // Wrap tables for mobile horizontal scrolling
  wrapTables(contentEl);

  sectionEl.appendChild(headerEl);
  sectionEl.appendChild(contentEl);

  // Retag headings to h3 and set ids for sidebar linking
  retagHeadingsToH3WithIds(contentEl);

  return sectionEl;
}
