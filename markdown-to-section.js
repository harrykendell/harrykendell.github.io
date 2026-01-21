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

function transformProcedureBlocks(markdown) {
    const lines = markdown.split(/\r?\n/);
    const output = [];

    for (let idx = 0; idx < lines.length; idx += 1) {
        const line = lines[idx];
        const match = /^\s*\[!PROCEDURE:([^\]]+)\]\]?\s*(.*?)\s*$/.exec(line);
        if (!match) {
            output.push(line);
            continue;
        }

        const skillRaw = (match[1] || "").trim();
        const title = (match[2] || "Procedure").trim() || "Procedure";

        const blockLines = [];
        idx += 1;
        while (idx < lines.length) {
            if (/^\s*\[!\/PROCEDURE\]\s*$/.test(lines[idx])) {
                break;
            }
            blockLines.push(lines[idx]);
            idx += 1;
        }

        if (idx >= lines.length) {
            output.push(line, ...blockLines);
            break;
        }

        const blockContent = blockLines.join("\n").trim();
        const chunks = blockContent
            ? blockContent.split(/\n\s*\n/).filter(Boolean)
            : [];
        const descriptionChunk = (chunks.shift() || "").trim();
        const restMarkdown = chunks.join("\n\n");

        const descriptionHtml = descriptionChunk
            ? marked.parseInline(descriptionChunk.replace(/\n+/g, " "))
            : "";
        const bodyHtml = restMarkdown ? marked.parse(restMarkdown) : "";

        const skillValue = skillRaw.toLowerCase();
        const skillLabel = skillRaw.replace(/[_-]+/g, " ");
        const skillBadge = skillRaw
            ? `<span class="procedure-skill-badge" data-skill="${skillValue}">${skillLabel}</span>`
            : "";

        const procedureHtml = [
            `<div class="procedure"${
                skillRaw ? ` data-skill="${skillValue}"` : ""
            }>`,
            `  <div class="procedure-header">`,
            `    <div class="procedure-title"><span>🛠</span><span>${title}</span>${skillBadge}</div>`,
            `  </div>`,
            `  <div class="procedure-content">`,
            descriptionHtml
                ? `    <div class="procedure-description">${descriptionHtml}</div>`
                : "",
            bodyHtml ? `    ${bodyHtml}` : "",
            `  </div>`,
            `</div>`,
        ]
            .filter(Boolean)
            .join("\n");

        output.push(procedureHtml);
    }

    return output.join("\n");
}

function initProcedures(rootEl) {
    const procedures = Array.from(rootEl.querySelectorAll(".procedure"));
    procedures.forEach((procedure) => {
        const header = procedure.querySelector(".procedure-header");
        if (!header) {
            return;
        }

        procedure.classList.add("collapsed");
        header.addEventListener("click", () => {
            procedure.classList.toggle("collapsed");
        });
    });
}

