(function (global) {
  "use strict";
  const CONTENT_REPO_OWNER = "harrykendell";
  const CONTENT_REPO_NAME = "harrykendell.github.io";
  const CONTENT_REPO_BRANCH = "main";

  function getContentRepoConfig() {
    return {
      owner: CONTENT_REPO_OWNER,
      name: CONTENT_REPO_NAME,
      baseBranch: CONTENT_REPO_BRANCH,
    };
  }

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

  function getGitHubEditUrl(relativePath, options) {
    const cleanPath = String(relativePath || "").replace(/^\/+/, "");
    if (!cleanPath) {
      return null;
    }

    const config = options || {};
    const owner = encodeURIComponent(String(config.owner || CONTENT_REPO_OWNER));
    const repo = encodeURIComponent(String(config.repo || CONTENT_REPO_NAME));
    const branch = encodeURIComponent(String(config.branch || CONTENT_REPO_BRANCH));
    const path = cleanPath
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");

    return `https://github.com/${owner}/${repo}/edit/${branch}/${path}`;
  }

  function normalizeHashValue(hash) {
    if (!hash || typeof hash !== "string") {
      return null;
    }

    const rawValue = hash.startsWith("#") ? hash.slice(1) : hash;
    if (!rawValue) {
      return null;
    }

    let decodedValue = rawValue;
    try {
      decodedValue = decodeURIComponent(rawValue);
    } catch (error) {
      decodedValue = rawValue;
    }

    return decodedValue ? `#${decodedValue}` : null;
  }

  function replaceUrlState(nextHash) {
    const url = new URL(global.location.href);
    url.hash = nextHash || "";
    global.history.replaceState(null, global.document.title, `${url.pathname}${url.search}${url.hash}`);
  }

  function getInternalHashFromLink(link) {
    if (!link) {
      return null;
    }

    const href = link.getAttribute("href");
    if (!href) {
      return null;
    }

    if (href.startsWith("#") || href.startsWith("/#")) {
      const hashIndex = href.indexOf("#");
      return normalizeHashValue(href.slice(hashIndex));
    }

    try {
      const url = new URL(href, global.location.href);
      if (!url.hash || url.origin !== global.location.origin) {
        return null;
      }

      const currentPath = global.location.pathname.replace(/\/+$/, "") || "/";
      const targetPath = url.pathname.replace(/\/+$/, "") || "/";
      if (targetPath !== currentPath) {
        return null;
      }

      return normalizeHashValue(url.hash);
    } catch (error) {
      return null;
    }
  }

  function normalizeInternalHashLinks(rootEl) {
    if (!rootEl) {
      return;
    }

    const links = Array.from(rootEl.querySelectorAll("a[href]"));
    links.forEach((link) => {
      const hash = getInternalHashFromLink(link);
      if (hash) {
        link.setAttribute("href", hash);
      }
    });
  }

  global.AppUtils = {
    escapeHtml,
    escapeAttribute,
    getGitHubEditUrl,
    getContentRepoConfig,
    normalizeHashValue,
    replaceUrlState,
    getInternalHashFromLink,
    normalizeInternalHashLinks,
  };

  // Backwards-compatible global aliases for older scripts.
  global.getGitHubEditUrl = getGitHubEditUrl;
  global.normalizeHashValue = normalizeHashValue;
  global.replaceUrlState = replaceUrlState;
  global.getInternalHashFromLink = getInternalHashFromLink;
  global.normalizeInternalHashLinks = normalizeInternalHashLinks;

  // Backwards-compatible repo globals used by older editor code.
  global.CONTENT_REPO_OWNER = CONTENT_REPO_OWNER;
  global.CONTENT_REPO_NAME = CONTENT_REPO_NAME;
  global.CONTENT_REPO_BRANCH = CONTENT_REPO_BRANCH;
}(window));
