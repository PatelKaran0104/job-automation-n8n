# Resume Generator — Pipeline Guide

Automated job application pipeline: scrapes 5 job boards on manual trigger → AI match filter → AI resume/cover letter tailoring → PDF generation → auto-apply (email outreach + Telegram notification for confidence ≥ 75) → Google Sheets logging.

---

## Architecture Overview

```
Run Workflow (manual trigger)
          ↓
1. Manual Configuration (URLs, jobCount, model names)
          ↓ (parallel)
┌──────────────────────────────────────────────────────────────────┐
│ 2a. Scrape LinkedIn │ 2b. Scrape Indeed │ 2c. Scrape StepStone  │
│ 2d. Scrape Glassdoor │ 2e. Scrape Xing  │  2f. Read Applied Jobs │
│ (Apify actors, each scrapes jobCount jobs)  │  (Google Sheets)   │
└──────────────────────────┬─────────────────────┬────────────────-┘
                           ↓                     ↓
               3. Wait for All Scrapers   2f.1. Ensure Not Empty
                           ↓                     ↓
               4. Normalize & Merge Jobs          │
                  BOARD_CONFIG adapter            │
                  Dedup by URL · country filter   │
                           ↓                     ↓
                     5. Sync Jobs + Sheet ←───────┘
                           ↓
                     6. Filter Duplicates (remove already-logged jobs)
                           ↓
                     7. GET Resume Context (fetch /context)
                           ↓
                     8. Attach Resume to Jobs
                           ↓
                     9. Loop Over Items (batch throttle)
                           ↓
             10a. Build Match Prompt (role-type pre-filter)
                           ↓
             10a1. Skip Gemini? ──── pre-filter reject → 18a
                           ↓
                     10b. Wait (3s)
                           ↓
             10c. Gemini API Call (primary match model)
                           ↓
             10d. Gemini OK? ──── no candidates → 10e. Fallback Gemini Call
                           ↓                         ↓
                           └──── 11. Parse Match Result ────┘
                                          ↓
                            12. Is Match? (match=true AND confidence ≥ 45)
             ↓ true                                      ↓ false
   13a. Build Tailor Prompt                     18a. Prepare Skip Log
             ↓                                            ↓
     13a1. Wait (2s)                     18b. Log Skipped to Sheets
             ↓
   13b. OpenAI API Call (tailor + cover letter)
             ↓
   14. Parse AI Patch (quality flag + structural validation)
             ↓ (parallel)
   15a. POST /generate-resume  │  15b. POST /generate-coverletter
             ↓                                 ↓
                    15c. Wait for PDFs (merge)
                           ↓
                   16. Prepare Sheet Log (jobId-based pairing)
                           ↓
             [NEW] Branch: confidence ≥ 75?
          ↓ yes                              ↓ no
  ┌── EMAIL PATH ──────────────────┐         │
  │ 19a. Build Apollo Payload      │         │
  │ 19b. Apollo People Search      │         │
  │ 19c. Extract HR Email          │         │
  │ 19c1. Has Email? ──no──→ 20e   │         │
  │    ↓ yes                 ↓     │         │
  │ 20a. Build PDF URLs     Merge  │         │
  │ 20a1. Fetch Resume PDF  22 ←──-┘         │
  │ 20a2. Fetch Cover Letter PDF   │         │
  │ 20b. Draft Outreach Email      │         │
  │ 20b1. Build Email Payload      │         │
  │ 20c. Send Outreach Email       │         │
  │ 20d. Mark Email Sent ──────────┘         │
  └────────────────────────────────          │
  ┌── TELEGRAM PATH ───────────────┐         │
  │ 21a. Personal Details          │         │
  │ 21b. Send Job Card             │→ Merge  │
  │ 21c. Send Quick-Fill Card      │  22 ←──-┘
  │ 21d. Mark Telegram Sent ───────┘         │
  └────────────────────────────────          │
          ↓ (both paths done)                │
   22. Merge Auto-Apply Paths                │
          ↓                                  │
   22b. Collapse Result                      │
          ↓                                  │
   17. Log to Google Sheets ←────────────────┘
```

---

## Running the Local Server

```bash
# Install dependencies (first time only)
npm install

# Start server
npm start

# Manual test — resume PDF
npm test

# Manual test — cover letter PDF
npm run test:coverletter

# Unit tests
npm run test:unit
```

Server must be running for the n8n workflow to call `/context`, `/generate-resume`, and `/generate-coverletter`.

---

## API Endpoints

### `GET /context`
Returns base resume as plain text. The n8n workflow calls this once per run to attach resume context to each job.

