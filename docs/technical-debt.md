# Technical Debt Log

This document tracks accepted technical debt items with clear revisit criteria and priority levels.

## Format

| ID | Item | Priority | Added | Revisit Criteria |
|----|------|----------|-------|------------------|

---

## Active Technical Debt

### TD-001: Tailwind Local File Bundle Size (Optional Optimization)

**Status:** Accepted - Low Priority

**Priority:** P3 (Very Low)

**Date Added:** 2026-04-25

**Component:** `public/admin.html`, `public/tailwind-3.4.17.js`

**Related Task:** `TASK-tailwind-build-eval-2026-04-25`

**Description:**

The admin panel loads Tailwind CSS via a local JavaScript file (`/tailwind-3.4.17.js`, 398KB). This is the Tailwind Play CDN runtime saved as a local file, which includes the full Tailwind utility set.

**Current State:**

- ✅ No console warnings (local file, not CDN)
- ✅ No external dependencies (file served locally)
- ⚠️ Larger bundle size (~398KB full Tailwind runtime)
- ✅ Acceptable for internal admin panel

**Decision:** Keep current approach - Low priority optimization.

**Rationale:**

| Factor | Finding | Impact |
| -------- | --------- | ------ |
| **User Base** | Internal-only (team manages API keys) | Not customer-facing |
| **Bundle Size** | 398KB (local file) | Acceptable for admin panel |
| **Performance** | Fast load (local, no CDN latency) | Good user experience |
| **Console Warnings** | None (local file) | No production concerns |
| **Build Complexity** | None (no build step required) | Simple deployment |

**Optional Improvement (P3 - Very Low Priority):**

Implement PostCSS build step for CSS purging (~398KB → ~10-20KB)

**When to Consider:**

1. Bundle size becomes problematic for deployment
2. Admin panel performance issues arise
3. Build tooling is added for other frontend work
4. Admin panel becomes customer-facing

**Migration Path (if triggered):**

```bash
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

---

## Resolved Items

### TD-000: Tailwind CDN (Mistakenly Filed)

**Status:** Resolved - Never Existed

**Date Resolved:** 2026-04-25

**Finding:** Task was based on outdated information. Admin panel has always used a local Tailwind file, not the CDN. No console warnings exist.

---

## Review Process

Technical debt items should be reviewed quarterly during planning sessions to ensure revisit criteria remain valid and priorities are appropriate.
