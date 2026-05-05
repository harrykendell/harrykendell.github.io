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

if (
    !window.AppUtils
    || typeof window.AppUtils.escapeHtml !== "function"
    || typeof window.AppUtils.escapeAttribute !== "function"
    || typeof window.AppUtils.getGitHubEditUrl !== "function"
) {
    throw new Error("AppUtils is required before markdown-to-section.js.");
}
const markdownEscapeHtml = window.AppUtils.escapeHtml;
const markdownEscapeAttribute = window.AppUtils.escapeAttribute;
const markdownGetGitHubEditUrl = window.AppUtils.getGitHubEditUrl;

const PROCEDURE_MARKER_START_PREFIX = "PROCEDURE:START:";
const PROCEDURE_MARKER_END = "PROCEDURE:END";

function buildProcedureStartMarkerHtml(skillRaw, title) {
    const encodedSkill = encodeURIComponent(skillRaw || "");
    const encodedTitle = encodeURIComponent(title || "");
    return `<!--${PROCEDURE_MARKER_START_PREFIX}${encodedSkill}:${encodedTitle}-->`;
}

function buildProcedureEndMarkerHtml() {
    return `<!--${PROCEDURE_MARKER_END}-->`;
}

function transformProcedureBlocks(markdown) {
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

            // Output any text before the tag
            if (prefix.trim()) {
                output.push(prefix.trimEnd());
            }

            output.push(buildProcedureStartMarkerHtml(skillRaw, title));
            stack.push({ skillRaw, title, markerIndex: output.length - 1 });
            continue;
        }

        if (endMatch) {
            const prefix = endMatch[1];
            const suffix = endMatch[2];

            if (!stack.length) {
                // Unmatched close; treat as plain text
                console.error('⚠️ Unmatched [!/PROCEDURE] at line', idx);
                output.push(line);
                continue;
            }

            // Add any text before the closing tag to the procedure content
            if (prefix.trim()) {
                output.push(prefix.trimEnd());
            }
            stack.pop();
            output.push(buildProcedureEndMarkerHtml());

            // Output any text after the closing tag
            if (suffix.trim()) {
                output.push(suffix.trimStart());
            }
            continue;
        }

        output.push(line);
    }

    // If any unclosed procedures remain, restore marker lines as plain text.
    while (stack.length) {
        const dangling = stack.shift();
        console.error(`❌ Unclosed procedure: "${dangling.title}"`);
        output[dangling.markerIndex] = `[!PROCEDURE:${dangling.skillRaw}] ${dangling.title}`;
    }

    return output.join("\n");
}

function renderProcedureBlockHtml(meta) {
    const skillRaw = (meta.skillRaw || "").trim();
    const title = (meta.title || "Procedure").trim() || "Procedure";
    const skillValue = skillRaw.toLowerCase();
    const skillLabel = skillRaw.replace(/[_-]+/g, " ");
    const skillBadge = skillRaw
        ? `<span class="procedure-skill-badge" data-skill="${markdownEscapeAttribute(skillValue)}">${markdownEscapeHtml(skillLabel)}</span>`
        : "";

    const rawContentHtml = String(meta.contentHtml || "");
    const contentHtml = rawContentHtml.trim();
    let descriptionHtml = "";
    let bodyHtml = contentHtml;

    const firstParagraphMatch = /^\s*<p>([\s\S]*?)<\/p>([\s\S]*)$/i.exec(contentHtml);
    if (firstParagraphMatch && firstParagraphMatch[1].trim()) {
        descriptionHtml = `<div class="procedure-description">${firstParagraphMatch[1].trim()}</div>`;
        bodyHtml = firstParagraphMatch[2].trim();
    }

    return [
        `<div class="procedure"${skillRaw ? ` data-skill="${markdownEscapeAttribute(skillValue)}"` : ""}>`,
        `  <div class="procedure-header" role="button" tabindex="0" aria-expanded="false">`,
        `    <div class="procedure-title">`,
        `      <span class="procedure-title-icon" aria-hidden="true">🛠</span>`,
        `      <div class="procedure-title-content">`,
        skillBadge ? `        ${skillBadge}` : "",
        `        <span class="procedure-title-text">${markdownEscapeHtml(title)}</span>`,
        `      </div>`,
        `    </div>`,
        `  </div>`,
        `  <div class="procedure-content">`,
        descriptionHtml ? `    ${descriptionHtml}` : "",
        bodyHtml ? `    ${bodyHtml}` : "",
        `  </div>`,
        `</div>`,
    ].filter(Boolean).join("\n");
}

