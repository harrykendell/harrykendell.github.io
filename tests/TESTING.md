# Testing

## Local markdown validation

Run:

```bash
node tests/validate-markdown.mjs
```

This validates:

- procedure blocks (`[!PROCEDURE:...] ... [!/PROCEDURE]`)
- callouts (`[!INFO]`, `[!WARNING]`, `[!DANGER]`)
- images in markdown and HTML (`![...]()`, reference images, `<img src=...>`)
- internal links and anchors
- external links and image URLs (HTTP checks)
- section order consistency (`sections/section-order.md`)

## CI

GitHub Actions workflow: `.github/workflows/markdown-validation.yml`

It runs on every `push` and `pull_request`, emits GitHub annotations, and fails on validation errors.
