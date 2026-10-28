# Novex Builder

Builder is an Astro/React visual page editor backed by the existing CMS session and RBAC layers. It is an initial, deliberately bounded page builder—not Elementor parity and not a general-purpose HTML/CSS/JavaScript execution environment. See the concise [Builder engineering audit](./builder-audit.md) for current status and remaining gates.

## Routes

- `/cms/pages` lists saved Builder pages.
- `/cms/pages/new` creates a draft with a permanent lowercase ASCII slug.
- `/cms/builder/<slug>` opens the three-region editor.
- `/pages/<slug>` renders the latest published snapshot through Astro SSR. An unpublished slug returns 404.

The editor has a component/library and tree panel, an interactive preview canvas, and a property inspector. Its first component set includes `Container`, `Heading`, `Text`, `Image`, and `Button`. A `Container` may use stack, row, or responsive grid layout; the separate Grid insertion action creates a `Container` with the `grid` layout token, so the saved contract has one layout implementation. Containers may contain nested Containers and any registered leaf component; non-container components do not accept children. The editor supports selection, double-click inline editing for headings and plain text, property editing, sibling ordering, drag/drop, duplicate/delete, undo/redo, desktop/tablet/mobile preview, per-breakpoint styles and visibility, JSON import/export, version history, and publishing.

## Document contract

The canonical contract is `src/lib/builder/types.ts`; runtime validation and migration are in `src/lib/builder/document.ts` and `src/lib/builder/registry.ts`.

- Page schema version: `1`.
- Component versions are checked against the registry; schema-zero documents with the known lowercase component aliases migrate to version one.
- Node IDs must be unique. Layout nesting is limited to eight levels and a document to 200 nodes. Imports are limited to 1 MiB.
- Component props, links, theme IDs, breakpoints, and style values are allow-listed and normalized. Unknown properties and raw CSS are rejected.
- Heading/Text content is plain text rendered through Astro/React escaping; the inline editor pastes plain text rather than HTML. Image sources allow same-origin absolute paths or credential-free HTTPS URLs; `javascript:`, `data:`, protocol-relative, and insecure HTTP image URLs are rejected. Buttons allow internal paths, anchors, or HTTP(S) URLs without credentials. Saved documents cannot run JavaScript.
- Responsive styles and the three built-in themes (`site`, `ocean`, `warm`) are controlled tokens. Do not add user-authored CSS/HTML/JS to the document contract.

## Save, conflict, and publish behavior

Edits are debounced for 650 ms. The editor also provides an explicit save button. A failed save keeps the in-memory document, exposes retry and JSON export, and does not silently discard edits. If the server revision differs from the client's expected revision, the server returns `409 revision_conflict`; the editor offers local JSON export and an explicit reload of the latest server version. It never silently overwrites another writer.

Successful saves append immutable document snapshots and keep the latest 25 revisions. The history panel can load an older snapshot into the editor; saving it creates a new revision rather than deleting later history. Publishing first flushes draft autosave, checks the expected revision again, then records a separate published snapshot and timestamp. Later draft saves do not change public output until the next publish.

## Themes and templates

Themes are fixed token sets in `src/lib/builder/themes.ts`. Four reusable starter templates (simple intro, three-column feature grid, contact CTA, and a Persian storefront route hub) are in `src/lib/builder/templates.ts`; the templates use the same Container/Heading/Text/Button document contract as authored pages. Editors can apply a starter or saved custom template to the current page, or save the current content/theme as a reusable custom template. Applying a template preserves the page's slug, document ID, title, and description, replaces its nodes, uses the template theme, and gives every node a fresh ID. Up to 50 custom templates are stored in the Builder data file. Page documents can be imported/exported as versioned JSON. The current template library is single-page: it does not yet create a complete multi-route e-commerce site kit or preview templates in a separate rendered canvas before applying them.

## API and authorization

All Builder management endpoints are under `/cms/api/builder` and require the existing private CMS session plus the dedicated page permissions:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/cms/api/builder/pages` | List page summaries |
| `POST` | `/cms/api/builder/pages` | Create a new empty draft at revision 1 |
| `GET` | `/cms/api/builder/pages/<slug>` | Read draft, revision, and publish metadata |
| `PUT` | `/cms/api/builder/pages/<slug>` | Save against `expectedRevision` |
| `POST` | `/cms/api/builder/pages/<slug>` | Publish against `expectedRevision` |
| `GET` | `/cms/api/builder/pages/<slug>/history` | List revisions; `?revision=<n>` returns a snapshot |
| `GET` | `/cms/api/builder/templates` | List built-in and saved templates |
| `POST` | `/cms/api/builder/templates` | Save the supplied document as a reusable template |
| `GET` | `/cms/api/builder/templates/<id>` | Read a saved template document |
| `DELETE` | `/cms/api/builder/templates/<id>` | Delete a saved template |

`admin` and `editor` roles may publish; `contributor` may read and save drafts but cannot publish. The browser-facing requests use relative URLs and the server enforces schema validation, page slug matching, and role permission checks before writing.

## Persistence and operational limits

Drafts, published snapshots, revisions, and saved templates are stored in `data/builder-pages.json` (ignored by Git). `BUILDER_DATA_FILE` can point to a different path for isolated tests or a mounted data volume. Writes use a temporary file followed by atomic rename, and compare-and-save is serialized within one Node process. This file adapter does **not** provide a cross-process lock or database transaction. It is appropriate for the current single-process standalone server; deploy multiple instances only after adding a transactional or shared persistence adapter.

A corrupt/unsupported Builder data file fails closed; it is not reset or overwritten. Back up the data file with the rest of the persistent `data/` volume.

## Verification

The automated tests cover validation/migration, safe links and image sources, component operations, hierarchy constraints, undo/redo, autosave failure/conflict behavior, revisions, publication snapshots, templates, and RBAC. HTTP smoke verification exercised login, page creation, nested Container/Grid/Text/Image rendering, save, stale-write `409`, history, template save, publish, public SSR, and editor SSR.

Browser automation is not configured in this repository and no usable browser executable is available in the current environment; a temporary Chromium build could not launch because `libnspr4.so` is missing. Therefore the full interactive browser flow (including double-click inline editing, using the image picker/source, dragging a node, saving, reloading in a real browser, and comparing editor and published visuals) remains unverified. Do not treat server-rendered HTML or unit tests as visual-parity evidence.

The Builder currently targets a single-process JSON store, with no cross-process locking. It does not yet provide dynamic data bindings, a media-library picker in the Image inspector, multi-page site kits, a CLI/component package ecosystem, or browser-level Playwright coverage. Existing store pages (`/shop`, `/shop/<product-slug>`, `/shop/cart`, `/shop/checkout`, and `/about`) remain separate Astro routes; a saved Builder page does not replace or automatically configure those routes. Product details use the real product slug, and `/shop/checkout` redirects to the cart while it is empty. There is no separate policy page yet, and payment is only usable after a real provider is configured.