```json
{
  "currentJobTitle": "...",
  "currentProfile": "plain text...",
  "currentWork": [
    { "id": "...", "employer": "...", "jobTitle": "...",
      "location": "...", "startDate": "...", "endDate": "...", "description": "plain text (bullets preserved as newlines)" }
  ],
  "currentSkills": [
    { "id": "...", "skill": "...", "details": "plain text" }
  ],
  "currentProjects": [
    { "id": "...", "name": "...", "techStack": "...", "url": "...", "description": "plain text" }
  ]
}
```

---

### `POST /generate-resume`
Merges AI patch into `data/resume.json`, renders HTML, exports PDF.

```json
{
  "patch": {
    "jobTitle": "string",
    "profile": "<p>HTML</p>",
    "showCertificates": false,
    "showProjects": false,
    "work": [{ "id": "must match /context id", "description": "<ul><li><p>...</p></li></ul>" }],
    "skills": [{ "id": "must match /context id", "skill": "optional rename", "infoHtml": "<p>HTML</p>" }],
    "projects": [{ "id": "must match /context id", "description": "...", "techStack": "...", "name": "..." }]
  },
  "company": "Company Name",
  "role": "Software Developer",
  "language": "de or en (optional)",
  "jobId": "optional — echoed back in response for downstream pairing"
}
```

> `patch` can also be passed flat at the top level — the server handles both.

**Output path:** `output/YYYY-MM-DD/Resume/resume-{company}--{role}-HHMMSS.pdf` (timestamp prevents same-day collisions).

**Response:** `{ "success": true, "file": "absolute path", "fileName": "...", "jobId": "..." }`

---

### `POST /generate-coverletter`
Renders a cover letter PDF (German or English) from 3 paragraphs.

```json
{
  "role": "...",
  "company": "...",
  "companyAddress": "...",
  "paragraph1": "Opening hook (HTML or plain text)",
  "paragraph2": "Skills/experience evidence",
  "paragraph3": "Availability + CTA",
  "language": "de or en (optional — defaults to de)",
  "jobId": "optional — echoed back"
}
```

**Output path:** `output/YYYY-MM-DD/Coverletter/coverletter-{company}--{role}-HHMMSS.pdf`.

---

## n8n Workflow

**File:** `data/Job_Application_Automator_v7.json` — import into n8n to deploy (~61 nodes).

**Skip Callback workflow:** `data/Telegram_Skip_Callback_v1.json` — import as a separate, always-active workflow. Listens for Telegram Skip button callbacks and updates `Portal Status` to `skipped` in Google Sheets.

**Trigger:** Manual (`Run Workflow` node). `workflow.active: false` — the workflow is executed on-demand, not on a schedule.

**URL in n8n nodes:** `http://host.docker.internal:3000` (Docker internal networking).
If running n8n natively (not Docker), change to `http://localhost:3000`.

**Credentials required in n8n:**
- `httpHeaderAuth` credential named **"Gemini API Key"** — sends `x-goog-api-key` header to Google's `generativelanguage.googleapis.com`
- `openAiApi` — OpenAI API credential (predefined credential type)
- Google Sheets OAuth credential (for `2f. Read Applied Jobs`, `17. Log to Google Sheets`, `18b. Log Skipped to Sheets`, `3. Find Job Row`, `4. Update Portal Status`)
- `httpHeaderAuth` credential named **"Apollo API Key"** — sends `x-api-key` header to `api.apollo.io` (free tier: 50 people exports/month)
- `telegramApi` credential named **"Job Bot"** — Telegram bot token for job card and quick-fill notifications
- `gmailOAuth2` credential named **"Karan Gmail"** — Gmail OAuth2 for outreach email send (scope: `gmail.send`)

**Environment variable required:**
- `TELEGRAM_BOT_TOKEN` — set in n8n's `.env` / Docker environment; used by the Skip Callback workflow to call `answerCallbackQuery`

No standalone environment variables are read — all auth flows through n8n credentials.

**To run:** open the workflow in n8n UI and click *Execute Workflow* on the `Run Workflow` node.

---

## Configuration Reference

All tunable values live in specific nodes. Edit them directly in the n8n workflow JSON or via the n8n UI.

