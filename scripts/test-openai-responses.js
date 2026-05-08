// Diagnoses 13b. OpenAI API Call latency / connectivity issues.
//
// Usage (PowerShell):
//   $env:OPENAI_API_KEY = "sk-..."
//   node scripts/test-openai-responses.js
//
// Usage (bash):
//   OPENAI_API_KEY=sk-... node scripts/test-openai-responses.js
//
// Optional: OPENAI_MODEL=gpt-5-mini (default matches the workflow)

import { performance } from "node:perf_hooks";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("ERROR: set OPENAI_API_KEY first");
  process.exit(1);
}

const model = process.env.OPENAI_MODEL || "gpt-5-mini";
const URL = "https://api.openai.com/v1/responses";

async function call(label, body, timeoutMs) {
  console.log(`\n=== ${label} ===`);
  console.log(`model=${body.model}  client_timeout=${timeoutMs / 1000}s`);
  const start = performance.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const elapsed = ((performance.now() - start) / 1000).toFixed(1);
    if (!res.ok) {
      console.log(`FAIL http ${res.status} ${res.statusText} after ${elapsed}s`);
      console.log((await res.text()).slice(0, 800));
      return { ok: false, elapsed: parseFloat(elapsed) };
    }
    const data = await res.json();
    const out =
      data.output_text ||
      data.output
        ?.find?.((o) => o?.type === "message")
        ?.content?.find?.((c) => c?.type === "output_text")?.text ||
      "";
    console.log(`OK after ${elapsed}s`);
    console.log("output preview:", out.slice(0, 200).replace(/\s+/g, " "));
    if (data.usage) console.log("usage:", JSON.stringify(data.usage));
    return { ok: true, elapsed: parseFloat(elapsed) };
  } catch (err) {
    clearTimeout(t);
    const elapsed = ((performance.now() - start) / 1000).toFixed(1);
    console.log(`ERROR after ${elapsed}s: ${err.name} — ${err.message}`);
    return { ok: false, elapsed: parseFloat(elapsed), err };
  }
}

// Test 1 — bare-minimum sanity (no reasoning, tiny prompt). Expect <5s.
const t1 = await call(
  "Test 1 — sanity (minimal)",
  {
    model,
    input: 'Reply with exactly: {"ok":true} json_object only, no explanations.',
    text: { format: { type: "json_object" } },
  },
  60_000,
);

// Test 2 — mimic the 13b. Build Tailor Prompt call: ~5K-token system instructions,
// reasoning.effort=medium, json_object output. This is the realistic latency probe.
const fillerLine =
  "You consider candidate experience, employer requirements, role responsibilities, German labor market norms, and quantitative achievements. ";
const systemPrompt =
  "You are an expert resume and cover letter writer for tech jobs in Germany. Output strict JSON.\n\n" +
  fillerLine.repeat(40);
const userMsg = `Tailor a resume for the following role.

ROLE: Senior Salesforce Developer
COMPANY: Example GmbH
LOCATION: Berlin, Germany

JD: Apex, LWC, Flows, Sales Cloud, integration with REST APIs. Production experience required.

Return JSON: {"jobTitle":"<title>","summary":"<3 sentences>"}`;

const t2 = await call(
  "Test 2 — mimic 13b (reasoning.medium + ~5K-token system prompt)",
  {
    model,
    reasoning: { effort: "medium" },
    text: { format: { type: "json_object" } },
    instructions: systemPrompt,
    input: userMsg,
  },
  300_000,
);

// Verdict
console.log("\n--- Verdict ---");
if (!t1.ok) {
  console.log("Test 1 failed → API key / network / model name. Not an n8n timeout issue.");
} else if (t2.ok && t2.elapsed > 90) {
  console.log(
    `Test 2 took ${t2.elapsed}s, > 90s n8n timeout. Raise 13b options.timeout to ${Math.ceil(
      t2.elapsed * 1.5,
    ) * 1000}ms (or drop reasoning.effort to "low"/"minimal").`,
  );
} else if (t2.ok) {
  console.log(
    `Test 2 returned in ${t2.elapsed}s — within 90s. If n8n still aborts, check Docker→api.openai.com DNS / outbound proxy.`,
  );
} else {
  console.log("Test 2 failed; see error above.");
}
