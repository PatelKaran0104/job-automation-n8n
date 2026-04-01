# Resume Generator — Pipeline Guide

Automated job application pipeline: scrapes 5 job boards daily → AI match filter → AI resume/cover letter tailoring → PDF generation → Google Sheets logging.

---

## Architecture Overview

```
Schedule Trigger (Mon–Fri 8am)
          ↓
1. Job Search URLs (set node — all URLs + jobCount)
          ↓ (parallel)
┌─────────────────────────────────────────────────────┐
│  LinkedIn │ Indeed │ StepStone │ Glassdoor │ Xing   │
│  (Apify actors, each scrapes ~50 jobs)              │
└──────────────────────┬──────────────────────────────┘
                       ↓
          2c. Wait for All Scrapers (merge)
                       ↓
          3. Normalize & Merge Jobs (Code node)
             BOARD_CONFIG adapter — 5 sources → 1 schema
             Dedup by URL · Country filter: DE/AT/CH/NL/BE
                       ↓
          6a. Read Applied Jobs (Google Sheets)
                       ↓
          6b. Filter Duplicates (remove already-logged jobs)
                       ↓
          4. GET /context (fetch resume as plain text)
                       ↓
          5. Attach Resume to Jobs
                       ↓
          6. Smart Throttle (7s base / 20s on rate limit)
                       ↓
          7. Groq API — match filter (llama-3.1-8b-instant)
             match:true / match:false
             ↓ true                    ↓ false
    10. OpenAI API              15. Prepare Skip Log
    (gpt-4o-mini — patch           ↓
     + cover letter)        16. Log Skipped to Sheets
          ↓
    11. Parse AI Patch
          ↓
    12. POST /generate-resume (PDF)
          ↓
    13. Prepare Sheet Log
          ↓
    14. Log to Google Sheets
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

Response: `{ "success": true, "file": "D:\\KARAN\\output\\resume-sap-se.pdf" }`

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

Response: `{ "success": true, "file": "D:\\KARAN\\output\\coverletter-sap-se.pdf" }`

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
| LinkedIn | `Run an Actor and get dataset` | `companyName`, `descriptionText`, `link` |
| Indeed | `Run an Actor and get dataset1` | `employer.name`, `description.text`, `location.countryCode` |
| StepStone | `Run an Actor and get dataset2` | `company_details.company_name`, `content_details.full_description` |
| Glassdoor | `Run an Actor and get dataset3` | `company.companyName`, `description_text`, country=null (de-only) |
| Xing | `Run an Actor and get dataset4` | `apply_url`, `location_country_code`, salary already formatted string |

To add a new board: add one entry to `BOARD_CONFIG` and wire its Apify node into `2c. Wait for All Scrapers`. Nothing else changes.

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
| Cover Letter | AI-generated plain text (success) or empty (skip) |
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
│   ├── mergeCoverLetter.js     ← Builds cover letter HTML (pure JS builder)
│   └── loadFonts.js            ← Embeds Source Serif Pro WOFF2 as base64
├── data/
│   ├── resume.json             ← Base resume, source of truth — never modified at runtime
│   └── Job_Application_Automator_v6.json  ← n8n workflow (import into n8n)
├── scripts/
│   ├── test.js                 ← Manual test: hits /generate-resume with hardcoded patch
│   └── test-coverletter.js     ← Manual test: hits /generate-coverletter with sample data
├── output/                     ← Generated PDFs land here (git-ignored)
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
