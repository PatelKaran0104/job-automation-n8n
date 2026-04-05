# Resume Generator — Pipeline Guide

Automated job application pipeline: scrapes 5 job boards daily → AI match filter → AI resume/cover letter tailoring → PDF generation → Google Sheets logging.

---

## Architecture Overview

```
Schedule Trigger (Mon–Fri 8am)
          ↓
1. Job Search URLs (set node — all URLs + jobCount)
          ↓ (parallel)
┌──────────────────────────────────────────────────────────────────┐
│ 2a. Scrape LinkedIn │ 2b. Scrape Indeed │ 2c. Scrape StepStone  │
│ 2d. Scrape Glassdoor │ 2e. Scrape Xing  │  2f. Read Applied Jobs │
│ (Apify actors, each scrapes ~50 jobs)   │  (Google Sheets)       │
└──────────────────────────┬─────────────────────┬────────────────-┘
                           ↓                     ↓
               3. Wait for All Scrapers   2f.1. Ensure Not Empty
                           ↓                     ↓
               4. Normalize & Merge Jobs          │
                  BOARD_CONFIG adapter            │
                  Dedup by URL · DE/AT/CH/NL/BE   │
                           ↓                     ↓
                     5. Sync Jobs + Sheet ←───────┘
                           ↓
                     6. Filter Duplicates (remove already-logged jobs)
                           ↓
                     7. GET Resume Context (fetch /context)
                           ↓
                     8. Attach Resume to Jobs
                           ↓
                     9. Loop Over Items + 10c. Wait (batchSize 5, 12s)
                           ↓
             10a. Build Match Prompt → 10b. Groq API Call
                match filter (llama-3.1-8b-instant)
                       ↓
             11. Parse Match Result → 12. Is Match?
             ↓ true                              ↓ false
   13a. Build Tailor Prompt              18a. Prepare Skip Log
             ↓                                   ↓
   13b. OpenAI API Call (gpt-4o-mini)   18b. Log Skipped to Sheets
             ↓
   14. Parse AI Patch
             ↓ (parallel)
   15a. POST /generate-resume    15b. POST /generate-coverletter
             ↓
   16. Prepare Sheet Log
             ↓
   17. Log to Google Sheets
```

---

## Running the Local Server

```bash
# Install dependencies (first time only)
npm install

# Start server on port 3000
npm start

# Manual test — resume PDF
npm test

# Manual test — cover letter PDF
npm run test:coverletter
```

Server must be running for the n8n workflow to call `/context` and `/generate-resume`.

---

## API Endpoints

### `GET /context`
Returns base resume as plain text. The n8n workflow calls this once per run to attach resume context to each job.

```json
{
  "currentJobTitle": "Salesforce Developer",
  "currentProfile": "plain text...",
  "currentWork": [
    { "id": "286ca64e-...", "employer": "MV Clouds", "jobTitle": "Salesforce Developer",
      "location": "...", "startDate": "02/2023", "endDate": "04/2025", "description": "plain text" }
  ],
  "currentSkills": [
    { "id": "9a905d12-...", "skill": "Salesforce Development", "details": "plain text" }
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
    "work": [{ "id": "must match /context id", "description": "<ul><li><p>...</p></li></ul>" }],
    "skills": [{ "id": "must match /context id", "infoHtml": "<p>HTML</p>" }]
  },
  "company": "SAP SE"
}
```

Response example:
`{ "success": true, "file": "D:\\KARAN\\output\\2026-04-03\\Resume\\resume-sap-se.pdf", "fileName": "resume-sap-se.pdf" }`

> `patch` can also be passed flat at the top level — the server handles both.

---

### `POST /generate-coverletter`
Renders a German cover letter PDF from 3 HTML paragraphs.

```json
{
  "role": "Salesforce Developer",
  "company": "SAP SE",
  "companyAddress": "Walldorf, Deutschland",
  "paragraph1": "Opening hook (HTML or plain text)",
  "paragraph2": "Skills/experience evidence",
  "paragraph3": "Availability + CTA"
}
```

Response example:
`{ "success": true, "file": "D:\\KARAN\\output\\2026-04-03\\Coverletter\\coverletter-sap-se.pdf", "fileName": "coverletter-sap-se.pdf" }`

---

## n8n Workflow

