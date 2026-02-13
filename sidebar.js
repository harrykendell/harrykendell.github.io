(function () {
  "use strict";

  const SEARCH_URL_PARAM = "q";
  const SEARCH_RESULT_LIMIT = 12;
  const SEARCH_MIN_QUERY_LENGTH = 2;
  const SEARCH_NODE_ID_ATTR = "search-node-id";
  const SECTION_GROUP_LABELS = {
    maintenance: "Maintenance",
    repairs: "Repairs",
    supplement: "Supplement",
    other: "Other",
  };

  let initialized = false;
  let searchIndex = [];
  let searchNodeCounter = 0;
  let searchInputDebounceId = null;
  const state = {
    query: "",
    normalizedQuery: "",
    tokens: [],
    results: [],
  };
  if (!window.AppUtils || typeof window.AppUtils.escapeHtml !== "function" || typeof window.AppUtils.escapeAttribute !== "function") {
    throw new Error("AppUtils is required before sidebar.js.");
  }
  const { escapeHtml, escapeAttribute } = window.AppUtils;

  function normalizeSearchText(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s/-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokenizeSearchQuery(query) {
    return normalizeSearchText(query)
      .split(" ")
      .map((token) => token.trim())
      .filter(Boolean);
  }

  function buildHighlightTokens(tokens, normalizedQuery) {
    const phrase = String(normalizedQuery || "").trim();
    const ordered = [];
    if (phrase.includes(" ") && phrase.length >= SEARCH_MIN_QUERY_LENGTH) {
      ordered.push(phrase);
    }
    (tokens || []).forEach((token) => {
      if (token && token.length >= 2) {
        ordered.push(token);
      }
    });

    const unique = [];
    const seen = new Set();
    ordered.forEach((value) => {
      if (seen.has(value)) {
        return;
      }
      seen.add(value);
      unique.push(value);
    });
    return unique;
  }

  function formatSectionGroupLabel(groupKey) {
    const key = String(groupKey || "").trim().toLowerCase();
    if (!key) {
      return "";
    }

    const knownLabel = SECTION_GROUP_LABELS[key];
    if (knownLabel) {
      return knownLabel;
    }

    return key
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function isSectionLevelResult(item) {
    if (!item || item.kind === "procedure") {
      return false;
    }

    const sectionId = String(item.sectionId || "").trim();
    if (!sectionId) {
      return false;
    }

    const headingLevel = Number.isFinite(item.headingLevel) ? item.headingLevel : NaN;
    const isSectionHeading = item.kind === "heading" && headingLevel <= 2;
    const isSectionContent = item.kind === "content" && item.targetId === sectionId;
    const isSectionResult = item.kind === "section";
    return isSectionHeading || isSectionContent || isSectionResult;
  }

  function getSectionLevelDedupeKey(item) {
    if (!isSectionLevelResult(item)) {
      return "";
    }

    const sectionId = String(item.sectionId || "").trim();
    const normalizedTitle = normalizeSearchText(item.title || "");
    if (!sectionId || !normalizedTitle) {
      return "";
    }

    return `${sectionId}|${normalizedTitle}`;
  }

  function getSectionTitleDisambiguationKey(item) {
    if (!isSectionLevelResult(item)) {
      return "";
    }

    const normalizedTitle = normalizeSearchText(item.sectionTitle || item.title || "");
    return normalizedTitle || "";
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function buildSearchSnippet(text, tokens, maxLength = 170) {
    const compactText = String(text || "").replace(/\s+/g, " ").trim();
    if (!compactText) {
      return "";
    }

    if (compactText.length <= maxLength) {
      return compactText;
    }

    const lower = compactText.toLowerCase();
    let focusIndex = -1;
    tokens.forEach((token) => {
      if (focusIndex !== -1 || !token) {
        return;
      }
      const index = lower.indexOf(token);
      if (index !== -1) {
        focusIndex = index;
      }
    });

    if (focusIndex === -1) {
      return `${compactText.slice(0, maxLength - 1).trimEnd()}…`;
    }

    const contextPadding = 48;
    let start = Math.max(0, focusIndex - contextPadding);
    let end = Math.min(compactText.length, start + maxLength);

    if (end >= compactText.length) {
      start = Math.max(0, compactText.length - maxLength);
    }

    const prefix = start > 0 ? "…" : "";
    const suffix = end < compactText.length ? "…" : "";
    return `${prefix}${compactText.slice(start, end).trim()}${suffix}`;
  }

  function highlightSearchText(text, tokens) {
    const rawText = String(text || "");
    if (!rawText) {
      return "";
    }

    const tokenList = (tokens || [])
      .map((token) => String(token || "").trim())
      .filter(Boolean);
    if (!tokenList.length) {
      return escapeHtml(rawText);
    }

    const uniqueTokens = [];
    const seen = new Set();
    tokenList.forEach((token) => {
      if (seen.has(token)) {
        return;
      }
      seen.add(token);
      uniqueTokens.push(token);
    });
    if (!uniqueTokens.length) {
      return escapeHtml(rawText);
    }

    const pattern = uniqueTokens
      .sort((a, b) => b.length - a.length)
      .map((token) => escapeRegExp(token))
      .join("|");
    if (!pattern) {
      return escapeHtml(rawText);
    }

    const regex = new RegExp(pattern, "gi");
    let output = "";
    let lastIndex = 0;
    let match = regex.exec(rawText);
    while (match) {
      const start = match.index;
      const end = start + match[0].length;
      if (start > lastIndex) {
        output += escapeHtml(rawText.slice(lastIndex, start));
      }
      output += `<mark>${escapeHtml(rawText.slice(start, end))}</mark>`;
      lastIndex = end;
      if (regex.lastIndex === start) {
        regex.lastIndex = end;
      }
      match = regex.exec(rawText);
    }
    if (lastIndex < rawText.length) {
      output += escapeHtml(rawText.slice(lastIndex));
    }

    return output || escapeHtml(rawText);
  }

  function fuzzySubsequenceScore(queryToken, corpus) {
    if (!queryToken || !corpus) {
      return 0;
    }

    let queryIndex = 0;
    let score = 0;
    let streak = 0;
    for (let corpusIndex = 0; corpusIndex < corpus.length; corpusIndex += 1) {
      if (queryIndex >= queryToken.length) {
        break;
      }

      if (queryToken[queryIndex] === corpus[corpusIndex]) {
        queryIndex += 1;
        streak += 1;
        score += 1 + Math.min(4, streak) * 0.35;
      } else {
        streak = 0;
      }
    }

    if (queryIndex !== queryToken.length) {
      return 0;
    }

    const normalized = score / (queryToken.length * 2.4);
    return Math.max(0, Math.min(1, normalized));
  }

  function computeSearchScore(item, normalizedQuery, queryTokens) {
    if (!item || !item.normalizedCorpus || !normalizedQuery || queryTokens.length === 0) {
      return null;
    }

    const corpus = item.normalizedCorpus;
    const title = item.normalizedTitle || "";
    const sectionTitle = item.normalizedSectionTitle || "";
    const preview = item.normalizedPreview || "";
    let score = item.baseWeight;
    let matchedTokenCount = 0;
    let directTokenCount = 0;
    let matchedInSection = false;
    let matchedInTitleOrPreview = false;

    const phraseIndex = corpus.indexOf(normalizedQuery);
    if (phraseIndex >= 0) {
      score += 84;
      score += Math.max(0, 22 - Math.floor(phraseIndex / 14));
      if (title.includes(normalizedQuery) || preview.includes(normalizedQuery)) {
        matchedInTitleOrPreview = true;
      } else if (sectionTitle.includes(normalizedQuery)) {
        matchedInSection = true;
      }
    }

    queryTokens.forEach((token) => {
      if (!token) {
        return;
      }

      const directIndex = corpus.indexOf(token);
      if (directIndex >= 0) {
        const tokenInTitle = title.includes(token);
        const tokenInPreview = preview.includes(token);
        const tokenInSection = sectionTitle.includes(token);

        if (tokenInTitle || tokenInPreview) {
          matchedInTitleOrPreview = true;
        } else if (tokenInSection) {
          matchedInSection = true;
        }

        matchedTokenCount += 1;
        directTokenCount += 1;
        score += 24;
        score += Math.max(0, 10 - Math.floor(directIndex / 20));
        if (tokenInTitle) {
          score += 14;
        }
        if (new RegExp(`\\b${escapeRegExp(token)}`).test(corpus)) {
          score += 8;
        }
        return;
      }

      const fuzzyCorpus = fuzzySubsequenceScore(token, corpus);
      const fuzzyTitle = fuzzySubsequenceScore(token, title);
      const fuzzyPreview = fuzzySubsequenceScore(token, preview);
      const fuzzySection = fuzzySubsequenceScore(token, sectionTitle);
      const fuzzyScore = Math.max(fuzzyCorpus, fuzzyTitle);
      if (fuzzyScore >= 0.74) {
        if (fuzzyTitle >= 0.74 || fuzzyPreview >= 0.74) {
          matchedInTitleOrPreview = true;
        } else if (fuzzySection >= 0.74) {
          matchedInSection = true;
        }
        matchedTokenCount += 1;
        score += Math.round(fuzzyScore * 16);
        if (fuzzyTitle >= 0.85) {
          score += 4;
        }
      }
    });

    const requiredMatches = queryTokens.length === 1
      ? 1
      : Math.ceil(queryTokens.length * 0.67);
    if (matchedTokenCount < requiredMatches) {
      return null;
    }

    if (directTokenCount === queryTokens.length) {
      score += 24;
    }
    if (title.startsWith(normalizedQuery)) {
      score += 26;
    } else if (title.includes(normalizedQuery)) {
      score += 13;
    }

    score += Math.round((matchedTokenCount / queryTokens.length) * 22);

    // Filter out non-section-level matches that only matched the section title.
    if (!isSectionLevelResult(item) && matchedInSection && !matchedInTitleOrPreview) {
      return null;
    }

    return score;
  }

  function isSearchableContentNode(node) {
    if (!(node instanceof HTMLElement)) {
      return false;
    }

    const tag = node.tagName;
    if (/^H[1-6]$/.test(tag) && node.id) {
      return true;
    }

    if (tag === "P" || tag === "LI" || tag === "TD" || tag === "TH" || tag === "FIGCAPTION") {
      return true;
    }

    return node.classList.contains("procedure-description")
      || node.classList.contains("procedure-title")
      || node.classList.contains("procedure-skill-badge")
      || node.classList.contains("callout-title");
  }

  function hasTokenMatchInText(text, tokens) {
    const normalizedText = normalizeSearchText(text);
    if (!normalizedText) {
      return false;
    }

    return (tokens || []).some((token) => token && normalizedText.includes(token));
  }

  function resolveSnippetSource(result, normalizedQuery, tokens) {
    if (!result) {
      return "";
    }

    const phrase = String(normalizedQuery || "");
    const candidates = [
      result.previewText || "",
      result.title || "",
      result.sectionTitle || "",
    ];

    const phraseCandidate = candidates.find((candidate) => {
      const normalized = normalizeSearchText(candidate);
      return normalized && phrase && normalized.includes(phrase);
    });
    if (phraseCandidate) {
      return phraseCandidate;
    }

    const tokenCandidate = candidates.find((candidate) =>
      hasTokenMatchInText(candidate, tokens));
    if (tokenCandidate) {
      return tokenCandidate;
    }

    return result.previewText || result.title || result.sectionTitle || "";
  }

  function addSearchIndexItem(items, dedupe, item) {
    if (!item || !item.targetId || !item.title) {
      return;
    }

    const normalizedTitle = normalizeSearchText(item.title);
    const normalizedSectionTitle = normalizeSearchText(item.sectionTitle || "");
    const normalizedPreview = normalizeSearchText(item.previewText || "");
    const normalizedCorpus = [normalizedTitle, normalizedSectionTitle, normalizedPreview]
      .filter(Boolean)
      .join(" ");

    if (!normalizedCorpus) {
      return;
    }

    const dedupeKey = `${item.targetId}|${item.kind}|${normalizedPreview.slice(0, 120)}`;
    if (dedupe.has(dedupeKey)) {
      return;
    }
    dedupe.add(dedupeKey);

    items.push({
      ...item,
      normalizedTitle,
      normalizedSectionTitle,
      normalizedPreview,
      normalizedCorpus,
    });
  }

  function ensureSearchNodeId(node) {
    if (!(node instanceof Element)) {
      return "";
    }

    const existing = (node.getAttribute(SEARCH_NODE_ID_ATTR) || "").trim();
    if (existing) {
      return existing;
    }

    searchNodeCounter += 1;
    const nextId = `snode-${searchNodeCounter}`;
    node.setAttribute(SEARCH_NODE_ID_ATTR, nextId);
    return nextId;
  }

  function getSearchNodeById(nodeId) {
    const normalizedNodeId = String(nodeId || "").trim();
    if (!normalizedNodeId || !/^[-a-zA-Z0-9_]+$/.test(normalizedNodeId)) {
      return null;
    }
    const selector = `#preface-content [${SEARCH_NODE_ID_ATTR}="${normalizedNodeId}"], #sections-container [${SEARCH_NODE_ID_ATTR}="${normalizedNodeId}"]`;
    return document.querySelector(selector);
  }

  function getProcedureTitleForNode(node) {
    if (!(node instanceof Element)) {
      return "";
    }

    const procedure = node.closest(".procedure");
    if (!procedure) {
      return "";
    }

    const titleEl = procedure.querySelector(".procedure-title");
    if (!titleEl) {
      return "";
    }

    const preferredTitle = titleEl.querySelector(".procedure-title-text")
      || titleEl.querySelector("span:nth-of-type(2)");
    const rawTitle = preferredTitle
      ? preferredTitle.textContent
      : titleEl.textContent;
    return String(rawTitle || "").replace(/\s+/g, " ").trim();
  }

  function formatSkillLabel(value) {
    const cleaned = String(value || "").trim();
    if (!cleaned) {
      return "";
    }
    return cleaned
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function getProcedureSkillInfo(procedure) {
    if (!(procedure instanceof Element)) {
      return { skill: "", label: "" };
    }

    const skill = String(procedure.getAttribute("data-skill") || "").trim().toLowerCase();
    if (!skill) {
      return { skill: "", label: "" };
    }

    const badge = procedure.querySelector(".procedure-skill-badge");
    const badgeText = badge ? badge.textContent : "";
    const label = formatSkillLabel(badgeText || skill);
    return { skill, label };
  }

  function indexSearchableContainer(options) {
    const {
      root,
      sectionId,
      sectionTitle,
      sectionGroup,
      sectionTargetId,
      headingBaseWeight,
      contentBaseWeight,
      items,
      dedupe,
    } = options;

    if (!root) {
      return;
    }

    let currentHeadingId = sectionTargetId;
    let currentHeadingTitle = sectionTitle;
    let currentHeadingLevel = 2;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      if (isSearchableContentNode(node)) {
        const text = (node.textContent || "").replace(/\s+/g, " ").trim();
        if (text) {
          const sourceNodeId = ensureSearchNodeId(node);
          if (/^H[1-6]$/.test(node.tagName) && node.id) {
            currentHeadingId = node.id;
            currentHeadingTitle = text;
            const level = parseInt(node.tagName.slice(1), 10);
            const levelPenalty = Number.isNaN(level) ? 0 : Math.max(0, level - 2);
            if (!Number.isNaN(level)) {
              currentHeadingLevel = level;
            }
            addSearchIndexItem(items, dedupe, {
              kind: "heading",
              targetId: currentHeadingId,
              sectionId,
              sectionGroup,
              sectionTitle,
              title: text,
              previewText: "",
              sourceNodeId,
              headingTitle: text,
              headingLevel: currentHeadingLevel,
              baseWeight: headingBaseWeight - levelPenalty * 4,
            });
          } else if (text.length >= 24) {
            const isProcedureContent = !!node.closest(".procedure");
            const isProcedureTitleNode = isProcedureContent
              && node.classList.contains("procedure-title");
            const procedureContainer = isProcedureContent
              ? node.closest(".procedure")
              : null;
            const procedureGroupId = procedureContainer
              ? ensureSearchNodeId(procedureContainer)
              : "";
            const procedureTitle = isProcedureContent
              ? getProcedureTitleForNode(node)
              : "";
            const procedureSkillInfo = isProcedureContent
              ? getProcedureSkillInfo(procedureContainer)
              : { skill: "", label: "" };
            const resultTitle = isProcedureContent
              ? (procedureTitle || currentHeadingTitle || sectionTitle)
              : (currentHeadingTitle || sectionTitle);
            addSearchIndexItem(items, dedupe, {
              kind: isProcedureContent ? "procedure" : "content",
              targetId: currentHeadingId || sectionTargetId,
              sectionId,
              sectionGroup,
              sectionTitle,
              title: resultTitle,
              previewText: isProcedureTitleNode ? "" : text,
              sourceNodeId,
              procedureGroupId,
              procedureTitle,
              procedureSkill: procedureSkillInfo.skill,
              procedureSkillLabel: procedureSkillInfo.label,
              headingTitle: currentHeadingTitle,
              headingLevel: currentHeadingLevel,
              baseWeight: contentBaseWeight,
            });
          }
        }
      }
      node = walker.nextNode();
    }
  }

  function buildSearchIndex() {
    const items = [];
    const dedupe = new Set();
    const preface = document.getElementById("preface-content");
    const usedHeadingIds = new Set();

    function ensureHeadingId(heading, baseId) {
      if (!(heading instanceof Element)) {
        return "";
      }

      const existing = (heading.getAttribute("id") || "").trim();
      if (existing) {
        usedHeadingIds.add(existing);
        return existing;
      }

      const base = String(baseId || "heading").replace(/[^a-z0-9_-]+/gi, "-");
      let candidate = `${base}-title`;
      let suffix = 2;
      while (usedHeadingIds.has(candidate) || document.getElementById(candidate)) {
        candidate = `${base}-title-${suffix}`;
        suffix += 1;
      }
      heading.setAttribute("id", candidate);
      usedHeadingIds.add(candidate);
      return candidate;
    }

    if (preface) {
      indexSearchableContainer({
        root: preface,
        sectionId: "preface",
        sectionTitle: "Introduction",
        sectionGroup: "supplement",
        sectionTargetId: "top",
        headingBaseWeight: 122,
        contentBaseWeight: 82,
        items,
        dedupe,
      });
    }

    const sections = Array.from(document.querySelectorAll(".section"));
    sections.forEach((section) => {
      const sectionId = section.id;
      if (!sectionId) {
        return;
      }

      const sectionTitleEl = section.querySelector(".section-header h2");
      const sectionTitle = sectionTitleEl
        ? (sectionTitleEl.textContent || "").trim()
        : sectionId;
      const sectionGroup = typeof getSectionGroup === "function"
        ? getSectionGroup(sectionId)
        : "";

      if (sectionTitleEl) {
        const sectionHeadingId = ensureHeadingId(sectionTitleEl, sectionId);
        const sourceNodeId = ensureSearchNodeId(sectionTitleEl);
        addSearchIndexItem(items, dedupe, {
          kind: "heading",
          targetId: sectionHeadingId,
          sectionId,
          sectionGroup,
          sectionTitle,
          title: sectionTitle,
          previewText: "",
          sourceNodeId,
          headingTitle: sectionTitle,
          headingLevel: 2,
          baseWeight: 140,
        });
      }

      const contentRoot = section.querySelector(".section-content");
      indexSearchableContainer({
        root: contentRoot,
        sectionId,
        sectionTitle,
        sectionGroup,
        sectionTargetId: sectionId,
        headingBaseWeight: 132,
        contentBaseWeight: 88,
        items,
        dedupe,
      });
    });

    searchIndex = items;
  }

  function getSearchElements() {
    return {
      sidebar: document.getElementById("sidebar"),
      input: document.getElementById("toc-search-input"),
      clear: document.getElementById("toc-search-clear"),
      results: document.getElementById("toc-search-results"),
    };
  }

  function expandSectionForElement(element) {
    let expanded = false;
    if (!element) {
      return expanded;
    }
    const parentSection = element.closest(".section.collapsed");
    if (!parentSection) {
      return expanded;
    }
    if (typeof setSectionCollapsed === "function") {
      setSectionCollapsed(parentSection, false, { syncActive: false });
      expanded = true;
    } else {
      const header = parentSection.querySelector(".section-header");
      if (header) {
        header.click();
        expanded = true;
      }
    }
    return expanded;
  }

  function expandProcedureForElement(element) {
    let expanded = false;
    if (!element) {
      return expanded;
    }
    const parentProcedure = element.closest(".procedure.collapsed");
    if (!parentProcedure) {
      return expanded;
    }
    if (typeof setProcedureCollapsed === "function") {
      setProcedureCollapsed(parentProcedure, false);
      expanded = true;
    } else {
      const header = parentProcedure.querySelector(".procedure-header");
      if (header) {
        header.click();
        expanded = true;
      }
    }
    return expanded;
  }

  function expandAncestorsForElement(element) {
    const sectionExpanded = expandSectionForElement(element);
    const procedureExpanded = expandProcedureForElement(element);
    return sectionExpanded || procedureExpanded;
  }

  function scrollToSearchSourceNode(sourceNodeId) {
    const sourceNode = getSearchNodeById(sourceNodeId);
    if (!sourceNode) {
      return false;
    }

    const expanded = expandAncestorsForElement(sourceNode);
    const performScroll = () => {
      const targetTop = sourceNode.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({
        top: Math.max(targetTop - 116, 0),
        behavior: "smooth",
      });
      const flashTarget = getFlashTarget(sourceNode);
      if (flashTarget) {
        flashSearchTarget(flashTarget);
      }
    };

    if (expanded) {
      window.setTimeout(() => {
        window.requestAnimationFrame(performScroll);
      }, 140);
      return true;
    }

    performScroll();
    return true;
  }

  function cancelSearch() {
    if (searchInputDebounceId) {
      window.clearTimeout(searchInputDebounceId);
      searchInputDebounceId = null;
    }
    setSearchQuery("", { updateUrl: true, syncInput: true });
  }

  function getSearchQueryFromUrl() {
    const url = new URL(window.location.href);
    return String(url.searchParams.get(SEARCH_URL_PARAM) || "").trim();
  }

  function setSearchQueryInUrl(rawQuery) {
    const query = String(rawQuery || "").trim();
    const url = new URL(window.location.href);
    if (query) {
      url.searchParams.set(SEARCH_URL_PARAM, query);
    } else {
      url.searchParams.delete(SEARCH_URL_PARAM);
    }
    history.replaceState(null, document.title, `${url.pathname}${url.search}${url.hash}`);
  }

  function shouldRenderResultSnippet(result, snippetText) {
    if (!result || !snippetText) {
      return false;
    }

    if (result.kind === "heading") {
      return false;
    }

    const normalizedSnippet = normalizeSearchText(snippetText);
    if (!normalizedSnippet) {
      return false;
    }

    const normalizedTitle = normalizeSearchText(result.title || "");
    if (normalizedSnippet === normalizedTitle) {
      return false;
    }

    return true;
  }

  function renderSearchResults(results, tokens, rawQuery) {
    const { sidebar, clear, results: resultsEl } = getSearchElements();
    if (!sidebar || !clear || !resultsEl) {
      return;
    }

    const query = String(rawQuery || "").trim();
    const normalizedQuery = normalizeSearchText(query);
    clear.hidden = !query;
    if (!query) {
      sidebar.classList.remove("search-active");
      resultsEl.hidden = true;
      resultsEl.innerHTML = "";
      return;
    }

    sidebar.classList.add("search-active");
    resultsEl.hidden = false;

    if (state.normalizedQuery.length < SEARCH_MIN_QUERY_LENGTH) {
      resultsEl.innerHTML = "<p class=\"toc-search-empty\">Type at least 2 characters.</p>";
      return;
    }

    if (!results || results.length === 0) {
      resultsEl.innerHTML = `<p class="toc-search-empty">No matches for “${escapeHtml(query)}”.</p>`;
      return;
    }

    const snippetTokens = buildHighlightTokens(tokens, normalizedQuery);
    const sectionTitleGroups = new Map();
    results.forEach((result) => {
      const key = getSectionTitleDisambiguationKey(result);
      if (!key) {
        return;
      }
      const groupKey = String(result.sectionGroup || "").trim().toLowerCase() || "__none__";
      const groups = sectionTitleGroups.get(key) || new Set();
      groups.add(groupKey);
      sectionTitleGroups.set(key, groups);
    });

    const rows = results.map((result) => {
      const isProcedureContext = result.kind === "procedure";
      const isHeadingResult = result.kind === "heading";
      const highlightedTitle = highlightSearchText(result.title, snippetTokens);
      const headingTitleHtml = `<span class="toc-search-result-title-heading">${highlightedTitle}</span>`;
      let titleHtml = highlightedTitle;
      if (isHeadingResult) {
        titleHtml = headingTitleHtml;
      } else if (result.kind === "section") {
        titleHtml = `<span class="toc-search-result-title-section">${highlightedTitle}</span>`;
      }
      const snippetSource = resolveSnippetSource(result, normalizedQuery, snippetTokens);
      const snippet = buildSearchSnippet(snippetSource, snippetTokens);
      const showSnippet = shouldRenderResultSnippet(result, snippet);
      const snippetHtml = showSnippet ? highlightSearchText(snippet, snippetTokens) : "";

      const contextParts = [];
      const sectionGroupLabel = formatSectionGroupLabel(result.sectionGroup);
      const includesSectionInMeta = result.kind === "section"
        || (result.sectionTitle && result.sectionTitle !== result.title);
      const sectionTitleKey = getSectionTitleDisambiguationKey(result);
      const groupSet = sectionTitleKey ? sectionTitleGroups.get(sectionTitleKey) : null;
      const hasCrossGroupTitleDuplicate = !!(groupSet && groupSet.size > 1);
      if (sectionGroupLabel && (includesSectionInMeta || hasCrossGroupTitleDuplicate)) {
        contextParts.push(sectionGroupLabel);
      }
      if (result.sectionTitle && result.sectionTitle !== result.title) {
        contextParts.push(result.sectionTitle);
      }
      if (result.headingTitle && result.headingTitle !== result.title && result.headingTitle !== result.sectionTitle) {
        contextParts.push(result.headingTitle);
      }

      const skillValue = String(result.procedureSkill || "").trim();
      const skillLabel = String(result.procedureSkillLabel || skillValue || "").trim();
      const skillBadgeHtml = skillValue
        ? `<span class="procedure-skill-badge" data-skill="${escapeAttribute(skillValue)}">${escapeHtml(skillLabel)}</span>`
        : "";
      const headingLevel = Number.isFinite(result.headingLevel) ? String(result.headingLevel) : "";
      const resultClasses = `toc-search-result${isProcedureContext ? " procedure" : ""}`;
      const skillDataAttr = skillValue && isProcedureContext
        ? ` data-skill="${escapeAttribute(skillValue)}"`
        : "";

      return `
      <li>
        <button type="button" class="${resultClasses}" search-target="${escapeAttribute(result.targetId)}" search-kind="${escapeAttribute(result.kind)}"${headingLevel ? ` search-heading-level="${escapeAttribute(headingLevel)}"` : ""}${skillValue ? ` search-skill="${escapeAttribute(skillValue)}"` : ""}${skillDataAttr} search-node-id="${escapeAttribute(result.sourceNodeId || "")}">
          <span class="toc-search-result-title">
            ${isProcedureContext ? "<span class=\"toc-search-result-procedure-icon\" aria-hidden=\"true\">🛠</span>" : ""}
            <span class="toc-search-result-title-text">${titleHtml}</span>
            ${skillBadgeHtml}
          </span>
          ${contextParts.length ? `<span class="toc-search-result-meta">${escapeHtml(contextParts.join(" → "))}</span>` : ""}
          ${showSnippet ? `<span class="toc-search-result-snippet">${snippetHtml}</span>` : ""}
        </button>
      </li>
    `;
    }).join("");

    resultsEl.innerHTML = `<ul class="toc-search-results-list">${rows}</ul>`;
  }

  function runSearch(rawQuery) {
    const normalizedQuery = normalizeSearchText(rawQuery);
    const queryTokens = tokenizeSearchQuery(rawQuery);
    if (!normalizedQuery || normalizedQuery.length < SEARCH_MIN_QUERY_LENGTH || queryTokens.length === 0) {
      return [];
    }

    const scoredItems = [];
    searchIndex.forEach((item) => {
      const score = computeSearchScore(item, normalizedQuery, queryTokens);
      if (score === null) {
        return;
      }
      scoredItems.push({ item, score });
    });

    const bestByTarget = new Map();
    scoredItems.forEach((scoredItem) => {
      const item = scoredItem.item;
      const key = item.kind === "procedure"
        ? `${item.targetId}|procedure|${item.procedureGroupId || item.sourceNodeId || item.title || ""}`
        : item.targetId;
      const existing = bestByTarget.get(key);
      if (!existing || scoredItem.score > existing.score) {
        bestByTarget.set(key, scoredItem);
      }
    });

    const kindRank = {
      section: 0,
      heading: 1,
      procedure: 2,
      content: 3,
    };

    const sorted = Array.from(bestByTarget.values())
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        const leftKind = kindRank[left.item.kind] ?? 99;
        const rightKind = kindRank[right.item.kind] ?? 99;
        if (leftKind !== rightKind) {
          return leftKind - rightKind;
        }

        const leftLength = left.item.title.length;
        const rightLength = right.item.title.length;
        if (leftLength !== rightLength) {
          return leftLength - rightLength;
        }

        return left.item.targetId.localeCompare(right.item.targetId);
      });

    const dedupedResults = [];
    const seenSectionLevelKeys = new Set();
    sorted.forEach((entry) => {
      if (dedupedResults.length >= SEARCH_RESULT_LIMIT) {
        return;
      }

      const sectionLevelKey = getSectionLevelDedupeKey(entry.item);
      if (sectionLevelKey) {
        if (seenSectionLevelKeys.has(sectionLevelKey)) {
          return;
        }
        seenSectionLevelKeys.add(sectionLevelKey);
      }

      dedupedResults.push(entry.item);
    });

    return dedupedResults;
  }

  function isTypingContext(target) {
    if (!(target instanceof Element)) {
      return false;
    }
    return !!target.closest("input, textarea, [contenteditable=''], [contenteditable='true'], [role='textbox']");
  }

  function flashSearchTarget(targetElement) {
    if (!targetElement || !targetElement.classList) {
      return;
    }
    targetElement.classList.remove("search-target-flash");
    // Restart animation.
    void targetElement.offsetWidth;
    targetElement.classList.add("search-target-flash");
    window.setTimeout(() => {
      targetElement.classList.remove("search-target-flash");
    }, 2000);
  }

  function getFlashTarget(element) {
    if (!(element instanceof Element)) {
      return null;
    }

    if (element.classList.contains("section")) {
      return element.querySelector(".section-header") || element;
    }

    const block = element.closest("p, li, td, th, blockquote, .procedure, .section-header, h1, h2, h3, h4, h5, h6");
    return block || element;
  }

  function navigateToSearchTarget(targetId, resultKind, sourceNodeId) {
    if (!targetId || typeof scrollToSection !== "function") {
      return;
    }

    const hash = `#${targetId}`;
    const isProcedureTarget = resultKind === "procedure";
    const usedDirectSourceScroll = scrollToSearchSourceNode(sourceNodeId);

    if (!usedDirectSourceScroll && !scrollToSection(hash, isProcedureTarget ? "auto" : "smooth")) {
      return;
    }

    const url = new URL(window.location.href);
    url.hash = hash;
    history.replaceState(null, document.title, `${url.pathname}${url.search}${url.hash}`);

    const target = document.getElementById(targetId);
    if (!usedDirectSourceScroll) {
      if (targetId === "top") {
        const prefaceTarget = document.querySelector(".page-header")
          || document.getElementById("preface-content");
        const flashTarget = getFlashTarget(prefaceTarget);
        if (flashTarget) {
          flashSearchTarget(flashTarget);
        }
      } else if (target) {
        const flashTarget = getFlashTarget(target);
        if (flashTarget) {
          flashSearchTarget(flashTarget);
        }
      }
    }

    if (window.matchMedia("(max-width: 860px)").matches && typeof window.setTocOpen === "function") {
      window.setTocOpen(false);
    }
  }

  function setSearchQuery(nextQuery, options) {
    const config = options || {};
    const updateUrl = config.updateUrl !== false;
    const syncInput = !!config.syncInput;

    const { sidebar, input } = getSearchElements();
    if (!sidebar || !input) {
      return;
    }

    const rawQuery = String(nextQuery || "");
    const normalizedQuery = normalizeSearchText(rawQuery);
    const tokens = tokenizeSearchQuery(rawQuery);

    state.query = rawQuery;
    state.normalizedQuery = normalizedQuery;
    state.tokens = tokens;
    state.results = runSearch(rawQuery);

    if (syncInput && input.value !== rawQuery) {
      input.value = rawQuery;
    }

    if (updateUrl) {
      setSearchQueryInUrl(rawQuery);
    }

    renderSearchResults(state.results, tokens, rawQuery);
  }

  function bindSearchInputHandlers(input, clear, results) {
    input.addEventListener("input", () => {
      if (searchInputDebounceId) {
        window.clearTimeout(searchInputDebounceId);
        searchInputDebounceId = null;
      }
      const nextValue = input.value;
      searchInputDebounceId = window.setTimeout(() => {
        setSearchQuery(nextValue, { updateUrl: true });
        searchInputDebounceId = null;
      }, 90);
    });

    clear.addEventListener("click", () => {
      cancelSearch();
      input.focus();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (input.value) {
          if (searchInputDebounceId) {
            window.clearTimeout(searchInputDebounceId);
            searchInputDebounceId = null;
          }
          cancelSearch();
        } else {
          input.blur();
        }
        return;
      }

      if (event.key === "Enter") {
        const firstResult = results.querySelector("button[search-target]");
        if (firstResult) {
          event.preventDefault();
          const targetId = firstResult.getAttribute("search-target");
          const resultKind = firstResult.getAttribute("search-kind");
          const sourceNodeId = firstResult.getAttribute("search-node-id");
          navigateToSearchTarget(targetId, resultKind, sourceNodeId);
        }
        return;
      }

      if (event.key === "ArrowDown") {
        const firstResult = results.querySelector("button[search-target]");
        if (firstResult) {
          event.preventDefault();
          firstResult.focus();
        }
      }
    });
  }

  function bindSearchResultsHandlers(input, results) {
    results.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const button = target.closest("button[search-target]");
      if (!button) {
        return;
      }
      navigateToSearchTarget(
        button.getAttribute("search-target"),
        button.getAttribute("search-kind"),
        button.getAttribute("search-node-id"),
      );
    });

    results.addEventListener("keydown", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const currentButton = target.closest("button[search-target]");
      if (!currentButton) {
        return;
      }
      const buttons = Array.from(results.querySelectorAll("button[search-target]"));
      const currentIndex = buttons.indexOf(currentButton);
      if (currentIndex === -1) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        const nextButton = buttons[currentIndex + 1] || buttons[0];
        if (nextButton) {
          nextButton.focus();
        }
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        const previousButton = buttons[currentIndex - 1] || buttons[buttons.length - 1];
        if (previousButton) {
          previousButton.focus();
        }
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        input.focus();
        input.select();
      }
    });
  }

  function bindSearchGlobalHandlers(input) {
    document.addEventListener("keydown", (event) => {
      if (event.defaultPrevented) {
        return;
      }
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (isTypingContext(event.target)) {
        return;
      }

      event.preventDefault();
      if (window.matchMedia("(max-width: 860px)").matches && typeof window.setTocOpen === "function") {
        window.setTocOpen(true);
      }
      input.focus();
      input.select();
    });

    window.addEventListener("popstate", () => {
      const queryFromUrl = getSearchQueryFromUrl();
      if (queryFromUrl === state.query) {
        return;
      }
      setSearchQuery(queryFromUrl, {
        updateUrl: false,
        syncInput: true,
      });
    });
  }

  function setup() {
    if (initialized) {
      return;
    }

    const { input, clear, results } = getSearchElements();
    if (!input || !clear || !results) {
      return;
    }
    initialized = true;

    bindSearchInputHandlers(input, clear, results);
    bindSearchResultsHandlers(input, results);
    bindSearchGlobalHandlers(input);

    const initialQuery = getSearchQueryFromUrl();
    setSearchQuery(initialQuery, {
      updateUrl: false,
      syncInput: true,
    });
  }

  function refreshIndex() {
    buildSearchIndex();
    if (!initialized) {
      return;
    }

    setSearchQuery(state.query, {
      updateUrl: false,
      syncInput: true,
    });
  }

  window.SearchBarSetup = setup;
  window.SearchBarRefreshIndex = refreshIndex;
}());
