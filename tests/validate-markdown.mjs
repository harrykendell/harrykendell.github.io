#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const VALID_PROCEDURE_LEVELS = new Set(["beginner", "intermediate", "advanced"]);
const VALID_CALLOUT_TYPES = new Set(["INFO", "WARNING", "DANGER"]);
const INTERNAL_HOSTS = new Set(["kendell.uk", "www.kendell.uk", "localhost", "127.0.0.1"]);
const MAX_GITHUB_ANNOTATIONS = 300;

const rootDir = process.cwd();
const sectionOrderPath = path.join("sections", "section-order.md");

const repoFiles = new Set();
const sectionAnchors = new Set(["top", "preface"]);
const issues = [];

async function main() {
  await collectRepoFiles(rootDir, repoFiles);

  if (!repoFiles.has(sectionOrderPath)) {
    addIssue({
      level: "error",
      code: "SECTION_ORDER_MISSING",
      file: sectionOrderPath,
      line: 1,
      message: "sections/section-order.md is missing.",
    });
    return finalize(issues, []);
  }

  const markdownPaths = Array.from(repoFiles)
    .filter((relPath) => relPath.startsWith("sections/") && relPath.endsWith(".md"))
    .sort();

  const sectionOrderContent = await readFileSafe(path.join(rootDir, sectionOrderPath));
  if (sectionOrderContent == null) {
    addIssue({
      level: "error",
      code: "SECTION_ORDER_UNREADABLE",
      file: sectionOrderPath,
      line: 1,
      message: "Could not read sections/section-order.md.",
    });
    return finalize(issues, []);
  }

  const orderedSectionIds = validateSectionOrder(sectionOrderContent, markdownPaths);

  const sectionFiles = markdownPaths.filter((relPath) => relPath !== sectionOrderPath);

  for (const filePath of sectionFiles) {
    const content = await readFileSafe(path.join(rootDir, filePath));
    if (content == null) {
      addIssue({
        level: "error",
        code: "MARKDOWN_UNREADABLE",
        file: filePath,
        line: 1,
        message: `Could not read ${filePath}.`,
      });
      continue;
    }

    const sectionId = toSectionId(filePath);
    if (sectionId) {
      sectionAnchors.add(sectionId);
      const anchors = collectAnchors(sectionId, content);
      for (const anchor of anchors) {
        sectionAnchors.add(anchor);
      }
    }
  }

  for (const filePath of sectionFiles) {
    const content = await readFileSafe(path.join(rootDir, filePath));
    if (content == null) {
      continue;
    }

    const references = extractReferenceDefinitions(content);

    validateProcedures(filePath, content);
    validateCallouts(filePath, content);

    const occurrences = extractLinkAndImageOccurrences(filePath, content, references);
    for (const occurrence of occurrences) {
      validateOccurrence(occurrence, {
        repoFiles,
        sectionAnchors,
      });
    }
  }

  const orderedSectionSet = new Set(orderedSectionIds);
  for (const filePath of sectionFiles) {
    const sectionId = toSectionId(filePath);
    if (!sectionId || sectionId === "introduction") {
      continue;
    }
    if (!orderedSectionSet.has(sectionId)) {
      addIssue({
        level: "warning",
        code: "SECTION_NOT_IN_ORDER",
        file: filePath,
        line: 1,
        message: `Section is not listed in sections/section-order.md: ${sectionId}`,
      });
    }
  }

  finalize(issues, sectionFiles);
}

async function collectRepoFiles(currentDir, outputSet, relPrefix = "") {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }

    const absPath = path.join(currentDir, entry.name);
    const relPath = toPosixPath(path.join(relPrefix, entry.name));

    if (entry.isDirectory()) {
      await collectRepoFiles(absPath, outputSet, relPath);
      continue;
    }

    outputSet.add(relPath);
  }
}

async function readFileSafe(absPath) {
  try {
    return await fs.readFile(absPath, "utf8");
  } catch (error) {
    return null;
  }
}

function toPosixPath(value) {
  return String(value).split(path.sep).join("/");
}

