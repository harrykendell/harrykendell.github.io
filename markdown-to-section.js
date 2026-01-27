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

function renderProcedureNode(node) {
    const skillRaw = (node.skillRaw || "").trim();
    const title = (node.title || "Procedure").trim() || "Procedure";

    console.groupCollapsed(`🔨 Rendering: "${title}"`);

    const blockContent = node.content
        .map((part) => (typeof part === "string" ? part : part.html))
        .join("\n")
        .trim();

    console.log('📝 Markdown content:', blockContent);

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

    const html = [
        `<div class="procedure"${skillRaw ? ` data-skill="${skillValue}"` : ""}>`,
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
    ].filter(Boolean).join("\n");

    console.log('✅ Rendered HTML:', html);
    console.groupEnd();

    return html;
}

function transformProcedureBlocks(markdown, documentTitle) {
    const titleInfo = documentTitle ? ` in "${documentTitle}"` : '';
    console.group(`📋 PROCEDURE TRANSFORM${titleInfo}`);
    const lines = markdown.split(/\r?\n/);
    const output = [];
    const stack = [];

    for (let idx = 0; idx < lines.length; idx += 1) {
        const line = lines[idx];
        const startMatch = /^(.*?)\[!PROCEDURE:([^\]]+)\]\]?\s*(.*?)\s*$/.exec(line);
        const endMatch = /^(.*?)\[!\/PROCEDURE\]\s*(.*)$/.exec(line);

        if (startMatch) {
            const prefix = startMatch[1];
            const skillRaw = (startMatch[2] || "").trim();
            const title = (startMatch[3] || "Procedure").trim() || "Procedure";

            console.groupCollapsed(`▶️ START "${title}" [${skillRaw}] at line ${idx}`);
            if (prefix.trim()) {
                console.log('Prefix text:', prefix);
            }
            console.log('Stack depth:', stack.length, '→', stack.length + 1);
            console.groupEnd();

            // Output any text before the tag
            if (prefix.trim()) {
                if (stack.length) {
                    stack[stack.length - 1].content.push(prefix.trimEnd());
                } else {
                    output.push(prefix.trimEnd());
                }
            }

            stack.push({ skillRaw, title, content: [] });
            continue;
        }

        if (endMatch) {
            const prefix = endMatch[1];
            const suffix = endMatch[2];

            if (!stack.length) {
                // Unmatched close; treat as plain text
                console.warn('⚠️ Unmatched [!/PROCEDURE] at line', idx);
                output.push(line);
                continue;
            }

            const completed = stack[stack.length - 1];
            console.groupCollapsed(`⏹️ END "${completed.title}" [Line ${idx}]`);

            // Add any text before the closing tag to the procedure content
            if (prefix.trim()) {
                console.log('Prefix text:', prefix);
                stack[stack.length - 1].content.push(prefix.trimEnd());
            }
            if (suffix.trim()) {
                console.log('Suffix text:', suffix);
            }
            console.log('Content lines captured:', completed.content.length);
            console.log('Stack depth:', stack.length, '→', stack.length - 1);

            stack.pop();
            const rendered = { html: renderProcedureNode(completed) };
            console.groupEnd();

            if (stack.length) {
                stack[stack.length - 1].content.push(rendered);
            } else {
                output.push(rendered.html);
            }

            // Output any text after the closing tag
            if (suffix.trim()) {
                if (stack.length) {
                    stack[stack.length - 1].content.push(suffix.trimStart());
                } else {
                    output.push(suffix.trimStart());
                }
            }
            continue;
        }

        if (stack.length) {
            stack[stack.length - 1].content.push(line);
        } else {
            output.push(line);
        }
    }

    // If any unclosed procedures remain, emit them as raw text to avoid loss
    while (stack.length) {
        const dangling = stack.shift();
        console.error(`❌ Unclosed procedure: "${dangling.title}"`);
        output.push(
            `[!PROCEDURE:${dangling.skillRaw}] ${dangling.title}`,
            ...dangling.content.map((part) => typeof part === "string" ? part : part.html));
    }

    console.log('✅ Transform complete. Output items:', output.length);
    console.groupEnd();
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

        blockquote.className = `${blockquote.className} ${classMap[kind]}`.trim();
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
            table.parentElement && table.parentElement.classList.contains("table-scroll")) {
            return;
        }
        const wrapper = document.createElement("div");
        wrapper.className = "table-scroll";
        table.parentElement.insertBefore(wrapper, table);
        wrapper.appendChild(table);
    });
}

function extractYouTubeId(src) {
    console.log('🔍 Extracting video ID from:', src);
    try {
        const url = new URL(src);
        if (!/youtube(-nocookie)?\.com$/.test(url.hostname)) {
            console.log('❌ Not a YouTube URL');
            return null;
        }
        const match = url.pathname.match(/\/embed\/([^/?]+)/);
        const videoId = match ? match[1] : null;
        console.log('✅ Extracted video ID:', videoId);
        return videoId;
    } catch (error) {
        console.log('⚠️ URL parse failed, trying fallback regex');
        const fallback = /youtube(?:-nocookie)?\.com\/embed\/([^?&]+)/.exec(
            src);
        const videoId = fallback ? fallback[1] : null;
        console.log(videoId ? '✅ Fallback extracted:' : '❌ Fallback failed:', videoId);
        return videoId;
    }
}