function transformRenderedProcedureBlocks(renderedHtml) {
    const source = String(renderedHtml || "");
    if (!source.includes("<!--PROCEDURE:")) {
        return source;
    }

    const markerPattern = /<!--PROCEDURE:START:([^:]*):(.*?)-->|<!--PROCEDURE:END-->/g;
    const output = [];
    const stack = [];
    let cursor = 0;

    const append = (chunk) => {
        if (!chunk) {
            return;
        }
        if (stack.length) {
            stack[stack.length - 1].contentHtml += chunk;
            return;
        }
        output.push(chunk);
    };

    source.replace(markerPattern, (...args) => {
        const fullMatch = args[0];
        const encodedSkill = args[1];
        const encodedTitle = args[2];
        const offset = args[args.length - 2];

        append(source.slice(cursor, offset));
        cursor = offset + fullMatch.length;

        if (fullMatch === `<!--${PROCEDURE_MARKER_END}-->`) {
            if (!stack.length) {
                console.error("⚠️ Unmatched [!/PROCEDURE] marker in rendered HTML.");
                append("<p>[!/PROCEDURE]</p>");
                return "";
            }

            const completed = stack.pop();
            append(renderProcedureBlockHtml(completed));
            return "";
        }

        let skillRaw = "";
        let title = "Procedure";
        try {
            skillRaw = decodeURIComponent(encodedSkill || "");
            title = decodeURIComponent(encodedTitle || "").trim() || "Procedure";
        } catch (error) {
            console.error("⚠️ Failed to decode procedure marker metadata.", error);
        }

        stack.push({
            skillRaw: String(skillRaw || "").trim(),
            title,
            contentHtml: "",
        });
        return "";
    });

    append(source.slice(cursor));

    while (stack.length) {
        const dangling = stack.pop();
        console.error(`❌ Unclosed procedure in rendered HTML: "${dangling.title}"`);
        const fallbackOpen = `[!PROCEDURE:${dangling.skillRaw}] ${dangling.title}`;
        append(`<p>${markdownEscapeHtml(fallbackOpen)}</p>${dangling.contentHtml}`);
    }

    return output.join("");
}

function initProcedures(rootEl) {
    const procedures = Array.from(rootEl.querySelectorAll(".procedure"));
    procedures.forEach((procedure) => {
        const header = procedure.querySelector(".procedure-header");
        if (!header) {
            return;
        }

        setProcedureCollapsed(procedure, true);
        const toggleProcedure = () => {
            toggleProcedureCollapsed(procedure);
        };
        header.addEventListener("click", toggleProcedure);
        header.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleProcedure();
            }
        });
    });
}

function setProcedureCollapsed(procedure, isCollapsed) {
    if (!(procedure instanceof Element)) {
        return false;
    }

    const nextCollapsed = !!isCollapsed;
    const changed = procedure.classList.contains("collapsed") !== nextCollapsed;
    procedure.classList.toggle("collapsed", nextCollapsed);

    const header = procedure.querySelector(".procedure-header");
    if (header) {
        header.setAttribute("aria-expanded", String(!nextCollapsed));
    }

    return changed;
}