function normalizeSectionId(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  const normalized = raw
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/^`+|`+$/g, "")
    .replace(/^\/+/, "")
    .replace(/^sections\//, "")
    .replace(/\.md$/i, "")
    .trim();

  if (!normalized || normalized === "introduction") {
    return null;
  }

  return /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/.test(normalized)
    ? normalized
    : null;
}

function toSectionId(filePath) {
  const normalized = toPosixPath(filePath);
  if (!normalized.startsWith("sections/") || !normalized.endsWith(".md")) {
    return null;
  }
  return normalized.slice("sections/".length, -".md".length);
}

function validateSectionOrder(content, markdownPaths) {
  const sectionIds = [];
  const seen = new Set();
  const markdownSet = new Set(markdownPaths);

  const lines = content.split(/\r?\n/);
  let inComment = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (inComment) {
      if (trimmed.includes("-->")) {
        inComment = false;
      }
      continue;
    }

    if (trimmed.startsWith("<!--")) {
      if (!trimmed.includes("-->")) {
        inComment = true;
      }
      continue;
    }

    const itemMatch = /^\s*(?:[-*+]|\d+\.)\s+(.+?)\s*$/.exec(line);
    if (!itemMatch) {
      continue;
    }

    const sectionId = normalizeSectionId(itemMatch[1]);
    if (!sectionId) {
      addIssue({
        level: "error",
        code: "SECTION_ORDER_INVALID_ENTRY",
        file: sectionOrderPath,
        line: index + 1,
        message: `Invalid section ID in section-order list: ${itemMatch[1].trim()}`,
      });
      continue;
    }

    if (seen.has(sectionId)) {
      addIssue({
        level: "error",
        code: "SECTION_ORDER_DUPLICATE",
        file: sectionOrderPath,
        line: index + 1,
        message: `Duplicate section in section-order list: ${sectionId}`,
      });
      continue;
    }

    seen.add(sectionId);
    sectionIds.push(sectionId);

    const expectedFile = `sections/${sectionId}.md`;
    if (!markdownSet.has(expectedFile)) {
      addIssue({
        level: "error",
        code: "SECTION_ORDER_FILE_MISSING",
        file: sectionOrderPath,
        line: index + 1,
        message: `Section listed but file does not exist: ${expectedFile}`,
      });
    }
  }

  return sectionIds;
}

function collectAnchors(sectionId, markdown) {
  const anchors = new Set();
  const lines = stripLeadingTitle(markdown).split(/\r?\n/);

  let inFence = false;
  let fenceChar = "";
  const seenIds = new Set();
  const slugStack = [];

  for (const line of lines) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      const markerChar = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = markerChar;
      } else if (markerChar === fenceChar) {
        inFence = false;
        fenceChar = "";
      }
      continue;
    }
    if (inFence) {
      continue;
    }

    const headingMatch = /^\s{0,3}(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!headingMatch) {
      continue;
    }

    const originalLevel = headingMatch[1].length;
    const renderedLevel = originalLevel <= 5 ? originalLevel + 1 : originalLevel;
    if (renderedLevel < 2 || renderedLevel > 6) {
      continue;
    }

    const headingText = headingMatch[2].replace(/\s+#+\s*$/, "").trim();
    const baseSlug = slugify(headingText);
    if (!baseSlug) {
      continue;
    }

    const level = renderedLevel - 2;
    slugStack.length = level + 1;
    slugStack[level] = baseSlug;

    const idParts = [sectionId, ...slugStack.slice(0, level + 1)].filter(Boolean);
    let nextId = idParts.join("/");
    let counter = 2;

    while (seenIds.has(nextId)) {
      nextId = `${idParts.join("/")}-${counter}`;
      counter += 1;
    }

    seenIds.add(nextId);
    anchors.add(nextId);
  }

  return anchors;
}

