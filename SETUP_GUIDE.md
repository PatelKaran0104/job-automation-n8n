# Job Application Automator — Complete Setup Guide

This guide walks you through replicating this exact pipeline from zero: a system that scrapes job boards on demand, uses AI to match and tailor your resume and cover letter for each role, generates PDFs, and logs everything to Google Sheets.

**What you'll have when done:**
- A Node.js resume server running in Docker on a DigitalOcean droplet
- n8n (hosted, accessible via HTTPS through Caddy) orchestrating the full pipeline
- 5 job boards scraped in parallel (LinkedIn, Indeed, StepStone, Glassdoor, Xing)
- Gemini AI matching jobs to your profile (with automatic fallback)
- OpenAI GPT-4o-mini tailoring your resume and drafting a cover letter for each match
- PDF pair (resume + cover letter) generated per matched job
- Every job logged to Google Sheets with confidence scores, file paths, and status

---

## Table of Contents

1. [Accounts and prerequisites](#1-accounts-and-prerequisites)
2. [Clone the repository](#2-clone-the-repository)
3. [Customize your resume JSON](#3-customize-your-resume-json)
4. [Update cover letter personal details](#4-update-cover-letter-personal-details)
5. [Create the Google Sheet](#5-create-the-google-sheet)
6. [Get your API keys](#6-get-your-api-keys)
7. [Provision the DigitalOcean droplet](#7-provision-the-digitalocean-droplet)
8. [Deploy the stack to the droplet](#8-deploy-the-stack-to-the-droplet)
9. [Import and configure the n8n workflow](#9-import-and-configure-the-n8n-workflow)
10. [Wire up credentials in n8n](#10-wire-up-credentials-in-n8n)
11. [Connect Google Sheets nodes](#11-connect-google-sheets-nodes)
12. [Configure the Manual Configuration node](#12-configure-the-manual-configuration-node)
13. [Test the pipeline end to end](#13-test-the-pipeline-end-to-end)
14. [Running the workflow](#14-running-the-workflow)
15. [Understanding the output](#15-understanding-the-output)
16. [Troubleshooting](#16-troubleshooting)

---

## 1. Accounts and prerequisites

### Accounts you need

| Service | What for | Cost |
|---------|----------|------|
| **DigitalOcean** | Droplet to host n8n + resume server | ~$12/month (2 GB RAM, Frankfurt) |
| **Apify** | Scraping LinkedIn, Indeed, StepStone, Glassdoor, Xing | Free tier (~$5/month free compute) |
| **Google Account** | Google Sheets logging + Google AI Studio (Gemini) | Free |
| **OpenAI** | Resume/cover letter tailoring via GPT-4o-mini | Pay-as-you-go (~$2–5/month) |

### Tools on your local machine

- **Python 3** — to run the droplet provisioning script (one-time)
- **Node.js 20+** — for local testing before deploying (`node --version` to check)
- **Git** — to clone and manage the repo
- **An SSH client** — built into Windows Terminal, macOS Terminal, and Linux

You do **not** need Docker locally — Docker runs on the droplet. You do not need n8n locally.

---

## 2. Clone the repository

```bash
git clone https://github.com/<your-fork-or-copy>/job-application-automator.git
cd job-application-automator
npm install
```

> If you're starting from this project's files directly (not a GitHub repo), just copy the folder and run `npm install` inside it.

### Verify the server starts locally

```bash
npm start
```

You should see: `Resume server running on port 3000`. Hit `Ctrl+C` to stop. If you see `EADDRINUSE`, port 3000 is taken — kill the conflicting process first.

---

## 3. Customize your resume JSON

`data/resume.json` is the single source of truth for every PDF the pipeline generates. **You must replace this with your own data.** Do not change field names or the schema shape — only the values inside.

### Schema overview

```
resume
├── meta
│   └── updatedAt
├── personalDetails
│   ├── firstName, lastName
│   ├── jobTitle              ← your current/default title
│   ├── email, phone, location
│   ├── linkedin, github, website  (optional)
│   └── profileImageUrl       (optional — leave empty string to omit photo)
└── content
    ├── profile               ← your professional summary (HTML string, <p> tags)
    ├── work[]                ← work experience entries
    ├── project[]             ← personal/academic projects
    ├── education[]
    ├── certificate[]
    ├── skill[]               ← skills with optional detail text
    └── language[]            ← spoken languages
```

### Critical: IDs

Every `work`, `project`, `skill`, and `certificate` entry has an `id` field. These IDs are how the AI patch targets individual entries to update them. **Never reuse or change an ID after you've set it.** Use short, descriptive slugs:

```json
{ "id": "work-company-2023", "employer": "Acme Corp", ... }
{ "id": "skill-python", "skill": "Python", ... }
```

The `/context` endpoint exposes these IDs to n8n so the AI can reference them in its patch. If an ID in the patch doesn't match any ID in `resume.json`, that entry is silently skipped.

### Work entry shape

```json
{
  "id": "work-company-year",
  "employer": "Company Name",
  "jobTitle": "Your Role",
  "location": "City, Country",
  "startDateNew": "Jan 2023",
  "endDateNew": "Dec 2024",
  "current": false,
  "description": "<ul><li><p>Bullet one.</p></li><li><p>Bullet two.</p></li></ul>"
}
```

`description` is an HTML string. Use `<ul><li><p>...</p></li></ul>` for bullets. The AI rewrites this field per job, so your base version just needs to be accurate — don't over-polish it.

### Skill entry shape

```json
{
  "id": "skill-javascript",
  "skill": "JavaScript",
  "infoHtml": "<p>React, Node.js, Express — 2 years professional experience</p>"
}
```

### Project entry shape

```json
{
  "id": "proj-portfolio",
  "name": "Portfolio Website",
  "techStack": "React, Node.js",
  "url": "https://yoursite.com",
  "description": "<p>Built a personal portfolio...</p>"
}
```

### Tips

- Include all real work experience — the AI decides which entries to emphasize per role.
- For skills, be specific in `infoHtml`. Vague entries produce vague patches.
- The `showCertificates` and `showProjects` fields in the AI patch control whether those sections appear in the final PDF (useful for roles where projects aren't relevant).

---

## 4. Update cover letter personal details

Open [src/mergeCoverLetter.js](src/mergeCoverLetter.js) and find the section with hardcoded personal details near the top. Replace every field with your own:

```js
const senderName = "Your Full Name";
const senderPhone = "+49 123 456789";
const senderEmail = "your@email.com";
const senderLocation = "City, Country";
const senderLinkedIn = "linkedin.com/in/yourprofile";
const senderGitHub = "github.com/yourusername";
```

Also update the footer role line — the title that appears under your name in the signature block. Change it to match your current role.

**This is the only file you need to edit for personal branding.** The resume header pulls automatically from `data/resume.json`.

---

## 5. Create the Google Sheet

Create a new Google Sheet. Name it anything (e.g. "Job Applications"). Add one header row with these exact column names, in this order:

```
Date | Company | Role | Job Type | Location | Source | Job URL | Apply URL | Raw URL |
Match Confidence | Match Reason | Resume File | Cover Letter File | Status |
Applied | Response | Interview | Notes | Quality
```

19 columns total.

- Columns 1–14 are written automatically by n8n.
- Columns 15–17 (`Applied`, `Response`, `Interview`) are for your manual tracking — n8n never overwrites them.
- Column 18 (`Notes`) receives AI parse warnings or PDF error messages.
- Column 19 (`Quality`) is set by n8n: `Good Fit`, `Bad Fit`, `Review`, or `Error`.

**Copy the Sheet ID from the URL.** The URL looks like:
```
https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit
```
You'll need this when wiring up n8n nodes.

---

## 6. Get your API keys

### Gemini API key (Google AI Studio)

1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Click **Get API Key** → **Create API key**
3. Copy the key — you'll enter it in n8n as a credential, not in any config file

The pipeline uses `gemini-2.5-flash-lite-preview` as the primary model and `gemini-2.0-flash-lite` as fallback. Both are free-tier eligible.

### OpenAI API key

1. Go to [platform.openai.com](https://platform.openai.com) → **API Keys**
2. Create a new secret key
3. Add at least $5 credit — the pipeline uses `gpt-4o-mini` which costs roughly $0.15/1M input tokens. A 50-job run costs under $0.10.

### Apify API token

1. Go to [apify.com](https://apify.com) and create an account
2. Navigate to **Settings** → **Integrations** → copy your **Personal API token**

The pipeline uses these 5 Apify actors — the n8n nodes call them by actor ID, no additional Apify config needed:

| Board | Actor |
|-------|-------|
| LinkedIn | `curious_coder/linkedin-jobs-scraper` |
| Indeed | `misceres/indeed-scraper` |
| StepStone | `dMUuGCp0N5uw0eJoT` |
| Glassdoor | `igorsteinmacher/glassdoor-scraper` |
| Xing | `dhrumil_work/xing-jobs-scraper` |

Apify's free tier gives ~$5/month of compute credit. Scraping 5 jobs per board × 5 boards = 25 items uses roughly $0.10–0.20 per run.

---

## 7. Provision the DigitalOcean droplet

This project includes a Python script that creates the droplet and cloud firewall automatically via the DigitalOcean API.

### Get a DigitalOcean API token

1. Log in to [cloud.digitalocean.com](https://cloud.digitalocean.com)
2. Go to **API** → **Personal Access Tokens** → **Generate New Token**
3. Give it read + write scope
4. Copy the token

### Generate your SSH key pair (if you don't have one)

```bash
ssh-keygen -t rsa -b 4096 -C "resume-server" -f ~/.ssh/resume-server
```

This creates `~/.ssh/resume-server` (private key) and `~/.ssh/resume-server.pub` (public key).

### Update the provisioning script

Open [scripts/do_create_droplet.py](scripts/do_create_droplet.py) and replace the `SSH_PUBLIC_KEY` value with the contents of your `~/.ssh/resume-server.pub`:

```python
SSH_PUBLIC_KEY = "ssh-rsa AAAA... your-key-comment"
```

The rest of the config at the top of the script:

```python
DROPLET_NAME = "resume-server"
REGION       = "fra1"           # Frankfurt — closest to Germany
SIZE         = "s-1vcpu-2gb"    # 2 GB RAM, 1 vCPU — $12/month
IMAGE        = "ubuntu-22-04-x64"
```

Change `REGION` if you're not in Germany. DigitalOcean region slugs: `fra1` (Frankfurt), `lon1` (London), `nyc3` (New York), `sgp1` (Singapore).

### Run the provisioning script

```bash
pip install requests

# Windows
set DO_TOKEN=your_digitalocean_token_here
python scripts/do_create_droplet.py

# macOS / Linux
export DO_TOKEN=your_digitalocean_token_here
python scripts/do_create_droplet.py
```

The script:
1. Uploads your SSH public key to DigitalOcean
2. Creates the droplet (takes ~2 minutes to become active)
3. Creates a cloud firewall opening ports 22 (SSH), 80 (HTTP), 443 (HTTPS), and 3000 (resume server)
4. Prints your droplet's public IP

At the end you'll see output like:

```
=======================================================
  DROPLET CREATED SUCCESSFULLY!
  Name   : resume-server
  Region : fra1 (Frankfurt)
  IP     : 165.245.211.204
  SSH    : ssh root@165.245.211.204
=======================================================
```

Write down your IP — you'll use it throughout the rest of this guide.

### SSH into the droplet

```bash
ssh -i ~/.ssh/resume-server root@YOUR_DROPLET_IP
```

> DigitalOcean droplets default to `root` login (unlike Oracle/AWS where it's `ubuntu` or `ec2-user`).

### Install Docker on the droplet

Once SSH'd in:

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Install Docker Compose plugin
apt-get install -y docker-compose-plugin

# Verify
docker --version
docker compose version
```

No `sudo` needed — you're already root.

---

## 8. Deploy the stack to the droplet

### Clone the repo on the droplet

```bash
git clone https://github.com/<your-repo>/job-application-automator.git ~/resume-generator
cd ~/resume-generator
```

### Configure your domain

The stack uses [sslip.io](https://sslip.io) — a free DNS service that maps `YOUR-IP-DASHES.sslip.io` to your IP automatically, with no registration needed. Caddy uses this to get a free TLS certificate from Let's Encrypt automatically.

Your domain will be: `YOUR-IP-DASHES.sslip.io`
Example: IP `165.245.211.204` → domain `165-245-211-204.sslip.io`

**Update the Caddyfile** — replace the domain with yours:

```
165-245-211-204.sslip.io {
    reverse_proxy n8n:5678
}
```

**Update docker-compose.yml** — replace `N8N_HOST` and `WEBHOOK_URL`:

```yaml
N8N_HOST: 165-245-211-204.sslip.io          # ← your domain
WEBHOOK_URL: https://165-245-211-204.sslip.io/  # ← your domain
```

Also remove or leave empty the `TELEGRAM_BOT_TOKEN` line — it is not needed.

### Create the .env file

```bash
cp .env.example .env
nano .env
```

Fill in all values:

```env
# Public URL of the resume server
# This appears in the Google Sheets "Resume File" / "Cover Letter File" columns
SERVER_URL=http://YOUR_DROPLET_IP:3000

# n8n basic auth — choose any username and password
N8N_USER=admin
N8N_PASSWORD=choose-a-strong-password-here

# Generate with: openssl rand -hex 32
N8N_ENCRYPTION_KEY=paste-the-output-here
```

Generate the encryption key:

```bash
openssl rand -hex 32
```

Copy the output and paste it as `N8N_ENCRYPTION_KEY`.

### Start the stack

```bash
docker compose up -d --build
```

`--build` is needed on first run to build the resume server image (takes 2–4 minutes — it installs Node dependencies and Playwright/Chromium).

Check all three services are up:

```bash
docker compose ps
```

You should see `resume-server`, `n8n`, and `caddy` all showing `Up`.

### Verify the resume server

```bash
curl http://localhost:3000/context
```

You should get a JSON blob with your resume's work, skills, and projects. If you get a connection error:

```bash
docker compose logs resume-server --tail=50
```

### Verify n8n is accessible

Open `https://YOUR-IP-DASHES.sslip.io` in your browser. You should see the n8n login page. Log in with the `N8N_USER` / `N8N_PASSWORD` from your `.env`.

> If you see a certificate warning, wait 30–60 seconds for Caddy to provision the TLS certificate and refresh.

---

## 9. Import and configure the n8n workflow

### Import the workflow

1. In n8n, go to the home screen and click **Add workflow** → **Import from file**
2. Upload `data/Job_Application_Automator_v6.json`
3. The workflow opens with ~36 nodes. Don't run it yet — credentials need to be wired up first.

### What the workflow does (overview)

```
Manual trigger
    ↓
1. Manual Configuration (your search URLs + model names)
    ↓ (parallel)
Scrape LinkedIn, Indeed, StepStone, Glassdoor, Xing  +  Read applied jobs from Sheets
    ↓
Normalize & deduplicate all jobs
    ↓
Filter out already-logged jobs
    ↓
Fetch /context (your resume)
    ↓
Loop over each job (one at a time):
    → Pre-filter (hard-reject obviously misaligned titles — no Gemini call needed)
    → Gemini match call (with automatic fallback to second model)
    → If match (confidence ≥ 45):
        → OpenAI tailor call → generate resume PDF + cover letter PDF (parallel)
        → Log to Sheets: Generated
    → If no match:
        → Log to Sheets: Skipped
```

---

## 10. Wire up credentials in n8n

Go to **Settings** → **Credentials** → **Add credential** for each of the following.

### Gemini API Key

- Type: **Header Auth**
- Name: `Gemini API Key` (must be this exact name — the workflow nodes reference it by name)
- Header name: `x-goog-api-key`
- Header value: your Gemini API key

### OpenAI API

- Type: **OpenAI API** (built-in credential type in n8n)
- API Key: your OpenAI API key

After creating, open any OpenAI node in the workflow and check the **Credential** dropdown — select the credential you just created.

### Google Sheets OAuth2

You need to create a Google OAuth app first:

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create or select a project
2. Go to **APIs & Services** → **Library** → search **Google Sheets API** → Enable it
3. Go to **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**
4. Application type: **Web application**
5. Add this as an authorized redirect URI:
   ```
   https://YOUR-IP-DASHES.sslip.io/rest/oauth2-credential/callback
   ```
6. Copy the **Client ID** and **Client Secret**

Back in n8n:
- Type: **Google OAuth2 API** (or **Google Sheets OAuth2**)
- Enter the Client ID and Client Secret from step 6
- Click **Connect** and complete the Google sign-in flow

### Apify API

- Type: **Header Auth**
- Name: match what the scraper nodes reference (check by opening a scraper node)
- Header name: `Authorization`
- Header value: `Bearer YOUR_APIFY_TOKEN`

---

## 11. Connect Google Sheets nodes

Three nodes in the workflow need to be pointed to your spreadsheet:

| Node | What it does |
|------|-------------|
| `2f. Read Applied Jobs` | Reads the `Raw URL` column to build the already-applied list |
| `17. Log to Google Sheets` | Appends one row per matched job |
| `18b. Log Skipped to Sheets` | Appends one row per skipped/rejected job |

For each node:
1. Open the node
2. Set the **Credential** to your Google Sheets OAuth credential
3. Set **Spreadsheet** — search by name or paste the Sheet ID from the URL
4. Set **Sheet** to the tab name (default: `Sheet1`)
5. For `2f. Read Applied Jobs`: confirm the column mapping reads the `Raw URL` column

---

## 12. Configure the Manual Configuration node

Open the `1. Manual Configuration` node. This is the only place you tune search parameters.

```js
linkedInUrl:   "https://www.linkedin.com/jobs/search/?keywords=Software+Developer&location=Germany",
indeedUrl:     "https://de.indeed.com/jobs?q=Software+Developer&l=Deutschland",
stepstoneUrl:  "https://www.stepstone.de/jobs/software-developer/in-deutschland",
xingUrl:       "https://www.xing.com/jobs/search?keywords=Software+Developer&location=Deutschland",
// Glassdoor URL is hardcoded in 2d. Scrape Glassdoor — edit it there

jobCount: 5,   // jobs scraped per board per run (5 × 5 boards = 25 total)

geminiModel:            "gemini-2.5-flash-lite-preview",
fallbackFilteringModel: "gemini-2.0-flash-lite",
openaiModel:            "gpt-4o-mini"
```

### How to get the right search URLs

Do a real job search on each platform with your preferred keywords and location filters, then copy the URL from your browser. The scraper fetches jobs from that exact search page including all your filters.

For LinkedIn you can add `&f_TPR=r86400` to the URL to limit results to the past 24 hours — useful for avoiding stale listings.

### Tune the match confidence threshold

The match gate is in node `12. Is Match?`. The default is `confidence >= 45`. Open the node and raise the value to see fewer but higher-quality matches, or lower it to see more.

---

## 13. Test the pipeline end to end

Do these checks in order before your first real run.

### 1. Test the resume server

SSH into the droplet and run:

```bash
curl http://localhost:3000/context | head -50
```

You should see your resume data as JSON. If not:

```bash
cd ~/resume-generator && docker compose logs resume-server --tail=50
```

### 2. Test resume PDF generation

```bash
curl -X POST http://localhost:3000/generate-resume \
  -H "Content-Type: application/json" \
  -d '{
    "jobTitle": "Software Developer",
    "profile": "<p>Test profile.</p>",
    "work": [],
    "skills": [],
    "projects": [],
    "company": "TestCo",
    "role": "Developer"
  }'
```

Response should be `{ "success": true, "file": "...", "fileName": "..." }`. The PDF appears in `~/resume-generator/output/YYYY-MM-DD/Resume/`.

### 3. Test cover letter PDF generation

```bash
curl -X POST http://localhost:3000/generate-coverletter \
  -H "Content-Type: application/json" \
  -d '{
    "role": "Developer",
    "company": "TestCo",
    "companyAddress": "TestCo GmbH, Musterstraße 1, 60311 Frankfurt",
    "paragraph1": "Test opening.",
    "paragraph2": "Test skills.",
    "paragraph3": "Test closing.",
    "language": "de"
  }'
```

### 4. Test n8n can reach the resume server

In n8n, open the `7. GET Resume Context` node and click the **Test step** button (play icon on the node itself). It should return your resume data. If it fails with a connection error:

Add this to the `n8n` service in `docker-compose.yml`, then restart:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

```bash
docker compose up -d n8n
```

---

## 14. Running the workflow

In n8n, open the imported workflow and click **Execute Workflow** on the `Run Workflow` (manual trigger) node.

The workflow is **manual trigger only** — it does not run on a schedule. Run it whenever you want a fresh batch of applications.

### What a normal run looks like

1. All 5 scrapers fire in parallel — takes 30–90 seconds
2. Jobs are normalized, deduplicated, and filtered against your Sheets log
3. The pipeline loops over new jobs one at a time
4. For each job: 3-second wait → Gemini match call → if match, 2-second wait → OpenAI tailor → 2 PDFs generated in parallel
5. Every job (matched or skipped) is logged to Google Sheets

A run with 25 jobs typically takes 5–10 minutes. Most of the time is API calls and throttle waits.

### Monitoring

Watch the n8n execution view — each node lights up green (success), yellow (no output), or red (error) as it runs. Click any node to inspect its input and output data.

---

## 15. Understanding the output

### Google Sheets log

Every job gets a row:

| Column | What it means |
|--------|--------------|
| Status | `Generated` / `Skipped - No Match` / `PDF Failed` / `Pipeline Error` |
| Match Confidence | Gemini's 0–100 score |
| Match Reason | Gemini's one-line explanation |
| Quality | `Good Fit` / `Bad Fit` / `Review` / `Error` |
| Resume File | Absolute path on the droplet |
| Cover Letter File | Absolute path on the droplet |

### PDFs on the droplet

```
~/resume-generator/output/
└── 2026-06-04/
    ├── Resume/
    │   └── resume-CompanyName--Role-143022.pdf
    └── Coverletter/
        └── coverletter-CompanyName--Role-143023.pdf
```

To copy PDFs to your local machine:

```bash
# From your local machine
scp -i ~/.ssh/resume-server -r root@YOUR_DROPLET_IP:~/resume-generator/output ./output
```

Or use an SFTP client (Cyberduck on macOS, WinSCP on Windows).

---

## 16. Troubleshooting

| Problem | Fix |
|---------|-----|
| `docker compose` command not found | Install Docker Compose plugin: `apt-get install -y docker-compose-plugin` |
| Resume server container exits immediately | Check logs: `docker compose logs resume-server --tail=100`. Usually a Playwright install failure — rebuild with `docker compose build --no-cache resume-server` |
| `EADDRINUSE` on port 3000 | Another container is using port 3000: `docker compose ps` then `docker compose down` and restart |
| n8n UI shows certificate warning | Wait 60 seconds for Caddy to get a TLS cert from Let's Encrypt. Ports 80 and 443 must be open in the DO firewall |
| n8n can't reach `host.docker.internal:3000` | Add `extra_hosts: ["host.docker.internal:host-gateway"]` to the n8n service in docker-compose.yml, then `docker compose up -d n8n` |
| Caddy won't start / TLS fails | Domain in Caddyfile must match `N8N_HOST` exactly. Check `docker compose logs caddy --tail=50` |
| Gemini 429 / quota exceeded | Primary falls back to `gemini-2.0-flash-lite` automatically. If both fail, increase the wait in `10b. Wait` (default 3s) or reduce `jobCount` |
| OpenAI rate limit | Increase delay in `13a1. Wait` node (default 2s), or reduce `jobCount` |
| PDFs empty / blank | Malformed HTML in `resume.json` description fields. Check `docker compose logs resume-server` |
| No jobs after normalize | Apify actor output schema changed. Compare `BOARD_CONFIG` field mappings in node `4. Normalize & Merge Jobs` against actual actor output in the n8n execution data |
| Google Sheets auth error | Re-authorize: **Settings** → **Credentials** → your Sheets credential → **Reconnect** |
| Jobs scraped again (no dedup) | `2f. Read Applied Jobs` failed silently — check the Sheets credential is valid and the Sheet ID is correct |
| Fonts missing in PDF | Run `docker compose build --no-cache resume-server` to reinstall `@fontsource/source-serif-pro` |

---

## Quick reference: what lives where

```
repo/
├── data/
│   ├── resume.json                         ← YOUR resume — edit this
│   └── Job_Application_Automator_v6.json   ← n8n workflow to import
├── src/
│   ├── server.js                           ← Express API (do not edit)
│   ├── mergeCoverLetter.js                 ← YOUR personal details — edit this
│   ├── buildResumeHtml.js                  ← HTML rendering (do not edit)
│   ├── mergePatch.js                       ← Patch apply logic (do not edit)
│   └── validatePatch.js                    ← Patch validation (do not edit)
├── scripts/
│   └── do_create_droplet.py                ← One-time droplet provisioning script
├── docker-compose.yml                      ← Edit: replace domain/IP, no Telegram line
├── Caddyfile                               ← Edit: replace domain/IP
├── .env                                    ← Create from .env.example, fill in secrets
├── Dockerfile                              ← Do not edit
└── output/                                 ← Generated PDFs land here (git-ignored)
```

## Summary: everything you must change

| File / Location | What to change |
|----------------|---------------|
| `data/resume.json` | Replace entirely with your own resume data |
| `src/mergeCoverLetter.js` | Your name, phone, email, location, LinkedIn, GitHub |
| `scripts/do_create_droplet.py` | Your `SSH_PUBLIC_KEY`; optionally `REGION` and `SIZE` |
| `docker-compose.yml` | `N8N_HOST`, `WEBHOOK_URL` → your `YOUR-IP-DASHES.sslip.io` domain |
| `Caddyfile` | Replace domain with your `YOUR-IP-DASHES.sslip.io` domain |
| `.env` | `SERVER_URL`, `N8N_USER`, `N8N_PASSWORD`, `N8N_ENCRYPTION_KEY` |
| n8n `1. Manual Configuration` node | Your job search URLs, `jobCount`, model names |
| n8n Sheets nodes | Your Google Sheet ID |
