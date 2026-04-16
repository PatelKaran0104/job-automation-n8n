# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

# CLAUDE.md — Resume Generator

## Project Overview

Node.js/Express automation service that tailors resumes and cover letters for job applications. It exposes a simple HTTP API designed to be driven by an n8n workflow: n8n fetches the base resume, passes it to an AI (Claude/GPT) for tailoring, then posts the AI patch back here to merge it with the base JSON, render a custom HTML page, and export a PDF via Playwright.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (ES Modules — `"type": "module"`) |
| Server | Express 4.18.2 |
| Browser automation | Playwright 1.43.0 (Chromium, headless) |
| Resume rendering | Custom HTML (`src/buildResumeHtml.js`) |
| Workflow orchestration | n8n (external) |
| Package manager | npm |

No build step. No database. No TypeScript. No CI/CD. Code runs directly with `node`. Unit tests use `node:test` (built-in).

---

## Directory Layout

```
d:\KARAN\
├── .claude/
│   ├── CLAUDE.md           ← This file
│   └── settings.local.json ← n8n workflow settings (not checked in)
├── src/
│   ├── server.js           ← Express server, all 3 endpoints
│   ├── buildResumeHtml.js  ← Renders resume JSON → full HTML page
│   ├── mergePatch.js       ← Merges AI patch into base resume JSON
│   ├── validatePatch.js    ← Validates AI patch shape and IDs before apply
│   ├── mergeCoverLetter.js ← Builds cover letter HTML from scratch via template literal
│   └── loadFonts.js        ← Base64-encodes Source Serif Pro WOFF2 fonts, exports FONT_CSS
├── data/
│   ├── resume.json         ← Base resume (FlowCV JSON export) — SOURCE OF TRUTH, never modified at runtime
│   └── Job_Application_Automator_v6.json  ← n8n workflow definition
├── scripts/
│   ├── test.js             ← Manual test (hits /generate-resume with a hardcoded patch)
│   └── test-coverletter.js ← Manual test (hits /generate-coverletter with sample data)
├── tests/
│   └── validatePatch.test.js ← Unit tests for patch validation (node:test)
├── docs/                   ← Design specs and implementation plans
├── output/                 ← Generated PDFs land here (git-ignored, date-organized)
├── package.json
├── PIPELINE.md             ← Full setup and n8n configuration guide
```

---

## Running the Server

```bash
# Start server on port 3000
npm start

# Manual test without n8n — resume
npm test

# Manual test without n8n — cover letter
npm run test:coverletter

# Unit tests (validatePatch)
npm run test:unit
```

---

## API Endpoints

### `GET /context`
Returns base resume as clean plain text (HTML stripped). Feed directly to AI so it knows what the current resume says. Work descriptions use `stripHtmlPreserveBullets()` which preserves bullet structure as newlines; all other fields use `stripHtml()`.

**Response shape:**
```json
{
  "currentJobTitle": "string",
  "currentProfile": "string (plain text)",
  "currentWork": [{ "id", "employer", "jobTitle", "location", "startDate", "endDate", "description" }],
  "currentSkills": [{ "id", "skill", "details" }],
  "currentProjects": [{ "id", "name", "techStack", "url", "description" }]
}
```

---

### `POST /generate-resume`
Accepts an AI patch, validates it via `validatePatch()`, merges it into `data/resume.json`, renders the merged data to HTML via `buildResumeHtml`, and exports a PDF to `output/YYYY-MM-DD/Resume/resume-{company}--{role}-HHMMSS.pdf` (timestamp suffix prevents same-day collisions).

**Request body (only include changed fields):**
```json
{
  "patch": {
    "jobTitle": "string",
    "profile": "<p>HTML</p>",
    "showCertificates": false,
    "showProjects": false,
    "work": [{ "id": "must match /context id", "description": "<ul><li><p>...</p></li></ul>" }],
    "skills": [{ "id": "must match /context id", "skill": "optional rename", "infoHtml": "<p>HTML</p>" }],
    "projects": [{ "id": "must match /context id", "description": "<ul><li><p>...</p></li></ul>", "techStack": "optional", "name": "optional rename" }]
  },
  "company": "SAP SE",
  "role": "Software Developer",
  "language": "de or en (optional, defaults to no override — German headings when \"de\")",
  "jobId": "optional — echoed back in response for downstream pairing (usually the job URL)"
}
```