function stripLeadingTitle(markdown) {
  const lines = markdown.split(/\r?\n/);
  let start = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*#\s+(.+?)\s*$/.test(lines[index])) {
      start = index + 1;
      break;
    }
  }
  return lines.slice(start).join("\n");
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function validateProcedures(filePath, markdown) {
  const lines = markdown.split(/\r?\n/);
  const stack = [];
  let inFence = false;
  let fenceChar = "";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      const markerChar = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = markerChar;
      } else if (markerChar === fenceChar) {
        inFence = false;
        fenceChar = "";
      }
      continue;
    }
    if (inFence) {
      continue;
    }

    const startMatch = /^(.*?)\[!PROCEDURE:([^\]]+)\]\]?\s*(.*?)\s*$/.exec(line);
    const endMatch = /^(.*?)\[!\/PROCEDURE\]\s*(.*)$/.exec(line);

    if (startMatch) {
      const prefix = startMatch[1].trim();
      const skill = String(startMatch[2] || "").trim().toLowerCase();
      const title = String(startMatch[3] || "").trim();

      if (prefix) {
        addIssue({
          level: "warning",
          code: "PROCEDURE_PREFIX_TEXT",
          file: filePath,
          line: index + 1,
          message: "Procedure opener has non-empty text before [!PROCEDURE:...].",
        });
      }

      if (!VALID_PROCEDURE_LEVELS.has(skill)) {
        addIssue({
          level: "error",
          code: "PROCEDURE_LEVEL_INVALID",
          file: filePath,
          line: index + 1,
          message: `Invalid procedure level \"${startMatch[2].trim()}\". Use beginner, intermediate, or advanced.`,
        });
      }

      if (!title) {
        addIssue({
          level: "warning",
          code: "PROCEDURE_TITLE_MISSING",
          file: filePath,
          line: index + 1,
          message: "Procedure title is empty.",
        });
      }

      if (stack.length > 0) {
        addIssue({
          level: "warning",
          code: "PROCEDURE_NESTED",
          file: filePath,
          line: index + 1,
          message: "Nested procedures are hard to maintain. Consider splitting the block.",
        });
      }

      stack.push({ line: index + 1, skill, title });
      continue;
    }

    if (endMatch) {
      if (!stack.length) {
        addIssue({
          level: "error",
          code: "PROCEDURE_UNMATCHED_CLOSE",
          file: filePath,
          line: index + 1,
          message: "Found [!/PROCEDURE] without a matching opener.",
        });
      } else {
        stack.pop();
      }
    }
  }

  for (const openProcedure of stack) {
    addIssue({
      level: "error",
      code: "PROCEDURE_UNCLOSED",
      file: filePath,
      line: openProcedure.line,
      message: "Procedure block is not closed with [!/PROCEDURE].",
    });
  }
}

function validateCallouts(filePath, markdown) {
  const lines = markdown.split(/\r?\n/);
  let inFence = false;
  let fenceChar = "";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      const markerChar = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = markerChar;
      } else if (markerChar === fenceChar) {
        inFence = false;
        fenceChar = "";
      }
      continue;
    }
    if (inFence) {
      continue;
    }

    const calloutMatch = /^\s*>\s*\[!([^\]]+)\]\s*(.*)$/.exec(line);
    if (!calloutMatch) {
      continue;
    }

    const kind = calloutMatch[1].trim().toUpperCase();
    const title = calloutMatch[2].trim();
    if (!VALID_CALLOUT_TYPES.has(kind)) {
      addIssue({
        level: "error",
        code: "CALLOUT_KIND_INVALID",
        file: filePath,
        line: index + 1,
        message: `Invalid callout type \"${calloutMatch[1].trim()}\". Use INFO, WARNING, or DANGER.`,
      });
    }

    if (!title) {
      addIssue({
        level: "warning",
        code: "CALLOUT_TITLE_MISSING",
        file: filePath,
        line: index + 1,
        message: "Callout title is empty.",
      });
    }

    const nextLine = lines[index + 1] || "";
    if (!/^\s*>/.test(nextLine)) {
      addIssue({
        level: "warning",
        code: "CALLOUT_BODY_MISSING",
        file: filePath,
        line: index + 1,
        message: "Callout block should include at least one body line starting with >.",
      });
    }
  }
}