function buildYouTubeEmbed(iframe, videoId) {
    const title = iframe.getAttribute("title") || "YouTube video";
    console.groupCollapsed(`📺 Building embed: "${title}" [${videoId}]`);
    const safeTitle = escapeHtml(title);

    let dataSrc = iframe.getAttribute("src") || "";
    console.log('Original src:', dataSrc);
    try {
        dataSrc = new URL(dataSrc);
        dataSrc.searchParams.set("autoplay", "1");
        dataSrc = dataSrc.toString();
    } catch (error) {
        dataSrc += dataSrc.includes("?") ? "&autoplay=1" : "?autoplay=1";
    }
    console.log('Data-src with autoplay:', dataSrc);

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
        "path");
    iconPath.setAttribute(
        "d",
        "M66.52 7.06a8 8 0 0 0-5.63-5.66C55.65 0 34 0 34 0S12.35 0 7.11 1.4A8 8 0 0 0 1.48 7.06 83.2 83.2 0 0 0 0 24a83.2 83.2 0 0 0 1.48 16.94 8 8 0 0 0 5.63 5.66C12.35 48 34 48 34 48s21.65 0 26.89-1.4a8 8 0 0 0 5.63-5.66A83.2 83.2 0 0 0 68 24a83.2 83.2 0 0 0-1.48-16.94z");
    iconPath.setAttribute("fill", "#ff0000");
    const iconTriangle = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path");
    iconTriangle.setAttribute("d", "M45 24 27 14v20z");
    iconTriangle.setAttribute("fill", "#ffffff");
    icon.appendChild(iconPath);
    icon.appendChild(iconTriangle);

    const thumbnail = document.createElement("img");
    thumbnail.loading = "lazy";
    thumbnail.decoding = "async";
    thumbnail.alt = title;
    thumbnail.src = `https://img.youtube.com/vi/${videoId}/0.jpg`;
    console.log('Thumbnail URL:', thumbnail.src);

    button.appendChild(icon);
    button.appendChild(thumbnail);

    const lazyIframe = document.createElement("iframe");
    lazyIframe.title = title;
    lazyIframe.src = "about:blank";
    lazyIframe.setAttribute("data-src", dataSrc);
    lazyIframe.setAttribute("frameborder", "0");
    lazyIframe.setAttribute("allowfullscreen", "");
    // lazyIframe.setAttribute("allow", "autoplay; encrypted-media");
    lazyIframe.loading = "lazy";

    wrapper.appendChild(button);
    wrapper.appendChild(lazyIframe);

    console.log('✅ Wrapper built');
    console.groupEnd();

    return wrapper;
}

function transformYouTubeEmbeds(rootEl) {
    const iframes = Array.from(rootEl.querySelectorAll("iframe"));
    console.group(`📺 YOUTUBE TRANSFORM (${iframes.length} iframes found)`);

    let transformed = 0;
    iframes.forEach((iframe, index) => {
        const src = iframe.getAttribute("src") || "";
        console.groupCollapsed(`🎬 iframe ${index + 1}/${iframes.length}`);
        console.log('Source:', src);

        const videoId = extractYouTubeId(src);
        if (!videoId) {
            console.log('⏭️ Skipping (not a YouTube embed)');
            console.groupEnd();
            return;
        }

        const wrapper = buildYouTubeEmbed(iframe, videoId);
        iframe.replaceWith(wrapper);
        transformed++;
        console.log('✅ Replaced with lazy-load wrapper');
        console.groupEnd();
    });

    console.log(`✅ Transformation complete. Converted: ${transformed}/${iframes.length}`);
    console.groupEnd();
}

/**
 * Converts Markdown content to a section element.
 * @param {string} markdown - The Markdown content
 * @param {string} sectionId - The section ID
 * @returns {HTMLElement} The section element
 */
function markdownToSection(markdown, sectionId) {
    const { title, content } = extractTitleAndContentFromMarkdown(markdown);

    console.groupCollapsed(`📄 Processing markdown: "${title || sectionId}" (${sectionId}.md)`);

    const html = marked.parse(transformProcedureBlocks(content, title));

    const safeTitle = escapeHtml(title || sectionId);
    const safeSectionId = escapeAttribute(sectionId);
    const template = document.createElement("template");
    template.innerHTML = `
        <section class="section" id="${safeSectionId}">
            <div class="section-header">
                <span class="section-toggle">▼</span>
                <h2>${safeTitle}</h2>
            </div>
            <div class="section-content">${html}</div>
        </section>
    `;

    const sectionEl = template.content.firstElementChild;
    const contentEl = sectionEl.querySelector(".section-content");

    // Ensure section content doesn't include h1
    downgradeHeadings(contentEl);

    initProcedures(contentEl);
    transformCallouts(contentEl);

    transformYouTubeEmbeds(contentEl);

    // Wrap tables for mobile horizontal scrolling
    wrapTables(contentEl);

    // Set ids for sidebar linking without changing heading levels
    addHeadingIds(contentEl, sectionId);

    console.log('✅ Section complete');
    console.groupEnd();

    return sectionEl;
}
