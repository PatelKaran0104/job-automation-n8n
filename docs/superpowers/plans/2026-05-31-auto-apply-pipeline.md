# Auto-Apply Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two parallel sub-pipelines (recruiter email outreach via Apollo.io + Gmail, and Telegram job-card notification) that fire automatically for every job with AI confidence ≥ 75, with a Skip callback that logs to Google Sheets.

**Architecture:** A new IF branch is inserted after node 15c (Wait for PDFs) in the main n8n workflow. High-confidence jobs fan out to an email path (Apollo.io lookup → OpenAI draft → Gmail send) and a Telegram path (job card + quick-fill card), then merge back into the existing node 16 sheet log. A separate n8n workflow handles the Telegram Skip callback.

**Tech Stack:** n8n (HTTP Request, Gmail, Telegram, OpenAI, Google Sheets nodes), Apollo.io People Search API (free tier), Telegram Bot API, Google Gmail API (OAuth).

---

## File Structure

| File | Change |
|---|---|
| `data/Job_Application_Automator_v6.json` | Add ~12 nodes; export as v7 at end |
| `data/Telegram_Skip_Callback_v1.json` | Create — new n8n workflow for Skip handling |

No changes to `src/` or the Express server.

---

## Background: n8n Conventions Used in This Plan

- **Execute Node:** Right-click any node in the n8n canvas → *Execute Node* — runs just that node using the last output from its upstream as input. Use this to verify each node before wiring it into the full flow.
- **Pinned data:** You can pin test data on any node — paste JSON, then *Execute Node* downstream nodes against it.
- **Function node:** Runs sandboxed JavaScript. Has access to `$json` (current item data), `$items()` (all items). Must return an array: `return [{ json: { ...data } }]`.
- **Merge node mode "Wait":** Collects inputs from all connected upstream branches before passing data downstream. Used to join parallel paths.
- After all nodes are added, export the workflow: *≡ menu → Download* → replace `data/Job_Application_Automator_v6.json` with the exported file and rename to `v7`.

---

## Task 1: Set Up Credentials in n8n

**Files:** n8n UI only — no file changes until Task 9 export.

### 1a — Apollo.io API Key

