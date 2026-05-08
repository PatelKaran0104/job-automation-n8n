You are probably not mainly failing because of the model. You are failing because the pipeline gives the model too much freedom, too little verified evidence, and then treats “valid JSON” as if it means “good CV.” That is the classic automation trap: syntactically correct garbage wearing a tie.

The biggest issues I see:

## 1. Your pipeline is optimizing for “generation,” not “truth-preserving transformation”

Your base resume has strong but specific evidence: Salesforce Developer at MV Clouds, AppExchange package, Agentforce/REST API integrations, CI/CD with Jenkins, 85%+ Apex test coverage, ~40% deployment time reduction, AWS/Terraform project, WebRTC project, n8n/OpenAI/Playwright pipeline, etc. 

But your tailoring step asks the model to rewrite, reorder, rename skill categories, update projects, write a cover letter, detect language, preserve metrics, avoid banned phrases, and maximize callback rate in one single call. That is too much in one shot.

The model is not doing a controlled patch. It is doing a creative rewrite under pressure.

Better architecture:

1. Extract job requirements.
2. Match each requirement to resume evidence.
3. Produce a “claim ledger.”
4. Generate CV patch only from ledger.
5. Validate every generated claim against the ledger.
6. Generate cover letter from the same ledger.
7. Run language/style/layout QA.
8. Only then render PDF.

Right now, you are asking one model call to be recruiter, translator, ATS optimizer, German stylist, factual auditor, layout planner, and JSON serializer. That’s how hallucinated claims and AI smell slip through.

## 2. Your model call uses `reasoning: { effort: 'minimal' }`

This is probably one of the biggest quality killers. Your tailor prompt sends the OpenAI request with `reasoning: { effort: 'minimal' }` while asking for a high-stakes, nuanced rewrite with German hiring context, factual constraints, role matching, cover-letter generation, and JSON formatting. 

That is like asking someone to perform surgery but saying, “Think as little as possible.”

For CV/cover letter generation, use at least medium reasoning. For final QA, use high or a stronger model. The creation step is not where you should cheap out.

Recommended change:

```json
"reasoning": { "effort": "medium" }
```

For the final reviewer:

```json
"reasoning": { "effort": "high" }
```

Even better: use `gpt-5-mini` for first draft and a stronger model for critique/repair. Quality in job applications is not just fluency; it is precision under constraints.

## 3. Your filtering threshold is too lenient, so weak-fit jobs enter the generation stage

Your match rules allow `match=true` at confidence `>=45`, and the n8n node also uses `confidence >= 45`. 

That means weak matches can still enter tailoring. A weak match is exactly where hallucination pressure becomes highest. The model sees gaps and starts “bridging” them with fake-adjacent language: technical sales, CRM strategy, customer relationship management, business process ownership, market language, etc.

For your goal, you should separate jobs into tiers:

For automatic generation, only allow confidence 70+.

For 55–69, generate only after manual review.

Below 55, log and skip.

This alone will reduce trash output dramatically.

Suggested logic:

```js
autoGenerate = confidence >= 70;
needsReview = confidence >= 55 && confidence < 70;
skip = confidence < 55;
```

Your current `45` threshold is good for not missing opportunities, but bad for fully automated CV generation.

## 4. Your job description extraction is too crude

You split the JD on keywords like `requirements`, `qualifications`, `profile`, `anforderungen`, `profil`, etc., then cap the resulting text. For matching you cap to 1500 chars, and for tailoring to 4000 chars. 

This can easily chop off the real signal, especially German postings where responsibilities, requirements, tech stack, language expectations, and benefits are mixed under non-standard headings like:

“Deine Aufgaben”
“Das bringst du mit”
“Womit du arbeitest”
“Was dich erwartet”
“Anforderungen”
“Qualifikation”
“Must-haves”
“Nice-to-haves”

If the extraction picks the wrong section or removes too much after “what we offer,” the generation model gets partial context. Partial JD in, generic CV out.

