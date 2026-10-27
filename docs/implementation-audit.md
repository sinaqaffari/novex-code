# Implementation and authorization audit

Audit date: 2026-10-27. Scope: the current workspace, including the first commerce slice, CMS authorization hardening, and plugin-platform phase 1. This records verified implementation and remaining limits; it is not a production-security certification.

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
| Plugins | `plugin.json` manifests are enumerated at startup; implementation modules are bundled but imported lazily when an active plugin boots or an explicit lifecycle/page action needs them. Imported modules run in the application process and remain cached after deactivation. Capability checks limit the exposed plugin API, but this is not a sandbox for untrusted plugin code. |
| Deployment | Multi-stage Node Dockerfile, Compose, local volumes, health endpoint, and non-root runtime are present. |
| Ecosystem | No component registry or CLI package exists. Package/release metadata and a safe extension-distribution flow remain future work. |

### Initial repository observations retained

- The original UI audit found missing Vazirmatn font loading, a mobile-menu `[hidden]` override, an overly tall homepage hero, duplicate legacy/current styles, and generic starter artwork. The shared public/storefront UI was subsequently updated; preserve `artifacts/ui-review/final/` screenshots and interaction review.
- Product records do not yet have a verified artifact/release/license/documentation schema. No reviews, compatibility claims, or genuine product screenshots should be invented.
- Order lookup is not a customer account, purchase history, or download-entitlement system.
- Shipping remains hard-coded in the checkout service at 45,000 toman with a 1,000,000 toman free-shipping threshold; these are implementation defaults, not confirmed store policy.

## First commerce workflow

- The first slice intentionally retained the existing Astro/Node and JSON architecture instead of introducing Fastify/PostgreSQL/Drizzle in one large change. This is a scope decision—not a statement that JSON is production-grade.
- Checkout validates customer fields, item count/quantity, active product state, stock, and server-side prices; duplicate product lines are aggregated. A persisted idempotency key plus request fingerprint prevents duplicate order/inventory effects for a repeated checkout.
- Payment initiation and callback transitions are explicit. A non-success browser-return status does not cancel, restock, or consume a discount; only provider-verified success settles. Repeated successful settlement does not repeat side effects in the same process/store.
- Isolated service-level tests cover checkout, cart parsing, empty initialization, corrupt commerce data, payment-state transitions, and the plugin manifest. They are not HTTP integration tests, multi-process contention tests, or live-provider tests.
- No SQL migration was added. JSON writes use a same-process queue and atomic rename; multiple processes/instances can race. Move to PostgreSQL with a migration plan, unique idempotency constraint, and transactional stock/payment operations before horizontal scaling or production traffic.
- Posts have no creator/owner field. Contributors can collaborate on the shared draft pool; these permissions are not per-author isolation. Add post ownership and a migration/claim policy before treating contributor accounts as isolated workspaces.

## Plugin-platform hardening — phase 1

### Changed files and runtime contract

- Core runtime: `src/lib/plugins/{types,validation,secrets,lazy-module,registry,store,hooks}.ts`; CMS management: `src/pages/cms/plugins.astro`, `src/pages/cms/api/plugins.ts`; host UI updates: plugin-owned settings pages and `plugins/*/plugin.json`/`readme.txt`.
- Plugin implementation discovery uses a non-eager `import.meta.glob`; each module is loaded on demand, concurrent imports are coalesced, and successful modules are cached. Inactive plugin module bodies are not evaluated when the registry starts. A regression test checks the lazy glob and cache behavior. Once imported, Node retains the module after deactivation; this only reduces startup/evaluation of disabled code and is not isolation.
- All five bundled manifests now declare stable `id` and `apiVersion: 1`. Invalid IDs, API versions, SemVer, capability declarations, hooks, dependencies, pages, and settings are surfaced as errors and cannot activate.
- `PLUGIN_HOOKS` is an allowlist. Registrations must match a host-defined hook, hook kind, manifest declaration, and required capability. Payment initiation and verification require `commerce:payments`; unknown hooks are rejected.
- `PluginApi.capabilities` uses a runtime read-only proxy detached from the authorization Set; nested manifest data is frozen. `hasCapability` and authorization checks use the private source Set.
- Hook priorities are bounded integers. Presentation hook failures are isolated so the prior output survives; payment-hook failures remain fail-closed. Plugin hooks are removed if registration/activation fails.
- Activation runs before the active flag is written. On a persistence failure, activation is rolled back best-effort. Active dependents prevent a dependency from being deactivated or uninstalled.
- Plugin settings validate type, numeric bounds/step, text length, and required values server-side. A settings form is validated as a batch and persisted in one atomic write.
- `data/plugins.json` now validates strictly; malformed JSON/schema is preserved and rejected instead of silently resetting. The plugin manager reports an unhealthy store and keeps the rest of the site available. Writes use same-process serialization, atomic rename, and file mode `0600`.
- Secret fields require `secrets:read`, are not saved in plugin JSON, and can only be accessed through `api.getSecret()` / `api.hasSecret()` for manifest-declared keys. Kaveh Negar and Zarinpal credentials use `NOVEX_PLUGIN_KAVEH_NEG_SMS_API_KEY` and `NOVEX_PLUGIN_ZARINPAL_GATEWAY_MERCHANT_ID`, injected by the runtime environment. The panel shows presence only, never the value.

