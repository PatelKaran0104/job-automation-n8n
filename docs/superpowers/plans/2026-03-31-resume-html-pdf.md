# Resume HTML→PDF Implementation Plan

> **Status: COMPLETE** — Implemented 2026-03-31. All tasks done. `scripts/saveAuth.js` and `auth.json` subsequently deleted on 2026-04-01 as no longer needed.

**Goal:** Replace FlowCV Playwright automation with a direct HTML→PDF pipeline using an HTML builder, reducing resume generation from ~20-30s to ~2-3s and eliminating the `auth.json` dependency.

**Architecture:** A new `src/buildResumeHtml.js` module reads the merged resume object (already produced by `applyPatch()`) and generates a complete HTML string. `src/server.js` is updated to use this HTML via `page.setContent() → page.pdf()` — the same pattern the cover letter already uses. The Chromium browser instance is launched once at startup and shared across both endpoints.

**Tech Stack:** Node.js ES Modules, Playwright 1.43.0 (Chromium), Express 4.18.2, Source Serif Pro (Google Fonts CDN), Font Awesome 6.5.0 (CDN)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/buildResumeHtml.js` | **Create** | Converts merged resume object → complete HTML string |
| `src/server.js` | **Modify** | Shared browser launch, stripped `/generate-resume`, updated `/generate-coverletter` |

---

## Task 1: Create `src/buildResumeHtml.js`

**Files:**
- Create: `src/buildResumeHtml.js`

This is the entire new file. It has no external dependencies — only pure string manipulation.

- [ ] **Step 1: Create `src/buildResumeHtml.js` with the full implementation**

```js
// src/buildResumeHtml.js

const ALLOWED_TAGS = new Set(["p", "ul", "ol", "li", "strong", "em", "b", "i", "br", "span"]);

function sanitizeHtml(html = "") {
  return html.replace(/<\/?([a-z0-9]+)[^>]*>/gi, (match, tag) =>
    ALLOWED_TAGS.has(tag.toLowerCase()) ? match : ""
  );
}

function stripHtml(html = "") {
  return html.replace(/<[^>]+>/g, "").trim();
}

function renderProfile(resume) {
  const text = sanitizeHtml(resume.content.profile?.entries?.[0]?.text || "");
  if (!text) return "";
  const heading = resume.content.profile.displayName || "PROFILE";
  return `
    <div class="section">
      <div class="section-heading">${heading}</div>
      <div>${text}</div>
    </div>`;
}

function renderCertificates(resume) {
  const entries = resume.content.certificate?.entries || [];
  if (!entries.length) return "";
  const heading = resume.content.certificate.displayName || "CERTIFICATES";
  const items = entries.map(e => `<li>${e.certificate}</li>`).join("");
  return `
    <div class="section">
      <div class="section-heading">${heading}</div>
      <ul class="cert-grid">${items}</ul>
    </div>`;
}

function renderSkills(resume) {
  const entries = resume.content.skill?.entries || [];
  if (!entries.length) return "";
  const heading = resume.content.skill.displayName || "SKILLS";
  const items = entries
    .map(
      e => `
    <div class="skill-entry">
      <div class="skill-name">${e.skill}</div>
      <div class="skill-info">${sanitizeHtml(e.infoHtml || "")}</div>
    </div>`
    )
    .join("");
  return `
    <div class="section">
      <div class="section-heading">${heading}</div>
      ${items}
    </div>`;
}

function renderWork(resume) {
  const entries = resume.content.work?.entries || [];
  if (!entries.length) return "";
  const heading = resume.content.work.displayName || "PROFESSIONAL EXPERIENCE";
  const items = entries
    .map(e => {
      const dates = [e.startDateNew, e.endDateNew].filter(Boolean).join(" – ");
      return `
      <div class="work-entry">
        <div class="entry-header">
          <span class="entry-title">${e.jobTitle}</span>
          <span class="entry-dates">${dates}</span>
        </div>
        <div class="entry-sub">
          <span class="entry-company">${e.employer}</span>
          <span class="entry-location">${e.location || ""}</span>
        </div>
        <div>${sanitizeHtml(e.description || "")}</div>
      </div>`;
    })
    .join("");
  return `
    <div class="section">
      <div class="section-heading">${heading}</div>
      ${items}
    </div>`;
}

function renderEducation(resume) {
  const entries = resume.content.education?.entries || [];
  if (!entries.length) return "";
  const heading = resume.content.education.displayName || "EDUCATION";
  const items = entries
    .map(e => {
      const dates = [e.startDateNew, e.endDateNew].filter(Boolean).join(" – ");
      return `
      <div class="edu-entry">
        <div class="entry-header">
          <span class="entry-title">${e.degree}</span>
          <span class="entry-dates">${dates}</span>
        </div>
        <div class="entry-sub">
          <span class="entry-company">${e.school}</span>
          <span class="entry-location">${e.location || ""}</span>
        </div>
        ${e.description ? `<div>${sanitizeHtml(e.description)}</div>` : ""}
      </div>`;
    })
    .join("");
  return `
    <div class="section">
      <div class="section-heading">${heading}</div>
      ${items}
    </div>`;
}