You need a dedicated JD parser that outputs structured fields:

```json
{
  "role_family": "Salesforce | Backend | Frontend | DevOps | Data | QA | Other",
  "must_have_skills": [],
  "nice_to_have_skills": [],
  "responsibilities": [],
  "language_requirements": [],
  "seniority_signals": [],
  "domain": "",
  "red_flags": []
}
```

Then tailor against this structured object, not raw scraped text.

## 5. Your validation is structural, not semantic

Your parse node checks whether `patch.work` exists, `patch.skills` exists, IDs exist, descriptions are non-trivial, and skill `infoHtml` is non-empty. 

That catches empty output, but not bad output.

It will not catch:

“claimed Kubernetes experience” when Kubernetes is not in your resume.

“fluent German” when your resume says German active learner.

“technical sales experience” when your base resume does not support it.

German phrasing that sounds translated.

Buzzword stacking.

Unbalanced page layout.

Claims that are technically true but misleading.

So your validation currently says: “The garbage has keys and values. Approved.”

You need semantic QA checks:

Claim audit:
Every bullet must be classified as `supported`, `unsupported`, or `overstated`.

Language audit:
No mixed German/English unless it is a technology term.

German style audit:
Reject literal translations like “ich bringe Erfahrung mit,” “starke Kenntnisse in,” “spannende Herausforderung,” “umfangreiche Expertise,” etc.

ATS audit:
Must include top 5 relevant JD keywords, but only if supported by resume evidence.

Layout audit:
Count approximate characters/lines per section before rendering.

## 6. You are generating CV and cover letter in the same call

Your node explicitly says the “single combined AI call returns both patch and coverLetter.” 

That is efficient, but quality-hostile.

CV tailoring and cover letter writing require different thinking:

The CV needs compact evidence, controlled wording, factual precision, ATS alignment.

The cover letter needs narrative, company/job specificity, tone, and German/English fluency.

When combined, one tends to poison the other. The model may use cover-letter style in resume bullets or resume-style bullet stuffing in the letter.

Split them:

1. `Generate Evidence Map`
2. `Generate Resume Patch`
3. `Review Resume Patch`
4. `Generate Cover Letter from Approved Resume Patch + Evidence Map`
5. `Review Cover Letter`

This is slower, but far better. Your bottleneck is not speed. It is callback rate.

## 7. Your base resume itself contains AI-smell that gets amplified

Your base resume is strong, but some bullets already have “AI résumé language.” For example, phrases like “applying the same architectural review discipline,” “low-code-first thinking,” “production-grade,” “AI-assisted engineering environments,” and “comfortable in…” are not terrible, but they are abstract and model-friendly. 

When the model rewrites from that, it often doubles down into buzzwords.

You need a cleaner evidence bank behind the resume. Not polished CV bullets. Raw facts.

Example evidence format:

```json
{
  "fact_id": "mvclouds_appexchange_001",
  "type": "work",
  "company": "MV Clouds",
  "role": "Salesforce Developer",
  "technologies": ["Apex", "LWC", "Salesforce DX", "AppExchange"],
  "claim": "Built and published a managed AppExchange package through Salesforce security review",
  "metrics": ["85%+ Apex test coverage"],
  "allowed_rewrites": [
    "Built a managed Salesforce AppExchange package...",
    "Shipped a Salesforce package through AppExchange security review..."
  ],
  "forbidden_rewrites": [
    "Led AppExchange product strategy",
    "Managed Salesforce marketplace sales",
    "Owned customer acquisition"
  ]
}
```

Then generate from the evidence bank, not only from a polished resume.

## 8. Your fallback model can quietly lower quality

You use Gemini flash-lite models for filtering/fallback and GPT-5-mini for creation. The fallback model is `gemini-2.0-flash-lite`. 

