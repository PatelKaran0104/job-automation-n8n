# Cover Letter Builder + Font Embedding Design

**Date:** 2026-04-01
**Status:** Approved

## Problem

The cover letter has two issues:

1. **Fragile architecture**: `mergeCoverLetter.js` reads a static HTML template file (`data/coverLetter.html`) on every call and uses regex injection to fill placeholder elements. This is brittle, hard to reason about, and inconsistent with how the resume now works (`buildResumeHtml.js` is a pure JS builder).

2. **CDN font dependency**: Both builders (resume and cover letter) currently rely on Google Fonts CDN for Source Serif Pro. If the CDN is slow or unreachable, fonts silently fall back to Georgia — inconsistent output with no error surfaced. `@fontsource/source-serif-pro` is already installed as an npm dependency with WOFF2 files available locally.

## Goal

- Replace `mergeCoverLetter.js` static template + regex approach with a pure JS dynamic builder (same pattern as `buildResumeHtml.js`)
- Embed Source Serif Pro from local `node_modules` in both builders — no CDN calls for body font
- Switch cover letter font from `Segoe UI` to `Source Serif Pro` (matching the resume)
- Keep the cover letter's blue accent design (professional, appropriate for German applications)
- Delete `data/coverLetter.html` (no longer needed)

## Architecture

### Files changed

| File | Change |
|------|--------|
| `src/loadFonts.js` | **New** — reads WOFF2 files from node_modules, returns `@font-face` CSS block |
| `src/mergeCoverLetter.js` | **Rewritten** — pure JS builder, no file reads, no regex |
| `src/buildResumeHtml.js` | **Modified** — import `getFontFaceCSS` from `loadFonts.js`, remove CDN `<link>` tags |
| `src/server.js` | **Modified** — cover letter handler: swap `waitUntil: "networkidle"` for `evaluateHandle("document.fonts.ready")` |
| `data/coverLetter.html` | **Deleted** |

### Data flow (cover letter — unchanged from caller's perspective)

```
POST /generate-coverletter
  └─ buildCoverLetterHtml(req.body)     ← pure JS, no I/O, returns HTML string
  └─ context = await browser.newContext()
  └─ page.setContent(html)              ← no waitUntil needed — fonts are embedded
  └─ page.evaluateHandle("document.fonts.ready")
  └─ page.pdf({ format: "A4", ... })
  └─ context.close()
```

### API contract — unchanged

`server.js` call to `buildCoverLetterHtml(req.body)` stays identical. Input shape unchanged:
```js
{ role, company, companyAddress, paragraph1, paragraph2, paragraph3 }
```

---

## `src/loadFonts.js`

Single exported function. Called once at module load from each builder; result stored in a module-level `const` — no repeated disk reads.

```js
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = resolve(__dirname, "../node_modules/@fontsource/source-serif-pro/files");

function toBase64(filename) {
  return readFileSync(resolve(FONTS_DIR, filename)).toString("base64");
}

export function getFontFaceCSS() {
  return `
    @font-face {
      font-family: 'Source Serif Pro';
      font-style: normal;
      font-weight: 400;
      src: url('data:font/woff2;base64,${toBase64("source-serif-pro-latin-400-normal.woff2")}') format('woff2');
    }
    @font-face {
      font-family: 'Source Serif Pro';
      font-style: italic;
      font-weight: 400;
      src: url('data:font/woff2;base64,${toBase64("source-serif-pro-latin-400-italic.woff2")}') format('woff2');
    }
    @font-face {
      font-family: 'Source Serif Pro';
      font-style: normal;
      font-weight: 600;
      src: url('data:font/woff2;base64,${toBase64("source-serif-pro-latin-600-normal.woff2")}') format('woff2');
    }
    @font-face {
      font-family: 'Source Serif Pro';
      font-style: normal;
      font-weight: 700;
      src: url('data:font/woff2;base64,${toBase64("source-serif-pro-latin-700-normal.woff2")}') format('woff2');
    }`;
}
```

