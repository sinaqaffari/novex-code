# Implementation and authorization audit

Audit date: 2026-10-27. Scope: the current workspace, including the commerce slice, CMS authorization hardening, public-page styling/performance work, and the plugin API-route phase. This records verified implementation and remaining limits; it is not a production-security certification.

## Architecture and initial findings

| Concern | Current implementation |
| --- | --- |
| Front end / server | Astro 7, TypeScript, server-rendered routes, `@astrojs/node` standalone adapter; MDX, RSS, and sitemap integrations. The app requires Node `>=22.23.4`. |
| Content | Markdown/MDX under `src/content/blog/`; the CMS reads and writes these files at runtime. |
| Commerce persistence | `data/commerce.json` or `COMMERCE_DB_FILE`; a missing file initializes with empty products, customers, orders, and discounts. Top-level structure, arrays, version, and counter are checked; malformed/incomplete top-level data is rejected and preserved. There is no SQL database or migration system. |
| CMS persistence | Users/settings/plugin state use local JSON files; posts and uploads are filesystem-backed. User-file JSON/shape/role errors fail closed; first-read initialization is coalesced and writes use unique temporary files with restrictive permissions. Settings still fall back to defaults on read/parse errors and should receive equivalent integrity treatment before operational use. |
| Authentication | HMAC-signed, eight-hour session cookie; scrypt password hashes; five failed attempts lock an IP for five minutes in the current process. The middleware now reloads the stored user and current role on each CMS request, so role changes/deactivation take effect without waiting for cookie expiry. A random session-signing key is used if `CMS_SESSION_SECRET` is unset, invalidating sessions on restart; production must set a persistent secret. |
| Authorization | `src/lib/cms/access.ts` maps CMS routes and request methods to permissions; route matching is segment-aware and fails closed to `cms.settings:write` for unmapped routes. Middleware protects pages, APIs, and private media paths, applies cross-site checks, and adds no-store/noindex headers. UI navigation/actions are filtered separately. |
| Payments | Checkout calls the payment initiation hook; `/shop/api/payment/callback` claims verification and applies verified payment once within the local store. A bundled Zarinpal adapter exists, but it has not been checked against current official provider documentation or a real transaction. |
| Plugins | `plugin.json` manifests are enumerated at startup; bundled modules load lazily. Manifests can declare exact CMS/public API routes with restricted JSON transport; CMS routes use session/RBAC/CSRF middleware, while public routes are GET-only with a restricted API. Imported modules run in-process and remain cached after deactivation; this is not a sandbox for untrusted code. |
| Deployment | Multi-stage Node Dockerfile, Compose, local volumes, health endpoint, and non-root runtime are present. |
| Ecosystem | No component registry or CLI package exists. Package/release metadata and a safe extension-distribution flow remain future work. |

### Initial repository observations retained

- The original UI audit found missing Vazirmatn font loading, a mobile-menu `[hidden]` override, an overly tall homepage hero, duplicate legacy/current styles, and generic starter artwork. The shared public/storefront UI was subsequently updated; preserve `artifacts/ui-review/final/` screenshots and interaction review.
- Product records do not yet have a verified artifact/release/license/documentation schema. No reviews, compatibility claims, or genuine product screenshots should be invented.
- Order lookup is not a customer account, purchase history, or download-entitlement system.
- Shipping remains hard-coded in the checkout service at 45,000 toman with a 1,000,000 toman free-shipping threshold; these are implementation defaults, not confirmed store policy.

## Public-page styling and performance notes

- Shared public/storefront layouts now use intentional layered surface backgrounds, branded cards/hero treatments, and a short entrance transition. `prefers-reduced-motion: reduce` disables nonessential motion; page behavior remains usable without animation.
- The `ShopLayout` stylesheet was reduced from 48,514 bytes in the recorded baseline to 36,685 bytes after removing duplicated/unused rules (a 24.4% stylesheet-size reduction). This is a source/asset-size comparison, not a Lighthouse, Core Web Vitals, or measured runtime-speed claim.
- Built-server HTTP smoke returned 200 for `/`, `/blog`, `/blog/docker`, `/about`, and `/shop`. No browser screenshot or automated visual regression was captured in this environment.

## First commerce workflow

