# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

A GitHub Pages static site for a "Rowing Repairs Manual" at kendell.uk. The site dynamically loads Markdown content and renders it client-side with custom extensions (procedures, callouts). Includes an authenticated inline editor for content updates.

## Development

**Local preview:**
```bash
python -m http.server 8000
# Then visit http://localhost:8000
```

No build step required - all JavaScript runs directly in the browser.

## Architecture

### Core JavaScript Files
- `utils.js` - Shared utilities (must load first); exports `window.AppUtils`
- `script.js` - Main app: section loading, TOC generation, scroll tracking
- `sidebar.js` - Sidebar navigation and fuzzy search functionality
- `markdown-to-section.js` - Markdown→HTML rendering with custom syntax extensions
- `editor.js` / `editor.css` - Inline Markdown editor with GitHub integration (lazy-loaded)
- `worker.js` - Cloudflare Worker for GitHub OAuth and API proxy (deployed separately to github-auth.kendell.uk)

### Content Structure
- `sections/section-order.md` - Ordered list of section IDs that controls render order
- `sections/{category}/{topic}.md` - Markdown content files
- Categories: `maintenance/`, `repairs/`, `supplement/`

### Section Loading Flow
1. `script.js` fetches `sections/section-order.md` and parses section IDs
2. For each section, creates a shell element and lazy-loads content via IntersectionObserver
3. `markdown-to-section.js` processes markdown using the `marked` library with custom extensions
4. Sidebar TOC is generated from rendered section headings

## Custom Markdown Syntax

### Procedure Blocks
Collapsible procedures with skill level badges:
```markdown
[!PROCEDURE:beginner] Procedure Title

Description paragraph.

1. Step one
2. Step two

[!/PROCEDURE]
```
Valid skill levels: `beginner`, `intermediate`, `advanced`

### Callouts
```markdown
> [!INFO]
> Information callout text

> [!WARNING]
> Warning callout text

> [!DANGER]
> Danger callout text
```

## Key Patterns

- All JS files check for `window.AppUtils` and throw if utilities aren't loaded
- Section IDs are normalized paths without `sections/` prefix or `.md` suffix (e.g., `maintenance/rigging`)
- Cache busting via query params on asset URLs (e.g., `?v=32`)
- Drafts stored in localStorage under `editor-markdown-drafts-v1` and `editor-image-drafts-v1`
- GitHub auth uses PKCE flow via the Cloudflare Worker

## Worker (worker.js)

Deployed separately to Cloudflare Workers. Handles:
- GitHub OAuth login/callback with PKCE
- Session management via signed cookies
- API proxy for repo status, file history, content fetching
- Content submission (creating branches/PRs)

Environment variables required: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`
