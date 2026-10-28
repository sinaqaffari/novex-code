# Phase 4 Architecture Risks Review

## 1. Multi-Tenant Isolation

**Risk Level: LOW (single-tenant by design)**

The application is explicitly single-tenant. All data is stored in JSON files under `/home/user/novex-code/data/`:
- `builder-pages.json` — page drafts and published documents
- `users.json` — user accounts and roles
- `commerce.json` — products, orders, carts, discounts
- `cms-settings.json` — site settings

There is no multi-tenant concept in the data layer, RBAC, or routing. Every request operates on the same shared data store. No tenant ID, workspace ID, or organization scoping exists anywhere in the codebase.

**Boundary explicitly kept:** Single-tenant. No changes planned or recommended to add multi-tenancy.

**Mitigation if needed in future:** Add tenant_id to all entities, scope API routes by tenant, add tenant middleware.

## 2. Persistent DB Storage

**Risk Level: MEDIUM**

The "database" is a set of JSON files read/written on every request via `readDatabase()` / `updateDatabase()` in `src/lib/commerce/db.ts` and similar patterns for builder pages (`src/lib/builder/store.ts`).

**Issues:**
- No file locking — concurrent writes can corrupt data
- No transaction support — partial writes possible on crash
- No indexing — every read scans the full file
- File size grows unbounded — no compaction or archival
- Single-process only — cannot scale horizontally without shared storage

**Mitigation:** The commerce state machine (`src/lib/commerce/`) uses optimistic concurrency with revision numbers (`expectedRevision`) to detect lost updates. Builder pages use the same pattern. But file-level corruption is not guarded against.

**Recommended:** Migrate to SQLite or PostgreSQL when concurrent write volume increases. The abstraction layer (`db.ts`) makes this feasible.

## 3. Multi-Instance Deployment

**Risk Level: HIGH**

The file-backed storage cannot support multiple instances:
- Each instance reads/writes its own copy of the JSON files
- No shared state between instances
- No session sharing (sessions are in-memory or cookie-based, not in a shared store)
- Autosave conflict detection relies on revision numbers but cannot prevent file corruption from concurrent writes across instances

**Current constraint:** Single-process deployment only. This is documented and intentional.

**Mitigation:** Replace file-backed storage with a database (SQLite/PostgreSQL) and use a shared session store (Redis) before deploying multiple instances.

## 4. Payment Sandbox Verification

**Risk Level: MEDIUM**

The payment system (`src/lib/commerce/`) includes a payment state machine with states like `pending`, `authorized`, `captured`, `failed`, `refunded`. However:

- No actual payment provider integration is configured (no Stripe, PayPal, ZarinPal, etc. credentials)
- The `createPaymentIntent` and `verifyPayment` functions exist but are gated behind configuration checks
- If credentials are absent, payments are labeled "unconfigured" and cannot be processed
- No webhook endpoint for payment provider callbacks exists

**Mitigation:** When payment credentials are available, integrate a provider via the existing plugin hook system (`PLUGIN_HOOKS`) rather than hardcoding provider logic.

## 5. Plugin Hook Safety

**Preserved behavior:** `PLUGIN_HOOKS.failureMode` is unchanged — plugin failures do not crash the host application. `secrets:read` is NOT listed in the README hooks table (per user constraint).

## 6. Security: XSS and Unsafe Content

**Risk Level: LOW (defenses in place)**

- Image `src` values are validated — `javascript:` URLs are rejected (422)
- Media uploads are validated — non-image files rejected (400)
- Builder document schema validation (`validatePageDocument`) rejects unknown component types, versions, and duplicate IDs
- Published pages render `alt` text and use `loading="lazy"` on images
- Plugin head/footer HTML is inserted via `Fragment set:html` — plugins can inject arbitrary HTML (trusted plugin model)

## 7. Editor / Renderer Canonical Document

**Status: ✅ Both use the same `PageDocument` model**

The editor (`BuilderEditor.tsx`) and the published renderer (`BuilderNode.astro`) both operate on `PageDocument` from `src/lib/builder/types.ts`. The editor serializes to JSON via the API; the renderer reads from the same JSON store. Validation is applied server-side on every save (`validatePageDocument`).

## Summary Table

| Risk Area | Level | Single-Tenant Boundary | Action Required |
|-----------|-------|----------------------|-----------------|
| Multi-tenant isolation | Low | Explicit single-tenant | None |
| Persistent file storage | Medium | N/A | Consider SQLite/PostgreSQL |
| Multi-instance deployment | High | N/A | Database + shared sessions required first |
| Payment sandbox | Medium | Unconfigured — labeled as such | Add provider when credentials available |
| XSS / unsafe content | Low | Validated server-side | None |
| Canonical document | ✅ Consistent | N/A | None |
