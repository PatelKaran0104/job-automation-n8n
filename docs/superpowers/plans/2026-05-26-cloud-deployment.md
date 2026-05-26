# Cloud Deployment — Oracle Free Tier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Host the Node.js/Playwright resume server and n8n workflow on Oracle Cloud Free Tier so the pipeline runs automatically at 5 AM daily and PDF download links appear as clickable hyperlinks in the existing Google Sheet.

**Architecture:** Add a `Dockerfile` to containerize the Express/Playwright app, update `docker-compose.yml` to run both containers on the same Docker network (so n8n calls `http://resume-server:3000` instead of `host.docker.internal`), add a `/files` static endpoint to serve generated PDFs over HTTP, and update the n8n workflow to use a Schedule Trigger and write clickable hyperlinks.

**Tech Stack:** Docker Compose, Node.js 20 on `node:20-bookworm-slim`, Playwright Chromium (ARM64-compatible via `npx playwright install --with-deps`), n8n self-hosted, Oracle Cloud ARM VM (Ubuntu 22.04)

---

## Files

| Action | File | What changes |
|--------|------|--------------|
| Create | `Dockerfile` | Containerize the Express/Playwright app |
| Modify | `docker-compose.yml` | Add `resume-server` service; harden n8n config |
| Create | `.env.example` | Template for all required env vars |
| Modify | `src/server.js` | Add `/files` static endpoint; add `url` field to both PDF responses |
| Modify | `data/Job_Application_Automator_v6.json` | Schedule trigger; 3 URL fixes; node-16 hyperlinks |

---

## Task 1: Dockerfile

**Files:**
- Create: `Dockerfile`

- [ ] **Step 1: Create the Dockerfile**

```dockerfile
FROM node:20-bookworm-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci
RUN npx playwright install --with-deps chromium

COPY . .
EXPOSE 3000
CMD ["node", "src/server.js"]
```

`npx playwright install --with-deps chromium` downloads the Playwright-bundled Chromium binary for the current CPU architecture (AMD64 or ARM64) and installs its system dependencies. This is the only approach that works on Oracle's Ampere ARM instances without switching to a system Chromium.

- [ ] **Step 2: Verify the file exists**

```bash
ls -la Dockerfile
```
Expected: `Dockerfile` visible.

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "feat: add Dockerfile for Node.js/Playwright container"
```

---

## Task 2: docker-compose.yml

**Files:**
- Modify: `docker-compose.yml`

Current file only has `n8n`. Needs a `resume-server` service added. The `extra_hosts` / `host.docker.internal` trick is removed because the two containers can reach each other by service name (`resume-server`) on the default Compose network. The `n8n_data` external volume becomes a regular named volume (fresh server has no pre-existing volumes).

- [ ] **Step 1: Replace docker-compose.yml entirely**

```yaml
services:
  resume-server:
    build: .
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      SERVER_URL: ${SERVER_URL}
    volumes:
      - ./output:/app/output

  n8n:
    image: n8nio/n8n:latest
    restart: unless-stopped
    ports:
      - "5678:5678"
    environment:
      TZ: Europe/Berlin
      N8N_RUNNERS_ENABLED: "true"
      N8N_BASIC_AUTH_ACTIVE: "true"
      N8N_BASIC_AUTH_USER: ${N8N_USER}
      N8N_BASIC_AUTH_PASSWORD: ${N8N_PASSWORD}
      N8N_ENCRYPTION_KEY: ${N8N_ENCRYPTION_KEY}
    volumes:
      - n8n_data:/home/node/.n8n

volumes:
  n8n_data:
```

Key changes vs. the old file:
- Added `resume-server` service with bind-mount `./output:/app/output` (PDFs survive container restarts and are browsable via SSH).
- Removed `extra_hosts` — not needed when both services are on the same Compose network.
- Removed `N8N_RESTRICT_FILE_ACCESS_TO` — n8n no longer reads local PDF files.
- Changed `n8n_data: external: true` → `n8n_data:` (regular named volume — fresh server).
- Added `N8N_BASIC_AUTH_*` and `N8N_ENCRYPTION_KEY` for production security.

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add resume-server to Docker Compose, harden n8n config"
```

---

## Task 3: .env.example

**Files:**
- Create: `.env.example`

- [ ] **Step 1: Create the file**

