# Builder engineering audit

Audit date: 2026-10-28. This supplements [`implementation-audit.md`](./implementation-audit.md); it is an implementation status, not a security certification.

## Current architecture

- Astro 7.4.2 server-rendered site on the Node adapter, TypeScript, React 19 for the Builder editor; Node `>=22.23.4` is required.
- CMS authentication, role checks, middleware, and route layout are reused. Builder pages use a validated JSON document and an atomic, revisioned JSON file adapter.
- Store routes and products remain in the existing Astro/commerce model; no Rust, new server framework, SQL database, or separate runtime was added.

## What works

- Versioned page validation/migration; stable node IDs; Container, Heading, Text, Image, Button; Container stack/row/grid; token-only styles and themes.
- Editor selection, inspector controls, inline Heading/Text edit, layer operations, drag/drop, undo/redo, responsive preview controls, JSON import/export, autosave recovery, revision history, custom templates, and publish action.
- Server-side permission checks, optimistic revision conflicts, separate draft/published snapshots, and Astro SSR from the same saved document. Plain text is escaped; links and image sources are constrained.
- Starter sections include a Persian storefront route hub. Existing catalog, detail, cart, checkout, and about routes use application data and remain independent of Builder documents.

## Incomplete or unverified

- No browser executable is installed. A temporary Chromium package was tried, but it cannot launch because the environment lacks `libnspr4.so`; Playwright browser interactions therefore remain unverified. HTTP and service tests are not substitutes.
- The media inspector has a URL/path field but no library picker; there are no dynamic content bindings or product-grid Builder component.
- The storefront starter is one editable route hub, not a multi-page site kit; no separate policy page exists. Empty checkout redirects to cart, and payment requires a configured provider.
- JSON writes are serialized only within one process. No cross-process lock, SQL migration, multi-tenant isolation, Lighthouse results, or real provider transaction has been verified.

## Reuse and implementation sequence

Reuse the current Astro renderer, CMS RBAC/session, existing commerce routes/product model, shared design tokens, and current test framework. Next: add Playwright/browser coverage for the critical edit-save-reload-publish workflow; add a permission-aware media picker; build a versioned multi-route commerce kit that uses actual products and existing checkout routes; only then add explicit data bindings or shared transactional persistence when deployment requires them.

## Verification for this workstream

Run `npm run check`, `npm test`, `npm run build`, `npm run check:copy`, `npm run check:rtl`, and `git diff --check`. Also smoke-test authenticated create/save/reload/publish, stale-write rejection, nested Grid SSR, safe Text/Image output, and the existing shop routes. The HTTP smoke does not verify a real browser interaction or visual parity.
