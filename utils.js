(function (global) {
  "use strict";
  const CONTENT_REPO_OWNER = "harrykendell";
  const CONTENT_REPO_NAME = "harrykendell.github.io";
  const CONTENT_REPO_BRANCH = "main";
  const DEV_CONTENT_REPO_BRANCH = "dev";
  const DEV_HOSTNAME = "dev.kendell.uk";

  function getContentRepoBranch() {
    const hostname = String(global.location && global.location.hostname || "").toLowerCase();
    return hostname === DEV_HOSTNAME
      ? DEV_CONTENT_REPO_BRANCH
      : CONTENT_REPO_BRANCH;
  }

  function getContentRepoConfig() {
    return {
      owner: CONTENT_REPO_OWNER,
      name: CONTENT_REPO_NAME,
      baseBranch: getContentRepoBranch(),
    };
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

  function getGitHubEditUrl(relativePath, options) {
    const cleanPath = String(relativePath || "").replace(/^\/+/, "");
    if (!cleanPath) {
      return null;
    }

    const config = options || {};
    const owner = encodeURIComponent(String(config.owner || CONTENT_REPO_OWNER));
    const repo = encodeURIComponent(String(config.repo || CONTENT_REPO_NAME));
    const branch = encodeURIComponent(String(config.branch || getContentRepoBranch()));
    const path = cleanPath
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");

    return `https://github.com/${owner}/${repo}/edit/${branch}/${path}`;
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

    if (!normalized || normalized === "supplement/introduction") {
      return null;
    }

    return /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/.test(normalized)
      ? normalized
      : null;
  }

  function getSectionPath(sectionId) {
    const normalized = normalizeSectionId(sectionId);
    return normalized ? `sections/${normalized}.md` : null;
  }

  function sectionIdFromPath(value) {
    return normalizeSectionId(value);
  }

  function normalizeImagePath(value) {
    if (!value) {
      return null;
    }

    const normalized = String(value)
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .trim();

    const withPrefix = normalized.startsWith("imgs/")
      ? normalized
      : `imgs/${normalized}`;

    if (
      withPrefix.includes("..")
      || withPrefix.includes("//")
      || withPrefix.endsWith("/")
    ) {
      return null;
    }

    return /^imgs\/[A-Za-z0-9._/-]+\.(png|jpe?g|gif|webp|svg|avif)$/i.test(withPrefix)
      ? withPrefix
      : null;
  }

  function imageRefFromPath(value) {
    const normalized = normalizeImagePath(value);
    return normalized ? normalized.replace(/^imgs\//, "") : "";
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
    getContentRepoBranch,
    normalizeSectionId,
    getSectionPath,
    sectionIdFromPath,
    normalizeImagePath,
    imageRefFromPath,
    normalizeHashValue,
    replaceUrlState,
    getInternalHashFromLink,
    normalizeInternalHashLinks,
  };
}(window));
