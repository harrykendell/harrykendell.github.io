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
    // Format: > [!TYPE] Title content...
    const classMap = {
        INFO: "callout callout--info",
        DANGER: "callout callout--danger",
        WARNING: "callout callout--warn",
    };
    const svgMap = {
        INFO: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path></svg>',
        WARNING:
            '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"></path></svg>',
        DANGER: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path></svg>',
    };

    const lines = markdown.split(/\r?\n/);
    const result = [];
    let i = 0;

    while (i < lines.length) {
        const match = /^>\s*\[!(INFO|WARNING|DANGER)\]\s*(.*)$/.exec(lines[i]);
        if (!match) {
            result.push(lines[i]);
            i++;
            continue;
        }

        const kind = match[1];
        const title = match[2].trim();
        const bodyLines = [];
        i++;

        // Collect body lines starting with ">"
        while (i < lines.length && /^>\s*/.test(lines[i])) {
            bodyLines.push(lines[i].replace(/^>\s*/, ""));
            i++;
        }

        const calloutHtml = [
            `<div class="${classMap[kind]}">`,
            title
                ? `<div class="callout-title">${svgMap[kind]} ${title}</div>`
                : "",
            `<div class="callout-body">`,
            marked.parse(bodyLines.join("\n")),
            `</div>`,
            `</div>`,
        ].join("");

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

function retagHeadingsToH3WithIds(rootEl, sectionId) {
    const headings = rootEl.querySelectorAll("h2, h3");
    const seenIds = new Set();
    headings.forEach((h) => {
        const text = h.textContent || "";
        const baseId = slugify(text);
        const prefix = sectionId ? `${sectionId}-` : "";
        let id = `${prefix}${baseId}`;
        let counter = 2;
        while (seenIds.has(id)) {
            id = `${prefix}${baseId}-${counter}`;
            counter += 1;
        }
        seenIds.add(id);
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
    retagHeadingsToH3WithIds(contentEl, sectionId);

    return sectionEl;
}