- The first slice intentionally retained the existing Astro/Node and JSON architecture instead of introducing Fastify/PostgreSQL/Drizzle in one large change. This is a scope decision—not a statement that JSON is production-grade.
- Checkout validates customer fields, item count/quantity, active product state, stock, and server-side prices; duplicate product lines are aggregated. A persisted idempotency key plus request fingerprint prevents duplicate order/inventory effects for a repeated checkout.
- Payment initiation and callback transitions are explicit. A non-success browser-return status does not cancel, restock, or consume a discount; only provider-verified success settles. Repeated successful settlement does not repeat side effects in the same process/store.
- Isolated service-level tests cover checkout, cart parsing, empty initialization, corrupt commerce data, payment-state transitions, and the plugin manifest. They are not HTTP integration tests, multi-process contention tests, or live-provider tests.
- No SQL migration was added. JSON writes use a same-process queue and atomic rename; multiple processes/instances can race. Move to PostgreSQL with a migration plan, unique idempotency constraint, and transactional stock/payment operations before horizontal scaling or production traffic.
- Posts have no creator/owner field. Contributors can collaborate on the shared draft pool; these permissions are not per-author isolation. Add post ownership and a migration/claim policy before treating contributor accounts as isolated workspaces.

## Plugin-platform hardening — phase 1 and API routes

### Changed files and runtime contract

- Core runtime: `src/lib/plugins/{types,validation,secrets,lazy-module,registry,store,hooks,route-http,route-dispatch,route-controller}.ts`; CMS management: `src/pages/cms/plugins.astro`, `src/pages/cms/api/plugins.ts`; plugin endpoints: `src/pages/api/plugins/[id]/[...path].ts` and `src/pages/cms/api/plugins/[id]/[...path].ts`; manifests, handlers, and `readme.txt` under `plugins/*/`.
- Plugin implementation discovery uses a non-eager `import.meta.glob`; each module is loaded on demand, concurrent imports are coalesced, and successful modules are cached. Inactive plugin module bodies are not evaluated when the registry starts. A regression test checks the lazy glob and cache behavior. Once imported, Node retains the module after deactivation; this only reduces startup/evaluation of disabled code and is not isolation.
- All five bundled manifests declare stable `id` and `apiVersion: 1`. Validation rejects invalid IDs, API versions, SemVer, capability/hook declarations, dependency/page/settings errors, unsafe or duplicate API paths, unsupported methods, missing `api:cms`/`api:public` capability, and public visibility on secret settings. API route declarations are exact static paths; there are no wildcards or dynamic parameters.
- `PLUGIN_HOOKS` is an allowlist. Registrations must match a host-defined hook, hook kind, manifest declaration, and required capability. Payment initiation and verification require `commerce:payments`; unknown hooks are rejected.
- `PluginApi.capabilities` uses a runtime read-only proxy detached from the authorization Set; nested manifest data is frozen. `hasCapability` and authorization checks use the private source Set.
- Hook priorities are bounded integers. Presentation hook failures are isolated so the prior output survives; payment-hook failures remain fail-closed. Plugin hooks are removed if registration/activation fails.
- Activation runs before the active flag is written. On a persistence failure, activation is rolled back best-effort. Active dependents prevent a dependency from being deactivated or uninstalled.
- Plugin settings validate type, numeric bounds/step, text length, and required values server-side. A settings form is validated as a batch and persisted in one atomic write.
- `data/plugins.json` now validates strictly; malformed JSON/schema is preserved and rejected instead of silently resetting. The plugin manager reports an unhealthy store and keeps the rest of the site available. Writes use same-process serialization, atomic rename, and file mode `0600`.
- Secret fields require `secrets:read`, are not saved in plugin JSON, and can only be accessed through `api.getSecret()` / `api.hasSecret()` for manifest-declared keys. Kaveh Negar and Zarinpal credentials use `NOVEX_PLUGIN_KAVEH_NEG_SMS_API_KEY` and `NOVEX_PLUGIN_ZARINPAL_GATEWAY_MERCHANT_ID`, injected by the runtime environment. The panel shows presence only, never the value.

### Endpoints and validation

- `GET /cms/plugins` lists packages and schema errors; `POST /cms/api/plugins` handles lifecycle and non-secret settings; declared pages remain under `/cms/plugins/<id>/<path>`. `GET /cms/api/plugins/<id>/<path>` resolves only an exact route of an active, valid plugin and requires a CMS session plus `cms.plugins:read`; declared POST routes require `cms.plugins:write` and JSON input. The shared middleware checks CSRF origin and role on CMS requests.
- `GET /api/plugins/<id>/<path>` is available only for manifest-declared public routes. Public routes are GET-only and receive an API limited to published posts and individually marked public, non-secret settings. CMS routes get the host `PluginApi` only after role checks. Both transports are JSON-only, `no-store`, and size-bounded; plugin errors return generic responses without forwarding cookies or arbitrary headers.
- The CMS route behavior was smoke-tested against the built server: anonymous 401, authorized content-audit activation/GET 200, unsupported POST 405 with `Allow`, cross-site POST 403, and inactive-plugin 404. Unit tests cover manifest path/capability validation, JSON limits, method handling, role checks, HEAD, and handler context. The integration smoke was manual; the registry/middleware do not yet have a repeatable HTTP test harness. There is no database migration.
- Existing bundled manifests were updated in place. A custom plugin must add `id` and `apiVersion`, declare every hook/capability/API route it uses, and move plaintext credentials from legacy plugin options to the named environment variables before upgrade.