Fallback is okay for availability, not for quality. If fallback ever touches generation or repair, it can absolutely produce worse German, more generic phrasing, and weaker factual control.

For your use case:

Use cheap models only for scraping cleanup, deduplication, and rough classification.

Use stronger models for:
CV patch generation,
German cover letter generation,
claim auditing,
final QA.

Do not let fallback-generated application documents go out automatically. Mark them `Needs Review`.

## 9. Your “banned phrase” list helps, but it is a band-aid

Your prompt bans phrases like “bringe ich,” “Ich bewerbe mich,” “hands-on,” “passionate,” “team player,” and similar AI/cliché wording. 

That is good, but banned phrases do not solve the deeper issue: the model can avoid banned words and still produce generic slop.

Example:

Bad but not banned:

“Meine Erfahrung in modernen Cloud-Technologien ermöglicht es mir, nachhaltige digitale Lösungen zu entwickeln.”

No banned phrase. Still garbage.

You need positive style rules, not just bans:

German CV bullets should be:
Concrete.
Tool-first.
Outcome-based.
No “soft personality” claims.
No “modern/digital/innovative solution” fluff.
No unsupported business impact.

Example better German bullet:

“Implementierte REST-API-Callouts und Apex Actions für Agentforce-Agenten, um externe Systeme wie QuickBooks und HomeAdvisor in Echtzeit aus Salesforce heraus anzubinden.”

That sounds like a developer, not a brochure.

## 10. Your page balance problem is probably not a model problem

You are generating styled PDFs via a local service using HTML-to-PDF rendering. Your base project even mentions Playwright/headless Chromium PDF generation. 

If page balance is inconsistent, stop asking the model to “write shorter.” Add deterministic layout controls.

You need pre-render sizing logic:

Approximate line budget:

```js
const limits = {
  profileChars: 420,
  workBullets: 6,
  workBulletChars: 145,
  projectCount: 2,
  projectBulletChars: 120,
  coverLetterTotalChars: 2200
};
```

Then reject or trim before PDF generation.

For a 1-page German CV, your current base has a lot: profile, 2 work entries, 8 projects, education, certificates, 6 skill categories, languages.  The model cannot magically balance that unless you give it hard layout budgets.

## 11. Your patch merge can preserve irrelevant base content

Your prompt says unlisted projects keep their base description, and omitted work/projects may remain depending on how your renderer merges patches. Your base resume has many projects, including QR Code Generator, Portfolio Website, SUMMA, Face Recognition, Marketplace, etc. 

If the AI patch updates only a few sections but the renderer keeps all base sections visible, then the final CV may look untailored even if the patch is decent.

This is huge.

You need explicit visibility control:

```json
"visibleProjectIds": ["59a0376c...", "7abecff6..."],
"visibleWorkIds": ["286ca64e..."],
"visibleSkillIds": [...]
```

Do not rely on “omit from patch” to mean “hide.” Patch and display selection should be separate.

## 12. Your input contains strong Salesforce identity, so non-Salesforce roles need a different resume mode

Your base resume is Salesforce-heavy: MV Clouds Salesforce Developer, Salesforce certifications, Salesforce platform skills, Agentforce, AppExchange, Service Cloud, Flows, Apex, LWC. 

For backend/frontend/cloud roles, the model may overcompensate by rewriting Salesforce experience into generic software experience. That is where false claims happen.

Instead, create separate resume modes:

Salesforce mode:
Keep Salesforce certifications, AppExchange, Apex/LWC, Agentforce, Flows.

Backend mode:
Keep Salesforce, but frame it as enterprise backend/integration work: Apex services, REST/SOAP APIs, external systems, CI/CD, testing, data models.

Frontend mode:
Lead with LWC, React, TypeScript, Phaser, UI projects, form builder.

Cloud/DevOps mode:
Lead with Jenkins, GitHub Actions, Docker, AWS/Terraform project, deployment quality gate.

