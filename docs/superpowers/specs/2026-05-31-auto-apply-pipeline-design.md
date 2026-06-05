# Auto-Apply Pipeline Design

**Date:** 2026-05-31
**Author:** Karan Patel
**Status:** Approved — ready for implementation planning

---

## Goal

Extend the existing n8n job application pipeline so that jobs with confidence ≥ 75 are acted on automatically after PDF generation — no manual step required. Two parallel actions fire: a cold outreach email to a real recruiter at the company, and a Telegram notification with a one-tap link to the application form.

---

## Scope

- Operates entirely within n8n — no changes to `src/` or the Express server.
- Triggers after node 15c (Wait for PDFs) in the existing workflow.
- Only applies to jobs where the AI match confidence ≥ 75 (configurable in node `1. Manual Configuration`).
- German-language jobs are the primary target; English jobs use the same logic with language toggled.

Out of scope:
- Automated form submission (user completes the portal application themselves).
- WhatsApp integration.
- Any changes to resume/cover letter generation logic.

---

## Architecture

```
15c. Wait for PDFs
        ↓
[NEW] Branch: confidence ≥ 75?
        ↓ yes                         ↓ no
[NEW] Parallel:               → node 16 (existing sheet log path)
  ├── EMAIL PATH
  └── TELEGRAM PATH
        ↓ both complete
[UPDATED] node 16 → node 17 (with new sheet columns)
```

---

## Sub-pipeline 1 — Email Outreach

For each high-confidence job, find a real recruiter/HR contact at the company and send a short personalized email with both PDFs attached. The goal is to land in an inbox directly, bypassing ATS screeners.

### Node sequence

| Node | Type | Action |
|---|---|---|
| 19a. Extract Company Domain | Function | Parse domain from job URL or company name field |
| 19b. Apollo.io Email Finder | HTTP Request | `POST https://api.apollo.io/api/v1/mixed_people/search` — search by company domain + job title filter (`recruiter`, `HR`, `talent`) |
| 19c. Has Email? | IF | `hrEmail` is not empty |
| 20a. Build Outreach Email | OpenAI (gpt-4o-mini) | Draft a 4-line email: subject + 3 sentences + sign-off. Language matches `job.language`. Must reference role title and one tailored detail from the job description. |
| 20b. Send Gmail | Gmail node | To: `hrEmail`. Subject from AI. Body from AI. Attachments: resume PDF + cover letter PDF (loaded as binary from file paths already in the job object). |

### Email format (German, `language: "de"`)

```
Betreff: Bewerbung als [role] – Karan Patel

Sehr geehrte Damen und Herren,

ich bewerbe mich für Ihre ausgeschriebene Stelle als [role]. Als Salesforce-Entwickler
mit 2 Jahren Erfahrung und Studierender der Global Software Development an der
Hochschule Fulda bringe ich [one tailored sentence from AI]. Meine vollständigen
Unterlagen finden Sie im Anhang.

Mit freundlichen Grüßen,
Karan Patel
```

### Email format (English, `language: "en"`)

```
Subject: Application for [role] – Karan Patel

Dear Hiring Manager,

I'm applying for the [role] position at [company]. As a Salesforce Developer with
2 years of experience and a M.Sc. in Global Software Development at Hochschule
Fulda, I bring [one tailored sentence from AI]. Please find my documents attached.

Kind regards,
Karan Patel
```

### Fallback chain

1. Apollo.io returns a contact → use it
2. Apollo returns nothing → skip email path silently, set `emailSent: false`

No pattern-guessing or secondary verifier in v1 — keep it simple. Can be added later if Apollo hit rate is low.

### Apollo.io setup

- Free tier: 50 email exports/month — sufficient for ≥75 confidence jobs per run.
- Auth: API key stored in n8n HTTP Request node credentials.
- Rate limit: 1 request/second — no throttle node needed at this volume.

---

## Sub-pipeline 2 — Telegram Notification

For each high-confidence job, send two Telegram messages to the user's personal chat. No Playwright, no form pre-filling — the value is instant notification + one-tap access to the form + a pre-formatted data card to fill from.

### Bot config

| Parameter | Value |
|---|---|
| Bot token | Store in n8n Telegram credential (never in code or docs) |
| Chat ID | `923697082` |