function transformCallouts(rootEl) {
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

    const blockquotes = Array.from(rootEl.querySelectorAll("blockquote"));
    blockquotes.forEach((blockquote) => {
        // Ensure all paragraphs are wrapped in <p> tags
        blockquote.innerHTML = blockquote.innerHTML
            .trim()
            .replace(/\n/g, "</p><p>");

        const firstParagraph = blockquote.querySelector("p");
        if (!firstParagraph) {
            return;
        }

        const titleText = (firstParagraph.textContent || "").trim();
        const match = /^\[!(INFO|WARNING|DANGER)\]\s*(.*)$/.exec(titleText);
        if (!match) {
            return;
        }

        const kind = match[1];
        const title = match[2].trim();

        blockquote.className =
            `${blockquote.className} ${classMap[kind]}`.trim();
        firstParagraph.className = "callout-title";
        firstParagraph.innerHTML = `${svgMap[kind]} ${title}`.trim();
    });
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

function addHeadingIds(rootEl, sectionId) {
    const headings = rootEl.querySelectorAll("h2, h3, h4, h5, h6");
    const seenIds = new Set();
    headings.forEach((h) => {
        if (h.id) {
            seenIds.add(h.id);
            return;
        }
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
        h.id = id;
    });
}

function downgradeHeadings(rootEl) {
    const headings = rootEl.querySelectorAll("h1, h2, h3, h4, h5");
    headings.forEach((heading) => {
        const currentLevel = parseInt(heading.tagName.slice(1), 10);
        if (Number.isNaN(currentLevel) || currentLevel >= 6) {
            return;
        }

        const nextLevel = currentLevel + 1;
        const newHeading = document.createElement(`h${nextLevel}`);

        Array.from(heading.attributes).forEach((attr) => {
            newHeading.setAttribute(attr.name, attr.value);
        });

        newHeading.innerHTML = heading.innerHTML;
        heading.replaceWith(newHeading);
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

function extractYouTubeId(src) {
    try {
        const url = new URL(src);
        if (!/youtube(-nocookie)?\.com$/.test(url.hostname)) {
            return null;
        }
        const match = url.pathname.match(/\/embed\/([^/?]+)/);
        return match ? match[1] : null;
    } catch (error) {
        const fallback = /youtube(?:-nocookie)?\.com\/embed\/([^?&]+)/.exec(
            src
        );
        return fallback ? fallback[1] : null;
    }
}

function buildYouTubeEmbed(iframe, videoId) {
    const title = iframe.getAttribute("title") || "YouTube video";

    let dataSrc = iframe.getAttribute("src") || "";
    try {
        dataSrc = new URL(dataSrc).searchParams.set("autoplay", "1").toString();
    } catch (error) {
        dataSrc += dataSrc.includes("?") ? "&autoplay=1" : "?autoplay=1";
    }

    const wrapper = document.createElement("div");
    wrapper.className = "youtube-embed";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "youtube-embed__button";
    button.title = `Play video: ${title}`;
    button.setAttribute("aria-label", `Play video: ${title}`);

    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("class", "youtube-embed__icon");
    icon.setAttribute("viewBox", "0 0 68 48");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("focusable", "false");

    const iconPath = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path"
    );
    iconPath.setAttribute(
        "d",
        "M66.52 7.06a8 8 0 0 0-5.63-5.66C55.65 0 34 0 34 0S12.35 0 7.11 1.4A8 8 0 0 0 1.48 7.06 83.2 83.2 0 0 0 0 24a83.2 83.2 0 0 0 1.48 16.94 8 8 0 0 0 5.63 5.66C12.35 48 34 48 34 48s21.65 0 26.89-1.4a8 8 0 0 0 5.63-5.66A83.2 83.2 0 0 0 68 24a83.2 83.2 0 0 0-1.48-16.94z"
    );
    iconPath.setAttribute("fill", "#ff0000");
    const iconTriangle = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path"
    );
    iconTriangle.setAttribute("d", "M45 24 27 14v20z");
    iconTriangle.setAttribute("fill", "#ffffff");
    icon.appendChild(iconPath);
    icon.appendChild(iconTriangle);

    const thumbnail = document.createElement("img");
    thumbnail.loading = "lazy";
    thumbnail.decoding = "async";
    thumbnail.alt = title;
    thumbnail.src = `https://img.youtube.com/vi/${videoId}/0.jpg`;

    button.appendChild(icon);
    button.appendChild(thumbnail);

    const lazyIframe = document.createElement("iframe");
    lazyIframe.title = title;
    lazyIframe.src = "about:blank";
    lazyIframe.setAttribute("data-src", dataSrc);
    lazyIframe.setAttribute("frameborder", "0");
    lazyIframe.setAttribute("allowfullscreen", "");
    lazyIframe.setAttribute("allow", "autoplay; encrypted-media");
    lazyIframe.loading = "lazy";

    wrapper.appendChild(button);
    wrapper.appendChild(lazyIframe);

    return wrapper;
}

function transformYouTubeEmbeds(rootEl) {
    const iframes = Array.from(rootEl.querySelectorAll("iframe"));
    console.log("Transforming YouTube embeds", iframes.length);
    iframes.forEach((iframe) => {
        const src = iframe.getAttribute("src") || "";
        const videoId = extractYouTubeId(src);
        if (!videoId) {
            return;
        }

        const wrapper = buildYouTubeEmbed(iframe, videoId);
        iframe.replaceWith(wrapper);
    });
}

/**
 * Converts Markdown content to a section element.
 * @param {string} markdown - The Markdown content
 * @param {string} sectionId - The section ID
 * @returns {HTMLElement} The section element
 */
function markdownToSection(markdown, sectionId) {
    const { title, content } = extractTitleAndContentFromMarkdown(markdown);
    const html = marked.parse(transformProcedureBlocks(content));

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

    // Ensure section content doesn't include h1
    downgradeHeadings(contentEl);

    initProcedures(contentEl);
    transformCallouts(contentEl);

    transformYouTubeEmbeds(contentEl);

    // Wrap tables for mobile horizontal scrolling
    wrapTables(contentEl);

    sectionEl.appendChild(headerEl);
    sectionEl.appendChild(contentEl);

    // Set ids for sidebar linking without changing heading levels
    addHeadingIds(contentEl, sectionId);

    return sectionEl;
}