function extractReferenceDefinitions(markdown) {
  const definitions = new Map();
  const lines = markdown.split(/\r?\n/);
  let inFence = false;
  let fenceChar = "";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      const markerChar = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = markerChar;
      } else if (markerChar === fenceChar) {
        inFence = false;
        fenceChar = "";
      }
      continue;
    }
    if (inFence) {
      continue;
    }

    const match = /^\s{0,3}\[([^\]]+)\]:\s*(.+?)\s*$/.exec(line);
    if (!match) {
      continue;
    }

    const label = normalizeReferenceLabel(match[1]);
    const destination = parseInlineDestination(match[2]);
    if (!label || !destination) {
      continue;
    }

    definitions.set(label, destination);
  }

  return definitions;
}

function normalizeReferenceLabel(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseInlineDestination(raw) {
  const value = String(raw || "").trim();
  if (!value) {
    return "";
  }

  if (value.startsWith("<")) {
    const close = value.indexOf(">");
    if (close > 1) {
      return value.slice(1, close).trim();
    }
  }

  const match = /^([^\s]+)(?:\s+.*)?$/.exec(value);
  return match ? match[1].trim() : value;
}

function extractLinkAndImageOccurrences(filePath, markdown, references) {
  const occurrences = [];
  const lines = markdown.split(/\r?\n/);
  let inFence = false;
  let fenceChar = "";

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index];

    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      const markerChar = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = markerChar;
      } else if (markerChar === fenceChar) {
        inFence = false;
        fenceChar = "";
      }
      continue;
    }
    if (inFence) {
      continue;
    }

    const scrubbedLine = line.replace(/`[^`]*`/g, "");

    const imageInlineRe = /!\[([^\]]*)\]\(([^)\n]+)\)/g;
    const linkInlineRe = /(?<!!)\[([^\]]+)\]\(([^)\n]+)\)/g;
    const imageRefRe = /!\[([^\]]*)\]\[([^\]]*)\]/g;
    const linkRefRe = /(?<!!)\[([^\]]+)\]\[([^\]]*)\]/g;
    const autoLinkRe = /<((?:https?:\/\/|mailto:|tel:)[^>\s]+)>/g;

    collectRegexMatches(scrubbedLine, imageInlineRe, (match, column) => {
      occurrences.push({
        file: filePath,
        line: lineNumber,
        column,
        kind: "image",
        destination: parseInlineDestination(match[2]),
        alt: match[1],
        source: "markdown-image",
      });
    });

    collectRegexMatches(scrubbedLine, linkInlineRe, (match, column) => {
      occurrences.push({
        file: filePath,
        line: lineNumber,
        column,
        kind: "link",
        destination: parseInlineDestination(match[2]),
        source: "markdown-link",
      });
    });

    collectRegexMatches(scrubbedLine, imageRefRe, (match, column) => {
      const fallbackLabel = match[1];
      const label = normalizeReferenceLabel(match[2] || fallbackLabel);
      const destination = references.get(label);
      if (!destination) {
        addIssue({
          level: "error",
          code: "REFERENCE_IMAGE_UNRESOLVED",
          file: filePath,
          line: lineNumber,
          column,
          message: `Image reference not found: [${match[2] || fallbackLabel}]`,
        });
        return;
      }
      occurrences.push({
        file: filePath,
        line: lineNumber,
        column,
        kind: "image",
        destination,
        alt: match[1],
        source: "markdown-image-reference",
      });
    });

    collectRegexMatches(scrubbedLine, linkRefRe, (match, column) => {
      const fallbackLabel = match[1];
      const label = normalizeReferenceLabel(match[2] || fallbackLabel);
      const destination = references.get(label);
      if (!destination) {
        addIssue({
          level: "error",
          code: "REFERENCE_LINK_UNRESOLVED",
          file: filePath,
          line: lineNumber,
          column,
          message: `Link reference not found: [${match[2] || fallbackLabel}]`,
        });
        return;
      }
      occurrences.push({
        file: filePath,
        line: lineNumber,
        column,
        kind: "link",
        destination,
        source: "markdown-link-reference",
      });
    });

    collectRegexMatches(scrubbedLine, autoLinkRe, (match, column) => {
      occurrences.push({
        file: filePath,
        line: lineNumber,
        column,
        kind: "link",
        destination: match[1],
        source: "markdown-autolink",
      });
    });

    collectHtmlTagOccurrences(scrubbedLine, "img", (tag, column) => {
      const src = getHtmlAttribute(tag, "src");
      const alt = getHtmlAttribute(tag, "alt");
      if (!src) {
        addIssue({
          level: "error",
          code: "HTML_IMG_SRC_MISSING",
          file: filePath,
          line: lineNumber,
          column,
          message: "<img> tag is missing src.",
        });
        return;
      }

      occurrences.push({
        file: filePath,
        line: lineNumber,
        column,
        kind: "image",
        destination: src,
        alt,
        source: "html-image",
      });
    });

    collectHtmlTagOccurrences(scrubbedLine, "a", (tag, column) => {
      const href = getHtmlAttribute(tag, "href");
      if (!href) {
        return;
      }
      occurrences.push({
        file: filePath,
        line: lineNumber,
        column,
        kind: "link",
        destination: href,
        source: "html-link",
      });
    });

    collectHtmlTagOccurrences(scrubbedLine, "iframe", (tag, column) => {
      const src = getHtmlAttribute(tag, "src");
      if (!src) {
        return;
      }
      occurrences.push({
        file: filePath,
        line: lineNumber,
        column,
        kind: "link",
        destination: src,
        source: "html-iframe",
      });
    });
  }

  return occurrences;
}

function collectRegexMatches(line, regex, onMatch) {
  regex.lastIndex = 0;
  let match;
  while ((match = regex.exec(line))) {
    const column = Number(match.index || 0) + 1;
    onMatch(match, column);
  }
}

function collectHtmlTagOccurrences(line, tagName, onMatch) {
  const regex = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  collectRegexMatches(line, regex, (match, column) => {
    onMatch(match[0], column);
  });
}

function getHtmlAttribute(tag, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escapedName}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'=<>]+))`, "i");
  const match = regex.exec(tag);
  if (!match) {
    return "";
  }
  return String(match[1] || match[2] || match[3] || "").trim();
}

