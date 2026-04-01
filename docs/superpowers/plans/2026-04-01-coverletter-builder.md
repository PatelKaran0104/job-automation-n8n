# Cover Letter Builder Implementation Plan

> **Status: COMPLETE** — Implemented 2026-04-01. `loadFonts.js` created, `mergeCoverLetter.js` rewritten as pure JS builder, `buildResumeHtml.js` updated to import from `loadFonts.js`, `data/coverLetter.html` deleted.

**Goal:** Replace the static HTML template + regex injection approach in `mergeCoverLetter.js` with a pure JS builder that embeds Source Serif Pro from local npm, matching the architecture of `buildResumeHtml.js`.

**Architecture:** Extract font loading from `buildResumeHtml.js` into a shared `loadFonts.js` module; rewrite `mergeCoverLetter.js` as a self-contained HTML builder that imports fonts from that module; update `server.js` cover letter handler to drop `networkidle` and use `document.fonts.ready` instead.

**Tech Stack:** Node.js ES Modules, `@fontsource/source-serif-pro` (already installed), Playwright Chromium

---

## File Map

| File | Change |
|------|--------|
| `src/loadFonts.js` | **New** — reads 4 WOFF2 files from `node_modules`, exports `FONT_CSS` const |
| `src/buildResumeHtml.js` | **Modified** — import `FONT_CSS` from `./loadFonts.js`, remove inline font loading |
| `src/mergeCoverLetter.js` | **Rewritten** — pure JS builder, no file I/O, no regex, Source Serif Pro |
| `src/server.js` | **Modified** — cover letter handler: drop `waitUntil: "networkidle"`, add `document.fonts.ready` |
| `data/coverLetter.html` | **Deleted** |

---

### Task 1: Create `src/loadFonts.js`

**Files:**
- Create: `src/loadFonts.js`

- [ ] **Step 1: Write `src/loadFonts.js`**

```js
// src/loadFonts.js
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const FONTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../node_modules/@fontsource/source-serif-pro/files"
);

function fontB64(file) {
  return readFileSync(join(FONTS_DIR, file)).toString("base64");
}

export const FONT_CSS = [
  ["source-serif-pro-latin-400-normal.woff2", "normal", 400],
  ["source-serif-pro-latin-400-italic.woff2", "italic", 400],
  ["source-serif-pro-latin-600-normal.woff2", "normal", 600],
  ["source-serif-pro-latin-700-normal.woff2", "normal", 700],
].map(
  ([file, style, weight]) => `
  @font-face {
    font-family: 'Source Serif Pro';
    font-style: ${style}; font-weight: ${weight};
    src: url('data:font/woff2;base64,${fontB64(file)}') format('woff2');
  }`
).join("");
```

- [ ] **Step 2: Verify `FONT_CSS` loads without error**

Run:
```bash
node --input-type=module <<< "import { FONT_CSS } from './src/loadFonts.js'; console.log('FONT_CSS bytes:', FONT_CSS.length);"
```
Expected: `FONT_CSS bytes:` followed by a number well above `100000` (the base64 for 4 WOFF2 files is large).

- [ ] **Step 3: Commit**

```bash
git add src/loadFonts.js
git commit -m "feat: add loadFonts.js — shared Source Serif Pro WOFF2 embedding"
```

---

### Task 2: Update `src/buildResumeHtml.js` to use `loadFonts.js`

**Files:**
- Modify: `src/buildResumeHtml.js`

- [ ] **Step 1: Replace inline font loading with import**

At the top of `src/buildResumeHtml.js`, make these changes:

**Remove** these 3 lines (they're only used for font loading):
```js
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
```

**Remove** these lines:
```js
const FONTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../node_modules/@fontsource/source-serif-pro/files"
);

function fontB64(file) {
  return readFileSync(join(FONTS_DIR, file)).toString("base64");
}

// Loaded once at module startup — no CDN dependency
const FONT_CSS = [
  ["source-serif-pro-latin-400-normal.woff2", "normal", 400],
  ["source-serif-pro-latin-400-italic.woff2", "italic", 400],
  ["source-serif-pro-latin-700-normal.woff2", "normal", 700],
].map(
  ([file, style, weight]) => `
  @font-face {
    font-family: 'Source Serif Pro';
    font-style: ${style}; font-weight: ${weight};
    src: url('data:font/woff2;base64,${fontB64(file)}') format('woff2');
  }`
).join("");
```

**Add** at the top of the file (as the first import):
```js
// src/buildResumeHtml.js
import { FONT_CSS } from "./loadFonts.js";
```

The `FONT_CSS` const is already referenced later in the file (inside the `<style>` block in `buildResumeHtml`) — no other changes needed.

- [ ] **Step 2: Verify resume generation still works**

Run: `npm test`

Expected: exits without error, `output/resume-company.pdf` is written (check timestamp updated). The test script at `scripts/test.js` hits `/generate-resume` with a hardcoded patch.

- [ ] **Step 3: Commit**

```bash
git add src/buildResumeHtml.js
git commit -m "refactor: move font loading to shared loadFonts.js"
```

---

### Task 3: Rewrite `src/mergeCoverLetter.js` as a pure JS builder

**Files:**
- Modify: `src/mergeCoverLetter.js`

- [ ] **Step 1: Replace entire file contents**

Replace the entire content of `src/mergeCoverLetter.js` with:

```js
// src/mergeCoverLetter.js
import { FONT_CSS } from "./loadFonts.js";

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildCoverLetterHtml(content) {
  const {
    role = "Softwareentwickler",
    company = "",
    companyAddress = "",
    paragraph1 = "",
    paragraph2 = "",
    paragraph3 = "",
  } = content;

  const dateStr = new Date().toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const subject = `Bewerbung als ${escapeHtml(role)}`;
  const footerRole = company
    ? `${escapeHtml(role)} @ ${escapeHtml(company)}`
    : escapeHtml(role);

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <title>Anschreiben – Karan Patel</title>
  <style>
    ${FONT_CSS}

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Source Serif Pro', Georgia, 'Times New Roman', serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #1a1a1a;
      background: #fff;
    }

    .page {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      padding: 18mm 20mm 16mm 20mm;
      display: flex;
      flex-direction: column;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #2563eb;
      padding-bottom: 10px;
      margin-bottom: 18px;
    }

    .header-name {
      font-size: 20pt;
      font-weight: 700;
      color: #1e3a5f;
      letter-spacing: 0.5px;
    }

    .header-title {
      font-size: 10pt;
      color: #2563eb;
      font-weight: 500;
      margin-top: 2px;
    }

    .header-contact {
      text-align: right;
      font-size: 9pt;
      color: #444;
      line-height: 1.7;
    }

    .header-contact a {
      color: #2563eb;
      text-decoration: none;
    }

    .recipient {
      margin-bottom: 20px;
      font-size: 10.5pt;
      line-height: 1.8;
      color: #1a1a1a;
    }

    .date-line {
      text-align: right;
      font-size: 10pt;
      color: #555;
      margin-bottom: 20px;
    }

    .subject {
      font-size: 12pt;
      font-weight: 700;
      color: #1e3a5f;
      margin-bottom: 18px;
      border-left: 3px solid #2563eb;
      padding-left: 10px;
    }

    .body-text p {
      margin-bottom: 13px;
      text-align: justify;
      hyphens: auto;
    }

    .closing {
      margin-top: 22px;
      font-size: 10.5pt;
    }

    .closing-line {
      margin-bottom: 38px;
    }

    .signature-name {
      font-weight: 700;
      font-size: 11pt;
      color: #1e3a5f;
    }

    .signature-title {
      font-size: 9.5pt;
      color: #555;
    }

    .footer {
      margin-top: auto;
      padding-top: 10px;
      border-top: 1px solid #d1d5db;
      font-size: 8.5pt;
      color: #777;
      display: flex;
      justify-content: space-between;
    }

    @media print {
      body { background: white; }
      .page { margin: 0; padding: 18mm 20mm 16mm 20mm; }
    }
  </style>
</head>
<body>
  <div class="page">

    <div class="header">
      <div>
        <div class="header-name">Karan Patel</div>
        <div class="header-title">${escapeHtml(role)}</div>
      </div>
      <div class="header-contact">
        khpatel0104@gmail.com<br/>
        +49 15210894179<br/>
        Hesse, Germany<br/>
        <a href="https://linkedin.com/in/patelkaran0104/">linkedin.com/in/patelkaran0104/</a><br/>
        <a href="https://karanpatel.live">karanpatel.live</a>
      </div>
    </div>

    <div class="date-line">${dateStr}</div>

    <div class="recipient">
      <div>${escapeHtml(company)}</div>
      <div>${escapeHtml(companyAddress)}</div>
    </div>

    <div class="subject">${subject}</div>

    <div style="margin-bottom: 13px;">Sehr geehrte Damen und Herren,</div>

    <div class="body-text">
      <p>${paragraph1}</p>
      <p>${paragraph2}</p>
      <p>${paragraph3}</p>
    </div>

    <div class="closing">
      <div class="closing-line">Mit freundlichen Grüßen,</div>
      <div class="signature-name">Karan Patel</div>
      <div class="signature-title">${escapeHtml(role)}</div>
    </div>

    <div class="footer">
      <span>Karan Patel · khpatel0104@gmail.com · +49 15210894179</span>
      <span>${footerRole}</span>
    </div>

  </div>
</body>
</html>`;
}
```

- [ ] **Step 2: Verify the module parses cleanly**

Run:
```bash
node --input-type=module <<< "import { buildCoverLetterHtml } from './src/mergeCoverLetter.js'; const html = buildCoverLetterHtml({ role: 'Salesforce Developer', company: 'SAP SE', companyAddress: 'Walldorf, Deutschland', paragraph1: '<p>Test</p>', paragraph2: '<p>Test</p>', paragraph3: '<p>Test</p>' }); console.log('HTML length:', html.length, html.includes('Source Serif Pro') ? 'font OK' : 'FONT MISSING', html.includes('Bewerbung als Salesforce Developer') ? 'subject OK' : 'SUBJECT MISSING');"
```

Expected output: `HTML length:` a large number (>200000 due to base64 fonts), then `font OK`, then `subject OK`.

- [ ] **Step 3: Commit**

```bash
git add src/mergeCoverLetter.js
git commit -m "feat: rewrite cover letter as pure JS builder with embedded Source Serif Pro"
```

---

### Task 4: Update `src/server.js` and delete `data/coverLetter.html`

**Files:**
- Modify: `src/server.js`
- Delete: `data/coverLetter.html`

- [ ] **Step 1: Update the cover letter handler in `src/server.js`**

In the `/generate-coverletter` handler, find:
```js
await page.setContent(html, { waitUntil: "networkidle" });
```

Replace with:
```js
await page.setContent(html);
await page.evaluateHandle("document.fonts.ready");
```

No other changes to `server.js`.

- [ ] **Step 2: Delete `data/coverLetter.html`**

```bash
rm data/coverLetter.html
```

- [ ] **Step 3: Commit**

```bash
git add src/server.js
git rm data/coverLetter.html
git commit -m "feat: use document.fonts.ready for cover letter, remove static template"
```

---

### Task 5: Smoke test both endpoints

**Files:** none (read-only test)

- [ ] **Step 1: Start the server**

```bash
npm start
```

Expected: `Server running on port 3000`

- [ ] **Step 2: Test resume generation**

In a second terminal:
```bash
npm test
```

Expected: exits cleanly, `output/resume-company.pdf` is updated (check timestamp). No errors in server console.

- [ ] **Step 3: Test cover letter generation**

```bash
curl -s -X POST http://localhost:3000/generate-coverletter \
  -H "Content-Type: application/json" \
  -d '{"role":"Salesforce Developer","company":"SAP SE","companyAddress":"Walldorf, Deutschland","paragraph1":"<p>Ich bewerbe mich als Salesforce Developer.</p>","paragraph2":"<p>Ich bringe umfangreiche Erfahrung mit.</p>","paragraph3":"<p>Ich freue mich auf ein Gespräch.</p>"}' | node -e "process.stdin||(0);let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);console.log(r.success?'PASS: '+r.file:'FAIL: '+r.error);})"
```

Expected: `PASS: <absolute path to output/coverletter-sap-se.pdf>`

- [ ] **Step 4: Verify PDF visually**

Open `output/coverletter-sap-se.pdf`. Confirm:
- Font is serif (Source Serif Pro), not sans-serif (Segoe UI)
- Name "Karan Patel" in navy (#1e3a5f), bold
- Blue bottom border on header (#2563eb)
- Subject line has blue left border
- Date is in German format (e.g. "01. April 2026")
- All three paragraph texts appear
- No blank or broken sections

- [ ] **Step 5: Commit**

No code changes in this task — just confirmation. If any fixes were needed, commit them with a descriptive message before marking this task done.
