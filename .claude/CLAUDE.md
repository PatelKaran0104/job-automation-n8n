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

No build step. No database. No TypeScript. No test framework. No CI/CD. Code runs directly with `node`.

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
│   └── mergeCoverLetter.js ← Builds cover letter HTML from scratch via template literal
├── data/
│   ├── resume.json         ← Base resume (FlowCV JSON export) — SOURCE OF TRUTH, never modified at runtime
│   └── Job_Application_Automator_v6.json  ← n8n workflow definition
├── scripts/
│   ├── test.js             ← Manual test (hits /generate-resume with a hardcoded patch)
│   └── test-coverletter.js ← Manual test (hits /generate-coverletter with sample data)
├── output/                 ← Generated PDFs land here (git-ignored, created at startup)
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
```

---

## API Endpoints

### `GET /context`
Returns base resume as clean plain text (HTML stripped). Feed directly to AI so it knows what the current resume says.

**Response shape:**
```json
{
  "currentJobTitle": "string",
  "currentProfile": "string (plain text)",
  "currentWork": [{ "id", "employer", "jobTitle", "location", "startDate", "endDate", "description" }],
  "currentSkills": [{ "id", "skill", "details" }]
}
```

---

### `POST /generate-resume`
Accepts an AI patch, merges it into `data/resume.json`, renders the merged data to HTML via `buildResumeHtml`, and exports a PDF to `output/resume-{slug}.pdf`.

**Request body (only include changed fields):**
```json
{
  "patch": {
    "jobTitle": "string",
    "profile": "<p>HTML</p>",
    "work": [{ "id": "must match /context id", "description": "<ul><li><p>...</p></li></ul>" }],
    "skills": [{ "id": "must match /context id", "infoHtml": "<p>HTML</p>" }]
  },
  "company": "SAP SE"
}
```

> Note: `patch` can also be passed at the top level (the server tries `req.body.patch || req.body`).

**Response:** `{ "success": true, "file": "absolute path to PDF", "fileName": "resume-sap-se.pdf" }`

---

### `POST /generate-coverletter`
Injects content into the HTML template and renders a PDF to `output/coverletter-{slug}.pdf` via Playwright.

**Request body:**
```json
{
  "role": "Salesforce Developer",
  "company": "SAP SE",
  "companyAddress": "Walldorf, Deutschland",
  "paragraph1": "HTML or plain text — opening hook",
  "paragraph2": "HTML or plain text — skills/experience evidence",
  "paragraph3": "HTML or plain text — availability + CTA"
}
```

**Response:** `{ "success": true, "file": "absolute path to PDF", "fileName": "coverletter-sap-se.pdf" }`

---

## Key Implementation Details

### How resume generation works (`src/server.js` + `src/buildResumeHtml.js`)
1. `applyPatch()` deep-clones `data/resume.json` and merges the AI patch
2. `buildResumeHtml()` converts the merged resume JSON into a complete, self-contained HTML page
3. A shared Playwright browser context renders the HTML via `page.setContent()`
4. `page.evaluate(() => document.fonts.ready)` waits for embedded fonts to load
5. `page.pdf()` exports an A4 PDF to `output/`

No external services contacted. No login or session required.

### How `buildResumeHtml.js` works
- **Fonts:** Inlines base64-encoded Source Serif Pro WOFF2 — no CDN dependency
- **Icons:** Inline SVG (envelope, phone, location, globe, github, linkedin) — no Font Awesome
- **HTML sanitization:** Whitelist-based (`p`, `ul`, `ol`, `li`, `strong`, `em`, `b`, `i`, `br`, `span`)
- **Sections rendered:** Profile, Work, Education, Certificates, Skills, Languages
- **Export:** `buildResumeHtml(resume, options = {})` — takes the full resume JSON object (same shape as `data/resume.json`)

### How patch merging works (`src/mergePatch.js`)
- `data/resume.json` is loaded once at module import (cached at process start)
- Each call to `applyPatch()` deep-clones the base via `JSON.parse(JSON.stringify(...))` — never mutates the cached base
- Patch is matched by entry `id` for work and skill entries — IDs must come from `/context`
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
  .content.education.{displayName, entries[].{degree, school, location, startDateNew, endDateNew, description?}}
  .content.certificate.{displayName, entries[].{id, certificate}}
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
| `07d4ce0e-0dcf-4193-8425-06a3e01fe20c` | Agentforce and AI |
| `9a905d12-825c-4090-a90c-3ff010a9d8b4` | Salesforce Development |
| `7e0af879-e5a3-457e-ab86-634363abf266` | Low-Code and Automation |
| `c7231132-d4b1-47eb-9bee-a66c7756ce1d` | Integration and DevOps |
| `4e5c9b0d-2b32-48a6-9b61-0c320df13632` | Salesforce Platform |
| `b38fcbc7-ae5a-41f8-87c3-8e1fd55a8445` | Languages and Tools |

---

## n8n Workflow Architecture

The full automation lives in `data/Job_Application_Automator_v6.json` (29 nodes). Claude Code only touches the Express server (`src/`) — n8n orchestrates everything else.

**Pipeline summary:**
1. Schedule trigger (Mon–Fri 8am) → `1. Job Search URLs` sets URLs + `jobCount=50`
2. `2a–2e. Scrape *` — 5 Apify scrapers run in parallel: LinkedIn, Indeed, StepStone, Glassdoor, Xing
   `2f. Read Applied Jobs` → `2f.1. Ensure Not Empty` — fetches existing sheet data in parallel
3. `3. Wait for All Scrapers` — merges all 5 scraper outputs
4. `4. Normalize & Merge Jobs` — Code node with `BOARD_CONFIG` adapter; deduplicates by URL; filters to DE/AT/CH/NL/BE
5. `5. Sync Jobs + Sheet` — merges scraped jobs with applied-jobs sheet data
6. `6. Filter Duplicates` — removes jobs already logged to Google Sheets
7. `7. GET Resume Context` — fetches `/context` from local server
8. `8. Attach Resume to Jobs` — attaches resume context to each job item
9. `9. Loop Over Items` + `10c. Wait` — batch throttle (batchSize 5, 12s between batches)
10. `10a. Build Match Prompt` → `10b. Groq API Call` — match filter (`llama-3.1-8b-instant`); returns `{match, confidence, reason, jobType}`
11. `11. Parse Match Result` → `12. Is Match?` — routes matched jobs forward; unmatched go to skip log
12. `13a. Build Tailor Prompt` → `13b. OpenAI API Call` — tailors resume patch + writes cover letter text (`gpt-4o-mini`)
13. `14. Parse AI Patch` — extracts patch + 3 cover letter paragraphs from AI response
14. `15a. POST Generate Resume PDF` + `15b. POST Generate Cover Letter PDF` — call local Express server
15. `16. Prepare Sheet Log` → `17. Log to Google Sheets` — 17 columns including match score, PDF paths, notes
    `18a. Prepare Skip Log` → `18b. Log Skipped to Sheets` — unmatched jobs

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

**Required env vars in n8n:** `GROQ_API_KEY`, `OPENAI_API_KEY`

---

## Cover Letter Details

**Language:** German. Salutation is `Sehr geehrte Damen und Herren,`, closing is `Mit freundlichen Grüßen,`. Date is formatted in German locale (`31. März 2026`).

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
| Date | Current date in de-DE locale |
| Subject line | `Bewerbung als {role}` |
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