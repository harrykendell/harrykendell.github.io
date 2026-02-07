(function () {
  "use strict";

  const SEARCH_URL_PARAM = "q";
  const SEARCH_RESULT_LIMIT = 12;
  const SEARCH_MIN_QUERY_LENGTH = 2;
  const SEARCH_HIGHLIGHT_LIMIT = 220;
  const SEARCH_RESULT_MARK_CLASS = "search-result-highlight";
  const SEARCH_CONTENT_MARK_CLASS = "search-highlight";

  const DEFAULT_GROUP_LABELS = {
    maintenance: "Maintenance",
    repairs: "Repairs",
    supplement: "Supplement",
  };

  let initialized = false;
  let searchIndex = [];
  let searchInputDebounceId = null;
  const navigatorUi = {
    root: null,
    count: null,
    cancel: null,
    next: null,
  };
  const state = {
    query: "",
    normalizedQuery: "",
    tokens: [],
    results: [],
    highlightMarks: [],
    highlightIndex: -1,
  };

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  function getSectionLabels() {
    if (
      window.SECTION_GROUPS
      && window.SECTION_GROUPS.labels
      && typeof window.SECTION_GROUPS.labels === "object"
    ) {
      return window.SECTION_GROUPS.labels;
    }
    return DEFAULT_GROUP_LABELS;
  }

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

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function mergeRanges(ranges) {
    if (!ranges || ranges.length === 0) {
      return [];
    }

    const sorted = ranges
      .filter((range) => range && Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
      .sort((left, right) => left.start - right.start);

    if (sorted.length === 0) {
      return [];
    }

    const merged = [{ start: sorted[0].start, end: sorted[0].end }];
    for (let idx = 1; idx < sorted.length; idx += 1) {
      const current = sorted[idx];
      const previous = merged[merged.length - 1];
      if (current.start <= previous.end) {
        previous.end = Math.max(previous.end, current.end);
      } else {
        merged.push({ start: current.start, end: current.end });
      }
    }

    return merged;
  }

  function getTextMatchRanges(text, tokens) {
    if (!text || !tokens || tokens.length === 0) {
      return [];
    }

    const lower = text.toLowerCase();
    const ranges = [];
    tokens.forEach((token) => {
      if (!token) {
        return;
      }
      let cursor = 0;
      while (cursor < lower.length) {
        const index = lower.indexOf(token, cursor);
        if (index === -1) {
          break;
        }
        ranges.push({ start: index, end: index + token.length });
        cursor = index + token.length;
      }
    });

    return mergeRanges(ranges);
  }

  function renderTextWithHighlightRanges(text, ranges, markClassName) {
    if (!ranges || ranges.length === 0) {
      return escapeHtml(text);
    }

    let cursor = 0;
    const parts = [];
    ranges.forEach((range) => {
      const start = Math.max(0, Math.min(range.start, text.length));
      const end = Math.max(start, Math.min(range.end, text.length));
      if (start > cursor) {
        parts.push(escapeHtml(text.slice(cursor, start)));
      }
      const highlighted = text.slice(start, end);
      parts.push(`<mark class="${escapeAttribute(markClassName)}">${escapeHtml(highlighted)}</mark>`);
      cursor = end;
    });

    if (cursor < text.length) {
      parts.push(escapeHtml(text.slice(cursor)));
    }

    return parts.join("");
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
    let score = item.baseWeight;
    let matchedTokenCount = 0;
    let directTokenCount = 0;

    const phraseIndex = corpus.indexOf(normalizedQuery);
    if (phraseIndex >= 0) {
      score += 84;
      score += Math.max(0, 22 - Math.floor(phraseIndex / 14));
    }

    queryTokens.forEach((token) => {
      if (!token) {
        return;
      }

      const directIndex = corpus.indexOf(token);
      if (directIndex >= 0) {
        matchedTokenCount += 1;
        directTokenCount += 1;
        score += 24;
        score += Math.max(0, 10 - Math.floor(directIndex / 20));
        if (title.includes(token)) {
          score += 14;
        }
        if (new RegExp(`\\b${escapeRegExp(token)}`).test(corpus)) {
          score += 8;
        }
        return;
      }

      const fuzzyCorpus = fuzzySubsequenceScore(token, corpus);
      const fuzzyTitle = fuzzySubsequenceScore(token, title);
      const fuzzyScore = Math.max(fuzzyCorpus, fuzzyTitle);
      if (fuzzyScore >= 0.74) {
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
    return score;
  }

  function isSearchableContentNode(node) {
    if (!(node instanceof HTMLElement)) {
      return false;
    }

    const tag = node.tagName;
    if (/^H[2-6]$/.test(tag) && node.id) {
      return true;
    }

    if (tag === "P" || tag === "LI" || tag === "TD" || tag === "TH" || tag === "FIGCAPTION") {
      return true;
    }

    return node.classList.contains("procedure-description")
      || node.classList.contains("callout-title");
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
      normalizedCorpus,
    });
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
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      if (isSearchableContentNode(node)) {
        const text = (node.textContent || "").replace(/\s+/g, " ").trim();
        if (text) {
          if (/^H[2-6]$/.test(node.tagName) && node.id) {
            currentHeadingId = node.id;
            currentHeadingTitle = text;
            const level = parseInt(node.tagName.slice(1), 10);
            const levelPenalty = Number.isNaN(level) ? 0 : Math.max(0, level - 2);
            addSearchIndexItem(items, dedupe, {
              kind: "heading",
              targetId: currentHeadingId,
              sectionId,
              sectionGroup,
              sectionTitle,
              title: text,
              previewText: "",
              baseWeight: headingBaseWeight - levelPenalty * 4,
            });
          } else if (text.length >= 24) {
            addSearchIndexItem(items, dedupe, {
              kind: "content",
              targetId: currentHeadingId || sectionTargetId,
              sectionId,
              sectionGroup,
              sectionTitle,
              title: currentHeadingTitle || sectionTitle,
              previewText: text,
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

    if (preface) {
      addSearchIndexItem(items, dedupe, {
        kind: "section",
        targetId: "top",
        sectionId: "preface",
        sectionGroup: "supplement",
        sectionTitle: "Introduction",
        title: "Introduction",
        previewText: (preface.textContent || "").replace(/\s+/g, " ").trim(),
        baseWeight: 130,
      });
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

      addSearchIndexItem(items, dedupe, {
        kind: "section",
        targetId: sectionId,
        sectionId,
        sectionGroup,
        sectionTitle,
        title: sectionTitle,
        previewText: "",
        baseWeight: 140,
      });

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

  function ensureMobileNavigator() {
    if (navigatorUi.root) {
      return;
    }

    const root = document.createElement("div");
    root.id = "mobile-search-nav";
    root.className = "mobile-search-nav";
    root.hidden = true;
    root.innerHTML = `
      <span class="mobile-search-nav-count" aria-live="polite" aria-atomic="true">0 / 0</span>
      <button type="button" class="mobile-search-nav-cancel" aria-label="Cancel search">Cancel</button>
      <button type="button" class="mobile-search-nav-next" aria-label="Go to next search match">Next</button>
    `;

    document.body.appendChild(root);
    navigatorUi.root = root;
    navigatorUi.count = root.querySelector(".mobile-search-nav-count");
    navigatorUi.cancel = root.querySelector(".mobile-search-nav-cancel");
    navigatorUi.next = root.querySelector(".mobile-search-nav-next");

    if (navigatorUi.cancel) {
      navigatorUi.cancel.addEventListener("click", () => {
        cancelSearch();
      });
    }

    if (navigatorUi.next) {
      navigatorUi.next.addEventListener("click", () => {
        goToAdjacentHighlight(1);
      });
    }
  }

  function updateMobileNavigator() {
    ensureMobileNavigator();
    if (!navigatorUi.root || !navigatorUi.count || !navigatorUi.next || !navigatorUi.cancel) {
      return;
    }

    const hasActiveQuery = state.normalizedQuery.length >= SEARCH_MIN_QUERY_LENGTH;
    const total = state.highlightMarks.length;
    const shouldShow = hasActiveQuery;

    navigatorUi.root.hidden = !shouldShow;
    if (!shouldShow) {
      return;
    }

    const current = total > 0
      ? Math.max(0, state.highlightIndex) + 1
      : 0;
    navigatorUi.count.textContent = `${current} / ${total}`;
    navigatorUi.next.disabled = total <= 1;
  }

  function expandSectionForMatch(mark) {
    let expanded = false;
    if (!mark) {
      return expanded;
    }
    const parentSection = mark.closest(".section.collapsed");
    if (!parentSection) {
      return expanded;
    }
    const header = parentSection.querySelector(".section-header");
    if (header) {
      header.click();
      expanded = true;
    }
    return expanded;
  }

  function expandProcedureForMatch(mark) {
    let expanded = false;
    if (!mark) {
      return expanded;
    }
    const parentProcedure = mark.closest(".procedure.collapsed");
    if (!parentProcedure) {
      return expanded;
    }
    const header = parentProcedure.querySelector(".procedure-header");
    if (header) {
      header.click();
      expanded = true;
    }
    return expanded;
  }

  function expandAncestorsForMatch(mark) {
    const sectionExpanded = expandSectionForMatch(mark);
    const procedureExpanded = expandProcedureForMatch(mark);
    return sectionExpanded || procedureExpanded;
  }

  function scrollToHighlightMatch(mark) {
    if (!mark) {
      return;
    }

    const expanded = expandAncestorsForMatch(mark);
    const performScroll = () => {
      const targetTop = mark.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({
        top: Math.max(targetTop - 116, 0),
        behavior: "smooth",
      });
    };

    if (expanded) {
      window.setTimeout(() => {
        window.requestAnimationFrame(performScroll);
      }, 140);
      return;
    }

    performScroll();
  }

  function setActiveHighlightByIndex(nextIndex, scrollIntoView) {
    const marks = state.highlightMarks;
    if (!marks || marks.length === 0) {
      state.highlightIndex = -1;
      updateMobileNavigator();
      return;
    }

    const normalizedIndex = ((nextIndex % marks.length) + marks.length) % marks.length;
    state.highlightIndex = normalizedIndex;
    marks.forEach((mark, index) => {
      mark.classList.toggle("search-highlight-current", index === normalizedIndex);
    });

    const currentMark = marks[normalizedIndex];
    if (scrollIntoView) {
      scrollToHighlightMatch(currentMark);
    }

    updateMobileNavigator();
  }

  function refreshHighlightNavigation(resetIndex) {
    const marks = Array.from(document.querySelectorAll(`mark.${SEARCH_CONTENT_MARK_CLASS}`));
    state.highlightMarks = marks;

    if (marks.length === 0) {
      state.highlightIndex = -1;
      updateMobileNavigator();
      return;
    }

    if (resetIndex || state.highlightIndex < 0 || state.highlightIndex >= marks.length) {
      state.highlightIndex = 0;
    }

    setActiveHighlightByIndex(state.highlightIndex, false);
  }

  function goToAdjacentHighlight(delta) {
    if (!state.highlightMarks || state.highlightMarks.length === 0) {
      return;
    }
    const current = state.highlightIndex >= 0 ? state.highlightIndex : 0;
    setActiveHighlightByIndex(current + delta, true);
  }

  function cancelSearch() {
    if (searchInputDebounceId) {
      window.clearTimeout(searchInputDebounceId);
      searchInputDebounceId = null;
    }
    setSearchQuery("", { updateUrl: true, syncInput: true });
  }

  function syncHighlightToTarget(targetId) {
    if (!targetId || !state.highlightMarks || state.highlightMarks.length === 0) {
      return;
    }

    const target = document.getElementById(targetId);
    if (!target) {
      return;
    }

    const marks = state.highlightMarks;
    const directIndex = marks.findIndex((mark) => target.contains(mark));
    if (directIndex >= 0) {
      setActiveHighlightByIndex(directIndex, false);
      return;
    }

    const targetTop = target.getBoundingClientRect().top + window.scrollY;
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    marks.forEach((mark, index) => {
      const markTop = mark.getBoundingClientRect().top + window.scrollY;
      const distance = Math.abs(markTop - targetTop);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    setActiveHighlightByIndex(nearestIndex, false);
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

  function clearSearchHighlights() {
    const marks = Array.from(document.querySelectorAll(`mark.${SEARCH_CONTENT_MARK_CLASS}`));
    if (marks.length === 0) {
      return;
    }

    const touchedParents = new Set();
    marks.forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) {
        return;
      }
      touchedParents.add(parent);
      parent.replaceChild(document.createTextNode(mark.textContent || ""), mark);
    });
    touchedParents.forEach((parent) => {
      if (parent && typeof parent.normalize === "function") {
        parent.normalize();
      }
    });
  }

  function applySearchHighlights(tokens) {
    clearSearchHighlights();

    const highlightTokens = (tokens || [])
      .filter((token) => token.length >= 2);
    if (highlightTokens.length === 0) {
      return;
    }

    const roots = [
      document.getElementById("preface-content"),
      document.getElementById("sections-container"),
    ].filter(Boolean);

    let remainingHighlights = SEARCH_HIGHLIGHT_LIMIT;
    roots.forEach((root) => {
      if (remainingHighlights <= 0) {
        return;
      }

      const textNodes = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node || !node.nodeValue || !node.nodeValue.trim()) {
            return NodeFilter.FILTER_REJECT;
          }
          const parent = node.parentElement;
          if (!parent) {
            return NodeFilter.FILTER_REJECT;
          }
          if (parent.closest("mark")) {
            return NodeFilter.FILTER_REJECT;
          }
          if (parent.closest("#inline-editor-modal, #inline-editor-toolbar")) {
            return NodeFilter.FILTER_REJECT;
          }
          const tag = parent.tagName;
          if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEXTAREA") {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      let textNode = walker.nextNode();
      while (textNode) {
        textNodes.push(textNode);
        textNode = walker.nextNode();
      }

      textNodes.forEach((node) => {
        if (remainingHighlights <= 0 || !node.parentNode) {
          return;
        }
        const text = node.nodeValue || "";
        const ranges = getTextMatchRanges(text, highlightTokens);
        if (ranges.length === 0) {
          return;
        }

        const limitedRanges = ranges.slice(0, remainingHighlights);
        const fragment = document.createDocumentFragment();
        let cursor = 0;
        limitedRanges.forEach((range) => {
          if (range.start > cursor) {
            fragment.appendChild(document.createTextNode(text.slice(cursor, range.start)));
          }
          const mark = document.createElement("mark");
          mark.className = SEARCH_CONTENT_MARK_CLASS;
          mark.textContent = text.slice(range.start, range.end);
          fragment.appendChild(mark);
          cursor = range.end;
        });
        if (cursor < text.length) {
          fragment.appendChild(document.createTextNode(text.slice(cursor)));
        }
        node.parentNode.replaceChild(fragment, node);
        remainingHighlights -= limitedRanges.length;
      });
    });
  }

  function getSearchKindLabel(kind) {
    if (kind === "section") {
      return "Section";
    }
    if (kind === "heading") {
      return "Heading";
    }
    return "Text";
  }

  function renderSearchResults(results, tokens, rawQuery) {
    const { sidebar, clear, results: resultsEl } = getSearchElements();
    if (!sidebar || !clear || !resultsEl) {
      return;
    }

    const query = String(rawQuery || "").trim();
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

    const sectionLabels = getSectionLabels();
    const rows = results.map((result) => {
      const displayTokens = tokens.filter((token) => token.length > 0);
      const titleRanges = getTextMatchRanges(result.title, displayTokens);
      const titleHtml = renderTextWithHighlightRanges(result.title, titleRanges, SEARCH_RESULT_MARK_CLASS);
      const snippet = buildSearchSnippet(result.previewText || result.title, displayTokens);
      const snippetRanges = getTextMatchRanges(snippet, displayTokens);
      const snippetHtml = renderTextWithHighlightRanges(snippet, snippetRanges, SEARCH_RESULT_MARK_CLASS);

      const groupLabel = sectionLabels[result.sectionGroup] || "";
      const metaParts = [getSearchKindLabel(result.kind)];
      if (groupLabel) {
        metaParts.push(groupLabel);
      }
      if (result.sectionTitle && result.sectionTitle !== result.title) {
        metaParts.push(result.sectionTitle);
      }

      return `
      <li>
        <button type="button" class="toc-search-result" data-search-target="${escapeAttribute(result.targetId)}">
          <span class="toc-search-result-title">${titleHtml}</span>
          <span class="toc-search-result-meta">${escapeHtml(metaParts.join(" · "))}</span>
          ${snippet ? `<span class="toc-search-result-snippet">${snippetHtml}</span>` : ""}
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
      const key = scoredItem.item.targetId;
      const existing = bestByTarget.get(key);
      if (!existing || scoredItem.score > existing.score) {
        bestByTarget.set(key, scoredItem);
      }
    });

    const kindRank = {
      section: 0,
      heading: 1,
      content: 2,
    };

    return Array.from(bestByTarget.values())
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
      })
      .slice(0, SEARCH_RESULT_LIMIT)
      .map((entry) => entry.item);
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
    }, 1200);
  }

  function navigateToSearchTarget(targetId) {
    if (!targetId || typeof scrollToSection !== "function") {
      return;
    }

    const hash = `#${targetId}`;
    if (!scrollToSection(hash)) {
      return;
    }

    const url = new URL(window.location.href);
    url.hash = hash;
    history.replaceState(null, document.title, `${url.pathname}${url.search}${url.hash}`);

    const target = document.getElementById(targetId);
    if (target && targetId !== "top") {
      flashSearchTarget(target);
    }
    syncHighlightToTarget(targetId);

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
    const previousNormalizedQuery = state.normalizedQuery;
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

    if (normalizedQuery.length >= SEARCH_MIN_QUERY_LENGTH && tokens.length > 0) {
      applySearchHighlights(tokens);
      refreshHighlightNavigation(normalizedQuery !== previousNormalizedQuery);
    } else {
      clearSearchHighlights();
      state.highlightMarks = [];
      state.highlightIndex = -1;
      updateMobileNavigator();
    }
  }

  function setup() {
    if (initialized) {
      return;
    }

    const { input, clear, results } = getSearchElements();
    if (!input || !clear || !results) {
      return;
    }
    ensureMobileNavigator();
    initialized = true;

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
        const firstResult = results.querySelector("button[data-search-target]");
        if (firstResult) {
          event.preventDefault();
          const targetId = firstResult.getAttribute("data-search-target");
          navigateToSearchTarget(targetId);
        }
        return;
      }

      if (event.key === "ArrowDown") {
        const firstResult = results.querySelector("button[data-search-target]");
        if (firstResult) {
          event.preventDefault();
          firstResult.focus();
        }
      }
    });

    results.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const button = target.closest("button[data-search-target]");
      if (!button) {
        return;
      }
      navigateToSearchTarget(button.getAttribute("data-search-target"));
    });

    results.addEventListener("keydown", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const currentButton = target.closest("button[data-search-target]");
      if (!currentButton) {
        return;
      }
      const buttons = Array.from(results.querySelectorAll("button[data-search-target]"));
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

    const initialQuery = getSearchQueryFromUrl();
    setSearchQuery(initialQuery, {
      updateUrl: false,
      syncInput: true,
    });
    updateMobileNavigator();
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

  window.SearchBar = {
    setup,
    refreshIndex,
  };
}());