> Note: `patch` can also be passed at the top level (the server tries `req.body.patch || req.body`).

**Response:** `{ "success": true, "file": "absolute path to PDF", "fileName": "resume-sap-se--salesforce-developer-HHMMSS.pdf", "jobId": "..." }`
The `jobId` key is only present if it was sent in the request.

---

### `POST /generate-coverletter`
Injects content into the HTML template and renders a PDF to `output/YYYY-MM-DD/Coverletter/coverletter-{company}--{role}-HHMMSS.pdf` via Playwright.

**Request body:**
```json
{
  "role": "Salesforce Developer",
  "company": "SAP SE",
  "companyAddress": "Walldorf, Deutschland",
  "paragraph1": "HTML or plain text — opening hook",
  "paragraph2": "HTML or plain text — skills/experience evidence",
  "paragraph3": "HTML or plain text — availability + CTA",
  "language": "de or en (optional, defaults to \"de\" — controls salutation, closing, subject, date locale)",
  "jobId": "optional — echoed back in response for downstream pairing"
}
```

**Response:** `{ "success": true, "file": "absolute path to PDF", "fileName": "coverletter-sap-se--salesforce-developer-HHMMSS.pdf", "jobId": "..." }`

---

## Key Implementation Details

### How resume generation works (`src/server.js` + `src/buildResumeHtml.js`)
1. `validatePatch()` checks patch shape and IDs; rejects invalid patches with 422
2. `applyPatch()` deep-clones `data/resume.json` and merges the AI patch
3. `buildResumeHtml()` converts the merged resume JSON into a complete, self-contained HTML page
4. A shared Playwright browser context renders the HTML via `page.setContent()`
5. `page.evaluate(() => document.fonts.ready)` waits for embedded fonts to load
6. `page.pdf()` exports an A4 PDF to `output/YYYY-MM-DD/Resume/`

No external services contacted. No login or session required.

### How `buildResumeHtml.js` works
- **Fonts:** Inlines base64-encoded Source Serif Pro WOFF2 — no CDN dependency
- **Icons:** Inline SVG (envelope, phone, location, globe, github, linkedin) — no Font Awesome
- **HTML sanitization:** Whitelist-based (`p`, `ul`, `ol`, `li`, `strong`, `em`, `b`, `i`, `br`, `span`)
- **Sections rendered:** Profile, Work, Projects, Education, Certificates, Skills, Languages
- **Export:** `buildResumeHtml(resume, options = {})` — takes the full resume JSON object (same shape as `data/resume.json`)

### How patch merging works (`src/mergePatch.js`)
- `data/resume.json` is loaded once at module import (cached at process start)
- Each call to `applyPatch()` deep-clones the base via `JSON.parse(JSON.stringify(...))` — never mutates the cached base
- Patch is matched by entry `id` for work, skill, and project entries — IDs must come from `/context`
- `updatedAt` is set to `new Date().toISOString()` on every modified entry
- Returns the full resume JSON object (the deep-cloned `data`) — this is passed directly to `buildResumeHtml()`

> Note: `/context` reads `resume.json` fresh on every request via `readFileSync` — it is NOT cached.

### How cover letter generation works (`src/mergeCoverLetter.js`)
- `buildCoverLetterHtml(content)` builds a **complete, self-contained HTML page** via a JS template literal — no external template file is read
- Shares `FONT_CSS` (base64-encoded Source Serif Pro) from `src/loadFonts.js`, same as the resume builder
- Plain text fields (`role`, `company`, `companyAddress`) are HTML-escaped via `escapeHtml()`
- Paragraph fields (`paragraph1/2/3`) are injected as raw HTML — must be `<p>`-wrapped (see Non-Obvious Behavior Notes)
- A `wrapParagraph()` helper provides a fallback: plain text without `<` is auto-wrapped in `<p>` tags
- Date is auto-generated on each call in German locale (`de-DE`): `31. März 2026`
- `subject` (`"Bewerbung als {role}"`) and `footerRole` (`"{role} @ {company}"`) are derived internally — not accepted from the request body

