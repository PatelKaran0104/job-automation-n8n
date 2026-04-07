Pipeline Audit: Remaining Improvements
P0 — Bugs / Gaps That Affect Reliability
1. 18b. Log Skipped to Sheets is missing the Quality column in its schema

Node 18a. Prepare Skip Log correctly outputs Quality: 'Skipped' and 10a2. Prepare Pre-Filter Log outputs Quality: 'Pre-Filter Reject', but the 18b node's Google Sheets schema (line ~670) has no Quality entry — only 17. Log to Google Sheets does. With autoMapInputData this happens to work if the sheet column exists, but it's fragile. Add the Quality schema entry to 18b for consistency.

2. Empty company from Glassdoor scraper (post-mortem #6)

The extractCompanyFromUrl() fallback in node 4. Normalize & Merge Jobs only matches the -at-COMPANY-JV_ Glassdoor URL pattern. Many Glassdoor listings use different URL formats. Result: company: "Unknown Company" → the resume PDF gets named resume-unknown-company--role.pdf and the sheet log is useless for that row.

Fix: In BOARD_CONFIG['2d. Scrape Glassdoor'].fields.company, expand the fallback chain. Glassdoor scraper also provides companyName at the top level and company object with nested fields. Add these to the array:


company: ['company.companyName', 'company.name', 'companyName', 'employer_name'],
3. PDF failure without diagnostics (post-mortem #7)

Both 15a and 15b have continueOnFail: true. When 15a (resume) fails, the pipeline still generates the cover letter via 15b, creating an orphaned cover letter with no matching resume. The 16. Prepare Sheet Log sets Status: 'PDF Failed' but the Notes field only captures _coverLetterWarning, not the actual PDF error message.

Fix: In 16. Prepare Sheet Log, capture the error from the resume result:


Notes: patchData.patch?._error 
  || resumeResult.error       // ← ADD THIS
  || patchData._coverLetterWarning 
  || '',
4. Error sentinel from node 4 leaks into the pipeline

If ALL 5 scrapers fail, node 4 returns { error: 'No valid jobs...' }. This flows to 6. Filter Duplicates, which treats it as a job array with 0 items via $('4. Normalize & Merge Jobs').all(). But if the error sentinel reaches 8. Attach Resume to Jobs, the skipped check passes (it's not skipped, it's error). The sentinel gets treated as a real job and flows into the Gemini call with no title/description.

Fix: In 8. Attach Resume to Jobs, add:


if (jobs.length === 1 && (jobs[0].json.skipped || jobs[0].json.error)) {
  return [{ json: jobs[0].json }];
}
P1 — Quality Improvements (Better Output)
5. Enforce work + skills presence in AI patch

The tailor prompt says "You MUST update work bullets AND skills in every response" but 14. Parse AI Patch never checks this. If the AI returns a patch with only jobTitle and profile (lazy response), it passes validation and produces a generic resume.

Fix: In 14. Parse AI Patch, add to the quality flag logic:


const hasWorkChanges = Array.isArray(patch.work) && patch.work.length > 0;
const hasSkillChanges = Array.isArray(patch.skills) && patch.skills.length > 0;
if (!hasWorkChanges || !hasSkillChanges) {
  _qualityFlag = 'Review';  // AI didn't fully tailor
}
6. Match confidence few-shot examples

The Gemini prompt has detailed calibration bands (90-100, 75-89, etc.) but no concrete examples. LLMs follow examples better than rules. The confidence still clusters.

Fix: Add 3-4 few-shot examples to the Gemini system prompt:


EXAMPLES:
Input: "Salesforce Developer" → {"match":true,"confidence":95,"reason":"Core Salesforce role","jobType":"full-time"}
Input: "Junior Backend Developer (Python/Node.js)" → {"match":true,"confidence":78,"reason":"Software dev, overlapping stack","jobType":"full-time"}
Input: "IT Project Manager" → {"match":false,"confidence":30,"reason":"Management role, not development","jobType":"full-time"}
Input: "Werkstudent Softwareentwicklung" → {"match":true,"confidence":65,"reason":"Entry-level tech, transferable skills","jobType":"werkstudent"}
7. JD extraction wastes tokens on "What we offer" / benefits sections

Both 10a and 13a extract JD sections by splitting on requirements keywords, but include the full intro (first 300 chars) + everything after the requirements heading — including "Was wir bieten" / "Benefits" / "What we offer" which are irrelevant to matching/tailoring.

Fix: After extracting jdImportant, filter out benefits sections:


jdImportant = jdImportant
  .replace(/(?:was wir bieten|what we offer|benefits|unsere leistungen|unser angebot)[\s\S]{0,500}/gi, '')
  .trim();
8. Cover letter language mismatch

Cover letter is hardcoded German. If the JD is in English (common for international companies in Germany), a German cover letter looks odd.

Fix: Add language detection in 10a. Build Match Prompt — check if JD contains common German markers (Anforderungen, Aufgaben, Profil, wir bieten). Pass language: "de" | "en" in matchResult. Then in 13a, conditionally adjust the cover letter instructions and in the Express server, support an English template.

This is a bigger change — worth planning separately.

P2 — Efficiency / Cost Optimization
9. 10b. Wait delay is 5 seconds — likely too conservative for Gemini Flash-Lite

Gemini 3.1 Flash-Lite has generous rate limits (especially on free tier: 30 RPM). With batchSize: 1 and 5s wait, processing 50 jobs takes ~4 minutes just in wait time.

Fix: Reduce 10b. Wait to 2-3 seconds, or increase batch size to 2-3 and test for rate limit errors.

10. Rate limiting in 13a uses await sleep inside a Code node

The PRE_CALL_DELAY_MS = 6000 sleep in 13a. Build Tailor Prompt blocks the n8n execution thread. Combined with the 10b. Wait and the OpenAI API call itself, each job takes ~15-20 seconds. For 57 matched jobs, that's 15+ minutes.

Fix: Remove the in-code sleep from 13a and add a dedicated n8n Wait node between 13a and 13b (like you did with 10b. Wait). This is cleaner and doesn't risk n8n execution timeouts.

11. Indeed and Glassdoor search terms are narrower than LinkedIn

LinkedIn URL searches for 9+ role titles (Salesforce Developer OR Software Developer OR Werkstudent Softwareentwicklung OR Junior Developer OR Backend Developer OR Frontend Developer OR Full Stack Developer OR DevOps Engineer OR Software Engineer). But Indeed's title field only has 5 terms, and Glassdoor only searches ["Salesforce Developer", "Software Engineer"].

Fix: Align search terms across all scrapers. Add Junior Developer, Backend Developer, DevOps Engineer to Glassdoor keywords. Add Full Stack Developer, DevOps Engineer, Software Engineer to Indeed's title field.

P3 — Monitoring / Observability
12. No run summary or notification

After 9. Loop Over Items completes (output 0 — done branch), there's no connected node. You have no visibility into how a run went unless you check the sheet manually.

Fix: Connect the "done" output of 9. Loop Over Items to a Code node that aggregates stats from the execution data (total processed, matched, skipped, pre-filtered, PDF errors), then send a summary via email/Slack/Telegram. Even a simple Google Sheets row in a "Run Summary" tab would help.

13. workflow.active: false

The workflow is set to active: false (line 1464). The Schedule Trigger (Daily 8am) won't fire until it's activated. If this is intentional (you use "Run Workflow" manual trigger), fine — but worth noting.

Summary — Priority Order
# |	Fix	| Impact | Effort

6	| Few-shot examples for match confidence |	High quality |	Small (prompt edit)
5	| Enforce work+skills in quality flag |	High quality |	Small (code edit)
11	| Align scraper search terms re jobs found |	Small (config edit)
2	| Glassdoor empty company fallback |	Fix bad data |	Small
3	| Capture resume PDF error in Notes |	Better debugging |	Tiny
1	| Quality schema in 18b |	Consistency |	Tiny
9	| Reduce wait to 2-3s |	2-3 min saved/run |	Tiny
10	| Move rate limit sleep to n8n Wait node |	Reliability |	Small
7	| Filter "benefits" sections from JD |	Better token usage |	Small
4	| Handle error sentinel from node 4 |	Edge case fix |	Tiny
12	| Run summary notification |	Observability |	Medium
8	| Cover letter language detection |	Quality for EN jobs |	Large
Want me to implement some of these? I'd suggest starting with #6, #5, #11, #2, #3, and #1 — they're all small, high-impact changes in the workflow JSON and server code.