### Endpoints and validation

- `GET /cms/plugins` lists packages and schema errors; `POST /cms/api/plugins` handles activate, deactivate, uninstall, and non-secret settings; declared plugin pages are served under `/cms/plugins/<id>/<path>`.
- `npm test` now includes focused plugin manifest, hook-policy, secret-environment, SemVer, settings, state-integrity, and lazy-import/cache regression tests. The lazy-import test guards the implementation glob against eager evaluation and verifies on-demand, coalesced, cached loading. The suite does not exercise the Astro registry through a repeatable HTTP test.
- Existing bundled manifests were updated in place; no SQL migration was added. Any custom plugin must add the required `id` and `apiVersion`, declare each used hook/capability, and move plaintext credentials from legacy plugin options to the named environment variables before upgrade.

### Remaining plugin limits

Plugin source is bundled into the application build and runs with full Node-process privileges. Implementation modules now load lazily, so disabled plugins are not evaluated during registry startup, but imports remain cached after deactivation. The API/capability system is a contract for trusted code, not a security sandbox; a malicious bundled module can bypass it by importing Node APIs directly. There is no plugin archive installer, signature verification, update channel, dependency version range, per-plugin data migration runner, or secret rotation UI. The configured secrets depend on deployment-level environment/secret-manager operations. Any legacy plaintext secret previously stored in `data/plugins.json` must be moved to the environment and manually removed; the app does not delete it automatically to avoid destroying configuration without operator confirmation.

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

- `npm ci` — completed; 309 packages added and npm reported 0 vulnerabilities. It also warned that local Node `v22.22.3` is below the project's/Astro's required `>=22.23.4`.
- `npm test` — **72/72 passed** across 23 suites. Includes concurrent user-store initialization, plugin manifest, hook-policy, secret-environment, settings, SemVer, state-integrity, lazy-module import/cache, and CMS product-sort tests; still not a browser or provider E2E suite.
- `npm run check:rtl` — passed (90 files checked).
- `npm run check:copy` — passed (125 files checked).
- `git diff --check` — passed after the final code and documentation updates.
- `npm run check` and `npm run build` — both stop at Astro's Node-version guard under local Node `v22.22.3`.
- Direct internal `@astrojs/check` CLI — **0 errors, 0 warnings, 0 hints** across 121 files (used to assess the source despite the unsupported local Node version).
- Direct internal Astro CLI build — completed successfully after the lazy-import and user-store race fixes. The generated registry uses dynamic `import()` loaders for plugin implementation chunks; manifest/readme data remains eager. This bypasses only Astro's Node-version guard; build/runtime operation under a supported Node version remains unverified.
- Manual built-server plugin HTTP smoke — logged in, activated `content-audit`, rendered its custom page (HTTP 200), deactivated it, and verified the former page redirected to plugin management (HTTP 302) with the plugin inactive. Generated user/plugin/commerce state and temporary cookie data were removed afterward. The earlier smoke also covered option save, out-of-range rejection, invalid-action rejection, secret-env status rendering, and no secret-marker persistence.
- User-store concurrency smoke — 32 parallel first-time login requests all returned HTTP 200, created exactly one configured admin, and produced a mode-`0600` user file without rename errors. Generated user data was removed afterward.

## Remaining risks and next phase

1. Run HTTP integration tests for unauthenticated redirects/API 401, per-role page/API 403, session role changes/deactivation, CSRF rejection, no-store headers, and user-management form overrides. The middleware base comparison is impossible because the base commit has no middleware file.
2. Add robust settings-store validation/atomic persistence and deeper nested-record validation for commerce JSON; the current protections validate the commerce file's top-level shape, not every nested entity field.
3. Verify the Zarinpal adapter against current official docs and a controlled test-mode transaction before enabling it for customers. Current tests do not contact a payment provider.
4. Revisit Fastify/PostgreSQL/Drizzle and versioned migrations as a separate, phased architecture change. Until then, keep deployments single-process and back up local JSON/media/content data.
5. Complete an independent authorization/security review, including trusted-proxy configuration for IP throttling, session-secret operations, upload handling, plugin trust, and production observability.
