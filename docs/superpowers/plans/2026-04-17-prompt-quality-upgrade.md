# Prompt Quality Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the match and tailor prompts in the n8n workflow so outputs (tailored resume + cover letter) consistently position Karan as a strong, JD-aligned candidate — maximizing interview callback rate across Salesforce, general software, DevOps, infrastructure, AI/automation, and student roles in Germany.

**Architecture:** All edits target two Code nodes in `data/Job_Application_Automator_v6.json` — `10a. Build Match Prompt` (match filter) and `13a. Build Tailor Prompt` (resume + cover letter tailor). Server-side (`src/server.js`, `src/mergePatch.js`, `src/validatePatch.js`) already supports `projects`, `showProjects`, and skill renames — no server changes required. Changes are grouped into 4 phases by impact, then a verification phase.

**Tech Stack:** n8n workflow JSON (embedded JavaScript in `jsCode` fields), Node.js (ES Modules), `node:test` for JSON validity, existing `test-resume` skill for end-to-end verification.

---

## How to edit n8n workflow JSON

The workflow lives in [data/Job_Application_Automator_v6.json](../../../data/Job_Application_Automator_v6.json). Each Code node stores its JavaScript in a `jsCode` string field where `\n` = newline, `\"` = quote, `\\` = backslash, and backticks are literal. All edits in this plan use the `Edit` tool with an anchor substring unique to that node. After each task, verify the JSON still parses:

```bash
node -e "JSON.parse(require('fs').readFileSync('data/Job_Application_Automator_v6.json')); console.log('OK')"
```

If this fails, revert and re-apply the edit with a shorter/more unique anchor.

## Why this plan does not use traditional TDD

Prompt text is not directly unit-testable — outputs are probabilistic. Verification in this plan is:

1. **Structural:** JSON remains valid after each edit (`node -e` check above).
2. **Behavioural:** After each phase, run the existing `test-resume` skill against 2–3 representative JDs (Salesforce DE role, DevOps/infrastructure role, Werkstudent/student role) and review the output PDFs and cover-letter paragraphs.
3. **Regression:** Existing `tests/validatePatch.test.js` must still pass (`npm run test:unit`).

---

## Skipped items (explicitly out of scope — per user decisions)

| # | Item | Reason |
|---|------|--------|
| 12 | Keep last 500 chars of JD after the section split | Last sections are usually benefits/perks, already filtered |
| 13 | Location override for remote roles | Candidate location stays DE even for remote |
| 16 | Bump cover-letter temperature from 0.3 → 0.5 | Added cost/variance not justified by minor quality gain |
| 18 | Nuanced `showCertificates` logic per role type | All certs are Salesforce-specific — binary hide/show is correct |

---

# PHASE 1 — Structural (highest leverage)

## Task 1: Add `projects` to the Tailor prompt (system rules + user message + output schema)

**Why:** Projects hold Karan's strongest differentiating evidence (WebRTC spatial platform, AWS/Terraform infrastructure stack with ~41 resources, SUMMA HPC in C+MPI, AI document pipeline, Custom Form Builder). For any non-Salesforce role (DevOps, backend, full-stack, real-time, HPC, AI engineering) the projects are the *only* place with hands-on matching evidence. The tailor prompt currently sees neither the projects nor outputs any patch for them — so they stay in base-resume order and wording regardless of JD.

