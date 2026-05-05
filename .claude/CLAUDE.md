# CLAUDE.md — Resume Generator

Guidance for Claude Code when working in this repository.

## Project Overview

Node.js/Express service that tailors resumes and cover letters for job applications. n8n drives it: fetches the base resume via `/context`, asks an AI (Gemini for matching, OpenAI for tailoring) to produce a patch, then posts the patch back here to merge with the base JSON, render HTML, and export a PDF via Playwright.

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (ES Modules — `"type": "module"`) |
| Server | Express 4.18.2 |
| Browser automation | Playwright 1.43.0 (Chromium, headless) |
| Resume rendering | Custom HTML (`src/buildResumeHtml.js`) |
| Workflow orchestration | n8n (external) |

No build step. No database. No TypeScript. No CI/CD. Unit tests use `node:test` (built-in).

## Directory Layout

```
d:\KARAN\
├── src/
│   ├── server.js           ← Express server, all 3 endpoints
│   ├── buildResumeHtml.js  ← Renders resume JSON → full HTML page
│   ├── mergePatch.js       ← Merges AI patch into base resume JSON
│   ├── validatePatch.js    ← Validates AI patch shape and IDs before apply
│   ├── mergeCoverLetter.js ← Builds cover letter HTML from scratch via template literal
│   └── loadFonts.js        ← Base64-encodes Source Serif Pro WOFF2 fonts, exports FONT_CSS
├── data/
│   ├── resume.json         ← Base resume — SOURCE OF TRUTH, never modified at runtime
│   └── Job_Application_Automator_v6.json  ← n8n workflow definition
├── scripts/                ← Manual smoke tests (test.js, test-coverletter.js)
├── tests/                  ← node:test unit tests
├── docs/                   ← Design specs and implementation plans
├── output/                 ← Generated PDFs (git-ignored, date-organized)
└── PIPELINE.md             ← Full n8n setup guide
```

## Running the Server

```bash
npm start                  # port 3000
npm test                   # manual resume test
npm run test:coverletter   # manual cover letter test
npm run test:unit          # unit tests
```

## API Endpoints

### `GET /context`
Returns base resume as clean plain text (HTML stripped). Feed to AI so it knows the current resume. Work descriptions use `stripHtmlPreserveBullets()` to keep bullet structure as newlines; other fields use `stripHtml()`.

```json
{
  "currentJobTitle": "string",
  "currentProfile": "string (plain text)",
  "currentWork": [{ "id", "employer", "jobTitle", "location", "startDate", "endDate", "description" }],
  "currentSkills": [{ "id", "skill", "details" }],
  "currentProjects": [{ "id", "name", "techStack", "url", "description" }],
  "currentCertificates": ["string", "..."]
}
```

> `/context` reads `resume.json` fresh on every request — not cached. IDs returned here are the only valid IDs for patches.

### `POST /generate-resume`
Validates the patch via `validatePatch()`, merges it into `data/resume.json`, renders HTML, exports a PDF to `output/YYYY-MM-DD/Resume/resume-{company}--{role}-HHMMSS.pdf`.

```json
{
  "patch": {
    "jobTitle": "string",
    "profile": "<p>HTML</p>",
    "showCertificates": false,
    "showProjects": false,
    "work":     [{ "id": "from /context", "description": "<ul><li><p>...</p></li></ul>" }],
    "skills":   [{ "id": "from /context", "skill": "optional rename", "infoHtml": "<p>HTML</p>" }],
    "projects": [{ "id": "from /context", "description": "<ul>...</ul>", "techStack": "optional", "name": "optional rename" }]
  },
  "company": "SAP SE",
  "role": "Software Developer",
  "language": "de | en (optional — German headings when \"de\")",
  "jobId": "optional — echoed in response for downstream pairing"
}
```

> `patch` may also be passed at the top level — server tries `req.body.patch || req.body`.

**Response:** `{ "success": true, "file": "...", "fileName": "...", "jobId": "..." }` (`jobId` only present if sent).

### `POST /generate-coverletter`
Renders a PDF to `output/YYYY-MM-DD/Coverletter/coverletter-{company}--{role}-HHMMSS.pdf`.

> **Empty-body guard:** If `paragraph1 + paragraph2 + paragraph3` strip to empty, returns `422` with `{ success: false, error: "Empty cover letter body", reason_code: "EMPTY_BODY" }` before any PDF work.

```json
{
  "role": "Salesforce Developer",
  "company": "SAP SE",
  "companyAddress": "Walldorf, Deutschland",
  "paragraph1": "HTML or plain text — opening hook",
  "paragraph2": "HTML or plain text — skills/experience evidence",
  "paragraph3": "HTML or plain text — availability + CTA",
  "language": "de | en (optional, defaults to \"de\")",
  "jobId": "optional — echoed in response"
}
```

**Response:** `{ "success": true, "file": "...", "fileName": "...", "jobId": "..." }`

## Key Implementation Details

### Resume generation flow (`src/server.js` + `src/buildResumeHtml.js`)
1. `validatePatch()` checks shape and IDs; rejects with 422 on invalid input
2. `applyPatch()` deep-clones `data/resume.json` and merges the patch
3. `buildResumeHtml()` produces a complete, self-contained HTML page
4. Shared Playwright browser → `page.setContent()` → `document.fonts.ready` → `page.pdf()`

### `buildResumeHtml.js`
- **Fonts:** Base64-inlined Source Serif Pro WOFF2 — no CDN
- **Icons:** Inline SVG — no Font Awesome
- **HTML sanitization:** Whitelist (`p`, `ul`, `ol`, `li`, `strong`, `em`, `b`, `i`, `br`, `span`)
- **Sections:** Profile, Work, Projects, Education, Certificates, Skills, Languages
- Signature: `buildResumeHtml(resume, options = {})` — full resume JSON in, HTML string out