AI/Automation mode:
Lead with Agentforce, n8n, Playwright, OpenAI/Gemini pipeline, automation systems.

Do not ask the model to invent the mode every time. Determine mode first, then pass a mode-specific prompt and layout template.

## The real fix: add a “Claim Ledger + QA Gate”

This is what I would implement next.

Before generating anything, create this:

```json
{
  "job_requirements": [
    {
      "requirement": "REST API development",
      "importance": "must-have",
      "matched_evidence_ids": ["mvclouds_rest_001", "consulting_api_001"],
      "strength": "strong"
    },
    {
      "requirement": "Kubernetes",
      "importance": "nice-to-have",
      "matched_evidence_ids": [],
      "strength": "unsupported"
    }
  ]
}
```

Then tell the CV generator:

“You may only make claims using matched evidence IDs. Unsupported requirements may appear only as gaps, never as claims.”

After generation, run a reviewer:

```json
{
  "unsupported_claims": [],
  "overstated_claims": [],
  "generic_sentences": [],
  "language_mismatch": [],
  "layout_risk": "medium",
  "decision": "pass | repair | reject"
}
```

If `repair`, send it back once. If still bad, mark manual review.

## Strong opinion: your current pipeline is too “one-pass AI magic”

The prompts are not bad. Actually, your prompt is quite serious and has many good constraints. The problem is that you are using prompting where you need process control.

For high-quality automated applications, do not think:

“Better prompt → better resume.”

Think:

“Evidence → constraints → generation → audit → repair → render.”

That is the mature version of this pipeline.

## Priority fixes I would do first

1. Change `reasoning.effort` from `minimal` to `medium` for generation.
2. Raise auto-generation match threshold from `45` to `70`; put 55–69 into manual review.
3. Split CV and cover letter into separate calls.
4. Add claim ledger before generation.
5. Add semantic QA after generation.
6. Add hard layout budgets before PDF rendering.
7. Add explicit `visibleProjectIds`, `visibleWorkIds`, and `visibleSkillIds`.
8. Create role modes: Salesforce, Backend, Frontend, Cloud/DevOps, AI/Automation.
9. Treat fallback outputs as `Needs Review`, not production-ready.
10. Replace polished base resume content with a raw evidence bank as the model’s source of truth.

The blunt diagnosis: you built a good “document generator,” but what you need is a controlled “truth-preserving application compiler.” Right now the model is allowed to improvise too much, and recruiters can smell that from space.


Plan complete and saved to docs/superpowers/plans/2026-05-06-job-pipeline-phase-0.md.

Summary: 11 tasks covering all 9 Phase 0 items from the spec plus an end-to-end smoke test. Each task has concrete code, exact file paths, TDD cycle (where automated tests apply), and a commit step. Total estimated time: ~1 day if you stay focused, longer if smoke-test reveals issues.

One thing I want to flag: Phases 1-3 will get their own plans written after each prior phase ships. This keeps each plan tied to real outputs rather than guessing at problems before evidence arrives. After Phase 0 lands and you've run a real batch, the data will likely sharpen what Phase 1 actually needs.

Two questions before we move on:

1. Commit the plan? Your CLAUDE.md says to only commit when asked, so I'm holding off. Say the word and I'll commit it.

2. Execution approach? Per the writing-plans skill, two options:

Subagent-Driven (recommended) — I dispatch a fresh subagent per task, review the output between tasks, you approve before each commit. Slowest but highest-quality. Good fit because Phase 0 has 11 distinct tasks that don't share state much.

Inline Execution — I execute tasks in this session via the executing-plans skill, batching with checkpoints. Faster but my context fills up across all 11 tasks; later tasks are likelier to drift.

Given the work touches one giant n8n JSON file (which I'd have to re-read often) and several src/ files, I'd lean Subagent-Driven — but you may want to do this yourself task-by-task in the IDE and just use the plan as a guide, since you know the n8n workflow intimately. Tell me what you want.