**Server-side support already exists:** [src/mergePatch.js:52-62](../../../src/mergePatch.js#L52-L62) merges `patch.projects[]` by id; [src/validatePatch.js:108-124](../../../src/validatePatch.js#L108-L124) validates them. No server changes needed.

**Files:**
- Modify: [data/Job_Application_Automator_v6.json](../../../data/Job_Application_Automator_v6.json) — node `13a. Build Tailor Prompt` (around line 344)

### Step 1.1: Add projects block to the user message

- [ ] Open the workflow JSON and locate the line containing `13a. Build Tailor Prompt`. The `jsCode` for this node is a long single line just before it.

- [ ] Find this anchor in the `jsCode` (part of the user message construction near the end):

```
const skillsFormatted = skillsClean.map(s =>\n  `[ID: ${s.id}] ${s.skill}: ${s.details}`\n).join('\\n');\n\nconst userMsg = `RESUME:\nTitle: ${item.resume?.currentJobTitle || ''}\nProfile: ${stripHtml(item.resume?.currentProfile || '')}\n\nWork Experience:\n${workFormatted}\n\nSkills:\n${skillsFormatted}\n\nJOB DETAILS:
```

- [ ] Replace it with (adds a `projectsFormatted` variable and injects projects into the user message between Skills and JOB DETAILS):

```
const skillsFormatted = skillsClean.map(s =>\n  `[ID: ${s.id}] ${s.skill}: ${s.details}`\n).join('\\n');\n\nconst projectsClean = (item.resume?.currentProjects || []).map(p => ({\n  ...p,\n  description: stripHtml(p.description),\n}));\n\nconst projectsFormatted = projectsClean.map(p =>\n  `[ID: ${p.id}] ${p.name} — ${p.techStack || 'n/a'}\\n` +\n  p.description.split(/\\n+/).filter(s => s.trim()).map(b => `  • ${b.trim()}`).join('\\n')\n).join('\\n\\n');\n\nconst userMsg = `RESUME:\nTitle: ${item.resume?.currentJobTitle || ''}\nProfile: ${stripHtml(item.resume?.currentProfile || '')}\n\nWork Experience:\n${workFormatted}\n\nSkills:\n${skillsFormatted}\n\nProjects:\n${projectsFormatted}\n\nJOB DETAILS:
```

- [ ] Run the JSON validity check:

```bash
node -e "JSON.parse(require('fs').readFileSync('data/Job_Application_Automator_v6.json')); console.log('OK')"
```
Expected: `OK`

### Step 1.2: Add the projects tailoring rule block to the system prompt

- [ ] Find this anchor inside the tailor system prompt (the block immediately after SKILLS rules, just before CERTIFICATES):

```
- Keep the same number of skill entries.\n\nCERTIFICATES:
```

- [ ] Replace with (inserts a PROJECTS section between SKILLS and CERTIFICATES):

```
- Keep the same number of skill entries.\n\nPROJECTS:\n- REORDER projects so the most JD-relevant ones appear FIRST.\n- DROP irrelevant projects by omitting them from the patch (only include projects you want updated — unlisted projects keep their base description).\n- For highly relevant projects: rewrite bullets to emphasize JD-aligned tech and outcomes. Preserve existing metrics — never drop numbers like \"95+ Lighthouse score\", \"41 cloud resources\", \"20Hz refresh rate\".\n- You MAY update \"techStack\" to reorder technologies so JD-relevant ones appear first, but NEVER invent tools not in the original techStack.\n- You MAY rename a project only if the rename is a closer description of the same work (e.g., \"Cloud Infrastructure Stack\" stays as-is for DevOps roles). Do NOT rename into a different domain.\n- If the role is Salesforce-heavy and projects section is a distraction, set `showProjects: false` in the patch instead of editing each project.\n- NEVER invent new projects or tech stacks.\n\nCERTIFICATES:
```

- [ ] Run JSON validity check (same command as Step 1.1).

### Step 1.3: Add `projects[]` + `showProjects` to the output schema
 
- [ ] Find this anchor inside the STRICT JSON OUTPUT FORMAT block:

```
    \"skills\": [\n      {\n        \"id\": \"existing-id\",\n        \"skill\": \"renamed category label (omit if Salesforce role or label is still appropriate)\",\n        \"infoHtml\": \"<p>Tool A, Tool B, Tool C, Tool D</p>\"\n      }\n    ]\n  },
```

- [ ] Replace with (adds `projects` array and `showProjects` flag to the schema, between skills and the closing brace of `patch`):

```
    \"skills\": [\n      {\n        \"id\": \"existing-id\",\n        \"skill\": \"renamed category label (omit if Salesforce role or label is still appropriate)\",\n        \"infoHtml\": \"<p>Tool A, Tool B, Tool C, Tool D</p>\"\n      }\n    ],\n    \"showProjects\": false,\n    \"projects\": [\n      {\n        \"id\": \"existing-id\",\n        \"name\": \"optional rename (omit if unchanged)\",\n        \"techStack\": \"optional reorder of existing techStack (omit if unchanged)\",\n        \"description\": \"<ul><li><p>...</p></li></ul>\"\n      }\n    ]\n  },
```

- [ ] Run JSON validity check.

### Step 1.4: Commit

- [ ] Stage and commit:

```bash
git add data/Job_Application_Automator_v6.json docs/superpowers/plans/2026-04-17-prompt-quality-upgrade.md
git commit -m "feat(tailor-prompt): add projects tailoring + showProjects toggle"
```

---

# PHASE 2 — Match accuracy (stop false-negative rejections)

## Task 2: Rewrite the candidate summary in the Match prompt

**Why:** The current summary understates Karan: it says `"AWS basics"` (actually deep VPC/EC2/ALB/ASG/RDS/EFS/WAF experience), omits TypeScript, Terraform (IaC, 41 resources), Docker, Jenkins, WebRTC, Socket.IO, PostgreSQL, MongoDB, Agentforce, and the shipped AppExchange managed package. It also never mentions the MSc at Hochschule Fulda (critical signal for the German market and student-role eligibility). The effect: false-negative rejections on infra, backend, and real-time roles. Availability context (20h semester / 40h breaks, open to Werkstudent/internship/part-time/full-time/remote) is also missing.

**Files:**
- Modify: [data/Job_Application_Automator_v6.json](../../../data/Job_Application_Automator_v6.json) — node `10a. Build Match Prompt` (around line 262)

### Step 2.1: Replace the candidate skill/profile line at the end of the match system prompt

- [ ] Find this anchor (last line of the match `systemPrompt` template literal):

```
The candidate skills: Salesforce (Apex, LWC, Flows), JavaScript, Python, React, REST APIs, CI/CD, Git, AWS basics, n8n/Zapier automation.\n`;
```

- [ ] Replace with:

```
CANDIDATE PROFILE (for your reference when judging match):\n- Education: M.Sc. Global Software Development at Hochschule Fulda (Germany, ongoing) + B.E. Information Technology (CGPA 8.83/10 ≈ German 1.5).\n- Visa status: Student visa — eligible for Werkstudent (20h/week during semester, 40h/week during breaks), internships, and full-time after graduation.\n- Open to: internship, Werkstudent, part-time, full-time, and remote roles across DACH + EU — be LENIENT on role type when tech alignment is strong.\n- Core Salesforce: Apex, LWC, Aura, Flows, Sales/Service/Experience/Data Cloud, Agentforce, Salesforce DX, AppExchange managed package shipped through full security review, 85%+ Apex test coverage. Certified Platform Developer I, Agentforce Specialist, Data Cloud Consultant.\n- Software engineering: JavaScript, TypeScript, Python, C, Node.js, Express, React, Tailwind CSS, Phaser.js, REST/SOAP APIs, WebRTC, Socket.IO, Supabase (PostgreSQL), MySQL, MongoDB.\n- Cloud & DevOps: AWS (VPC, EC2, ALB, ASG, RDS, EFS, WAF), Terraform (IaC, ~41 resources), Docker, Jenkins CI/CD, GitHub Actions, Git, HPC/SLURM, MPI.\n- Automation & AI: n8n, Zapier, Agentforce Agent Builder, Prompt Templates, Playwright, AI-assisted engineering.\n- Notable hands-on projects: real-time spatial communication platform (WebRTC + Socket.IO), production AWS/Terraform stack, AI document generation pipeline (n8n + OpenAI + Playwright), distributed SUMMA matrix-multiply in C+MPI, LWC-based Custom Form Builder.\n- Languages: English C1, German active learner.\n`;
```

- [ ] Run JSON validity check.

### Step 2.2: Commit

- [ ] Stage and commit:

```bash
git add data/Job_Application_Automator_v6.json
git commit -m "fix(match-prompt): accurate candidate summary with MSc + availability context"
```

---

## Task 3: Add projects to the Match prompt user message

**Why:** Same root cause as Task 1 but on the match side. Adding 2–3 one-line project summaries (WebRTC platform, AWS/Terraform, AI pipeline) boosts match confidence for adjacent roles the filter currently borderline-rejects at 40–55.

**Files:**
- Modify: [data/Job_Application_Automator_v6.json](../../../data/Job_Application_Automator_v6.json) — node `10a. Build Match Prompt`

### Step 3.1: Add projects digest to the match user message

- [ ] Find this anchor (the section that builds `recentWork`):

```
const recentWork = (item.resume?.currentWork || [])\n  .slice(0, 2)\n  .map(w =>\n    `${w.jobTitle || ''} at ${w.employer || ''}: ${(w.description || '').slice(0, 120)}`\n  )\n  .join(' | ');
```

- [ ] Replace with (adds a `projectsDigest` variable after `recentWork`):

```
const recentWork = (item.resume?.currentWork || [])\n  .slice(0, 2)\n  .map(w =>\n    `${w.jobTitle || ''} at ${w.employer || ''}: ${(w.description || '').slice(0, 120)}`\n  )\n  .join(' | ');\n\nconst projectsDigest = (item.resume?.currentProjects || [])\n  .slice(0, 5)\n  .map(p => `${p.name} (${p.techStack || 'n/a'})`)\n  .join(' | ');
```

- [ ] Find this anchor in the `userMsg` template literal:

```
Skills:\n${skills || 'N/A'}\n\nJob:
```

- [ ] Replace with:

```
Skills:\n${skills || 'N/A'}\n\nKey Projects:\n${projectsDigest || 'N/A'}\n\nJob:
```

- [ ] Run JSON validity check.

### Step 3.2: Commit

- [ ] Stage and commit:

```bash
git add data/Job_Application_Automator_v6.json
git commit -m "feat(match-prompt): include key projects in candidate context"
```

---

## Task 4: Add Werkstudent / remote / internship calibration examples to the Match prompt

**Why:** All 6 existing calibration examples are full-time. Adding Werkstudent, remote, internship, and part-time examples anchors the model correctly for the role types Karan actually wants.

**Files:**
- Modify: [data/Job_Application_Automator_v6.json](../../../data/Job_Application_Automator_v6.json) — node `10a. Build Match Prompt`

### Step 4.1: Add four new calibration examples

- [ ] Find this anchor (existing Werkstudent example + following `Senior DevOps Engineer` example):

```
- \"Werkstudent Softwareentwicklung\" at BMW: {\"match\":true,\"confidence\":68,\"reason\":\"Entry-level tech role, transferable development skills\",\"jobType\":\"werkstudent\"}\n- \"Senior DevOps Engineer\" at Delivery Hero: {\"match\":true,\"confidence\":72,\"reason\":\"Infrastructure role, candidate has CI/CD and AWS experience\",\"jobType\":\"full-time\"}
```

- [ ] Replace with (inserts 4 new examples after the existing two):

```
- \"Werkstudent Softwareentwicklung\" at BMW: {\"match\":true,\"confidence\":68,\"reason\":\"Entry-level tech role, transferable development skills\",\"jobType\":\"werkstudent\"}\n- \"Senior DevOps Engineer\" at Delivery Hero: {\"match\":true,\"confidence\":72,\"reason\":\"Infrastructure role, candidate has CI/CD and AWS experience\",\"jobType\":\"full-time\"}\n- \"Werkstudent Cloud / DevOps\" at N26: {\"match\":true,\"confidence\":80,\"reason\":\"Direct match for AWS/Terraform project experience, student-friendly hours\",\"jobType\":\"werkstudent\"}\n- \"Remote Full-Stack Engineer (EU)\" at a Berlin startup: {\"match\":true,\"confidence\":75,\"reason\":\"React + Node stack matches, fully remote\",\"jobType\":\"full-time\"}\n- \"Software Engineering Intern\" at SAP: {\"match\":true,\"confidence\":72,\"reason\":\"Tech internship, skill overlap, eligible via student visa\",\"jobType\":\"internship\"}\n- \"Part-time Salesforce Developer (20h/week)\" at a consultancy: {\"match\":true,\"confidence\":90,\"reason\":\"Core expertise, matches Werkstudent hour cap\",\"jobType\":\"werkstudent\"}
```

- [ ] Run JSON validity check.

### Step 4.2: Update lenient-entry-level rule to cover part-time and remote

- [ ] Find this anchor:

```
- Internship / Werkstudent in ANY tech field: confidence 60+ (be lenient with entry-level tech roles)\n- Junior roles in software/IT: confidence 65+ (transferable skills)\n
```

- [ ] Replace with:

```
- Internship / Werkstudent / part-time in ANY tech field: confidence 60+ (be lenient — candidate is explicitly open to all these formats)\n- Junior roles in software/IT: confidence 65+ (transferable skills)\n- Remote tech roles based anywhere in DACH or EU: do NOT penalize for being remote — candidate is open to remote\n- Roles with \"Werkstudent\", \"Praktikum\", \"Intern\", \"Teilzeit\", or \"part-time\" in the title: these are HIGH-priority matches for this candidate — bias confidence +10 if tech-aligned\n
```

- [ ] Run JSON validity check.

### Step 4.3: Commit

- [ ] Stage and commit:

```bash
git add data/Job_Application_Automator_v6.json
git commit -m "feat(match-prompt): add werkstudent/remote/intern calibration"
```

---

# PHASE 3 — Cover letter quality

## Task 5: Add JD-specific hook rule + per-paragraph word budgets

**Why:** P1 currently says "state role, company, MSc, strong hook" — produces template-grade openings. Adding a "quote one specific JD detail" rule forces personalization. Per-paragraph word targets fix imbalanced 40/120/40 splits.

**Files:**
- Modify: [data/Job_Application_Automator_v6.json](../../../data/Job_Application_Automator_v6.json) — node `13a. Build Tailor Prompt`

### Step 5.1: Replace the cover-letter paragraph rules

- [ ] Find this anchor (the P1/P2/P3 rule block):

```
P1:\n- State role and company name\n- Mention MSc Hochschule Fulda (Germany)\n- Start with a strong, specific hook tied to relevant experience\n\nP2:\n- 2–3 concrete skills or project outcomes aligned with the job\n- Include specific technologies and results\n- No generic claims\n\nP3:\n- Clearly state availability (internship / Werkstudent / full-time)\n- Match jobType context\n- End with a confident and direct closing
```

- [ ] Replace with:

```
P1 (target: 50–70 words):\n- State the role and company name.\n- Mention the M.Sc. Global Software Development at Hochschule Fulda.\n- REQUIRED: include ONE specific detail from this JD — a product name, a team/department, a mentioned technology, or a company mission phrase. Quote or paraphrase it. Never open with a template sentence.\n- Tie that detail directly to Karan's matching experience in a single clean hook.\n\nP2 (target: 80–110 words):\n- Provide 2–3 concrete skills or project outcomes that map to the JD.\n- Reference specific technologies by name (e.g., \"Terraform and AWS VPC\", not \"cloud experience\").\n- Preserve any quantitative metric that fits: test coverage %, deployment time reductions, Lighthouse scores, refresh rates, resource counts. Germans trust numbers.\n- Each sentence must add new information — no filler, no paraphrased repeats of P1.\n\nP3 (target: 40–60 words):\n- State availability explicitly using the candidate's real constraints: \"20 hours/week during the semester and up to 40 hours/week during semester breaks\" for Werkstudent/part-time; \"full-time from [expected graduation] onward\" for full-time; \"available immediately for a 3–6 month internship\" for internships. Use what fits the role.\n- Mention open to on-site (Hesse/Germany) AND remote.\n- Close with a confident, direct sentence inviting next steps — no clichés.
```

- [ ] Run JSON validity check.

### Step 5.2: Commit

- [ ] Stage and commit:

```bash
git add data/Job_Application_Automator_v6.json
git commit -m "feat(tailor-prompt): JD hook rule + per-paragraph word budgets"
```

---

## Task 6: Add tone/register guidance (DE formal Sie, EN startup vs enterprise)

**Why:** German cover letters need formal "Sie" and restrained register; English startup letters need a warmer voice; enterprise English needs measured/professional. The prompt currently produces a flat middle-register voice everywhere.

**Files:**
- Modify: [data/Job_Application_Automator_v6.json](../../../data/Job_Application_Automator_v6.json) — node `13a. Build Tailor Prompt`

### Step 6.1: Insert a TONE & REGISTER block into cover-letter rules

- [ ] Find this anchor (closing of the STRICT list at the end of COVER LETTER RULES):

```
- If job requires German and resume does not show it → do NOT claim German skills\n\n========================\nOUTPUT FORMAT (STRICT JSON)
```

- [ ] Replace with:

```
- If job requires German and resume does not show it → do NOT claim German skills\n\nTONE & REGISTER:\n- If language=\"de\": use formal \"Sie\" throughout. Restrained, precise, confident. Avoid colloquialisms. Do not translate English idioms literally.\n- If language=\"en\" AND the company reads like a startup (small team, fast-paced, product-led, YC/Series A wording in JD): warmer, more direct voice. First-person \"I\" is fine. One sentence may show personality.\n- If language=\"en\" AND the company reads like enterprise (DAX/Fortune-style, formal JD, compliance/governance mentions, \"we are seeking\"): measured, professional register. No contractions. Keep personality restrained.\n- If unsure which English register: default to enterprise/professional.\n- NEVER mix registers inside one letter.\n\n========================\nOUTPUT FORMAT (STRICT JSON)
```

- [ ] Run JSON validity check.

### Step 6.2: Commit

- [ ] Stage and commit:

```bash
git add data/Job_Application_Automator_v6.json
git commit -m "feat(tailor-prompt): add tone/register guidance (DE Sie, EN startup/enterprise)"
```

---

## Task 7: Expand the anti-cliché list (EN + DE)

**Why:** The existing list ("passionate, excited, team player, fast learner, driven") is a starting point. Adding known-generic openings and filler phrases — in both English and German — removes the remaining templated-feeling sentences.

**Files:**
- Modify: [data/Job_Application_Automator_v6.json](../../../data/Job_Application_Automator_v6.json) — node `13a. Build Tailor Prompt`

### Step 7.1: Replace the no-clichés rule

- [ ] Find this anchor:

```
- No clichés: \"passionate\", \"excited\", \"team player\", \"fast learner\", \"driven\"
```

- [ ] Replace with:

```
- No clichés. Hard-banned English phrases: \"passionate\", \"excited\", \"team player\", \"fast learner\", \"driven\", \"I am writing to apply\", \"I would like to apply\", \"dynamic environment\", \"cutting-edge\", \"proven track record\", \"hit the ground running\", \"think outside the box\", \"results-oriented\", \"self-starter\", \"synergy\".\n- Hard-banned German phrases: \"hochmotiviert\", \"bringe ich mit\", \"dynamisches Umfeld\", \"Herausforderung\" as filler, \"Teamplayer\", \"Hands-on-Mentalität\", \"ich bewerbe mich hiermit\", \"mit großem Interesse\", \"Quereinsteiger\" as filler.\n- If you catch yourself writing one of these, rewrite the sentence with a concrete detail instead.
```

- [ ] Run JSON validity check.

### Step 7.2: Commit

- [ ] Stage and commit:

```bash
git add data/Job_Application_Automator_v6.json
git commit -m "feat(tailor-prompt): expand anti-cliché list (EN + DE)"
```

---

## Task 8: Bilingual JD handling + German-required-English-JD case

**Why:** The current language detection is binary. Bilingual JDs (English summary + German requirements) and English JDs from DE companies that require German skills cause inconsistent letter language. Explicit rules eliminate the drift.

**Files:**
- Modify: [data/Job_Application_Automator_v6.json](../../../data/Job_Application_Automator_v6.json) — node `13a. Build Tailor Prompt`

### Step 8.1: Replace the LANGUAGE DETECTION block

- [ ] Find this anchor:

```
========================\nLANGUAGE DETECTION\n========================\n\nDetect the language of the job description:\n- If the JD is written in German OR explicitly requires German language skills → set \"language\": \"de\"\n- Otherwise → set \"language\": \"en\"\n\nWrite ALL text content (profile, work bullets, cover letter) in the detected language.\nResume section headings are handled separately — only the content you write needs to match.
```

- [ ] Replace with:

```
========================\nLANGUAGE DETECTION\n========================\n\nDecide the output language using this priority:\n\n1. If the majority of the JD body text is in German → language=\"de\".\n2. If the JD body is in English AND the JD explicitly requires German language skills (e.g. \"fluent German required\", \"Deutsch C1\", \"Verhandlungssicheres Deutsch\"): language=\"en\", but P3 of the cover letter must include one sentence acknowledging openness to working in German environments (without overclaiming current fluency — candidate is an active learner, not C1).\n3. If the JD is bilingual (English summary + German requirements section): use whichever language dominates the REQUIREMENTS section. If tied, default to German.\n4. If the JD is in English AND German is not required: language=\"en\".\n\nWrite ALL text content (profile, work bullets, cover letter) in the detected language.\nResume section headings are handled separately — only the content you write needs to match.
```

- [ ] Run JSON validity check.

### Step 8.2: Commit

- [ ] Stage and commit:

```bash
git add data/Job_Application_Automator_v6.json
git commit -m "feat(tailor-prompt): bilingual JD + German-required-English-JD handling"
```

---

# PHASE 4 — Resume tailoring polish

> **Ordering:** Tasks 9 → 10 → 11 must run in order. Task 10's anchor text is introduced by Task 9; Task 11.1's anchor relies on Task 1 having already run. Phase 1–3 tasks are independent.

## Task 9: Metric preservation + "sprinkle metrics" rule

**Why:** Your work bullets contain rare credible numbers ("85%+ Apex test coverage", "~40% deployment time reduction"). Projects have more ("95+ Lighthouse score", "20Hz refresh rate", "~41 cloud resources", "sub-1-second load", "56.85 KB gzipped"). AI drift tends to strip these when rewriting. German recruiters weight metrics heavily. Explicit preservation + "keep visible metrics in every section where they exist" rule.

**Files:**
- Modify: [data/Job_Application_Automator_v6.json](../../../data/Job_Application_Automator_v6.json) — node `13a. Build Tailor Prompt`

### Step 9.1: Insert a METRICS rule block between WORK EXPERIENCE and the PROJECTS rules added in Task 1

- [ ] Find this anchor (end of WORK EXPERIENCE rules, just before SKILLS):

```
  If a bullet has no relevance to the target role, DROP it rather than rewriting it into a false narrative.\n  But make sure to have enough content in experience section so that recruiters see a strong technical background — do not fabricate non-technical experience.\n\nSKILLS:
```

- [ ] Replace with:

```
  If a bullet has no relevance to the target role, DROP it rather than rewriting it into a false narrative.\n  But make sure to have enough content in experience section so that recruiters see a strong technical background — do not fabricate non-technical experience.\n\nMETRICS (German recruiters weight numbers heavily):\n- PRESERVE every quantitative metric that already exists in the resume (percentages, test coverage %, time reductions, resource counts, refresh rates, scores, file sizes). Never drop an existing number when rewriting a bullet.\n- If a kept bullet does not currently contain a metric but a credible one exists in nearby context (e.g., \"85%+ Apex test coverage\", \"~40% deployment time reduction\"), you MAY re-surface it — ONLY if it is factually present elsewhere in the resume. Never invent numbers.\n- Aim for at least one quantitative metric in the Work section, at least one in Projects, and at least one in the cover letter P2.\n- If no credible metric exists for a bullet, leave it qualitative — do not fabricate.\n\nSKILLS:
```

- [ ] Run JSON validity check.

### Step 9.2: Commit

- [ ] Stage and commit:

```bash
git add data/Job_Application_Automator_v6.json
git commit -m "feat(tailor-prompt): metric preservation and surface rule"
```

---

## Task 10: Pin AppExchange + Agentforce bullets for Salesforce roles

**Why:** The shipped-through-security-review AppExchange package and Agentforce AI integration work are 1-in-100 credentials for Salesforce roles. They should always surface in the top 3 bullets for any Salesforce-related JD.

**Files:**
- Modify: [data/Job_Application_Automator_v6.json](../../../data/Job_Application_Automator_v6.json) — node `13a. Build Tailor Prompt`

### Step 10.1: Add a pinning rule at the end of the WORK EXPERIENCE rule block

- [ ] Find this anchor (end of WORK EXPERIENCE rules, just before METRICS block added in Task 9):

```
  But make sure to have enough content in experience section so that recruiters see a strong technical background — do not fabricate non-technical experience.\n\nMETRICS (German recruiters weight numbers heavily):
```

- [ ] Replace with:

```
  But make sure to have enough content in experience section so that recruiters see a strong technical background — do not fabricate non-technical experience.\n\nCROWN-JEWEL BULLETS FOR SALESFORCE ROLES:\n- If the JD is Salesforce-related (CRM, Apex, LWC, Agentforce, AppExchange, Sales Cloud, Service Cloud, Data Cloud, Experience Cloud), these two bullets from the MV Clouds entry MUST appear in the top 3 of the reordered description:\n  1. The AppExchange managed package bullet (\"Built and published a production package through Salesforce's full security review cycle...\")\n  2. The Agentforce and AI integration bullet (\"Configured Agentforce AI agents with custom actions and REST API interfaces...\")\n- You may slightly rewrite wording to emphasize JD-aligned terms, but the substance and metrics (85%+ test coverage, security review, real-time REST) must remain.\n- For non-Salesforce roles these bullets may be dropped or de-prioritized per the standard REORDER/DROP rules.\n\nMETRICS (German recruiters weight numbers heavily):
```

- [ ] Run JSON validity check.

### Step 10.2: Commit

- [ ] Stage and commit:

```bash
git add data/Job_Application_Automator_v6.json
git commit -m "feat(tailor-prompt): pin AppExchange + Agentforce bullets for SF roles"
```

---

## Task 11: Skill ordering hint + self-check at end of tailor prompt

**Why:** The model should emit skill entries in the desired display order (merge logic preserves whatever order the AI returns on matched ids, but base resume keeps unmatched entries in place — mixed order possible). A final self-check line catches ~half of schema-drift errors before they hit the parse node.

**Files:**
- Modify: [data/Job_Application_Automator_v6.json](../../../data/Job_Application_Automator_v6.json) — node `13a. Build Tailor Prompt`

### Step 11.1: Add a skill-order note to the SKILLS rule block

- [ ] Find this anchor (inside the SKILLS rule block):

```
- Keep the same number of skill entries.
```

- [ ] Replace with (no backticks in the inserted text — avoids template-literal escape pitfalls):

```
- Keep the same number of skill entries.\n- Return the skills array in the display ORDER you want (most JD-relevant first). The base resume preserves the order of IDs you provide in the patch for entries that are renamed or updated.
```

- [ ] Run JSON validity check.

### Step 11.2: Add a SELF-CHECK block before FINAL RULES

- [ ] Find this anchor:

```
========================\nFINAL RULES\n========================\n\n- Always make at least one meaningful improvement if possible
```

- [ ] Replace with:

```
========================\nSELF-CHECK BEFORE EMITTING JSON\n========================\n\nBefore you output, silently verify:\n1. Every `id` in `patch.work`, `patch.skills`, and `patch.projects` appears in the input RESUME block.\n2. No tool, technology, or domain appears in the output that is not present in the input resume.\n3. `coverLetter` is an OBJECT with exactly three keys: `paragraph1`, `paragraph2`, `paragraph3` — each a non-empty string.\n4. `language` is exactly \"de\" or \"en\" and matches the detected JD language per the LANGUAGE DETECTION rules.\n5. No banned cliché phrase from the anti-cliché list appears in any paragraph.\n6. At least one quantitative metric appears in the Work section (if any work entries are present in the patch) and in cover letter P2.\n7. For Salesforce JDs: AppExchange + Agentforce bullets are in the top 3 of the relevant work entry.\n8. JSON is valid and parseable — no trailing commas, no comments, no text outside the JSON object.\n\nIf any check fails, fix silently before emitting.\n\n========================\nFINAL RULES\n========================\n\n- Always make at least one meaningful improvement if possible
```

- [ ] Run JSON validity check.

### Step 11.3: Commit

- [ ] Stage and commit:

```bash
git add data/Job_Application_Automator_v6.json
git commit -m "feat(tailor-prompt): skill order hint + pre-emit self-check"
```

---

# PHASE 5 — Verification & end-to-end test

## Task 12: Run the full pipeline against three representative JDs and review

**Why:** Final sanity pass. Confirm the prompts produce stronger outputs across the three role types Karan actually applies to.

**Files (no code change):**
- Run: [scripts/test.js](../../../scripts/test.js) and [scripts/test-coverletter.js](../../../scripts/test-coverletter.js)
- Invoke: `test-resume` skill for end-to-end

### Step 12.1: Start the server

- [ ] In one terminal:

```bash
npm start
```
Expected: `Server listening on port 3000`

### Step 12.2: Run the unit tests

- [ ] In another terminal:

```bash
npm run test:unit
```
Expected: all `validatePatch` tests pass. Fix any regressions before continuing.

### Step 12.3: Run the built-in manual tests

- [ ] Run:

```bash
npm test
npm run test:coverletter
```
Expected: both generate PDFs under `output/YYYY-MM-DD/` without errors.

### Step 12.4: End-to-end via the `test-resume` skill

- [ ] Invoke the `test-resume` skill against these three representative JD scenarios (picked to exercise the three biggest prompt changes):
  1. **Salesforce Developer** at a DE SaaS — verify AppExchange + Agentforce bullets lead, cert shown, profile mentions Salesforce + MSc, cover letter DE with formal Sie.
  2. **DevOps / Cloud Infrastructure Engineer** at a startup — verify skills renamed to "Infrastructure & DevOps", Terraform + AWS projects surfaced and reordered, certs hidden, cover letter EN startup register.
  3. **Werkstudent Softwareentwicklung** at a DE enterprise — verify match confidence ≥70, P3 of cover letter states 20h/40h availability explicitly, language DE.

- [ ] For each output, review:
  - [ ] Profile section mentions MSc at Hochschule Fulda
  - [ ] Projects section is reordered (or hidden) per JD
  - [ ] Work bullets preserve metrics; crown-jewel bullets surfaced for SF role
  - [ ] Cover letter P1 references one specific JD detail
  - [ ] Cover letter paragraphs roughly match 50–70 / 80–110 / 40–60 word budgets
  - [ ] No banned cliché phrases
  - [ ] P3 has correct availability phrasing

### Step 12.5: Commit the plan as completed

- [ ] If any task needs a follow-up tweak, append a short note to this plan document under a `## Follow-ups` section and commit. Otherwise:

```bash
git commit --allow-empty -m "chore: prompt quality upgrade pipeline verified on 3 representative JDs"
```

---

# Summary of changes

| # | File | Node / area | Effect |
|---|------|------------|--------|
| 1 | workflow JSON | `13a` user msg + system prompt + schema | Projects tailored per JD |
| 2 | workflow JSON | `10a` system prompt | Accurate candidate summary with MSc + availability |
| 3 | workflow JSON | `10a` user msg | Match filter sees key projects |
| 4 | workflow JSON | `10a` examples + rules | Werkstudent/remote/intern bias |
| 5 | workflow JSON | `13a` cover-letter rules | JD hook + per-paragraph word budgets |
| 6 | workflow JSON | `13a` cover-letter rules | Tone/register (DE Sie, EN startup/enterprise) |
| 7 | workflow JSON | `13a` cover-letter rules | Expanded anti-cliché list (EN + DE) |
| 8 | workflow JSON | `13a` language detection | Bilingual + German-required-English-JD |
| 9 | workflow JSON | `13a` system prompt | Metric preservation + surface rule |
| 10 | workflow JSON | `13a` work rules | Pin AppExchange + Agentforce for SF roles |
| 11 | workflow JSON | `13a` skills + end | Skill display order + self-check |
| 12 | n/a | verification | End-to-end test on 3 JDs |

No server-side (`src/*.js`) changes required — the API already accepts `patch.projects[]` and `showProjects`.

---

## Follow-ups

End-to-end run on 2026-04-17 against three representative JDs (SF Developer & Architect @ EMEA Company, Cloud DevOps Engineer @ MVTec Software, Working Student Full-Stack @ SAP). All 6 PDFs generated successfully and the prompts did not crash, but the following quality issues surfaced — candidates for a second-pass iteration.

**Update 2026-04-18:** A second-pass iteration was applied (3 sub-iterations). Resolved items are marked ✅ below; residual items are marked ⚠ with the underlying cause.

1. ✅ **`showProjects: false` over-applied across all three JDs.** RESOLVED. Flipped the default from suppress to include and added HARD MAPPINGS (SF → AI-Powered Document Generation Pipeline; Cloud/DevOps → Cloud Infrastructure Stack; React/Full-stack → University Marketplace + Real-Time Spatial Communication Platform). Verified: all 3 JDs now return 2–3 projects with `showProjects: true`.

2. ✅ **`showCertificates: false` wrongly set for the Salesforce role.** RESOLVED. Added explicit rule: SF roles (JD mentions Salesforce/Apex/Lightning/LWC/CRM/SOQL/Cloud/Agentforce/Flow/AppExchange) MUST keep `showCertificates: true`; non-SF technical roles set false. Verified: SF-EMEA now returns true, DevOps + SAP return false.

3. ⚠ **Cover letter P2 still ~60–80 words vs 80–110 target.** PARTIALLY RESOLVED. Added MUST-be-X-Y phrasing, sentence+element requirements, and worked DE+EN examples hitting 94/93 words. gpt-4o-mini still produces 4-sentence ~70-word P2's regardless of prompt strength. Quality content is correct (metrics retained, crown-jewel projects surfaced), only length falls short. **Fundamental cause:** instruction-following limit of gpt-4o-mini on long prompts. **Real fixes:** (a) upgrade tailor model from `gpt-4o-mini` to `gpt-4o` in node 1 (~10× cost), or (b) add server-side word-count validation in node 14 that triggers regeneration. Neither is a prompt-only fix.

4. ⚠ **P3 still 29–30 words vs 40–60 target.** PARTIALLY RESOLVED. The atomic-sentence rule (3 separate sentences for availability / location / close) IS working — P3 is now correctly 3 sentences across all 3 JDs (was 2 before). But each sentence stays terse. Same root cause as item 3. P3 content quality is correct (concrete availability, on-site city named, professional close).

5. ✅ **"Ich bewerbe mich um die Position..." opener appears in all three P1's.** RESOLVED. Lifted `Ich bewerbe mich` (any form) into a top-of-prompt ABSOLUTE BANS section with concrete replacement guidance. Verified: all 3 P1's now open with JD-specific concrete hooks ("Die Verantwortung für…", "Die Entwicklung maßgeschneiderter Salesforce-Lösungen…", "Supporting the design and enhancement of UI features…"). Note: `bringe ich` regression in iter-2 also caught and fixed in iter-3 with the same lifted-ban approach.

6. ✅ **SAP English JD was classified as `language: de`.** RESOLVED. Tightened LANGUAGE DETECTION rule 2 to require an explicit hard German-skill phrase ("fluent German", "C1", "Verhandlungssicheres Deutsch", "sehr gute Deutschkenntnisse", etc.); explicitly downgraded "German is a plus / nice to have / wünschenswert" to language="en". Verified: SAP-WorkingStudent now correctly returns `language: en`.

7. ✅ **Profile first 80 chars does not mention MSc / Hochschule Fulda.** RESOLVED. Added mandate to PROFILE rule: first sentence MUST name the M.Sc. in Global Software Development at Hochschule Fulda. Verified: all 3 profiles now open with this anchor (DE: "M.Sc. Global Software Development an der Hochschule Fulda…", EN: "M.Sc. in Global Software Development at Hochschule Fulda…").

8. ⚠ **Banned-substring scanning unreliable for "dynamic environment".** New regression observed in iter-3 SAP P2. Despite "dynamic environment" being on the English banned list since Task 7, gpt-4o-mini emitted "I am eager to apply my skills in a dynamic environment at SAP." Same model-instruction-following limit as items 3-4. The SELF-CHECK gate is in the prompt but not always honored. **Real fix:** add programmatic substring rejection in node 14 (Parse AI Patch) that triggers regeneration on hit.

### What's left

Items 3, 4, 8 are the three residual issues. All share one root cause: gpt-4o-mini cannot reliably enforce numeric or substring constraints inside its own output. The right next move is **not** another prompt revision — it's one of two architecture changes:

- **Option A (cheap, more code):** add a word-count + banned-substring validator in node 14, triggering up to one regeneration call when the patch fails. Cost: marginal (~1 extra OpenAI call on ~20% of jobs). Implementation: ~30 lines in node 14's existing parse logic.
- **Option B (no code, more cost):** swap `openaiModel` in node 1 from `gpt-4o-mini` to `gpt-4o`. Cost: ~10× per tailor call. Quality lift on long-form instructions is significant in our experience.

For a personal job-application pipeline where every callback matters more than every cent, Option A is preferred — defer Option B unless A still leaves residual issues after a second observation window.

### Step 12.5: Commit the plan as completed — DONE

Follow-ups captured 2026-04-17 after the initial verification run; second-pass resolution applied 2026-04-18 (3 sub-iterations against the same 3 JDs).