### Remaining plugin limits

Plugin source is bundled into the application build and runs with full Node-process privileges. Implementation modules now load lazily, so disabled plugins are not evaluated during registry startup, but imports remain cached after deactivation. The API/capability system is a contract for trusted code, not a security sandbox; a malicious bundled module can bypass it by importing Node APIs directly. This TypeScript/Node contract does not execute or install PHP WordPress plugins. There is no runtime plugin archive installer, signature verification, update channel, dependency version range, per-plugin data migration runner, or secret rotation UI. The configured secrets depend on deployment-level environment/secret-manager operations. Any legacy plaintext secret previously stored in `data/plugins.json` must be moved to the environment and manually removed; the app does not delete it automatically to avoid destroying configuration without operator confirmation.

## CMS authorization changes

### Permission behavior

| Area | Read access | Write/action access |
| --- | --- | --- |
| Posts | The post list/API filters drafts from subscriber results. Contributors can read/edit draft material. | Contributors may create/update drafts only. `canEditPost` blocks them from publishing a draft, changing a published post, or unpublishing it through a direct `PUT`. Editors/admins can publish; delete requires `cms.posts:delete`. Preview uses the same safe Markdown renderer as public posts. |
| Products | Read-only page requests are forced to active products; subscribers cannot open product detail/edit routes. | Product creation/edit actions require `commerce.products:write`; the list hides editing controls from read-only users. |
| Orders/customers | Order list, dashboard/reports, and customer routes require their read permissions. Contributors/subscribers do not receive order/customer access. | Order detail and status/note API require `commerce.orders:write`. |
| Settings | `/cms/api/settings` has a separate read permission. | `/cms/settings` and settings writes require `cms.settings:write`; the navigation and links are hidden from users lacking it. |
| Discounts | The management page is restricted to write-capable users. | Create/toggle/delete routes require `commerce.discounts:write`. |
| Media | Private media-file reads require `cms.media:read`. | The media library/upload requires `cms.media:write`; deleting uploaded files requires `cms.media:delete`. Delete controls and links to the library are hidden when unavailable. |
| Users/plugins | User and plugin routes require their respective read permissions. | User/plugin writes are restricted by their write permissions; user role inputs are validated against the four supported roles. |

- Unknown CMS routes fail closed, while explicit login/logout endpoints remain available as designed. POST/PATCH/DELETE forms for user management now have server-side `_method` handling and return redirects for regular browser forms.
- Role changes are loaded from the user store on each CMS request; deleted/disabled accounts lose access on their next request. Corrupt or structurally invalid `data/users.json` is preserved and causes a fail-closed error rather than a reset.
- Markdown rendering escapes raw HTML and blocks unsafe URL schemes, including entity-obfuscated `javascript:` URLs and `data:` images. The CMS preview and public blog share this renderer.
- New SVG uploads are disabled until a proven sanitizer is selected; existing SVG media remains listed/servable for compatibility. Private media responses use `nosniff`; existing SVG data still needs an operational inventory/sanitization policy.
- Automated tests cover the role matrix, route/action mapping, list-versus-detail permissions, trailing-slash list routes, contributor publishing/editing rules, media/settings/discount capabilities, user-store integrity and concurrent first-read initialization, media-upload policy, and Markdown safety. A manual HTTP smoke test against the final built server also verified cross-site rejection, anonymous 401/redirect behavior, custom admin bootstrap without duplicate IDs, admin pages, contributor 403s and direct post restrictions, editor upload versus delete permissions, user form method override, immediate role refresh/deactivation, and no-store redirects. No repeatable automated HTTP session/middleware suite has been added.

### Product-list sorting

- The CMS product sort query is now allowlisted; unknown values fall back to `newest` both in the page and in the service.
- `newest` orders by `createdAt` (the previous comparator used `updatedAt`, which made edits to old products appear new). Price/stock ties and Persian-name order use stable name/ID tie-breakers. Focused tests run against an isolated temporary commerce file.

### Middleware comparison limitation

The branch's Git base commit (`249e60c`) contains no `src/middleware.ts`, so there is no committed prior middleware version to compare against. The current file was reviewed against the existing auth helpers, routes, cookies, and permission map. A manual HTTP smoke test exercised login, cross-site/CSRF rejection, route permissions, role changes, deactivation, and no-store redirects against the built app. Logout behavior and broader automated HTTP/browser coverage remain untested.

## Validation recorded for this workspace