function renderLanguages(resume) {
  const entries = resume.content.language?.entries || [];
  if (!entries.length) return "";
  const heading = resume.content.language.displayName || "LANGUAGES";
  const items = entries
    .map(e => `<div>${e.language} (${stripHtml(e.infoHtml || "")})</div>`)
    .join("");
  return `
    <div class="section">
      <div class="section-heading">${heading}</div>
      <div class="lang-grid">${items}</div>
    </div>`;
}

const SECTION_RENDERERS = {
  profile: renderProfile,
  certificate: renderCertificates,
  skill: renderSkills,
  work: renderWork,
  education: renderEducation,
  language: renderLanguages,
};

const DEFAULT_ORDER = ["profile", "certificate", "skill", "work", "education", "language"];

export function buildResumeHtml(resume, options = {}) {
  if (!resume?.content) throw new Error("Invalid resume structure: missing content");

  const p = resume.personalDetails;
  const contactParts = [
    p.displayEmail && `<span><i class="fa-solid fa-envelope"></i> ${p.displayEmail}</span>`,
    p.phone        && `<span><i class="fa-solid fa-phone"></i> ${p.phone}</span>`,
    p.address      && `<span><i class="fa-solid fa-location-dot"></i> ${p.address}</span>`,
    p.social?.github?.display   && `<span><i class="fa-brands fa-github"></i> ${p.social.github.display}</span>`,
    p.social?.linkedIn?.display && `<span><i class="fa-brands fa-linkedin"></i> ${p.social.linkedIn.display}</span>`,
    p.website      && `<span><i class="fa-solid fa-globe"></i> ${p.website}</span>`,
  ].filter(Boolean);

  const contactRow = contactParts.join(" · ");
  const order = options.sectionOrder || DEFAULT_ORDER;
  const sections = order.map(key => SECTION_RENDERERS[key]?.(resume) || "").join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Source+Serif+Pro:ital,wght@0,400;0,600;0,700;1,400;1,600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Source Serif Pro', Georgia, 'Times New Roman', serif;
      font-size: 10pt;
      line-height: 1.5;
      color: #000;
      background: #fff;
    }
    .page {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      padding: 15mm 18mm;
    }
    .header { text-align: center; margin-bottom: 12px; }
    .name { font-size: 22pt; font-weight: 700; }
    .job-title { font-size: 12pt; font-style: italic; margin-top: 2px; }
    .contact-row { margin-top: 6px; font-size: 9pt; }
    .contact-row i { margin-right: 3px; }
    .header hr { border: none; border-top: 1px solid #000; margin-top: 10px; }
    .section { margin-bottom: 8px; }
    .section-heading {
      font-size: 10.5pt;
      font-weight: 700;
      text-transform: uppercase;
      border-bottom: 1px solid #000;
      padding-bottom: 2px;
      margin-bottom: 6px;
    }
    .cert-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 2px 8px;
      list-style: disc;
      padding-left: 16px;
    }
    .skill-entry { margin-bottom: 4px; }
    .skill-name { font-weight: 700; font-size: 10pt; }
    .skill-info p { margin: 0; }
    .work-entry { margin-bottom: 10px; page-break-inside: avoid; }
    .edu-entry  { margin-bottom: 10px; page-break-inside: avoid; }
    .entry-header { display: flex; justify-content: space-between; }
    .entry-title { font-weight: 700; }
    .entry-dates { font-size: 9.5pt; }
    .entry-sub { display: flex; justify-content: space-between; }
    .entry-company { font-style: italic; }
    .entry-location { font-size: 9.5pt; }
    .lang-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
    ul { margin: 4px 0; padding-left: 16px; }
    p  { margin: 2px 0; }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="name">${p.fullName}</div>
      <div class="job-title">${p.jobTitle}</div>
      <div class="contact-row">${contactRow}</div>
      <hr />
    </div>
    ${sections}
  </div>
</body>
</html>`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/buildResumeHtml.js
git commit -m "feat: add buildResumeHtml — HTML resume builder from FlowCV JSON"
```

---

## Task 2: Update `src/server.js`

**Files:**
- Modify: `src/server.js`

Three changes in one file: (a) shared browser at module level, (b) new `/generate-resume` handler, (c) updated `/generate-coverletter` to use shared browser.

- [ ] **Step 1: Replace the entire `src/server.js` with the following**