```bash
# --- Resume Server ---
# Public URL of this Oracle VM (used in PDF download links written to Google Sheets)
SERVER_URL=http://YOUR_ORACLE_PUBLIC_IP:3000

# --- n8n ---
N8N_USER=admin
N8N_PASSWORD=replace-with-a-strong-password
# Generate with: openssl rand -hex 32
N8N_ENCRYPTION_KEY=replace-with-32-char-random-hex-string
```

Note: `.env` is already in `.gitignore`. `.env.example` is explicitly excluded from the ignore rule (`!.env.example`) so it is committed safely.

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "feat: add .env.example for cloud deployment"
```

---

## Task 4: server.js — /files endpoint + url in responses

**Files:**
- Modify: `src/server.js`

Three changes:
1. Add `relative` to the `path` import.
2. After `OUTPUT_DIR` is set, add the static file server and a `SERVER_URL` constant.
3. Add a `buildFileUrl` helper and call it in both `generate-resume` and `generate-coverletter` responses.

- [ ] **Step 1: Add `relative` to the path import (line 4)**

Old:
```javascript
import { resolve } from "path";
```
New:
```javascript
import { resolve, relative } from "path";
```

- [ ] **Step 2: Add static file server and SERVER_URL constant after line 13 (`mkdirSync(OUTPUT_DIR, ...)`)**

Insert after line 13:
```javascript
const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";
app.use("/files", express.static(OUTPUT_DIR));

function buildFileUrl(fullPath) {
  const rel = relative(OUTPUT_DIR, fullPath).replace(/\\/g, "/");
  return `${SERVER_URL}/files/${rel}`;
}
```

- [ ] **Step 3: Add `url` field to the generate-resume response (currently line 175)**

Old:
```javascript
    const result = { success: true, file: output.fullPath, fileName: output.fileName };
    if (jobId) result.jobId = jobId;
    res.json(result);
```
New:
```javascript
    const result = { success: true, file: output.fullPath, fileName: output.fileName, url: buildFileUrl(output.fullPath) };
    if (jobId) result.jobId = jobId;
    res.json(result);