function validateOccurrence(occurrence, context) {
  const destinationRaw = String(occurrence.destination || "").trim();
  if (!destinationRaw) {
    addIssue({
      level: "error",
      code: "LINK_EMPTY_DESTINATION",
      file: occurrence.file,
      line: occurrence.line,
      column: occurrence.column,
      message: `${occurrence.kind} has an empty destination.`,
    });
    return;
  }

  if (occurrence.kind === "image" && !String(occurrence.alt || "").trim()) {
    addIssue({
      level: "warning",
      code: "IMAGE_ALT_MISSING",
      file: occurrence.file,
      line: occurrence.line,
      column: occurrence.column,
      message: "Image alt text is empty.",
    });
  }

  const classified = classifyDestination(destinationRaw);
  if (classified.type === "error") {
    addIssue({
      level: "error",
      code: "LINK_INVALID_DESTINATION",
      file: occurrence.file,
      line: occurrence.line,
      column: occurrence.column,
      message: classified.message,
    });
    return;
  }

  if (classified.type === "skip") {
    return;
  }

  if (classified.type === "external") {
    return;
  }

  if (classified.type === "anchor") {
    const anchor = normalizeAnchor(classified.anchor);
    if (!anchor) {
      return;
    }
    if (!context.sectionAnchors.has(anchor)) {
      addIssue({
        level: "error",
        code: "LINK_ANCHOR_MISSING",
        file: occurrence.file,
        line: occurrence.line,
        column: occurrence.column,
        message: `Internal anchor not found: #${anchor}`,
      });
    }
    return;
  }

  if (classified.type === "internal") {
    const repoPath = classifyInternalRepoPath(classified.path, occurrence.kind);
    if (!repoPath.ok) {
      addIssue({
        level: "error",
        code: "LINK_PATH_INVALID",
        file: occurrence.file,
        line: occurrence.line,
        column: occurrence.column,
        message: repoPath.message,
      });
      return;
    }

    if (repoPath.path && !context.repoFiles.has(repoPath.path)) {
      addIssue({
        level: "error",
        code: occurrence.kind === "image" ? "IMAGE_FILE_MISSING" : "LINK_FILE_MISSING",
        file: occurrence.file,
        line: occurrence.line,
        column: occurrence.column,
        message: `Referenced file does not exist: ${repoPath.path}`,
      });
      return;
    }

    const anchor = normalizeAnchor(classified.anchor);
    if (anchor && !context.sectionAnchors.has(anchor)) {
      addIssue({
        level: "error",
        code: "LINK_ANCHOR_MISSING",
        file: occurrence.file,
        line: occurrence.line,
        column: occurrence.column,
        message: `Internal anchor not found: #${anchor}`,
      });
    }
  }
}