- [ ] Sign up at [apollo.io](https://app.apollo.io) (free tier, 50 people exports/month).
- [ ] Settings → API Keys → copy your API key.
- [ ] In n8n: *Credentials → Add Credential → Header Auth*.
  - Name: `Apollo API Key`
  - Name: `x-api-key`
  - Value: `<your Apollo key>`
- [ ] Save.

### 1b — Telegram Bot

- [ ] In n8n: *Credentials → Add Credential → Telegram API*.
  - Name: `Job Bot`
  - Access Token: `<your new bot token>`
- [ ] Save.
- [ ] Verify: open Telegram, send `/start` to your bot — confirm message appears.

### 1c — Gmail OAuth

- [ ] In n8n: *Credentials → Add Credential → Gmail OAuth2*.
- [ ] Follow n8n's Google OAuth setup wizard (requires Google Cloud project with Gmail API enabled).
  - Scopes needed: `gmail.send`
- [ ] Authorize with `khpatel0104@gmail.com`.
- [ ] Name the credential: `Karan Gmail`.

---

## Task 2: Add Confidence Branch + Merge to Main Workflow

**Files:** `data/Job_Application_Automator_v6.json` (edit in n8n UI)

This task rewires the end of the loop: after node 15c, high-confidence jobs fork into two parallel paths and rejoin before node 16.

- [ ] Open `Job_Application_Automator_v6` in the n8n editor.

- [ ] **Add IF node** — drag from node palette, name it `Branch: High Confidence?`.
  - Connect: `15c. Wait for PDFs` → `Branch: High Confidence?`
  - Condition:
    ```
    Value 1: {{ $json.confidence }}
    Operation: ≥
    Value 2: 75
    ```

- [ ] **Add Merge node** — name it `22. Merge Auto-Apply Paths`, mode: **Wait**.
  - This node will receive inputs from the end of the email path AND the telegram path.
  - Connect: `22. Merge Auto-Apply Paths` → `16. Prepare Sheet Log`
  - Disconnect the existing wire from `15c` → `16` (it now routes through the branch).

- [ ] **Wire false path:**
  - Connect: `Branch: High Confidence?` (false output) → `16. Prepare Sheet Log` directly.
  - This preserves today's behavior for sub-75 jobs — they skip both new sub-pipelines.

- [ ] **Test the branch:**
  - Right-click `15c. Wait for PDFs` → *Pin data* → paste:
    ```json
    [{ "json": { "confidence": 80, "company": "TestCo", "role": "Dev", "jobId": "test-001" } }]
    ```
  - Execute `Branch: High Confidence?` → verify true output fires with confidence=80.
  - Change pinned confidence to `60` → verify false output fires.

- [ ] Commit the intermediate state (export workflow, save as `data/Job_Application_Automator_v6.json` temporarily — final export at Task 9):
  ```bash
  git add data/
  git commit -m "wip: add confidence branch scaffold (tasks 2-8 in progress)"
  ```

---

## Task 3: Email Path — Apollo.io People Search (nodes 19a, 19b, 19c)

**Files:** n8n UI only.

These three nodes find a recruiter email for the company. They connect to the **true** output of `Branch: High Confidence?`.

### Node 19a — Build Apollo Search Payload (Function node)

- [ ] Add a **Function** node, name: `19a. Build Apollo Payload`.
  - Connect: `Branch: High Confidence?` (true) → `19a. Build Apollo Payload`
  - Code:
    ```javascript
    const company = $json.company || "";
    const role = $json.role || "";

    return [{
      json: {
        ...$json,
        apolloPayload: {
          q_organization_name: company,
          person_titles: ["recruiter", "talent acquisition", "HR manager", "head of HR", "personal"],
          per_page: 1
        }
      }
    }];
    ```

- [ ] **Test:** Pin the test data from Task 2 on `Branch: High Confidence?`, then Execute `19a. Build Apollo Payload`. Verify `apolloPayload` appears in output with `q_organization_name: "TestCo"`.

### Node 19b — Apollo.io HTTP Request

- [ ] Add an **HTTP Request** node, name: `19b. Apollo People Search`.
  - Connect: `19a. Build Apollo Payload` → `19b. Apollo People Search`
  - Method: `POST`
  - URL: `https://api.apollo.io/api/v1/mixed_people/search`
  - Authentication: *Predefined Credential Type* → select `Apollo API Key`
  - Body: *JSON*
    ```json
    {{ $json.apolloPayload }}
    ```
  - Options → *Continue On Fail*: enabled (so a 429/500 doesn't kill the run)

- [ ] **Test:** Execute `19b. Apollo People Search` with TestCo pinned. If Apollo returns no results for "TestCo", that's expected — the IF in 19c will route around it. Verify the HTTP call succeeds (200) and `people` array is present (even if empty).

### Node 19c — Extract Email IF (Function node + IF node)

- [ ] Add a **Function** node, name: `19c. Extract HR Email`.
  - Connect: `19b. Apollo People Search` → `19c. Extract HR Email`
  - Code:
    ```javascript
    const people = $json.people || [];
    const person = people.find(p => p.email) || null;
    const hrEmail = person ? person.email : null;
    const hrName = person ? `${person.first_name || ""} ${person.last_name || ""}`.trim() : null;

    return [{
      json: {
        ...$json,
        hrEmail,
        hrName,
        emailSent: false
      }
    }];
    ```

- [ ] Add an **IF** node, name: `19c1. Has Recruiter Email?`.
  - Connect: `19c. Extract HR Email` → `19c1. Has Recruiter Email?`
  - Condition:
    ```
    Value 1: {{ $json.hrEmail }}
    Operation: Is Not Empty
    ```

- [ ] **Add a passthrough for the false path** — do NOT connect `19c1` false directly to the Merge node. The Merge's Wait mode expects all connected inputs to fire every time; if you wire both `20d` (email sent) and `19c1 false` (no email) to the Merge, it will deadlock whenever one path fires but not the other.

  Instead, add a **Function** node, name: `20e. No Email Passthrough`.
  - Connect: `19c1. Has Recruiter Email?` (false output) → `20e. No Email Passthrough`
  - Code:
    ```javascript
    return [{ json: { ...$json, emailSent: false, hrEmail: null } }];
    ```
  - Connect: `20e. No Email Passthrough` → `22. Merge Auto-Apply Paths`
  - Connect: `20d. Mark Email Sent` → `22. Merge Auto-Apply Paths`
  
  Now the Merge receives exactly **2 inputs**: one from the email path (either `20d` or `20e`) and one from the Telegram path (`21d`). It will always fire correctly.

- [ ] **Test:** Pin data with `people: []` on `19b`, Execute `19c. Extract HR Email` → verify `hrEmail: null`. Execute `19c1. Has Recruiter Email?` → verify false output fires.

---

## Task 4: Email Path — OpenAI Draft + Gmail Send (nodes 20a, 20b)

**Files:** n8n UI only.

These nodes draft and send the outreach email with both PDFs attached.

### Node 20a — Fetch Resume PDF as Binary

n8n's Gmail node requires binary data for attachments. The Express server exposes PDFs via `/files/`. This node converts the file path from node 15a's response into a fetchable URL, then downloads it.

- [ ] Add a **Function** node, name: `20a. Build PDF URLs`.
  - Connect: `19c1. Has Recruiter Email?` (true output) → `20a. Build PDF URLs`
  - Code:
    ```javascript
    const serverBase = "http://host.docker.internal:3000";
    // Node 15a response is in resumeFile, 15b in coverLetterFile
    // The merge node 15c combines both — access via $json
    const resumeFile = $json.resumeFile || $json.file || "";
    const coverLetterFile = $json.coverLetterFile || "";

    // Convert absolute Windows path to URL path
    // e.g. "C:\KARAN\output\2026-05-31\Resume\resume-..." → "/files/2026-05-31/Resume/resume-..."
    function toFileUrl(absPath) {
      const rel = absPath.replace(/.*output[\\/]/, "").replace(/\\/g, "/");
      return `${serverBase}/files/${rel}`;
    }

    return [{
      json: {
        ...$json,
        resumePdfUrl: toFileUrl(resumeFile),
        coverLetterPdfUrl: toFileUrl(coverLetterFile),
      }
    }];
    ```

  > **Note:** The exact field names (`resumeFile`, `coverLetterFile`) depend on how node 15c's Merge node exposes the two parallel PDF responses. Check the actual output of 15c in a live run — adjust field names if needed.

- [ ] Add an **HTTP Request** node, name: `20a1. Fetch Resume PDF`.
  - Connect: `20a. Build PDF URLs` → `20a1. Fetch Resume PDF`
  - Method: `GET`
  - URL: `{{ $json.resumePdfUrl }}`
  - Response Format: *File*
  - Put Output in Field: `resumeBinary`

- [ ] Add an **HTTP Request** node, name: `20a2. Fetch Cover Letter PDF`.
  - Connect: `20a1. Fetch Resume PDF` → `20a2. Fetch Cover Letter PDF`
  - Method: `GET`
  - URL: `{{ $json.coverLetterPdfUrl }}`
  - Response Format: *File*
  - Put Output in Field: `coverLetterBinary`

### Node 20b — OpenAI: Draft Outreach Email

- [ ] Add an **OpenAI** node, name: `20b. Draft Outreach Email`.
  - Connect: `20a2. Fetch Cover Letter PDF` → `20b. Draft Outreach Email`
  - Resource: *Chat*
  - Model: `gpt-4o-mini`
  - System prompt:
    ```
    You write short job application outreach emails. Write in {{ $json.language === "en" ? "English" : "German" }}.
    Output ONLY the email body — no subject line, no greeting label, no sign-off. Just the 3-sentence paragraph.
    Be specific: mention the exact role and one concrete skill match from the job description.
    Max 60 words.
    ```
  - User message:
    ```
    Role: {{ $json.role }}
    Company: {{ $json.company }}
    Job description excerpt: {{ ($json.description || "").slice(0, 400) }}
    ```

- [ ] Add a **Function** node, name: `20b1. Build Email Payload`.
  - Connect: `20b. Draft Outreach Email` → `20b1. Build Email Payload`
  - Code:
    ```javascript
    const lang = $json.language || "de";
    const role = $json.role || "";
    const company = $json.company || "";
    const body = $json.message?.content || $json.choices?.[0]?.message?.content || "";

    const isDE = lang !== "en";
    const subject = isDE
      ? `Bewerbung als ${role} – Karan Patel`
      : `Application for ${role} – Karan Patel`;

    const greeting = isDE ? "Sehr geehrte Damen und Herren," : "Dear Hiring Manager,";
    const closing = isDE ? "Mit freundlichen Grüßen,\nKaran Patel" : "Kind regards,\nKaran Patel";

    const fullBody = `${greeting}\n\n${body}\n\n${closing}`;

    return [{
      json: {
        ...$json,
        emailSubject: subject,
        emailBody: fullBody,
      }
    }];
    ```

### Node 20c — Gmail Send with PDF Attachments

- [ ] Add a **Gmail** node, name: `20c. Send Outreach Email`.
  - Connect: `20b1. Build Email Payload` → `20c. Send Outreach Email`
  - Credential: `Karan Gmail`
  - Resource: *Message* → Operation: *Send*
  - To: `{{ $json.hrEmail }}`
  - Subject: `{{ $json.emailSubject }}`
  - Message: `{{ $json.emailBody }}`
  - Additional Fields → *Attachments*:
    - Attachment 1: binary field `resumeBinary`, filename `Resume_Karan_Patel.pdf`
    - Attachment 2: binary field `coverLetterBinary`, filename `CoverLetter_Karan_Patel.pdf`

- [ ] Add a **Function** node, name: `20d. Mark Email Sent`.
  - Connect: `20c. Send Outreach Email` → `20d. Mark Email Sent`
  - Code:
    ```javascript
    return [{ json: { ...$json, emailSent: true } }];
    ```
  - Connect: `20d. Mark Email Sent` → `22. Merge Auto-Apply Paths`

- [ ] **Test end-to-end (dry run):** Temporarily change `hrEmail` in pinned data to your own email address. Execute from `20b. Draft Outreach Email` through `20c. Send Outreach Email`. Verify the email arrives at your inbox with both PDFs attached and German/English body correct.

- [ ] Restore `hrEmail` to the Apollo-provided value. Commit:
  ```bash
  git add data/
  git commit -m "wip: email sub-pipeline nodes 19a-20d (apollo + gmail)"
  ```

---

## Task 5: Telegram Path — Personal Details + Job Card (node 21a)

**Files:** n8n UI only.

The Telegram path starts from the **true** output of `Branch: High Confidence?` — it runs in parallel with the email path (both connected to the same true output).

### Node 21a — Set Personal Details

- [ ] Add a **Set** node, name: `21a. Personal Details`.
  - Connect: `Branch: High Confidence?` (true) → `21a. Personal Details` *(second connection from true output)*
  - Fields to set:
    | Name | Type | Value |
    |---|---|---|
    | `pd_name` | String | `Karan Patel` |
    | `pd_email` | String | `khpatel0104@gmail.com` |
    | `pd_phone` | String | `+49 15210894179` |
    | `pd_linkedin` | String | `linkedin.com/in/patelkaran0104/` |
    | `pd_university` | String | `Hochschule Fulda` |
    | `pd_degree` | String | `M.Sc. Global Software Development` |
    | `pd_availability` | String | `sofort / immediately` |
  - Keep All Other Fields: *enabled*

### Node 21b — Send Telegram Job Card

- [ ] Add a **Telegram** node, name: `21b. Send Job Card`.
  - Connect: `21a. Personal Details` → `21b. Send Job Card`
  - Credential: `Job Bot`
  - Resource: *Message* → Operation: *Send Message*
  - Chat ID: `923697082`
  - Text:
    ```
    🎯 New Match — {{ $json.confidence }}% confidence

    📋 {{ $json.role }}
    🏢 {{ $json.company }}
    🌐 {{ $json.board }}  |  {{ $json.language === "en" ? "🇬🇧 English" : "🇩🇪 German" }}

    {{ $json.hrEmail ? "📧 Email sent to: " + $json.hrEmail : "📧 No recruiter email found" }}
    ```
  - Additional Fields → *Reply Markup*:
    ```json
    {
      "inline_keyboard": [[
        {
          "text": "🔗 Open Application",
          "url": "{{ $json.url || $json.link || $json.applyUrl }}"
        },
        {
          "text": "❌ Skip",
          "callback_data": "skip:{{ $json.jobId }}"
        }
      ]]
    }
    ```
  - Parse Mode: `Markdown`

- [ ] **Test:** Pin test data (with `confidence: 82`, `role: "Werkstudent Dev"`, `company: "TestCo"`, `jobId: "test-001"`, `url: "https://example.com"`) on `21a. Personal Details`. Execute `21b. Send Job Card`. Check your Telegram — the card should arrive with both buttons.

---

## Task 6: Telegram Path — Quick-Fill Card (node 21c)

**Files:** n8n UI only.

- [ ] Add a **Telegram** node, name: `21c. Send Quick-Fill Card`.
  - Connect: `21b. Send Job Card` → `21c. Send Quick-Fill Card`
  - Credential: `Job Bot`
  - Chat ID: `923697082`
  - Text:
    ```
    📋 Quick-fill — {{ $json.company }}:
    Name: {{ $json.pd_name }}
    Email: {{ $json.pd_email }}
    Phone: {{ $json.pd_phone }}
    LinkedIn: {{ $json.pd_linkedin }}
    University: {{ $json.pd_university }}
    Degree: {{ $json.pd_degree }}
    Availability: {{ $json.pd_availability }}
    ```
  - Connect: `21c. Send Quick-Fill Card` → `22. Merge Auto-Apply Paths`

- [ ] **Test:** Execute `21c. Send Quick-Fill Card` with same pinned data. Verify the second Telegram message arrives with your contact details filled in.

- [ ] Commit:
  ```bash
  git add data/
  git commit -m "wip: telegram sub-pipeline nodes 21a-21c (job card + quick-fill)"
  ```

---

## Task 7: Update Node 16 — New Google Sheets Columns

**Files:** n8n UI (node 16 edit) + Google Sheets (add columns manually).

### 7a — Add columns to the Google Sheet

- [ ] Open your job log Google Sheet.
- [ ] Add these 4 columns at the end of the existing headers:
  - `Email Recipient`
  - `Email Sent`
  - `Telegram Notified`
  - `Portal Status`

### 7b — Update node 16 in n8n

- [ ] Open `16. Prepare Sheet Log` in n8n.
- [ ] Add 4 new field mappings (keep all existing ones):
  | Sheet Column | Value |
  |---|---|
  | `Email Recipient` | `{{ $json.hrEmail || "—" }}` |
  | `Email Sent` | `{{ $json.emailSent ? "yes" : "no" }}` |
  | `Telegram Notified` | `{{ $json.telegramNotified ? "yes" : "no" }}` |
  | `Portal Status` | `pending` |

- [ ] Add a **Function** node immediately before `21c. Send Quick-Fill Card` connects to the merge, name `21d. Mark Telegram Sent`:
  ```javascript
  return [{ json: { ...$json, telegramNotified: true } }];
  ```
  - Insert between `21c. Send Quick-Fill Card` and `22. Merge Auto-Apply Paths`.

- [ ] **Test:** Execute `16. Prepare Sheet Log` with pinned data including `hrEmail: "test@example.com"`, `emailSent: true`, `telegramNotified: true`. Verify new columns populate correctly in the Sheet.

- [ ] Commit:
  ```bash
  git add data/
  git commit -m "wip: update node 16 with auto-apply sheet columns"
  ```

---

## Task 8: Skip Callback Workflow (Separate n8n Workflow)

**Files:** Create `data/Telegram_Skip_Callback_v1.json`

This is a separate n8n workflow (always active) that listens for Telegram callback queries from the Skip button.

- [ ] In n8n: *New Workflow* → name it `Telegram Skip Callback`.
- [ ] Set the workflow to **Active** (toggle in top right).

### Node 1 — Telegram Trigger

- [ ] Add a **Telegram Trigger** node, name: `1. Telegram Callback Trigger`.
  - Credential: `Job Bot`
  - Updates: select `callback_query`

### Node 2 — Parse Callback Data

- [ ] Add a **Function** node, name: `2. Parse Skip Callback`.
  - Connect: `1. Telegram Callback Trigger` → `2. Parse Skip Callback`
  - Code:
    ```javascript
    const callbackData = $json.callback_query?.data || "";
    const callbackId = $json.callback_query?.id;
    const chatId = $json.callback_query?.message?.chat?.id;

    if (!callbackData.startsWith("skip:")) {
      // Not a skip callback — ignore
      return [];
    }

    const jobId = callbackData.replace("skip:", "").trim();

    return [{
      json: {
        jobId,
        callbackId,
        chatId,
      }
    }];
    ```

### Node 3 — Find Sheet Row by jobId

- [ ] Add a **Google Sheets** node, name: `3. Find Job Row`.
  - Connect: `2. Parse Skip Callback` → `3. Find Job Row`
  - Operation: *Read Rows*
  - Spreadsheet: your job log sheet
  - Sheet: your log tab
  - Filters → Column: `jobId` = `{{ $json.jobId }}`

### Node 4 — Update Portal Status

- [ ] Add a **Google Sheets** node, name: `4. Update Portal Status`.
  - Connect: `3. Find Job Row` → `4. Update Portal Status`
  - Operation: *Update Row*
  - Row Number: `{{ $json.row_number }}` (the row number returned by node 3)
  - Column: `Portal Status` → Value: `skipped`

### Node 5 — Answer Callback Query

Telegram requires answering the callback query to clear the "loading" spinner on the button.

- [ ] Add a **Set** node before the HTTP Request, name: `4b. Set Bot Token`.
  - Connect: `4. Update Portal Status` → `4b. Set Bot Token`
  - Field: `botToken` → Value: store the token as an n8n environment variable named `TELEGRAM_BOT_TOKEN` (set it in your n8n `.env` or DigitalOcean Docker env), then reference it here as `{{ $env.TELEGRAM_BOT_TOKEN }}`.
  - Keep All Other Fields: enabled.

- [ ] Add an **HTTP Request** node, name: `5. Answer Callback`.
  - Connect: `4b. Set Bot Token` → `5. Answer Callback`
  - Method: `POST`
  - URL: `https://api.telegram.org/bot{{ $json.botToken }}/answerCallbackQuery`
  - Body (JSON):
    ```json
    {
      "callback_query_id": "{{ $json.callbackId }}",
      "text": "Marked as skipped ✓"
    }
    ```

- [ ] **Test:** 
  - Run the main workflow on a test job (confidence=80) until the Telegram message arrives.
  - Tap the `❌ Skip` button.
  - In n8n, open `Telegram Skip Callback` workflow → check Executions — verify it fired.
  - Check Google Sheets — the `Portal Status` for that `jobId` should now read `skipped`.

- [ ] Export this workflow: *≡ menu → Download* → save as `data/Telegram_Skip_Callback_v1.json`.

- [ ] Commit:
  ```bash
  git add data/Telegram_Skip_Callback_v1.json
  git commit -m "feat: add telegram skip callback workflow"
  ```

---

## Task 9: Export Updated Main Workflow + End-to-End Test

**Files:** `data/Job_Application_Automator_v6.json` → rename to `v7`

### 9a — Verify full wiring

- [ ] In n8n, visually trace these paths are complete:
  - `15c` → `Branch: High Confidence?` → true → `19a` … `20d` → `22. Merge`
  - `15c` → `Branch: High Confidence?` → true → `21a` … `21d` → `22. Merge`
  - `Branch: High Confidence?` → false → `16. Prepare Sheet Log`
  - `19c1. Has Recruiter Email?` → false → `22. Merge` (email skip path)
  - `22. Merge` → `16. Prepare Sheet Log`

### 9b — Live end-to-end test (confidence=80 job)

- [ ] Temporarily lower the confidence threshold in `12. Is Match?` to `45` (already default) and the new branch to `45` to get a test job through easily.
- [ ] Run the full workflow with `jobCount: 1`.
- [ ] Verify:
  - A Telegram job card arrives within ~30 seconds of the run starting.
  - A Telegram quick-fill card arrives immediately after.
  - The "Open Application" button links to a real job URL.
  - If Apollo found an email: check `khpatel0104@gmail.com` for the outreach email with 2 PDF attachments.
  - Google Sheets new columns are populated (`Email Recipient`, `Email Sent`, `Telegram Notified`, `Portal Status: pending`).
- [ ] Restore confidence threshold to `75` in the new branch.

### 9c — Test the false path

- [ ] Temporarily set the branch threshold to `95` (so no jobs qualify).
- [ ] Run with `jobCount: 1`.
- [ ] Verify: no Telegram message arrives, no email sent, Sheets log has `Email Sent: no`, `Telegram Notified: no`.
- [ ] Restore to `75`.

### 9d — Export and commit

- [ ] Export the main workflow: *≡ menu → Download*.
- [ ] Replace `data/Job_Application_Automator_v6.json` with the export — rename to `Job_Application_Automator_v7.json`.
- [ ] Update `PIPELINE.md`: change all references from `v6` to `v7`, update node count (was 35, now ~47), add the 4 new credentials to the *Credentials required* section.

  In `PIPELINE.md`, update this section:
  ```markdown
  **File:** `data/Job_Application_Automator_v7.json` — import into n8n to deploy (~47 nodes).
  ```

  Add to the credentials list:
  ```markdown
  - `headerAuth` credential named **"Apollo API Key"** — `x-api-key` header for `api.apollo.io`
  - `telegramApi` credential named **"Job Bot"** — Telegram bot token
  - `gmailOAuth2` credential named **"Karan Gmail"** — Gmail OAuth for outreach send
  ```

  Add to the Configuration Reference table:
  ```markdown
  | Auto-apply confidence threshold | `Branch: High Confidence?` → condition value (default: `75`) |
  | Apollo.io credential | n8n Credentials → `Apollo API Key` |
  | Telegram chat ID | `21b. Send Job Card` → Chat ID field |
  ```

- [ ] Commit:
  ```bash
  git add data/Job_Application_Automator_v7.json PIPELINE.md
  git rm data/Job_Application_Automator_v6.json
  git commit -m "feat: auto-apply pipeline — Apollo email outreach + Telegram notifications for confidence ≥75 jobs

  - Apollo.io people search finds recruiter email by company name
  - OpenAI drafts language-matched outreach email; Gmail sends with PDF attachments
  - Telegram bot sends job card (inline Apply + Skip buttons) + quick-fill card
  - Skip callback workflow updates Portal Status in Google Sheets
  - ~€1-2/month additional cost on free-tier Apollo + gpt-4o-mini

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
  ```

---

## Self-Review Checklist

### Spec coverage

| Spec requirement | Covered by |
|---|---|
| Confidence ≥ 75 branch | Task 2 |
| Apollo.io email lookup | Task 3 |
| OpenAI email draft (language-matched) | Task 4, node 20b |
| Gmail send with PDF attachments | Task 4, node 20c |
| Telegram job card with inline keyboard | Task 5, node 21b |
| Telegram quick-fill card | Task 6, node 21c |
| Skip callback → Sheets update | Task 8 |
| New Google Sheets columns (4) | Task 7 |
| Apollo free tier (50/month) | Task 1, 3 — no paid plan required |
| No changes to `src/` | All tasks — n8n only |
| Merge parallel paths before node 16 | Task 2, node 22 |
| `hrEmail`, `emailSent`, `telegramNotified`, `portalStatus` fields | Tasks 3, 4, 6, 7 |

All spec requirements are covered. No gaps found.