| What | Where to change |
|------|----------------|
| Search URLs per board | `1. Manual Configuration` → `linkedInUrl`, `indeedUrl`, `stepstoneUrl`, `XingUrl` |
| Jobs scraped per board | `1. Manual Configuration` → `jobCount` (default: `5`) |
| Primary match model | `1. Manual Configuration` → `geminiModel` (default: `gemini-3.1-flash-lite-preview`) |
| Fallback match model | `1. Manual Configuration` → `fallbackFilteringModel` (default: `gemini-2.0-flash-lite`) |
| Tailor model | `1. Manual Configuration` → `openaiModel` (default: `gpt-4o-mini`) |
| Glassdoor URL | Hardcoded in `2d. Scrape Glassdoor` (not parametrized — city/country filter inside actor) |
| Match confidence threshold | `12. Is Match?` → `confidence-check` condition value (default: `55`) |
| Auto-apply threshold | `Branch: High Confidence?` → condition value (default: `75`) |
| Apollo.io credential | n8n Credentials → `Apollo API Key` |
| Telegram chat ID | `21b. Send Job Card` → Chat ID field (current: `923697082`) |
| Pre-Gemini delay | `10b. Wait` → `amount` (default: `3` seconds) |
| Pre-OpenAI delay | `13a1. Wait` → `amount` (default: `2` seconds) |
| Batch size (items per loop) | `9. Loop Over Items` → `batchSize` (default: `1`) |
| Country filter | `4. Normalize & Merge Jobs` → `ALLOWED_COUNTRIES` set |
| Min description length | `4. Normalize & Merge Jobs` → `desc.length < N` check |
| Resume server timeout | `7. GET Resume Context`, `15a`, `15b` → `timeout` option |
| Gemini API retry | `10c. Gemini API Call` → `maxTries` / `waitBetweenTries` |
| OpenAI API retry | `13b. OpenAI API Call` → `maxTries` / `waitBetweenTries` |

---

## Job Board Adapter (Node: "4. Normalize & Merge Jobs")

All 5 scrapers output different schemas. The `BOARD_CONFIG` object maps each scraper's fields to a unified shape:

| Source | n8n Node | Key field notes |
|--------|----------|-----------------|
| LinkedIn | `2a. Scrape LinkedIn` | `companyName`, `descriptionText`, `link` |
| Indeed | `2b. Scrape Indeed` | `employer.name`, `description.text`, `location.countryCode` |
| StepStone | `2c. Scrape StepStone` | `company_details.company_name`, `content_details.full_description` |
| Glassdoor | `2d. Scrape Glassdoor` | `company.companyName`, `description_text`, country filter skipped (DE-only board) |
| Xing | `2e. Scrape Xing` | `apply_url`, `location_country_code`, salary already a formatted string |

To add a new board: add one entry to `BOARD_CONFIG` and wire its Apify node into `3. Wait for All Scrapers`. Nothing else changes.

---

## Match Filter (Gemini)

`10a. Build Match Prompt` → `10a1. Skip Gemini?` → (`10b. Wait` →) `10c. Gemini API Call` → `10d. Gemini OK?` → (`10e. Fallback Gemini Call` →) `11. Parse Match Result`.

- **Pre-filter (in `10a`):** regex-based hard reject of fundamentally misaligned titles (Sales, HR, Customer Service, Logistics, Accounting, Gastronomie, …). A `TECH_SAFEGUARD` regex lets borderline titles like "DevOps Engineer - Recruiting Platform" pass through to Gemini. Rejected items carry `_preFilterReject: true` and `10a1. Skip Gemini?` routes them directly to `18a. Prepare Skip Log` — no Gemini call, no `10a2` node.
- **Primary call (`10c`):** Gemini `gemini-3.1-flash-lite-preview`, via direct REST to `generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`.
- **Fallback (`10e`):** If `10c` returns no `candidates` array, `10d. Gemini OK?` routes to `10e. Fallback Gemini Call` (model: `gemini-2.0-flash-lite`). Both paths converge at `11. Parse Match Result`.
- **Match gate (`12`):** requires `match === true` AND `confidence >= 45` AND `_apiError !== true`.

---

## Tailor (OpenAI)

`13a. Build Tailor Prompt` → `13a1. Wait` (2s) → `13b. OpenAI API Call` → `14. Parse AI Patch`.

- Single combined call returns `{ patch, coverLetter: { paragraph1, paragraph2, paragraph3 }, language }`.
- `14. Parse AI Patch` performs structural validation: patch must contain non-empty `work` AND `skills` with valid descriptions/infoHtml, else flagged as `_error` / "Review".
- `language` flows through from tailor response into both `15a` and `15b` request bodies (controls German vs English output).

---

## PDF Generation & Logging

- `14. Parse AI Patch` fans out to `15a. POST Generate Resume PDF` and `15b. POST Generate Cover Letter PDF` in parallel.
- Both feed into `15c. Wait for PDFs` (merge node) — pairs the two HTTP responses back to one item per job.
- `16. Prepare Sheet Log` uses jobId-based Map lookup to pair resume and coverletter PDF paths — immune to index shifts when one PDF call fails.
- `17. Log to Google Sheets` appends one row per job; `18b. Log Skipped to Sheets` appends skipped/pre-filter-rejected/API-error rows.

---

## Google Sheets Schema

Each logged job (match or skip) writes these columns:

| Column | Source |
|--------|--------|
| Date | timestamp |
| Company | normalized job |
| Role | normalized job |
| Job Type | Gemini match result (internship / werkstudent / full-time / contract / unknown) |
| Location | normalized job |
| Source | board name |
| Job URL | normalized job (hyperlinked) |
| Apply URL | normalized job (hyperlinked) |
| Raw URL | non-hyperlinked URL (for jobId reference) |
| Match Confidence | Gemini score (0–100) |
| Match Reason | Gemini one-line reason |
| Resume File | absolute path to generated PDF (empty if skipped) |
| Cover Letter File | absolute path to generated cover letter PDF (empty if skipped) |
| Status | `Generated` / `PDF Failed` / `Skipped - No Match` / `No New Jobs` / `Pipeline Error` |
| Applied | manual column (default `No`) |
| Response | manual column |
| Interview | manual column |
| Notes | AI parse warning, PDF error, or cover letter warning |
| Quality | `Good Fit` / `Bad Fit` / `Review` / `Error` / `Unknown` / `N/A` |
| Email Recipient | HR/recruiter email found via Apollo.io, or `—` if none found |
| Email Sent | `yes` / `no` |
| Telegram Notified | `yes` / `no` |
| Portal Status | `pending` (auto-apply sent) / `skipped` (Skip button tapped) / `—` (confidence < 75) / `applied` (set manually after portal form submitted) |

**Note:** The last 4 columns are only populated for confidence ≥ 75 jobs. Add them to your Google Sheet header row before the first run of v7.

---

## File Reference

```
d:\KARAN\
├── .claude/
│   └── CLAUDE.md               ← Codebase guidance for Claude Code
├── src/
│   ├── server.js               ← Express server (all 3 endpoints)
│   ├── buildResumeHtml.js      ← Renders resume JSON → full HTML page (EN/DE headings)
│   ├── mergePatch.js           ← Merges AI patch into base JSON
│   ├── validatePatch.js        ← Validates AI patch shape and IDs before apply
│   ├── mergeCoverLetter.js     ← Builds cover letter HTML (DE or EN, date in locale)
│   └── loadFonts.js            ← Embeds Source Serif Pro WOFF2 as base64
├── data/
│   ├── resume.json             ← Base resume, source of truth — never modified at runtime
│   ├── Job_Application_Automator_v7.json  ← n8n main workflow (~61 nodes; import into n8n)
│   ├── Job_Application_Automator_v6.json  ← previous version (kept for reference)
│   └── Telegram_Skip_Callback_v1.json    ← separate always-active workflow (Skip button handler)
├── scripts/
│   ├── test.js                 ← Manual test: hits /generate-resume with hardcoded patch
│   └── test-coverletter.js     ← Manual test: hits /generate-coverletter with sample data
├── tests/
│   └── validatePatch.test.js   ← node:test unit tests for validatePatch
├── docs/superpowers/           ← Plans and specs (history of changes)
├── output/                     ← Generated PDFs organized as YYYY-MM-DD/Resume and YYYY-MM-DD/Coverletter
├── docker-compose.yml          ← n8n container config (custom DNS, host.docker.internal mapping)
├── package.json
└── PIPELINE.md                 ← This file
```

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `EADDRINUSE` | Kill existing server process and restart |
| PDF not in `/output` | Restart server after any code change |
| Fonts missing in PDF | `npm install` to restore `@fontsource/source-serif-pro` |
| HTML layout broken | Check `buildResumeHtml.js` — likely a resume JSON schema mismatch |
| n8n can't reach server | Change URL from `host.docker.internal` to `localhost` if not on Docker |
| Gemini 429 / quota | Primary model fails → `10d. Gemini OK?` auto-falls back to `fallbackFilteringModel`. To reduce load, increase `10b. Wait` or reduce `jobCount`. |
| OpenAI 429 / quota | Increase `13a1. Wait` amount or reduce `batchSize` in `9. Loop Over Items` |
| No jobs after normalize | Check Apify actor outputs match `BOARD_CONFIG` field names |
| Scraper failure hangs pipeline | Check `onError` setting on scraper nodes — should emit to merge node on error |
| Resume/cover letter language mismatch | `language` field in tailor result flows through — check `14. Parse AI Patch` output |
| Apollo returns no people | Expected — `19c1` routes to `20e` (passthrough), email is skipped, Telegram still fires |
| Gmail auth error | Re-authorize `Karan Gmail` credential in n8n → Credentials |
| Telegram message not delivered | Check `Job Bot` credential token is valid; re-enter if expired |
| Skip button logs wrong row | `Raw URL` column must be populated — check node 16 output |
| Merge 22 hangs forever | One of email/telegram paths is failing silently — check `continueOnFail` is enabled on nodes 20c, 21b, 21c |