function classifyDestination(destination) {
  const trimmed = String(destination || "").trim().replace(/^<|>$/g, "");
  if (!trimmed) {
    return { type: "error", message: "Destination is empty." };
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("javascript:")) {
    return { type: "error", message: "javascript: links are not allowed." };
  }

  if (
    lower.startsWith("mailto:")
    || lower.startsWith("tel:")
    || lower.startsWith("sms:")
    || lower.startsWith("data:")
    || lower.startsWith("blob:")
  ) {
    return { type: "skip" };
  }

  if (trimmed.startsWith("#")) {
    return { type: "anchor", anchor: trimmed.slice(1) };
  }

  if (trimmed.startsWith("/#")) {
    return { type: "anchor", anchor: trimmed.slice(2) };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch (error) {
      return { type: "error", message: `Invalid URL: ${trimmed}` };
    }

    const hostname = String(parsed.hostname || "").toLowerCase();
    if (INTERNAL_HOSTS.has(hostname)) {
      const pathPart = parsed.pathname || "/";
      const anchor = parsed.hash ? parsed.hash.slice(1) : "";
      return {
        type: "internal",
        path: pathPart,
        anchor,
      };
    }

    parsed.hash = "";
    return { type: "external", url: parsed.toString() };
  }

  if (trimmed.startsWith("//")) {
    return classifyDestination(`https:${trimmed}`);
  }

  const hashIndex = trimmed.indexOf("#");
  const queryIndex = trimmed.indexOf("?");
  const splitIndex = [hashIndex, queryIndex].filter((index) => index >= 0).sort((a, b) => a - b)[0];

  const pathPart = splitIndex === undefined ? trimmed : trimmed.slice(0, splitIndex);
  const hashPart = hashIndex >= 0 ? trimmed.slice(hashIndex + 1) : "";

  return {
    type: "internal",
    path: pathPart,
    anchor: hashPart,
  };
}

function classifyInternalRepoPath(rawPath, kind = "link") {
  const source = String(rawPath || "").trim();
  if (!source || source === "/") {
    return { ok: true, path: "index.html" };
  }

  const withoutQuery = source.split("?")[0];
  const normalizedInput = withoutQuery
    .replace(/^\/+/, "")
    .replace(/^\.\/+/, "");

  if (!normalizedInput) {
    return { ok: true, path: "index.html" };
  }

  const imagePath = kind === "image" && !normalizedInput.startsWith("imgs/")
    ? `imgs/${normalizedInput}`
    : normalizedInput;
  const normalized = path.posix.normalize(imagePath);
  if (normalized.startsWith("../") || normalized === ".." || normalized.includes("/../")) {
    return { ok: false, message: `Invalid relative path traversal: ${rawPath}` };
  }

  return { ok: true, path: normalized };
}

