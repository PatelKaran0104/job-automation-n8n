Pipeline Audit: Remaining Improvements

All P0 bugs, P1 quality improvements, and P2 efficiency fixes from the original audit have been resolved.
Remaining items are listed below.

---

## Open Issues

### 1. No run summary or notification (P3 — Medium effort)

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

### 2. `workflow.active: false` (Informational — by design)

Since the workflow was converted to a manual `Run Workflow` trigger, `active: false` is expected. It will not fire automatically; execute on demand via the n8n UI. If scheduled runs are desired again, add a `Schedule Trigger` node upstream of `1. Manual Configuration` and toggle the workflow active.

---

## Resolved Issues (for reference)

| # | Issue | Resolution |
|---|-------|-----------|
| 1 | 18b missing Quality schema | Already present in schema |
| 2 | Glassdoor empty company | Full fallback chain in BOARD_CONFIG |
| 3 | PDF failure diagnostics | Node 16 captures resumeResult.error via `pdfErrorMsg` |
| 4 | Error sentinel from node 4 | Node 8 has skipped/error guard |
| 5 | Enforce work+skills in quality flag | Node 14 structural validation flags 'Review' |
| 6 | Few-shot examples for match confidence | Examples in Gemini prompt |
| 7 | Filter benefits sections from JD | Both 10a and 13a filter benefits |
| 8 | Cover letter language | Resolved — `language` flows through tailor response (`14. Parse AI Patch`) into both `15a` and `15b` request bodies; `mergeCoverLetter.js` renders DE or EN accordingly |
| 9 | Reduce wait delay | `10b. Wait` = 3s |
| 10 | Rate limit sleep in 13a | Replaced by explicit `13a1. Wait` node (2s) |
| 11 | Align scraper search terms | Indeed aligned with LinkedIn keywords |
| 12 | Broken regex `[sS]` in node 10a | Fixed: changed to `[\s\S]` to match node 13a |
| 13 | Missing comma in Glassdoor customBody | Fixed |
| 14 | Confidence threshold mismatch (40 vs 45) | Fixed: aligned prompt to >= 45 matching node 12 gate |
| 15 | Implicit batchSize in node 9 | Fixed: explicit `batchSize: 1` |
| 16 | Error sentinel overwritten in node 6 | Fixed: early return preserves error from node 4 |
| 17 | executionOrder v1 (legacy) | Upgraded to v2 (depth-first) |
| 18 | Gemini single-model failure | Resolved — `10d. Gemini OK?` + `10e. Fallback Gemini Call` provide `fallbackFilteringModel` fallback |
| 19 | PDF filename collisions on same-day reruns | Resolved — filenames include `HHMMSS` timestamp |
| 20 | Index-based PDF pairing broke on failure | Resolved — `16. Prepare Sheet Log` uses jobId Map lookup (echoed through `15a/15b` response) |
| 21 | Tech roles falsely pre-filtered (e.g. "DevOps Engineer - Recruiting Platform") | Resolved — `TECH_SAFEGUARD` regex in `10a` rescues borderline titles |
