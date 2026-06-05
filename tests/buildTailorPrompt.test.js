import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareTailorJd, decodeHtmlEntities } from "../src/buildTailorPrompt.js";

// Build a normalized ~4,000-word JD. It is already in the shape prepareTailorJd
// emits (single spaces, single/double newlines, no tags, no entities), so a pure
// pass-through must return it byte-for-byte — proving nothing is truncated.
function buildLongJd() {
  const fillerSentence =
    "You will collaborate with cross functional teams to deliver scalable cloud native solutions using modern engineering practices.";
  const filler = [];
  for (let i = 0; i < 220; i++) {
    filler.push(`Task ${i}: ${fillerSentence}`);
  }
  return [
    "Senior Salesforce Developer at Acme GmbH in Munich.",
    "Responsibilities: design Apex services, build LWC components, integrate REST APIs, mentor juniors.",
    filler.join(" "),
    "FINAL_REQUIREMENT_SENTINEL: ownership of the deployment pipeline.",
  ].join("\n\n");
}

test("4,000-word JD reaches the tailor prompt unchanged — no 4000-char cap", () => {
  const jd = buildLongJd();
  const wordCount = jd.split(/\s+/).filter(Boolean).length;
  assert.ok(wordCount >= 4000, `fixture should be >=4000 words, got ${wordCount}`);
  assert.ok(jd.length > 20000, `fixture should be far past the old 4000-char cap, got ${jd.length}`);

  const out = prepareTailorJd(jd);

  // Full text preserved, byte-for-byte (already-normalized input round-trips).
  assert.equal(out, jd);
  // Tail survives — the old slice(0, 4000) would have dropped this sentinel.
  assert.ok(out.includes("FINAL_REQUIREMENT_SENTINEL"));
  assert.ok(out.length > 20000);
});

test("empty / whitespace / nullish JD returns '' (graceful skip, no PDF downstream)", () => {
  assert.equal(prepareTailorJd(""), "");
  assert.equal(prepareTailorJd("   \n\t  "), "");
  assert.equal(prepareTailorJd(null), "");
  assert.equal(prepareTailorJd(undefined), "");
});

test("decodes HTML entities the model would otherwise see literally", () => {
  const jd =
    "Build &lt;Apex&gt; services &amp; LWC. Erf&uuml;llung der Anforderungen. " +
    "Pyt&#104;on und &#x52;EST. Requirements: 3+ years.";
  const out = prepareTailorJd(jd);

  assert.ok(out.includes("<Apex>"), "entity-encoded angle brackets survive as literal text");
  assert.ok(out.includes("services & LWC"), "&amp; decoded");
  assert.ok(out.includes("Erfüllung"), "&uuml; decoded to ü");
  assert.ok(out.includes("Python"), "numeric &#104; decoded");
  assert.ok(out.includes("REST"), "hex &#x52; decoded");
  assert.ok(!out.includes("&amp;") && !out.includes("&uuml;") && !out.includes("&#"),
    "no raw entities remain");
});

test("German umlauts and ß pass through intact", () => {
  const jd = "Anforderungen: Berufserfahrung in Softwareentwicklung. Größe, Qualität, Übernahme.";
  const out = prepareTailorJd(jd);
  assert.ok(out.includes("Größe"));
  assert.ok(out.includes("Qualität"));
  assert.ok(out.includes("Übernahme"));
});

test("surrogate-pair emoji is never split (no slicing) — literal and entity forms", () => {
  const jd = "Rocket 🚀 launch. " + "x".repeat(5000) + " Also &#128640; here. Requirements end.";
  const out = prepareTailorJd(jd);
  const rockets = [...out].filter((c) => c === "🚀").length;
  assert.equal(rockets, 2, "both literal and entity-decoded rocket present and intact");
  assert.ok(out.includes("Requirements end."), "tail survives past 5k filler");
});

test("strips real HTML tags but keeps their text content", () => {
  const jd = "<div><p>Responsibilities:</p><ul><li>Build APIs</li><li>Write tests</li></ul></div>";
  const out = prepareTailorJd(jd);
  assert.ok(!/[<>]/.test(out.replace(/[^<>]/g, "")) || !out.includes("<div>"));
  assert.ok(!out.includes("<div>") && !out.includes("<li>") && !out.includes("</p>"));
  assert.ok(out.includes("Responsibilities:"));
  assert.ok(out.includes("Build APIs"));
  assert.ok(out.includes("Write tests"));
});

test("decodeHtmlEntities leaves unknown entities and avoids double-decoding", () => {
  assert.equal(decodeHtmlEntities("&unknownentity;"), "&unknownentity;");
  assert.equal(decodeHtmlEntities("&amp;#38;"), "&#38;");
  assert.equal(decodeHtmlEntities("a &amp; b"), "a & b");
});