### Browser architecture in `src/server.js`
A single browser instance is launched at startup and reused across all requests. Each request opens a new context (`browser.newContext()`), uses it, then closes it in `finally`. This avoids per-request Chromium startup cost without leaking state between requests.

---

## Data Schema Notes

The resume JSON structure (`data/resume.json`) is flat — no FlowCV wrapper:
```
resume
  .meta.template                          ← "default" or a named template
  .personalDetails.{fullName, jobTitle, displayEmail, phone, address, website, social.github.display, social.linkedIn.display}
  .content.profile.{displayName, entries[0].text}        ← text is HTML string
  .content.work.{displayName, entries[].{id, employer, jobTitle, location, startDateNew, endDateNew, description}}
  .content.project.{displayName, entries[].{id, name, techStack, url?, description}}
  .content.education.{displayName, entries[].{degree, school, location, startDateNew, endDateNew, description?}}
  .content.certificate.{displayName, entries[].{certificate}}
  .content.skill.{displayName, entries[].{id, skill, infoHtml}}
  .content.language.{displayName, entries[].{language, infoHtml}}
```

All description/infoHtml fields are stored as HTML strings.

---

## Code Conventions

- **ES Modules only** — use `import`/`export`, never `require()`
- **File URLs for data paths** — `new URL("../data/resume.json", import.meta.url)` (not `__dirname`)
- **`__dirname` workaround** — uses `dirname(fileURLToPath(import.meta.url))` where needed for filesystem reads
- **camelCase** for functions and variables; **UPPER_SNAKE_CASE** for top-level constants
- **Verb-first function names**: `applyPatch`, `buildResumeHtml`, `buildCoverLetterHtml`, `toSlug`, `stripHtml`
- **Browser contexts always closed** in `finally` blocks — never leave dangling contexts
- **No linter or formatter configured** — no `.eslintrc`, no Prettier config

---

## What NOT to Do

- **Never modify `data/resume.json` at runtime** — it is the immutable source of truth; all mutations happen in-memory via deep clone
- **Never add `require()` calls** — this is an ES module project; it will crash
- **Never remove the `finally { context.close() }` blocks** — Playwright contexts will leak
- **Never cache cover letter output** — `buildCoverLetterHtml()` is called fresh per request intentionally (date must be current)
- **Never close the shared `browser` instance inside a request handler** — it is reused; close only on process exit

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `EADDRINUSE: port 3000` | Kill existing process and restart |
| PDF not in `/output` | Restart server after code changes |
| Fonts missing in PDF | Run `npm install` to restore `@fontsource/source-serif-pro` |
| HTML layout broken | Check `buildResumeHtml.js` — likely a resume JSON schema change |

---

## Entry ID Quick Reference

These IDs are hardcoded in `data/resume.json` and must be used verbatim in API patches. Never guess or generate IDs.

### Work Entries
| ID | Employer | Role | Period |
|----|----------|------|--------|
| `286ca64e-9ab1-4d32-9905-0996d5d6a5c1` | MV Clouds | Salesforce Developer | 02/2023 – 04/2025 |
| `4ea57bcd-62e6-4928-9c40-bd11d0afc5ff` | Independent Salesforce Consultant | Aerospace Industry Client | 2024 – 2025 |

### Skill Entries
| ID | Skill Name |
|----|-----------|
| `7e0af879-e5a3-457e-ab86-634363abf266` | Languages |
| `4e5c9b0d-2b32-48a6-9b61-0c320df13632` | Frontend |
| `b38fcbc7-ae5a-41f8-87c3-8e1fd55a8445` | Backend & APIs |
| `c7231132-d4b1-47eb-9bee-a66c7756ce1d` | Cloud & DevOps |
| `9a905d12-825c-4090-a90c-3ff010a9d8b4` | Salesforce Platform |
| `07d4ce0e-0dcf-4193-8425-06a3e01fe20c` | Automation & AI |