function toggleProcedureCollapsed(procedure) {
    if (!(procedure instanceof Element)) {
        return false;
    }
    return setProcedureCollapsed(procedure, !procedure.classList.contains("collapsed"));
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
    // Track the slug at each heading level (h2=0, h3=1, ...)
    const slugStack = [];
    headings.forEach((h) => {
        if (h.id) {
            seenIds.add(h.id);
            return;
        }
        const text = h.textContent || "";
        const baseSlug = slugify(text);
        const level = parseInt(h.tagName.slice(1), 10) - 2; // h2=0, h3=1, ...
        slugStack.length = level + 1;
        slugStack[level] = baseSlug;
        // Build hierarchical id: sectionId + all parent slugs up to this level
        const idParts = [sectionId, ...slugStack.slice(0, level + 1)].filter(Boolean);
        let id = idParts.join("/");
        let counter = 2;
        while (seenIds.has(id)) {
            id = idParts.join("/") + "-" + counter;
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
        const parentElement = table.parentElement;
        if (parentElement && parentElement.classList.contains("table-scroll")) {
            return;
        }
        const parentNode = table.parentNode;
        if (!parentNode) {
            return;
        }
        const wrapper = document.createElement("div");
        wrapper.className = "table-scroll";
        parentNode.insertBefore(wrapper, table);
        wrapper.appendChild(table);
    });
}

function optimizeSectionMedia(rootEl) {
    const images = Array.from(rootEl.querySelectorAll("img"));
    images.forEach((image) => {
        if (!image.hasAttribute("loading")) {
            image.loading = "lazy";
        }
        if (!image.hasAttribute("decoding")) {
            image.decoding = "async";
        }
    });
}

function parseImageTextWidthFraction(value) {
    const normalized = String(value || "").trim().replace(/^['"]|['"]$/g, "");
    if (normalized === "-1") {
        return null;
    }

    let fraction = NaN;
    const ratioMatch = /^(\d+)\/(\d+)$/.exec(normalized);
    if (ratioMatch) {
        const numerator = Number(ratioMatch[1]);
        const denominator = Number(ratioMatch[2]);
        if (denominator > 0) {
            fraction = numerator / denominator;
        }
    } else if (/^(?:0?\.\d+|1(?:\.0+)?)$/.test(normalized)) {
        fraction = Number(normalized);
    }

    if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
        return false;
    }

    return {
        css: `${Number((fraction * 100).toFixed(4))}%`,
        fraction,
    };
}

function parseImageFloat(value) {
    const normalized = String(value || "").trim().replace(/^['"]|['"]$/g, "").toLowerCase();
    if (normalized === "-1") {
        return null;
    }
    if (normalized === "left" || normalized === "right") {
        return normalized;
    }
    return false;
}

function applyImageFloat(target, floatValue) {
    if (!(target instanceof Element)) {
        return;
    }
    target.classList.remove("inline-image-float-left", "inline-image-float-right", "inline-image-align-center");
    if (floatValue) {
        target.classList.add(`inline-image-float-${floatValue}`);
        return;
    }
    target.classList.add("inline-image-align-center");
}

function getImageWidthCss(dimension, floatValue) {
    if (!dimension || !dimension.css) {
        return "";
    }
    if (floatValue) {
        return `calc(${dimension.css} - var(--inline-image-float-gap))`;
    }
    return dimension.css;
}

function applyImageSizing(image, frame, options) {
    const target = frame || image;
    if (!(image instanceof Element) || !(target instanceof Element)) {
        return;
    }

    if (options.size) {
        const widthCss = getImageWidthCss(options.size, options.float);
        target.style.width = widthCss;
        image.style.width = frame ? "100%" : widthCss;
        image.style.height = "auto";
        return;
    }

    if (options.width) {
        const widthCss = getImageWidthCss(options.width, options.float);
        target.style.width = widthCss;
        image.style.width = frame ? "100%" : widthCss;
    }

    if (options.width && options.height) {
        image.style.aspectRatio = `${options.width.fraction} / ${options.height.fraction}`;
        image.style.height = "auto";
        return;
    }

    if (options.height && !options.width) {
        target.style.width = options.height.css;
        image.style.width = frame ? "100%" : options.height.css;
        image.style.height = "auto";
        return;
    }

    if (frame) {
        image.style.height = "auto";
    }
}

function renderImageCaption(image, options) {
    const captionText = String(image.getAttribute("alt") || "").trim();
    if (!captionText) {
        return null;
    }

    const frame = document.createElement("span");
    frame.className = "inline-image-frame";
    image.replaceWith(frame);
    frame.appendChild(image);

    const caption = document.createElement("span");
    caption.className = "inline-image-caption";
    caption.textContent = captionText;
    frame.appendChild(caption);

    applyImageSizing(image, frame, options);
    applyImageFloat(frame, options.float);
    return frame;
}

function applyImageAttributeLists(rootEl) {
    const images = Array.from(rootEl.querySelectorAll("img"));
    images.forEach((image) => {
        if (image.closest(".youtube-embed, .video-wrapper")) {
            return;
        }

        const nextNode = image.nextSibling;
        const hasAttributeListNode = nextNode && nextNode.nodeType === Node.TEXT_NODE;
        if (!hasAttributeListNode && !String(image.getAttribute("alt") || "").trim()) {
            return;
        }

        const text = hasAttributeListNode ? nextNode.textContent || "" : "";
        const match = hasAttributeListNode ? /^\s*\{([^{}]*)\}/.exec(text) : null;
        const options = {
            width: "",
            height: "",
            size: "",
            float: "",
        };

        let recognized = false;
        if (match) {
            const attrText = match[1];
            attrText.replace(/\b(width|height|size|float)=(?:"([^"]*)"|'([^']*)'|([^\s}]+))/g, (fullMatch, name, doubleQuoted, singleQuoted, bare) => {
                const value = doubleQuoted || singleQuoted || bare;

                if (name === "float") {
                    const floatValue = parseImageFloat(value);
                    if (floatValue === false) {
                        return fullMatch;
                    }
                    recognized = true;
                    options.float = floatValue || "";
                    return fullMatch;
                }

                const textWidthFraction = parseImageTextWidthFraction(value);
                if (textWidthFraction === false) {
                    return fullMatch;
                }

                recognized = true;
                if (textWidthFraction) {
                    options[name] = textWidthFraction;
                }
                return fullMatch;
            });
        }

        const frame = renderImageCaption(image, options);
        if (!frame) {
            applyImageSizing(image, null, options);
            applyImageFloat(image, options.float);
        }

        if (!recognized || !match) {
            return;
        }

        nextNode.textContent = text.slice(match[0].length);
        if (!nextNode.textContent) {
            nextNode.remove();
        }
    });
}

function extractYouTubeId(src) {
    const url = new URL(src);
    if (!/youtube(-nocookie)?\.com$/.test(url.hostname)) {
        console.error(`❌ Not a YouTube URL ${url.hostname}`);
        return null;
    }
    const match = url.pathname.match(/\/embed\/([^/?]+)/);
    const videoId = match ? match[1] : null;
    return videoId;
}

function buildYouTubeEmbed(iframe, videoId) {
    var title = iframe.getAttribute("title") || "YouTube video";
    title = markdownEscapeHtml(title);

    let dataSrc = iframe.getAttribute("src") || "";
    dataSrc = new URL(dataSrc);
    dataSrc.searchParams.set("autoplay", "1");
    dataSrc = dataSrc.toString();

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
    thumbnail.style.height = "auto";

    button.appendChild(icon);
    button.appendChild(thumbnail);

    const lazyIframe = document.createElement("iframe");
    lazyIframe.title = title;
    lazyIframe.src = "about:blank";
    lazyIframe.setAttribute("data-src", dataSrc);
    lazyIframe.setAttribute("frameborder", "0");
    lazyIframe.setAttribute(
        "allow",
        "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
    );
    lazyIframe.setAttribute("allowfullscreen", "");
    lazyIframe.loading = "lazy";

    wrapper.appendChild(button);
    wrapper.appendChild(lazyIframe);

    return wrapper;
}

function getReplaceableVideoWrapper(iframe) {
    const parent = iframe && iframe.parentElement;
    if (!parent || !parent.classList.contains("video-wrapper")) {
        return null;
    }

    const meaningfulNodes = Array.from(parent.childNodes).filter((node) => {
        return node.nodeType !== Node.TEXT_NODE || String(node.textContent || "").trim();
    });

    if (meaningfulNodes.length === 1 && meaningfulNodes[0] === iframe) {
        return parent;
    }

    return null;
}

function transformYouTubeEmbeds(rootEl) {
    const iframes = Array.from(rootEl.querySelectorAll("iframe"));

    iframes.forEach((iframe) => {
        const src = iframe.getAttribute("src") || "";

        const videoId = extractYouTubeId(src);
        if (!videoId) {
            console.warn('⏭️ Skipping (not a YouTube embed)');
            return;
        }

        const wrapper = buildYouTubeEmbed(iframe, videoId);
        const existingVideoWrapper = getReplaceableVideoWrapper(iframe);
        if (existingVideoWrapper) {
            existingVideoWrapper.replaceWith(wrapper);
        } else {
            iframe.replaceWith(wrapper);
        }
    });
}

function initYouTubeEmbeds(rootEl) {
    const buttons = Array.from(rootEl.querySelectorAll(".youtube-embed__button"));
    buttons.forEach((button) => {
        button.addEventListener("click", () => {
            const wrapper = button.closest(".youtube-embed");
            if (!wrapper || wrapper.classList.contains("is-playing")) {
                return;
            }

            const iframe = wrapper.querySelector("iframe[data-src]");
            if (!iframe) {
                return;
            }

            const dataSrc = iframe.getAttribute("data-src");
            if (!dataSrc) {
                return;
            }

            iframe.src = dataSrc;
            wrapper.classList.add("is-playing");
        });
    });
}

function renderMarkdownContent(rootEl, markdownContent, options) {
    if (!(rootEl instanceof Element)) {
        return false;
    }

    const settings = options || {};
    const sourceMarkdown = typeof markdownContent === "string" ? markdownContent : "";
    const headingScopeId = typeof settings.headingScopeId === "string" ? settings.headingScopeId : "";
    const shouldDowngradeHeadings = !!settings.downgradeHeadings;

    if (
        typeof marked === "undefined"
        || typeof marked.parse !== "function"
    ) {
        throw new Error("marked is required to render markdown content.");
    }

    const transformedMarkdown = transformProcedureBlocks(sourceMarkdown);
    const renderedHtml = marked.parse(transformedMarkdown);
    const procedureWrappedHtml = transformRenderedProcedureBlocks(renderedHtml);
    const template = document.createElement("template");
    template.innerHTML = procedureWrappedHtml;
    const fragment = template.content;

    if (shouldDowngradeHeadings) {
        downgradeHeadings(fragment);
    }

    initProcedures(fragment);
    transformCallouts(fragment);
    transformYouTubeEmbeds(fragment);
    initYouTubeEmbeds(fragment);
    wrapTables(fragment);
    applyImageAttributeLists(fragment);
    optimizeSectionMedia(fragment);

    if (headingScopeId) {
        addHeadingIds(fragment, headingScopeId);
    }

    rootEl.replaceChildren(fragment);

    return true;
}

/**
 * Converts Markdown content to a section element.
 * @param {string} markdown - The Markdown content
 * @param {string} sectionId - The section ID
 * @returns {HTMLElement} The section element
 */
function markdownToSection(markdown, sectionId) {
    const { title, content } = extractTitleAndContentFromMarkdown(markdown);

    const safeTitle = markdownEscapeHtml(title || sectionId);
    const safeSectionId = markdownEscapeAttribute(sectionId);
    const sectionPath = `sections/${sectionId}.md`;
    const editUrl = markdownGetGitHubEditUrl(sectionPath);
    const editLinkHtml = editUrl
        ? `<a class="section-edit-link" data-source-path="${markdownEscapeAttribute(sectionPath)}" href="${markdownEscapeAttribute(editUrl)}" target="_blank" rel="noopener noreferrer">Edit</a>`
        : "";
    const template = document.createElement("template");
    template.innerHTML = `
        <section class="section collapsed" id="${safeSectionId}" data-source-path="${markdownEscapeAttribute(sectionPath)}">
            <div class="section-header" role="button" tabindex="0" aria-expanded="false">
                <div class="section-header-main">
                    <span class="section-toggle">▼</span>
                    <h2>${safeTitle}</h2>
                </div>
                ${editLinkHtml}
            </div>
            <div class="section-content"></div>
        </section>
    `;

    const sectionEl = template.content.firstElementChild;
    const contentEl = sectionEl.querySelector(".section-content");
    renderMarkdownContent(contentEl, content, {
        documentTitle: title || sectionId,
        headingScopeId: sectionId,
        downgradeHeadings: true,
    });

    return sectionEl;
}
