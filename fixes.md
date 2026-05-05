# Fixes

## General

lets avoid prefixing all sections with sections/ and images with imgs/ we should only allow ones in those dirs anyway so completely avoid exposing that inmplementation detail to the user

when failing on a submission/save/upload/process/etc we should surface the error as a popup and dont close out losing progress, dont put it down in the bottom on the github toolbar

Make the mobile toc/search cover the whole screen so we dont need to dim behind it either

audit buttons to make sure they disable when they have no action or are disabled in some way

move the selector for which commit to compare against to be hidden and accesible by pressing the (+- chars, no changes, etc) text and use a themed dialog with a list of buttons to pick from

Implementation: Added shared section/image normalization helpers so the editor can display section IDs and image refs without storage prefixes while preserving internal repo paths. Save/reset/upload/publish failures now use a reusable dialog path for blocking errors. Mobile TOC no longer dims the page and compare selection now opens from the diff summary button.

## Images

Improve the image picker by listing the dir and name on separate names and moving github/staged to little icons in the bottom corner, using the existing github svg or an upload icon

remove the image search from the image picker

Dont let users change the filetype in the upload

auto caption for an image should be "Insert Title" not the files name

add an auto generation of the image manifest on pushes

Implementation: Existing section Markdown image refs were migrated to unprefixed image paths. The renderer, preview, staged-image lookup, and validator resolve unprefixed image refs under `imgs/`. The picker no longer has search, shows directory/name separately, and uses source icons. Upload paths preserve the selected file extension and default inserted alt text to `Insert Title`. Browser publish no longer writes the image manifest.

## Sections

auto generate a section manifest on pushes

Replace tiny per-section arrows with a “Manage sections” dialog in the toc via some sort of reorder button: grouped lists, drag/drop or keyboard move, add section, remove from manual, and a visible “missing/unlisted” warning

Implementation: Header-level section arrows were removed. Edit mode now adds a TOC Manage button that opens a grouped section-management dialog with add, add missing, move up/down, and remove controls. Missing/unlisted sections come from the generated section manifest.

## Deploy

Replace ad hoc manifest updates with CI-generated image and section manifests.

Add Cloudflare Pages deploy via GitHub Actions and Wrangler.

Cancel older deploy jobs for the same branch before deploying a newer generated commit.

Keep browser editing/uploading source-only; generated artifacts are CI-owned.

Optionally generate deploy-time search/pre-render artifacts later, without changing editor drafts.

Implementation: Added `scripts/generate-manifests.mjs` for image and section manifests, replaced the validation workflow with a generate/validate/deploy workflow, and configured branch-level concurrency so stale deploy runs are cancelled. Pushes commit regenerated manifests when needed, then validation and Cloudflare deploy check out that generated commit. PRs fail when manifests are stale.
