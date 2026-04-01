# Resume HTML→PDF Generation Design

**Date:** 2026-03-31  
**Status:** Approved (v2)

## Problem

The current `/generate-resume` endpoint automates FlowCV via Playwright: it loads the FlowCV edit page (~20-30s), intercepts the save API, injects merged data into the Zustand store, and triggers a file download. This is slow, brittle (depends on a saved auth session and FlowCV's UI/React internals), and completely unnecessary given that the cover letter endpoint already generates PDFs at ~2-3s via `page.setContent() → page.pdf()`.

## Goal

Replace the FlowCV automation with a direct HTML→PDF pipeline that:
- Matches the current resume design exactly (Source Serif Pro, black, single column, uppercase section headings)
- Eliminates `auth.json` dependency for resume generation
- Reduces generation time from ~20-30s to ~2-3s
- Uses the same Playwright infrastructure already in place for the cover letter

## Architecture

### Files changed

| File | Change |
|------|--------|
| `src/buildResumeHtml.js` | **New** — takes merged resume object, returns complete HTML string |
| `src/server.js` | **Modified** — browser launched once at startup; `/generate-resume` handler stripped of all FlowCV logic |
| `src/mergePatch.js` | **Unchanged** |
| `scripts/saveAuth.js` | **Unchanged** — no longer required for resume generation |

No new npm dependencies. No new template files.

### Data flow

```
SERVER STARTUP
  └─ browser = await chromium.launch({ headless: true })   ← once, reused across all requests

POST /generate-resume
  └─ applyPatch(patch || req.body)
        returns mergedResume (FlowCV JSON object: resume.data.resumes[0])
  └─ buildResumeHtml(mergedResume)
        returns complete HTML string
  └─ context = await browser.newContext()
  └─ page = await context.newPage()
  └─ await page.setContent(html)
  └─ await page.evaluateHandle('document.fonts.ready')     ← guarantees fonts loaded before PDF
  └─ page.pdf({ path: outPath, format: "A4", printBackground: true, margin: 0 })
  └─ await context.close()
  └─ res.json({ success: true, file: outPath })
```

The `auth.json` existence check is removed entirely. The browser instance is shared — `context.close()` replaces `browser.close()` in the finally block.

## `src/buildResumeHtml.js`

Exported function signature: `buildResumeHtml(resume, options = {})` where `resume` is the object returned by `applyPatch()` — i.e. `data.resumes[0]`.

### Safe rendering guard

First thing in the function:
```js
if (!resume?.content) throw new Error("Invalid resume structure: missing content");

const workEntries     = resume.content.work?.entries        || [];
const skillEntries    = resume.content.skill?.entries       || [];
const certEntries     = resume.content.certificate?.entries || [];
const eduEntries      = resume.content.education?.entries   || [];
const langEntries     = resume.content.language?.entries    || [];
const profileText     = resume.content.profile?.entries?.[0]?.text || "";
```

Prevents crashes when a section is missing or empty from a partial AI patch.

### HTML injection safety

Several fields are injected as raw HTML from AI-generated patches:
- `profile.entries[0].text`
- `work.entries[].description`
- `skill.entries[].infoHtml`
- `education.entries[].description`

Whitelist-based sanitizer — only the tags FlowCV actually produces are allowed:

```js
const ALLOWED_TAGS = new Set(["p", "ul", "ol", "li", "strong", "em", "b", "i", "br", "span"]);

function sanitizeHtml(html = "") {
  return html.replace(/<\/?([a-z0-9]+)[^>]*>/gi, (match, tag) =>
    ALLOWED_TAGS.has(tag.toLowerCase()) ? match : ""
  );
}
```

Applied to all raw-HTML fields before injection. No new dependency.

### Contact row robustness

Fields are conditionally included — missing fields do not leave orphan separators:

```js
const { fullName, jobTitle, displayEmail, phone, address, website, social } = resume.personalDetails;

const contactParts = [
  displayEmail && `<span><i class="fa-solid fa-envelope"></i> ${displayEmail}</span>`,
  phone        && `<span><i class="fa-solid fa-phone"></i> ${phone}</span>`,
  address      && `<span><i class="fa-solid fa-location-dot"></i> ${address}</span>`,
  social?.github?.display    && `<span><i class="fa-brands fa-github"></i> ${social.github.display}</span>`,
  social?.linkedIn?.display  && `<span><i class="fa-brands fa-linkedin"></i> ${social.linkedIn.display}</span>`,
  website      && `<span><i class="fa-solid fa-globe"></i> ${website}</span>`,
].filter(Boolean);

const contactRow = contactParts.join(" · ");
```

Font Awesome Free loaded via CDN in `<head>`. Playwright resolves it before `document.fonts.ready` resolves.

### Section order

Default hardcoded to match current PDF (not read from `resume.json` — that field doesn't match):

```js
const DEFAULT_ORDER = ["profile", "certificate", "skill", "work", "education", "language"];
const ORDER = options.sectionOrder || DEFAULT_ORDER;
```

Each key maps to a render function. Sections are looped and concatenated. Server passes no override today — this is a one-line change in `server.js` when needed.

### Section rendering

Each section heading: uppercase bold + `border-bottom: 1px solid #000`.

| Section | Data source | Rendering |
|---------|-------------|-----------|
| **PROFILE** | `profileText` | `sanitizeHtml(profileText)` injected directly — already contains `<p>` tags, do not double-wrap |
| **CERTIFICATES** | `certEntries` | 3-column CSS grid, one `<li>` per `certificate` |
| **SKILLS** | `skillEntries` | Per entry: `<strong>skill</strong>` + `sanitizeHtml(infoHtml)` on next line |
| **PROFESSIONAL EXPERIENCE** | `workEntries` | Per entry in `.work-entry`: job title (bold, left) + dates (right) flex row; employer (italic) + location; `sanitizeHtml(description)` |
| **EDUCATION** | `eduEntries` | Per entry in `.edu-entry`: degree (bold) + dates flex row; school (italic) + location; description if present |
| **LANGUAGES** | `langEntries` | 2-column CSS grid, `language (stripHtml(infoHtml))` per entry |

### Typography & spacing

| Property | Value |
|----------|-------|
| Font family | `'Source Serif Pro', Georgia, 'Times New Roman', serif` |
| Base font size | 10pt |
| Line height | 1.5 |
| Page padding | `15mm 18mm` via CSS on `.page` (PDF call uses `margin: 0`) |
| Text color | `#000000` |
| Background | `#ffffff` |
| Section heading | uppercase, bold, 10.5pt |
| Name | bold, 22pt |
| Job title | italic, 12pt |

Fallback rationale: `Georgia` is the closest system serif. If the CDN request for Source Serif Pro is still in-flight when `document.fonts.ready` resolves (unlikely but possible offline), Georgia renders without layout shift.

### Font loading (CRITICAL)

`waitUntil: "networkidle"` does **not** guarantee fonts are applied to the DOM. The correct sequence:

```js
await page.setContent(html);              // no waitUntil — we control readiness manually
await page.evaluateHandle("document.fonts.ready");  // blocks until all @font-face fonts are loaded and applied
```

This eliminates the race condition where Playwright captures the PDF before Source Serif Pro is active.

### Layout overflow (multi-page)

Playwright's `page.pdf()` flows content naturally to page 2. Per-entry page breaks prevent mid-entry splits:

```css
.work-entry, .edu-entry {
  page-break-inside: avoid;
}
```

Skill and certificate entries are left to flow naturally — they are short and forcing them together would create whitespace gaps.

### CSS stability fixes

Resets that prevent inconsistent spacing from AI-injected HTML:

```css
ul { margin: 4px 0; padding-left: 16px; }
p  { margin: 2px 0; }
```

## `src/server.js` changes

### Browser lifecycle

Browser is launched once at module load, shared across all requests:

```js
const browser = await chromium.launch({ headless: true });
```

Per request, use `browser.newContext()` / `context.close()` in the finally block instead of `browser.launch()` / `browser.close()`.

### `/generate-resume` handler

Simplified from ~50 lines to ~20 lines.

**Remove:**
- `auth.json` existence check
- `storageState: "auth.json"` context option
- `page.route("**/api/resume/**", ...)` interception
- `page.goto(FLOWCV_EDIT_URL, ...)`
- `page.evaluate(...)` Zustand store injection
- `Promise.all([page.waitForEvent("download"), page.click(...)])`
- `download.path()` + `copyFileSync`

**Add:**
- `import { buildResumeHtml } from "./buildResumeHtml.js"`
- `const html = buildResumeHtml(mergedResume)`
- `await page.setContent(html)`
- `await page.evaluateHandle("document.fonts.ready")`
- `await page.pdf({ path: outPath, format: "A4", printBackground: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } })`

`RESUME_ID` and `FLOWCV_EDIT_URL` constants removed. `copyFileSync` import removed.

### `/generate-coverletter` handler

Also updated to use the shared `browser` instance (same pattern: `newContext` / `context.close()`). No logic changes — just lifecycle alignment.

## Error handling

`try/catch/finally` block stays. `context.close()` in finally (replaces `browser.close()`). The shared browser instance is not closed per-request. Errors still returned as `{ success: false, error: err.message }`.

## What is NOT changing

- `/context` endpoint — unchanged
- `src/mergePatch.js` — unchanged
- `data/resume.json` — still the immutable source of truth
- n8n workflow — API contract (`POST /generate-resume` body shape) is identical
- Output path pattern — `output/resume-{slug}.pdf` — unchanged