### Patch merging (`src/mergePatch.js`)
- `data/resume.json` is read once at module import (cached at process start)
- Each `applyPatch()` deep-clones via `JSON.parse(JSON.stringify(...))` — never mutates the cache
- Work / skill / project entries match by `id` — IDs must come from `/context`
- `updatedAt` set to `new Date().toISOString()` on every modified entry

### Cover letter (`src/mergeCoverLetter.js`)
- `buildCoverLetterHtml(content)` builds a complete HTML page via JS template literal — no template file
- Plain text fields (`role`, `company`, `companyAddress`) are HTML-escaped
- Paragraph fields are injected raw — `wrapParagraph()` auto-wraps plain text (no `<`) in `<p>`
- **Language adaptive:** `de` uses `Sehr geehrte Damen und Herren,` / `Mit freundlichen Grüßen,` / `Bewerbung als {role}` / de-DE date. `en` uses `Dear Hiring Manager,` / `Kind regards,` / `Application for {role}` / en-US date.
- `subject`, `footerRole`, `date`, and personal contact details (name, email, phone, location, LinkedIn, website) are hardcoded in the file — edit `src/mergeCoverLetter.js` directly to change them, not via API

### Browser architecture
A single browser launches at startup and is reused. Each request opens a `browser.newContext()` and closes it in `finally`. Avoids per-request Chromium startup cost without leaking state.

## Data Schema (`data/resume.json`)

Flat — no FlowCV wrapper:
```
resume
  .meta.template
  .personalDetails.{fullName, jobTitle, displayEmail, phone, address, website, social.github.display, social.linkedIn.display}
  .content.profile.{displayName, entries[0].text}                                          ← text is HTML
  .content.work.{displayName, entries[].{id, employer, jobTitle, location, startDateNew, endDateNew, description}}
  .content.project.{displayName, entries[].{id, name, techStack, url?, description}}
  .content.education.{displayName, entries[].{degree, school, location, startDateNew, endDateNew, description?}}
  .content.certificate.{displayName, entries[].{certificate}}
  .content.skill.{displayName, entries[].{id, skill, infoHtml}}
  .content.language.{displayName, entries[].{language, infoHtml}}
```

All `description` / `infoHtml` fields are HTML strings.

## Code Conventions

- **ES Modules only** — `import`/`export`, never `require()`
- **File URLs for data paths** — `new URL("../data/resume.json", import.meta.url)`
- **camelCase** for functions/variables, **UPPER_SNAKE_CASE** for top-level constants
- **Verb-first function names**: `applyPatch`, `buildResumeHtml`, `toSlug`, `stripHtml`
- **Browser contexts always closed** in `finally` — never leak
- No linter, no formatter

## What NOT to Do

- **Never modify `data/resume.json` at runtime** — it's the immutable source of truth; mutations happen in-memory via deep clone
- **Never add `require()` calls** — ES module project; will crash
- **Never remove the `finally { context.close() }` blocks** — Playwright contexts will leak
- **Never cache cover letter output** — date must be current per request
- **Never close the shared `browser` instance inside a request handler** — close only on process exit

## n8n Workflow (high level)

Full automation lives in `data/Job_Application_Automator_v6.json` (36 nodes). Claude Code only edits the Express server — n8n orchestrates everything else. See `PIPELINE.md` for the full setup guide.

**Trigger:** manual (`workflow.active: false`).

**Flow:** 5 parallel Apify scrapers (LinkedIn, Indeed, StepStone, Glassdoor, Xing) → normalize/dedupe (filter DE/AT/CH/NL/BE) → diff against Google Sheets log → fetch `/context` → loop per job → role pre-filter → Gemini match (with fallback) → if `match===true && confidence>=45` → OpenAI tailor → POST `/generate-resume` + `/generate-coverletter` in parallel → pair responses by `jobId` → log to Sheets.

**To add a new job board:** add one entry to `BOARD_CONFIG` in node `4. Normalize & Merge Jobs` and wire its Apify node into `3. Wait for All Scrapers`.

**Models** (parametrized in node `1. Manual Configuration`):
- `geminiModel` = `gemini-3.1-flash-lite-preview` (primary match)
- `fallbackFilteringModel` = `gemini-2.0-flash-lite` (fallback match)
- `openaiModel` = `gpt-4o-mini` (tailor)

**Local server URL:** `http://host.docker.internal:3000` (Docker n8n) or `http://localhost:3000` (native).

**Credentials:** `httpHeaderAuth` "Gemini API Key" → `x-goog-api-key` header for `generativelanguage.googleapis.com`; `openAiApi` predefined; Google Sheets OAuth.

## Non-Obvious Behavior

### `scripts/test.js` sends a flat patch (no `patch:` wrapper)
Posts fields directly at the top level. Server handles both formats: `applyPatch(patch || req.body)`.

### Paragraphs must be HTML (or plain text — auto-wrapped)
`paragraph1/2/3` go raw into `<div class="body-text">`. The CSS `.body-text p` only applies to `<p>` elements. Prefer `<p>`-wrapped HTML. Plain text (no `<`) is auto-wrapped by `wrapParagraph()`.

### `data/resume.json` is a FlowCV export but FlowCV is no longer used
Schema field names (`infoHtml`, `startDateNew`, `endDateNew`) come from FlowCV. The file remains the source of truth, but PDF generation is fully local via `buildResumeHtml.js`. No FlowCV account, session, or API is needed.