function normalizeAnchor(rawAnchor) {
  const trimmed = String(rawAnchor || "").trim();
  if (!trimmed) {
    return "";
  }

  const normalized = decodeURIComponentSafe(trimmed)
    .replace(/^#+/, "")
    .replace(/^\/+/, "");

  return normalized;
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
}

function addIssue(issue) {
  const normalized = {
    level: issue.level === "warning" ? "warning" : "error",
    code: String(issue.code || "VALIDATION"),
    file: toPosixPath(String(issue.file || "")),
    line: Number.isFinite(issue.line) ? Math.max(1, Math.floor(issue.line)) : 1,
    column: Number.isFinite(issue.column) ? Math.max(1, Math.floor(issue.column)) : 1,
    message: String(issue.message || "Validation issue."),
  };
  issues.push(normalized);
}

function finalize(allIssues, scannedFiles) {
  allIssues.sort((a, b) => {
    const bySeverity = severityOrder(a.level) - severityOrder(b.level);
    if (bySeverity !== 0) {
      return bySeverity;
    }
    const byFile = a.file.localeCompare(b.file);
    if (byFile !== 0) {
      return byFile;
    }
    const byLine = a.line - b.line;
    if (byLine !== 0) {
      return byLine;
    }
    return a.column - b.column;
  });

  const errorCount = allIssues.filter((issue) => issue.level === "error").length;
  const warningCount = allIssues.length - errorCount;

  if (allIssues.length === 0) {
    console.log(`Markdown validation passed. ${scannedFiles.length} markdown files checked.`);
  } else {
    for (const issue of allIssues) {
      const prefix = issue.level === "error" ? "ERROR" : "WARN";
      console.log(`${prefix} ${issue.file}:${issue.line}:${issue.column} [${issue.code}] ${issue.message}`);
    }
    console.log(`\nMarkdown validation finished with ${errorCount} error(s), ${warningCount} warning(s).`);
  }

  emitGitHubAnnotations(allIssues);
  writeGitHubStepSummary(allIssues, errorCount, warningCount, scannedFiles.length);

  if (errorCount > 0) {
    process.exitCode = 1;
  }
}

function severityOrder(level) {
  return level === "error" ? 0 : 1;
}

function emitGitHubAnnotations(allIssues) {
  if (process.env.GITHUB_ACTIONS !== "true") {
    return;
  }

  const limitedIssues = allIssues.slice(0, MAX_GITHUB_ANNOTATIONS);
  for (const issue of limitedIssues) {
    const command = issue.level === "error" ? "error" : "warning";
    const file = escapeGithubCommandValue(issue.file);
    const message = escapeGithubCommandMessage(`[${issue.code}] ${issue.message}`);
    console.log(`::${command} file=${file},line=${issue.line},col=${issue.column}::${message}`);
  }

  if (allIssues.length > limitedIssues.length) {
    const hidden = allIssues.length - limitedIssues.length;
    const message = escapeGithubCommandMessage(`${hidden} additional issue(s) omitted from annotations.`);
    console.log(`::warning::${message}`);
  }
}

function writeGitHubStepSummary(allIssues, errorCount, warningCount, scannedFileCount) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }

  const lines = [];
  lines.push("## Markdown Validation");
  lines.push("");
  lines.push(`- Files scanned: **${scannedFileCount}**`);
  lines.push(`- Errors: **${errorCount}**`);
  lines.push(`- Warnings: **${warningCount}**`);
  lines.push("");

  if (allIssues.length === 0) {
    lines.push("No issues found.");
  } else {
    lines.push("| Level | File | Line | Code | Message |");
    lines.push("| --- | --- | ---: | --- | --- |");
    for (const issue of allIssues.slice(0, 200)) {
      const level = issue.level.toUpperCase();
      const file = issue.file.replace(/\|/g, "\\|");
      const code = issue.code.replace(/\|/g, "\\|");
      const message = issue.message.replace(/\|/g, "\\|");
      lines.push(`| ${level} | ${file} | ${issue.line} | ${code} | ${message} |`);
    }

    if (allIssues.length > 200) {
      lines.push("");
      lines.push(`... ${allIssues.length - 200} more issue(s) omitted.`);
    }
  }

  lines.push("");
  fs.appendFile(summaryPath, `${lines.join("\n")}\n`).catch(() => {});
}

function escapeGithubCommandValue(value) {
  return String(value || "")
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A")
    .replace(/,/g, "%2C")
    .replace(/:/g, "%3A");
}

function escapeGithubCommandMessage(value) {
  return String(value || "")
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