```

- [ ] **Step 4: Add `url` field to the generate-coverletter response (currently line 246)**

Old (inside the cover-letter try block):
```javascript
    const result = { success: true, file: output.fullPath, fileName: output.fileName };
    if (jobId) result.jobId = jobId;
    if (quality.severity !== "ok") {
```
New:
```javascript
    const result = { success: true, file: output.fullPath, fileName: output.fileName, url: buildFileUrl(output.fullPath) };
    if (jobId) result.jobId = jobId;
    if (quality.severity !== "ok") {
```

- [ ] **Step 5: Verify the server starts**

```bash
npm start
# Expected: "Server running on port 3000"
# Ctrl+C to stop
```

- [ ] **Step 6: Commit**

```bash
git add src/server.js
git commit -m "feat: serve PDFs via /files endpoint and return url in PDF responses"
```

---

## Task 5: n8n workflow — schedule trigger + URL fixes + node-16 hyperlinks

**Files:**
- Modify: `data/Job_Application_Automator_v6.json`

Three sub-changes in the workflow JSON:

### 5a — Replace Manual Trigger with Schedule Trigger

Find this block (starts around line 3):
```json
    {
      "parameters": {},
      "id": "6de8ad47-9ed9-462f-b403-de9bc4cd9792",
      "name": "Run Workflow",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [
        90960,
        27120
      ]
    },
```

Replace with:
```json
    {
      "parameters": {
        "rule": {
          "interval": [
            {
              "field": "cronExpression",
              "expression": "0 5 * * *"
            }
          ]
        }
      },
      "id": "6de8ad47-9ed9-462f-b403-de9bc4cd9792",
      "name": "Run Workflow",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.2,
      "position": [
        90960,
        27120
      ]
    },
```

`0 5 * * *` = 5:00 AM every day. With `TZ: Europe/Berlin` in docker-compose, this fires at 5 AM Berlin time (CET/CEST). The `id` is kept identical so all connections in the workflow's `connections` map remain valid.

### 5b — Fix the three hardcoded localhost URLs

Do a global find-and-replace in the JSON file:

| Find | Replace |
|------|---------|
| `http://host.docker.internal:3000/context` | `http://resume-server:3000/context` |
| `http://host.docker.internal:3000/generate-resume` | `http://resume-server:3000/generate-resume` |
| `http://host.docker.internal:3000/generate-coverletter` | `http://resume-server:3000/generate-coverletter` |

These appear at lines 231, 404, and 975 respectively (in the current file).

### 5c — Update node "16. Prepare Sheet Log" to write clickable hyperlinks

In the `jsCode` parameter of node `16. Prepare Sheet Log` (id: `bce0e3ac-790d-471a-9fee-d9cdf37bfcf8`), find:
```javascript
      'Resume File':       resumeItem.json.file            || '',\n      'Cover Letter File': coverItem.json.file             || '',
```

Replace with:
```javascript
      'Resume File':       resumeItem.json.url ? '=HYPERLINK(\"' + resumeItem.json.url + '\",\"Download Resume\")' : (resumeItem.json.file || ''),\n      'Cover Letter File': coverItem.json.url ? '=HYPERLINK(\"' + coverItem.json.url + '\",\"Download Cover Letter\")' : (coverItem.json.file || ''),
```

**Important:** The `jsCode` value is a JSON string with `\n` escapes. The replacement above preserves that encoding. The fallback `(resumeItem.json.file || '')` preserves backward compatibility for any local runs.

- [ ] **Step 1: Make the 5a Manual → Schedule Trigger change**
- [ ] **Step 2: Make the 5b URL replacements (3 occurrences)**
- [ ] **Step 3: Make the 5c node-16 hyperlink change**

- [ ] **Step 4: Validate JSON is still valid**

```bash
node -e "JSON.parse(require('fs').readFileSync('data/Job_Application_Automator_v6.json','utf8')); console.log('JSON valid')"
```
Expected: `JSON valid`

- [ ] **Step 5: Commit**

```bash
git add data/Job_Application_Automator_v6.json
git commit -m "feat: schedule trigger 5AM, Docker network URLs, clickable PDF hyperlinks in Sheet"
```

---

## Task 6: Oracle VM — create the instance (you do this in Oracle Cloud Console)

This task has no code. Follow these steps in your browser.

- [ ] **Step 1: Create the instance**

1. Go to [cloud.oracle.com](https://cloud.oracle.com) → Compute → Instances → **Create Instance**
2. Name: `resume-server`
3. Under **Image and shape** click Edit:
   - Image: **Ubuntu 22.04** (Canonical)
   - Shape: **VM.Standard.A1.Flex** (ARM Ampere — Always Free eligible)
   - OCPU count: **2**, Memory: **4 GB**
4. Under **Add SSH keys**: upload your public key or paste it. **Download the private key** if generating a new one.
5. Boot volume: leave at default 50 GB.
6. Click **Create**.

Wait ~2 minutes for the instance to reach **Running** state. Note the **Public IP address**.

- [ ] **Step 2: Open ports in the VCN Security List**

1. Click the instance → under Primary VNIC click the **Subnet** link → click **Default Security List**
2. Click **Add Ingress Rules** and add two rules:

| Source CIDR | Protocol | Port |
|-------------|----------|------|
| 0.0.0.0/0 | TCP | 5678 |
| 0.0.0.0/0 | TCP | 3000 |

- [ ] **Step 3: Open ports in Ubuntu's iptables (SSH into the VM first)**

```bash
ssh -i ~/your-key.key ubuntu@YOUR_PUBLIC_IP
```

Once connected:
```bash
# Oracle Ubuntu images use iptables, not UFW
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 5678 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT
sudo netfilter-persistent save
```

- [ ] **Step 4: Install Docker**

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker ubuntu
newgrp docker
docker --version
# Expected: Docker version 27.x.x or similar
```

---

## Task 7: Deploy to the VM

All commands run on the Oracle VM (via SSH).

- [ ] **Step 1: Push local changes to GitHub first (run on your laptop)**

```bash
git push
```

- [ ] **Step 2: Clone the repo on the VM**

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME.git ~/resume-generator
cd ~/resume-generator
```

- [ ] **Step 3: Create .env from the template**

```bash
cp .env.example .env
nano .env
```

Fill in all four values:
```
SERVER_URL=http://YOUR_ORACLE_PUBLIC_IP:3000
N8N_USER=admin
N8N_PASSWORD=<choose a strong password>
N8N_ENCRYPTION_KEY=<run `openssl rand -hex 32` to generate>
```

- [ ] **Step 4: Build and start services**

```bash
docker compose up -d --build
```

The first build takes ~5–10 minutes (Playwright downloads Chromium). Subsequent starts are fast.

- [ ] **Step 5: Verify both containers are running**

```bash
docker compose ps
```
Expected: both `resume-server` and `n8n` show status `running`.

```bash
docker compose logs resume-server --tail=20
```
Expected: `Server running on port 3000`

```bash
curl http://localhost:3000/context | head -c 200
```
Expected: JSON starting with `{"currentJobTitle":...`

---

## Task 8: n8n — import workflow and reconnect credentials

All steps are done in the n8n browser UI at `http://YOUR_ORACLE_PUBLIC_IP:5678`.

- [ ] **Step 1: Log in**

Open `http://YOUR_ORACLE_PUBLIC_IP:5678`. Log in with `N8N_USER` / `N8N_PASSWORD` from your `.env`.

- [ ] **Step 2: Add credentials** (Settings → Credentials → Add Credential)

Add each of these in order:

| Credential type | Values needed |
|----------------|---------------|
| Google Sheets OAuth2 | Follow the OAuth flow — you'll need a Google Cloud project with Sheets API enabled. See note below. |
| OpenAI | Your `OPENAI_API_KEY` from `.env` on your laptop |
| Google AI / Gemini | Your `GOOGLE_AI_API_KEY` from `.env` on your laptop |
| Apify | Your Apify API token (from apify.com → Settings → API & Integrations) |

**Google Sheets OAuth setup (one-time, ~5 min):**
1. Go to [console.cloud.google.com](https://console.cloud.google.com) → New project → name it `n8n-sheets`
2. APIs & Services → Enable APIs → enable **Google Sheets API**
3. APIs & Services → Credentials → Create Credentials → **OAuth client ID**
   - Type: **Web application**
   - Authorized redirect URI: `http://YOUR_ORACLE_PUBLIC_IP:5678/rest/oauth2-credential/callback`
4. Copy the Client ID and Client Secret into the n8n Google Sheets credential form and click Connect.

- [ ] **Step 3: Import the updated workflow**

Workflows → Import → upload `data/Job_Application_Automator_v6.json` from your laptop (or from the cloned repo on the VM at `~/resume-generator/data/Job_Application_Automator_v6.json`).

- [ ] **Step 4: Reconnect credentials in the imported workflow**

Open the workflow. Any node with a yellow ⚠️ on it has a disconnected credential. Click each node and select the matching credential you added in Step 2.

Nodes that need credentials:
- `2f. Read Applied Jobs` → Google Sheets account
- `2a/b/c/d/e` Apify scrapers → Apify Patkaran
- `10. Gemini Match` and `10e. Fallback Gemini Call` → Google AI
- `13b. OpenAI Tailor` → OpenAI
- `17. Log to Google Sheets`, `18b. Log Skipped to Sheets`, `4d. Log Bad JD Sheet` → Google Sheets account

- [ ] **Step 5: Activate the workflow**

Toggle the workflow to **Active** (top-right switch). It will fire at 5 AM Berlin time.

- [ ] **Step 6: Do a manual test run**

Click the **Run Workflow** node → **Execute step** (or use the Test Workflow button). Watch the execution. Verify:
- `/context` call succeeds (green node)
- One or more PDF generations succeed (green 15a/15b nodes)
- Row appears in your Google Sheet with a clickable `=HYPERLINK(...)` formula in the Resume File column

---

## Self-review checklist

- [x] Spec requirement: automated morning run → Schedule Trigger at 5 AM Berlin time (Task 5a)
- [x] Spec requirement: no local Docker — both containers run on Oracle VM (Tasks 1–2, 7)
- [x] Spec requirement: clickable PDF links in Google Sheet → `/files` endpoint + `url` field + node-16 hyperlinks (Tasks 4, 5c)
- [x] Spec requirement: zero cost → Oracle ARM Always Free shape (Task 6 Step 1)
- [x] `.env` never committed — already in `.gitignore`; `.env.example` committed instead (Task 3)
- [x] `n8n_data: external: true` removed — breaks on fresh server with no pre-existing volume (Task 2)
- [x] ARM64 Playwright — `npx playwright install --with-deps chromium` downloads architecture-appropriate binary (Task 1)