**Font files used** (all in `node_modules/@fontsource/source-serif-pro/files/`):
- `source-serif-pro-latin-400-normal.woff2`
- `source-serif-pro-latin-400-italic.woff2`
- `source-serif-pro-latin-600-normal.woff2`
- `source-serif-pro-latin-700-normal.woff2`

---

## `src/mergeCoverLetter.js` — rewritten as pure builder

### Structure

```
getFontFaceCSS import    ← from loadFonts.js
FONT_CSS const           ← cached at module load (one disk read cycle per process)
escapeHtml()             ← unchanged from current file
buildCoverLetterHtml(content) ← exported, returns complete HTML string
```

### HTML layout (same structure as current coverLetter.html, font changed)

```
<html lang="de">
<head>
  <style>
    @font-face ... (embedded via FONT_CSS)
    font-family: 'Source Serif Pro', Georgia, serif  ← was: Segoe UI, Helvetica, Arial
    ... rest of CSS identical to current coverLetter.html ...
  </style>
</head>
<body>
  <div class="page">
    Header: name (bold, #1e3a5f) | contact info right-aligned
            blue bottom border (#2563eb)
    Date line (right-aligned, de-DE locale)
    Recipient: company name + address
    Subject: blue left border, "Bewerbung als {role}"
    Salutation: "Sehr geehrte Damen und Herren,"
    Body: paragraph1, paragraph2, paragraph3 (raw HTML)
    Closing: "Mit freundlichen Grüßen," + "Karan Patel" + role title
    Footer: name · email · phone | role @ company
  </div>
</body>
```

### Injected fields

All the same data as the current `coverLetter.html` id-tagged elements — just built inline:

| Field | Source | Treatment |
|-------|--------|-----------|
| Date | `new Date()` de-DE locale | hardcoded generation |
| `cl-sender-title` | `role` | `escapeHtml()` |
| `cl-closing-title` | `role` | `escapeHtml()` |
| `cl-company-name` | `company` | `escapeHtml()` |
| `cl-company-address` | `companyAddress` | `escapeHtml()` |
| `cl-subject` | `Bewerbung als ${role}` | `escapeHtml()` on role |
| `cl-footer-role` | `${role} @ ${company}` | `escapeHtml()` on both |
| `cl-paragraph-1/2/3` | `paragraph1/2/3` | raw HTML (AI-generated) |

Hardcoded personal details (same as current template — not injected via API):
- Name: Karan Patel
- Email: khpatel0104@gmail.com
- Phone: +49 15210894179
- Location: Hesse, Germany
- LinkedIn: linkedin.com/in/patelkaran0104/
- Website: karanpatel.live

---

## `src/buildResumeHtml.js` changes

**Remove:**
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+Pro...">
```

**Add at top of file:**
```js
import { getFontFaceCSS } from "./loadFonts.js";
const FONT_CSS = getFontFaceCSS();
```

**In the HTML template**, replace the CDN `<link>` tags with:
```html
<style>${FONT_CSS}</style>
```

Font Awesome CDN (`cdnjs.cloudflare.com/...font-awesome`) stays — icon fonts are non-critical and already backed by `waitUntil: "networkidle"`.

---

## `src/server.js` changes

Cover letter handler only — one-line swap:

**Remove:**
```js
await page.setContent(html, { waitUntil: "networkidle" });
```

**Replace with:**
```js
await page.setContent(html);
await page.evaluateHandle("document.fonts.ready");
```

No `networkidle` needed — fonts are embedded, no CDN requests to wait for. `document.fonts.ready` is the correct guarantee that the embedded `@font-face` fonts are parsed and applied before PDF capture.

---

## What is NOT changing

- `/generate-resume` endpoint — unchanged (except `buildResumeHtml.js` internals)
- `/generate-coverletter` API contract — same input, same output path pattern
- Cover letter visual design — same blue accents, same layout, same German text
- Personal details in cover letter — still hardcoded in the builder
- `src/mergePatch.js` — unchanged
- `data/resume.json` — unchanged