### Project Entries
| ID | Project Name |
|----|-------------|
| `7abecff6-de39-4af0-9415-c52095dad34d` | AI-Powered Document Generation Pipeline |
| `9a2cb027-89ad-4d79-b6d0-2cf3b8be86b7` | Real-Time Spatial Communication Platform |
| `cc6d5648-a1f0-4eca-9216-adda27e62c36` | University Marketplace |
| `59a0376c-1b3e-47cd-a4cc-115650724dfb` | Cloud Infrastructure Stack |
| `c209ab25-c79e-4d14-874c-847424ea9db4` | Portfolio Website |
| `a26b166c-99b8-4de6-8535-bceae1d0a347` | QR Code Generator |
| `a2da740b-cffe-4f70-99f0-b47508f9482b` | Parallel Matrix Multiplication (SUMMA) |
| `5dd88371-c8c5-4965-92d2-44441f810630` | Face Recognition Attendance System |

---

## n8n Workflow Architecture

The full automation lives in `data/Job_Application_Automator_v6.json` (35 nodes). Claude Code only touches the Express server (`src/`) — n8n orchestrates everything else.

**Trigger:** `Run Workflow` (manual). `workflow.active: false` — executed on demand, not on a schedule.

**Pipeline summary:**
1. `Run Workflow` → `1. Manual Configuration` sets per-board URLs, `jobCount`, `geminiModel`, `fallbackFilteringModel`, `openaiModel`
2. `2a–2e. Scrape *` — 5 Apify scrapers run in parallel: LinkedIn, Indeed, StepStone, Glassdoor, Xing
   `2f. Read Applied Jobs` → `2f.1. Ensure Not Empty` — fetches existing sheet data in parallel
3. `3. Wait for All Scrapers` — merges all 5 scraper outputs
4. `4. Normalize & Merge Jobs` — Code node with `BOARD_CONFIG` adapter; deduplicates by URL; filters to DE/AT/CH/NL/BE
5. `5. Sync Jobs + Sheet` — merges scraped jobs with applied-jobs sheet data
6. `6. Filter Duplicates` — removes jobs already logged to Google Sheets; also deduplicates by company+role within the scraped batch
7. `7. GET Resume Context` — fetches `/context` from local server
8. `8. Attach Resume to Jobs` — attaches resume context to each job item
9. `9. Loop Over Items` — batch throttle (batch size `1`)
10. `10a. Build Match Prompt` — builds prompt with role-type pre-filter (rejects sales, HR, customer service, logistics, accounting; `TECH_SAFEGUARD` regex rescues borderline titles like "DevOps Engineer – Recruiting Platform")
    `10a1. Skip Gemini?` — routes pre-filtered rejects directly to `18a. Prepare Skip Log`; rest to `10b. Wait`
    `10b. Wait` (3s) → `10c. Gemini API Call` — primary match filter (`geminiModel`)
    `10d. Gemini OK?` — if `candidates` missing, routes to `10e. Fallback Gemini Call` (`fallbackFilteringModel`); both paths converge at `11`
11. `11. Parse Match Result` → `12. Is Match?` — requires `match === true` AND `confidence >= 45` AND `_apiError !== true`
12. `13a. Build Tailor Prompt` → `13a1. Wait` (2s) → `13b. OpenAI API Call` — tailors resume patch + structured cover letter `{paragraph1, paragraph2, paragraph3, language}`; includes skill rename guards and profile guard
13. `14. Parse AI Patch` — extracts patch + 3 cover letter paragraphs; runs structural validation (must contain non-empty `work` AND `skills`); computes quality flag (Good Fit / Bad Fit / Review / Error)
14. `15a. POST Generate Resume PDF` + `15b. POST Generate Cover Letter PDF` fire in parallel from `14`
15. `15c. Wait for PDFs` merge node → `16. Prepare Sheet Log` pairs resume/coverletter responses via jobId-based Map lookup (immune to index shifts from failed PDF calls)
16. `16. Prepare Sheet Log` → `17. Log to Google Sheets`
    `18a. Prepare Skip Log` → `18b. Log Skipped to Sheets` — unmatched, pre-filtered, and API-error jobs