```js
import express from "express";
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { applyPatch } from "./mergePatch.js";
import { buildCoverLetterHtml } from "./mergeCoverLetter.js";
import { buildResumeHtml } from "./buildResumeHtml.js";

const OUTPUT_DIR = resolve("output");
mkdirSync(OUTPUT_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: "10mb" }));

// Shared browser instance — launched once at startup, reused across all requests
const browser = await chromium.launch({ headless: true });

// Sanitize company name for safe filenames: "SAP SE" → "sap-se"
function toSlug(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "company";
}

// Strips HTML tags to give AI clean plain text
function stripHtml(html = "") {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// GET /context — returns only the human-readable resume content for AI input
app.get("/context", (_req, res) => {
  const base = JSON.parse(readFileSync(new URL("../data/resume.json", import.meta.url)));
  const resume = base.data.resumes[0];

  res.json({
    currentJobTitle: resume.personalDetails.jobTitle,
    currentProfile: stripHtml(resume.content.profile.entries[0]?.text),
    currentWork: resume.content.work.entries.map((e) => ({
      id: e.id,
      employer: e.employer,
      jobTitle: e.jobTitle,
      location: e.location,
      startDate: e.startDateNew,
      endDate: e.endDateNew,
      description: stripHtml(e.description),
    })),
    currentSkills: resume.content.skill.entries.map((e) => ({
      id: e.id,
      skill: e.skill,
      details: stripHtml(e.infoHtml),
    })),
  });
});

// POST /generate-resume
// Body: { patch: {...}, company: "SAP SE" }
app.post("/generate-resume", async (req, res) => {
  const { patch, company } = req.body;
  const mergedResume = applyPatch(patch || req.body);
  const slug = toSlug(company || "company");
  const outPath = resolve(OUTPUT_DIR, `resume-${slug}.pdf`);

  let context;
  try {
    const html = buildResumeHtml(mergedResume);
    context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent(html);
    await page.evaluateHandle("document.fonts.ready");
    await page.pdf({
      path: outPath,
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    res.json({ success: true, file: outPath });
  } catch (err) {
    console.error("Resume generation error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (context) await context.close();
  }
});

// POST /generate-coverletter
// Body: { role, company, companyAddress, paragraph1, paragraph2, paragraph3 }
app.post("/generate-coverletter", async (req, res) => {
  const { company } = req.body;
  const slug = toSlug(company || "company");
  const outPath = resolve(OUTPUT_DIR, `coverletter-${slug}.pdf`);

  let context;
  try {
    const html = buildCoverLetterHtml(req.body);
    context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.pdf({
      path: outPath,
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    res.json({ success: true, file: outPath });
  } catch (err) {
    console.error("Cover letter generation error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (context) await context.close();
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));
```

- [ ] **Step 2: Commit**

```bash
git add src/server.js
git commit -m "feat: replace FlowCV automation with HTML→PDF pipeline, share browser instance"
```

---

## Task 3: Smoke Test

**Files:**
- Read: `scripts/test.js` (existing manual test — hits `/generate-resume` with a hardcoded patch)
- Read: `output/resume-*.pdf` (visual inspection)

- [ ] **Step 1: Start the server**

```bash
cd d:/KARAN && npm start
```

Expected output:
```
Server running on port 3000
```

If you see a Chromium launch error, check that Playwright is installed: `npx playwright install chromium`

- [ ] **Step 2: In a second terminal, run the test script**

```bash
cd d:/KARAN && npm test
```

Expected output (from `scripts/test.js`):
```json
{ "success": true, "file": "...\\output\\resume-company.pdf" }
```

If you see `Invalid resume structure`, check that `data/resume.json` exists and has not been corrupted.

- [ ] **Step 3: Open the generated PDF and visually verify**

Open `output/resume-company.pdf`. Check:

- [ ] Name "Karan Patel" appears bold and centered at the top
- [ ] Job title appears italic below the name
- [ ] Contact row shows email · phone · location · github · linkedin · website with icons
- [ ] Horizontal rule below the contact row
- [ ] Sections appear in order: PROFILE → CERTIFICATES → SKILLS → PROFESSIONAL EXPERIENCE → EDUCATION → LANGUAGES
- [ ] Section headings are uppercase with underline
- [ ] Work entries show job title + dates on one row, company italic + location on next
- [ ] Bullet points render inside work descriptions
- [ ] Skills show category name bold, items on next line
- [ ] Certificates render in 3 columns
- [ ] Font is serif (Source Serif Pro or Georgia fallback)
- [ ] No content overflows the page margins unexpectedly

- [ ] **Step 4: Verify cover letter still works**

```bash
curl -s -X POST http://localhost:3000/generate-coverletter \
  -H "Content-Type: application/json" \
  -d "{\"role\":\"Salesforce Developer\",\"company\":\"Test GmbH\",\"companyAddress\":\"Berlin\",\"paragraph1\":\"Test.\",\"paragraph2\":\"Test.\",\"paragraph3\":\"Test.\"}"
```

Expected:
```json
{ "success": true, "file": "...\\output\\coverletter-test-gmbh.pdf" }
```

Open `output/coverletter-test-gmbh.pdf` and confirm it looks identical to before.

- [ ] **Step 5: Confirm `auth.json` is no longer needed for resume generation**

Delete or rename `auth.json` if it exists, then re-run `npm test`. It should still succeed — the endpoint no longer checks for it.