**File:** `data/Job_Application_Automator_v6.json` — import into n8n to deploy.

**URL in n8n nodes:** `http://host.docker.internal:3000` (Docker internal networking).
If running n8n natively (not Docker), change to `http://localhost:3000`.

**Environment variables required in n8n:**
- `GROQ_API_KEY` — for the match filter node (free tier)
- `OPENAI_API_KEY` — for the tailor prompt node

**Credentials required in n8n:**
- `groqApi` — Groq API credential
- `openAiApi` — OpenAI API credential
- Google Sheets OAuth credential

**To activate:** set `"active": true` in the workflow JSON or toggle in n8n UI.

---

## Job Board Adapter (Node: "3. Normalize & Merge Jobs")

All 5 scrapers output different schemas. The `BOARD_CONFIG` object in the normalize Code node maps each scraper's fields to a unified schema:

| Source | n8n Node | Key field notes |
|--------|----------|-----------------|
| LinkedIn | `2a. Scrape LinkedIn` | `companyName`, `descriptionText`, `link` |
| Indeed | `2b. Scrape Indeed` | `employer.name`, `description.text`, `location.countryCode` |
| StepStone | `2c. Scrape StepStone` | `company_details.company_name`, `content_details.full_description` |
| Glassdoor | `2d. Scrape Glassdoor` | `company.companyName`, `description_text`, country=null (de-only) |
| Xing | `2e. Scrape Xing` | `apply_url`, `location_country_code`, salary already formatted string |

To add a new board: add one entry to `BOARD_CONFIG` and wire its Apify node into `3. Wait for All Scrapers`. Nothing else changes.

---

## Google Sheets Schema

Each logged job (match or skip) writes 17 columns:

| Column | Source |
|--------|--------|
| Date | timestamp |
| Company | normalized job |
| Role | normalized job |
| Job Type | Groq match result (internship/werkstudent/full-time/contract) |
| Location | normalized job |
| Source | board name (LinkedIn/Indeed/StepStone/Glassdoor/Xing) |
| Job URL | normalized job |
| Apply URL | normalized job |
| Match Confidence | Groq 0–100 score |
| Match Reason | Groq one-line reason |
| Resume File | absolute path to generated PDF (success) or empty (skip) |
| Cover Letter File | absolute path to generated cover letter PDF (success) or empty (skip) |
| Status | `Generated` / `PDF Failed` / `Skipped - No Match` |
| Applied | manual column (default `No` / `N/A`) |
| Response | manual column |
| Interview | manual column |
| Notes | AI parse error message if any |

---

## File Reference

```
d:\KARAN\
├── .claude/
│   └── CLAUDE.md               ← Codebase guidance for Claude Code
├── src/
│   ├── server.js               ← Express server (all 3 endpoints)
│   ├── buildResumeHtml.js      ← Renders resume JSON → full HTML page
│   ├── mergePatch.js           ← Merges AI patch into base JSON
│   ├── validatePatch.js        ← Validates AI patch shape and IDs before apply
│   ├── mergeCoverLetter.js     ← Builds cover letter HTML (pure JS builder)
│   └── loadFonts.js            ← Embeds Source Serif Pro WOFF2 as base64
├── data/
│   ├── resume.json             ← Base resume, source of truth — never modified at runtime
│   └── Job_Application_Automator_v6.json  ← n8n workflow (import into n8n)
├── scripts/
│   ├── test.js                 ← Manual test: hits /generate-resume with hardcoded patch
│   └── test-coverletter.js     ← Manual test: hits /generate-coverletter with sample data
├── output/                     ← Generated PDFs organized as YYYY-MM-DD/Resume and YYYY-MM-DD/Coverletter
├── package.json
└── PIPELINE.md                 ← This file
```

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `EADDRINUSE: port 3000` | Kill existing server process and restart |
| PDF not in `/output` | Restart server after any code change |
| Fonts missing in PDF | `npm install` to restore `@fontsource/source-serif-pro` |
| HTML layout broken | Check `buildResumeHtml.js` — likely a resume JSON schema mismatch |
| n8n can't reach server | Change URL from `host.docker.internal` to `localhost` if not on Docker |
| Groq/OpenAI 429 | Smart throttle will slow down automatically; wait for cooldown |
| No jobs after normalize | Check Apify actor outputs match BOARD_CONFIG field names |
