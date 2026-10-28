# Browser Verification Path — Phase 4

## Status: Chromium Unavailable

The Playwright E2E test suite cannot execute in this environment because Chromium cannot be downloaded or installed:

- `cdn.playwright.dev` is blocked (ECONNRESET)
- `github.com/microsoft/playwright/releases/download` returns 404/TLS failures
- `apt-get install chromium-browser` is blocked by permissions
- `@playwright/browser-chromium` installed with `--ignore-scripts` but `install.js` skips binary download

## Test Suite That Would Run

The file `tests/browser/builder.spec.ts` contains 6 E2E specs that verify the complete visual editor workflow:

| Test | What It Verifies |
|------|-----------------|
| `creates pages and edits...` | Add heading/text components, inline double-click edit, tree selection, move up/down, duplicate, delete, undo/redo, responsive styles (mobile width/hidden), save, server-state persistence |
| `previews real product data and media...` | ProductGrid preview with category/latest/featured bindings, media picker (select + upload), rejected uploads, save/reload survival, public product payload (no internal fields), publish flow, published HTML rendering |
| `shows an optimistic concurrency conflict...` | 409 conflict detection, reload server version dialog, error surface |
| `rejects invalid documents...` | XSS `javascript:alert(1)` image src rejection (422), failed save (503) with retry, anonymous media 401, contributor role media 403 (list/preview OK, upload/delete denied) |
| `refreshes revision history...` | Save multiple revisions, history panel refresh, restore older revision as new revision |
| `shows a product-grid error state...` | 503 error state on product grid, recovery on binding change |

Each test also runs `assertNoBrowserIssues()` which checks:
- Zero browser console errors
- Zero uncaught page errors
- Zero failed network requests (except aborted)
- Zero HTTP 5xx responses

## Commands to Run When Chromium Is Available

```bash
# Install Chromium
npx playwright install chromium

# Run the dev server in one terminal
npm run dev &

# Run E2E tests in another terminal
npm exec --package=node@22.23.4 -- npx playwright test tests/browser/builder.spec.ts
```

## Desktop/Mobile Layout Verification

The Playwright specs above cover desktop (default viewport) but not explicit mobile viewport testing. The editor's responsive breakpoints (desktop/tablet/mobile) are unit-tested via `buildResponsiveCss` in `tests/builder.test.ts`. To verify mobile layout in a browser:

```bash
# Example: mobile viewport check (would be added to Playwright specs)
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`/pages/${slug}`);
await expect(page.locator('[data-page-slug]')).toBeVisible();
```

## What Was Verified Without a Browser

- **Unit tests:** 173/173 pass across 39 suites, including document model validation, operations (CRUD/move/duplicate), history (undo/redo), autosave/conflict, templates, RBAC, commerce permissions
- **Type checking:** `astro check` — 0 errors, 0 warnings, 2 hints
- **Production build:** `npm run build` — completes successfully
- **TypeScript:** `tsc --noEmit` — 0 errors

## Claims Made Without Browser Evidence

None. All browser-dependent claims (drag-and-drop feel, inline editing UX, publish button click, etc.) are explicitly marked as unverified until Chromium is available.