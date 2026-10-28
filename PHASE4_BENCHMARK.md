# Phase 4 Benchmark Report — Published Output

## Build Output Sizes (after `npm run build`)

| Asset | Size | Notes |
|-------|------|-------|
| Total `dist/` | 2.4 MB | Dominated by Vazirmatn font files (WOFF2) |
| BuilderEditor.js | 86 KB | Editor only, loaded on `/cms/builder/*` routes |
| client.js | 208 KB | Astro client runtime + React hydration |
| react.js | 7.8 KB | React runtime |
| PostEditor.js | 5.0 KB | CMS post editor |
| builder.css | 6.2 KB | Builder component styles |
| commerce.css | 9.2 KB | Commerce styles |
| CmsLayout.css | 24 KB | CMS layout styles |
| ShopLayout.css | 29 KB | Storefront layout styles |

## Published Page Output (Zero JS Payload)

Published pages at `/pages/[slug]` use pure Astro SSR with:
- **0 KB client-side JavaScript** — no `<script>` tags, no hydration
- **Inline responsive CSS** — generated per-document via `buildResponsiveCss()`, only includes styles for nodes that actually have responsive overrides
- **Semantic HTML** — `<article>`, `<header>`, `<h1>`-`<h4>`, `<p>`, `<figure>`, `<figcaption>`, `[loading="lazy"]`, `<a>`
- **Skip link** — `<a class="sr-only" href="#main">پرش به محتوای اصلی</a>`
- **RTL** — `<html lang="fa" dir="rtl">`
- **Canonical + Open Graph** — auto-generated meta tags

## Page Weight Analysis

| Metric | Value | Assessment |
|--------|-------|------------|
| JS payload (published page) | 0 KB | Excellent — no client-side JS |
| CSS payload (published page) | Inline only | Only responsive overrides, minimal |
| HTML payload | Depends on content | SSR-rendered, no framework overhead |
| Font loading | Vazirmatn variable | ~400 KB per subset, loaded via @fontsource |

## Unnecessary Scripts

None found on published pages. The only client-side JavaScript in the entire build is:
- `BuilderEditor.js` — only on `/cms/builder/*` (editor routes)
- `PostEditor.js` — only on CMS post routes
- `client.js` / `react.js` — only where client components are used (editor)

Storefront pages (`/`, `/shop/*`, `/pages/*`, `/blog/*`) ship zero JavaScript.

## Mobile Usability

- Responsive breakpoints: desktop (>1024px), tablet (≤1023px), mobile (≤767px)
- Canvas preview supports viewport switching in the editor
- Published pages use `width=device-width, initial-scale=1` viewport meta
- Mobile layout collapses row-layout containers to column (`flex-direction: column`)

## LCP/CLS Notes (Cannot Measure Without Browser)

- **Cannot measure** without a browser — no Chromium available
- LCP would likely be dominated by font loading (Vazirmatn WOFF2)
- CLS should be minimal since layout is server-determined with no client-side layout shifts
- Image `loading="lazy"` on all images helps LCP

## Build Time

- `npm run build` completes in ~5 seconds
- No build steps beyond Astro compilation

## WordPress Comparison

**Not available** — no WordPress instance to benchmark against. No claims made about relative performance.

## Semantic HTML / Accessibility (Static Analysis)

| Feature | Status | Evidence |
|---------|--------|----------|
| Skip to content link | ✅ | `<a class="sr-only" href="#main">` in SiteLayout |
| Semantic landmarks | ✅ | `<header>`, `<nav>`, `<main id="main">`, `<footer>` |
| Heading hierarchy | ✅ | `<h1>`-`<h4>` based on `level` prop |
| Image alt text | ✅ | `alt={node.props.alt}`, empty state uses `role="img"` + `aria-label` |
| RTL language | ✅ | `dir="rtl"`, `lang="fa"` |
| Focus styles | ✅ | `focus-visible` rings on interactive elements |
| ARIA labels | ✅ | On nav, buttons, tree nodes, image empty states |
| Color contrast | ⚠️ | Not verified (requires browser/tools) |
| Keyboard navigation | ✅ | Native HTML elements, no custom widgets on published pages |

## Missing Comparison Data

- WordPress plugin performance: not available (no WordPress instance)
- LCP/CLS field data: not available (no browser)
- Real-user monitoring: not implemented
