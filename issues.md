Pipeline Audit: Remaining Improvements

All P0 bugs, P1 quality improvements, and P2 efficiency fixes from the original audit have been resolved.
Remaining items are listed below.

---

## Open Issues

### 1. Cover letter language mismatch (P1 — Large effort)

Cover letter is hardcoded German. If the JD is in English (common for international companies in Germany), a German cover letter looks odd.

**Plan:**
1. In `10a. Build Match Prompt`, add language detection to the Gemini prompt output — check if JD contains common German markers (Anforderungen, Aufgaben, Profil, wir bieten). Return `language: "de" | "en"` alongside `match`, `confidence`, `reason`, `jobType`.
2. In `11. Parse Match Result`, pass through `matchResult.language` to downstream nodes.
3. In `13a. Build Tailor Prompt`, conditionally switch cover letter instructions (German salutation/closing vs English).
4. In `src/mergeCoverLetter.js`, add an English template variant — different salutation ("Dear Hiring Manager"), closing ("Best regards"), date format, and subject line.
5. In `POST /generate-coverletter`, accept an optional `language` field and route to the correct template.

**Risk:** Moderate — touches 4 nodes + 1 server file. Test with a known English JD and a known German JD.

---

### 2. No run summary or notification (P3 — Medium effort)

After `9. Loop Over Items` completes (output 0 — done branch), there's no connected node. No visibility into how a run went unless you check the sheet manually.

**Plan:**
1. Create a new Code node (`19. Build Run Summary`) connected to output 0 (done) of `9. Loop Over Items`.
2. Aggregate stats from execution data: total processed, matched, skipped, pre-filtered, PDF errors, quality flag breakdown.
3. Connect to a notification node — options:
   - **Simplest:** Append a summary row to a "Run Summary" tab in the existing Google Sheet.
   - **Better:** Send a Telegram/email with the summary.
4. Wire the done output of `9. Loop Over Items` → `19. Build Run Summary` → notification node.

**Risk:** Low — additive only, no existing nodes modified.

---

### 3. `workflow.active: false` (P3 — Informational)

The workflow is set to `active: false`. The Schedule Trigger (Daily 8am) won't fire until activated. If this is intentional (manual trigger only), no action needed. To enable scheduled runs, set `active: true` in n8n or toggle it in the workflow editor.

---

## Resolved Issues (for reference)

| # | Issue | Resolution |
|---|-------|-----------|
| 1 | 18b missing Quality schema | Already present in schema (lines 829-837) |
| 2 | Glassdoor empty company | Full fallback chain in BOARD_CONFIG |
| 3 | PDF failure diagnostics | Node 16 captures resumeResult.error |
| 4 | Error sentinel from node 4 | Node 8 has skipped/error guard |
| 5 | Enforce work+skills in quality flag | Node 14 checks and flags 'Review' |
| 6 | Few-shot examples for match confidence | 6 examples in Gemini prompt |
| 7 | Filter benefits sections from JD | Both 10a and 13a filter benefits |
| 8 | Cover letter language | Open — see #1 above |
| 9 | Reduce wait delay | Changed to 3s explicit wait |
| 10 | Rate limit sleep in 13a | Reduced PRE_CALL_DELAY_MS to 2000ms |
| 11 | Align scraper search terms | Indeed already has 9 terms, aligned with LinkedIn |
| 12 | Broken regex `[sS]` in node 10a | Fixed: changed to `[\s\S]` to match node 13a |
| 13 | Missing comma in Glassdoor customBody | Fixed: added comma after `"deepSearch": true` |
| 14 | Confidence threshold mismatch (40 vs 45) | Fixed: aligned prompt to >= 45 matching node 12 gate |
| 15 | Implicit batchSize in node 9 | Fixed: set explicit `batchSize: 1` |
| 16 | Error sentinel overwritten in node 6 | Fixed: early return preserves error from node 4 |
| 17 | executionOrder v1 (legacy) | Upgraded to v2 (depth-first) |