### Message 1 — Job card

Sent via n8n Telegram node with inline keyboard.

```
🎯 New Match — {confidence}% confidence

📋 {role}
🏢 {company}
🌐 {board}  |  {flag} {language}

📧 Email sent to: {hrEmail}
   (or: No recruiter email found)
```

Inline keyboard:
- `🔗 Open Application` → URL button → `job.applicationUrl`
- `❌ Skip` → callback button → data: `skip:{jobId}`

### Message 2 — Quick-fill card

Sent immediately after Message 1, plain text.

```
📋 Quick-fill — {company}:
Name: Karan Patel
Email: khpatel0104@gmail.com
Phone: {resume.personalDetails.phone}
LinkedIn: {resume.personalDetails.linkedIn}
University: Hochschule Fulda
Degree: M.Sc. Global Software Development
Availability: sofort / immediately
```

Values are read from `resume.json → personalDetails` at runtime by the n8n Function node — same source as the `/context` endpoint. No hardcoding in the workflow.

### Skip callback workflow

A **separate n8n workflow** with a Telegram Trigger node listens for callback queries where `data` starts with `skip:`. On receipt:

1. Parse `jobId` from callback data.
2. Find the matching row in Google Sheets by `jobId`.
3. Set `Portal Status` column to `skipped`.
4. Answer the callback (required by Telegram API to clear the loading state on the button).

---

## Google Sheets — New Columns

Added to the existing log sheet, populated during node 16 (Prepare Sheet Log):

| Column | Type | Values |
|---|---|---|
| Email Recipient | String | HR email address, or `—` |
| Email Sent | Boolean | `yes` / `no` |
| Telegram Notified | Boolean | `yes` / `no` |
| Portal Status | String | `pending` / `skipped` / `applied` |

`applied` is set manually by the user after completing a portal application. `pending` is the default for all auto-apply jobs. `skipped` is set by the Telegram callback workflow.

---

## n8n Job Object — New Fields

Carried through the job object from the confidence branch onward:

| Field | Type | Source |
|---|---|---|
| `hrEmail` | String \| null | Apollo.io node 19b |
| `emailSent` | Boolean | Gmail node 20b |
| `telegramNotified` | Boolean | Telegram node 21a |
| `portalStatus` | String | Default `"pending"` at branch; updated to `"skipped"` via callback workflow |

---

## Cost Summary

| Item | Monthly cost |
|---|---|
| Apollo.io (free tier, 50 lookups) | €0 |
| OpenAI email drafting (gpt-4o-mini, ~500 tokens/email) | ~€1–2 |
| Gmail API | Free |
| Telegram Bot API | Free |
| n8n (self-hosted on existing DigitalOcean droplet) | €0 additional |
| **Total** | **~€1–2/month** |

---

## Dev Effort

| Task | Effort |
|---|---|
| Apollo.io HTTP Request node + credential | 0.5 days |
| OpenAI outreach email drafting node | 0.5 days |
| Gmail send node + binary PDF attachment | 1 day |
| Telegram job card node (inline keyboard) | 0.5 days |
| Telegram quick-fill card node | 0.5 days |
| Telegram Trigger callback workflow (Skip) | 0.5 days |
| Google Sheets new columns + log update | 0.5 days |
| End-to-end testing (dry-run mode first) | 1 day |
| **Total** | **~5 days** |

---

## Risks & Constraints

| Risk | Mitigation |
|---|---|
| Apollo.io returns no email for a company | Skip email path silently — Telegram notification still fires |
| Gmail send fails (quota, auth) | Log error to Sheets, Telegram still fires |
| Telegram message delivery fails | Log error to Sheets; no retry in v1 |
| PDF binary loading in n8n fails for attachment | Test with one job first; file paths already in job object from nodes 15a/15b |
| Apollo free tier exhausted mid-run | Apollo returns 429; IF node treats as "no email found" and skips gracefully |

---

## Out of Scope for v1

- Automated portal form submission
- CAPTCHA solving
- Session-based Playwright form pre-filling
- WhatsApp integration
- Multiple Telegram chat IDs / team notifications
- Email deduplication guard (same company, multiple runs) — add in v2 if needed