- Project scripts were run with Node `v22.23.4` from the available npx binary; the system-default Node remains `v22.22.3`, below the repository engine requirement.
- `npm run check` — **0 errors, 0 warnings, 0 hints** across 132 files.
- `npm run build` — completed successfully with the supported Node binary; Astro built the standalone Node server and generated client assets.
- `npm test` — **92/92 passed** across 28 suites, including manifest route/capability validation, route JSON bounds and serialization, dispatch authorization, method handling, public/CMS handler contexts, RBAC path mapping, and existing CMS/commerce/plugin tests. This remains a unit/service suite, not provider E2E or browser automation.
- `npm run check:rtl` — passed (95 files checked); `npm run check:copy` — passed (131 files checked).
- Built-server HTTP smoke — `/`, `/blog`, `/blog/docker`, `/about`, `/shop` all returned 200. The plugin API checks returned anonymous 401, login/activation 200, authorized `content-audit` GET 200 with JSON `no-store`, undeclared POST 405 (`Allow: GET, HEAD`), cross-site POST 403, and inactive plugin 404. The test-only user and plugin state were removed afterward; the pre-existing empty `data/commerce.json` was preserved.
- The earlier 32-request user-store concurrency smoke remains recorded: all first-time logins returned 200, exactly one configured admin was created, and the generated file had mode `0600`; test user data was removed.
- No automated browser screenshot, visual regression, live payment-provider test, or independent security certification was performed.

## Remaining risks and next phase

1. Run HTTP integration tests for unauthenticated redirects/API 401, per-role page/API 403, session role changes/deactivation, CSRF rejection, no-store headers, and user-management form overrides. The middleware base comparison is impossible because the base commit has no middleware file.
2. Add robust settings-store validation/atomic persistence and deeper nested-record validation for commerce JSON; the current protections validate the commerce file's top-level shape, not every nested entity field.
3. Verify the Zarinpal adapter against current official docs and a controlled test-mode transaction before enabling it for customers. Current tests do not contact a payment provider.
4. Revisit Fastify/PostgreSQL/Drizzle and versioned migrations as a separate, phased architecture change. Until then, keep deployments single-process and back up local JSON/media/content data.
5. Complete an independent authorization/security review, including trusted-proxy configuration for IP throttling, session-secret operations, upload handling, plugin trust, and production observability.

## Builder workstream audit — 2026-10-28

- **Architecture to reuse:** Astro 7.4 SSR on the existing Node adapter; React 19 + TypeScript for the editor; the current CMS session/RBAC and page routes; the filesystem-backed commerce catalog and existing `/shop` routes. No new database or backend framework is introduced.
- **Builder implementation now present:** one versioned page-document contract, allow-listed Container/Heading/Text/Image/Button components, Container stack/row/grid layout, safe tokenized responsive styles, edit operations/history/autosave, revisioned JSON persistence, themes/templates, CMS APIs, and an Astro renderer. Plain text is escaped; image inputs reject script/data/protocol-relative and insecure HTTP sources. Grid insertion is a preset of the Container component, not a second incompatible node type.
- **Verified behavior:** latest `npm run check` reported 0 errors/warnings/hints across 160 files; `npm test` passed 129 tests; `npm run build`, `npm run check:copy` (155 files), `npm run check:rtl` (108 files), and `git diff --check` passed. Built-server HTTP smoke verified create/save/reload/publish, stale-write `409`, nested grid SSR, escaped Heading/Text markup, Image/Button output, theme/responsive CSS, and four starter templates. `/shop`, `/shop/cart`, `/about` returned 200; `/shop/checkout` redirected to `/shop/cart` for an empty cart. Browser-only interaction remains unverified because no browser runtime is available; a temporary Chromium package could not launch without `libnspr4.so`.
- **Known gaps:** the JSON adapter has no cross-process lock; the Image inspector has no media-library picker; the editor has no dynamic bindings; template persistence is single-page rather than a multi-route site kit, and the current library does not render an isolated visual template preview. Existing e-commerce routes are real Astro routes, but Builder publishing does not replace/configure those routes. No Playwright browser workflow, Lighthouse data, real payment-provider test, or visual-parity claim is available.
- **Recommended sequence:** (1) complete and browser-test the Container/Heading/Text/Image/Button/Grid edit-to-publish slice; (2) add an authenticated media picker and reusable preview for templates; (3) design versioned, multi-route commerce site kits against the real product/cart/checkout routes; (4) add dynamic data binding only with explicit schemas and server-side permissions; (5) move local JSON persistence to transactional shared storage only when deployment requires multiple writers/instances.
- **Verification method:** `npm run check`, `npm test`, `npm run build`, `npm run check:copy`, `npm run check:rtl`, `git diff --check`, and an HTTP server smoke for create/save/reload/publish/public SSR. Browser-level interaction tests remain a release gate, not a completed verification item.