17. Both `17` and `18b` loop back to `9. Loop Over Items` to pick up the next item

**BOARD_CONFIG keys** (in node `4. Normalize & Merge Jobs`):

| Board | n8n node name |
|-------|--------------|
| LinkedIn | `2a. Scrape LinkedIn` |
| Indeed | `2b. Scrape Indeed` |
| StepStone | `2c. Scrape StepStone` |
| Glassdoor | `2d. Scrape Glassdoor` |
| Xing | `2e. Scrape Xing` |

To add a new job board: add one entry to `BOARD_CONFIG` and wire its Apify node to `3. Wait for All Scrapers`. Nothing else changes.

**n8n URL for local server:** `http://host.docker.internal:3000` (Docker). Change to `http://localhost:3000` for native n8n.

**n8n credentials required:**
- `httpHeaderAuth` credential **"Gemini API Key"** (sends `x-goog-api-key` to `generativelanguage.googleapis.com`) — used by `10c` and `10e`
- `openAiApi` predefined credential — used by `13b`
- Google Sheets OAuth credential — used by `2f`, `17`, `18b`

Models are parametrized in `1. Manual Configuration`:
- `geminiModel` = `gemini-3.1-flash-lite:preview` (primary match)
- `fallbackFilteringModel` = `gemini-2.0-flash-lite` (fallback match)
- `openaiModel` = `gpt-4o-mini` (tailor)

---

## Cover Letter Details

**Language:** Adaptive based on `language` parameter (`"de"` or `"en"`, defaults to `"de"`). The n8n workflow detects the JD language and passes it through. German uses `Sehr geehrte Damen und Herren,` / `Mit freundlichen Grüßen,` / `Bewerbung als {role}` / de-DE date. English uses `Dear Hiring Manager,` / `Kind regards,` / `Application for {role}` / en-US date.

**Hardcoded in `src/mergeCoverLetter.js`** (NOT injected via API — edit the file directly to change):
- Name: Karan Patel
- Email: khpatel0104@gmail.com
- Phone: +49 15210894179
- Location: Hesse, Germany
- LinkedIn: linkedin.com/in/patelkaran0104/
- Website: karanpatel.live

**Auto-derived fields** (computed inside `buildCoverLetterHtml()`, not accepted from the request body):
| Field | Value |
|-------|-------|
| Date | Current date in de-DE or en-US locale (based on `language`) |
| Subject line | `Bewerbung als {role}` (de) / `Application for {role}` (en) |
| Header title | `{role}` |
| Closing title | `{role}` |
| Footer | `{role} @ {company}` |

---

## Non-Obvious Behavior Notes

### `test.js` sends a flat patch (no `patch:` wrapper)
`scripts/test.js` posts fields directly at the top level of the body (e.g. `{ jobTitle, profile, work, skills }`), not nested under a `patch` key. The server handles both: `applyPatch(patch || req.body)`. Either format works.

### Paragraphs must be HTML (or plain text — auto-wrapped)
`paragraph1/2/3` are injected raw into `<div class="body-text">`. The CSS rule `.body-text p` only applies to `<p>` elements. Prefer sending `<p>`-wrapped HTML. If plain text (no `<` prefix) is sent, `wrapParagraph()` auto-wraps it in `<p>` tags. Either works, but HTML gives full control over formatting.

### `data/resume.json` is a FlowCV export but FlowCV is no longer used at runtime
The JSON schema originates from FlowCV (field names like `infoHtml`, `startDateNew`, `endDateNew`). The file is still the source of truth for resume content — but PDF generation is now fully local via `buildResumeHtml.js`. No FlowCV account, session, or API is needed.