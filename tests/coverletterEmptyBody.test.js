import { test } from "node:test";
import assert from "node:assert/strict";

// Helper that mirrors src/server.js stripHtml
function stripHtml(html = "") {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function isEmptyBody({ paragraph1 = "", paragraph2 = "", paragraph3 = "" }) {
  return stripHtml(paragraph1 + paragraph2 + paragraph3).length === 0;
}

test("all three paragraphs empty → empty body", () => {
  assert.equal(isEmptyBody({}), true);
  assert.equal(isEmptyBody({ paragraph1: "", paragraph2: "", paragraph3: "" }), true);
});

test("only HTML tags, no text → empty body", () => {
  assert.equal(isEmptyBody({ paragraph1: "<p></p>", paragraph2: "<p>   </p>", paragraph3: "<br/>" }), true);
});

test("any non-empty paragraph → not empty body", () => {
  assert.equal(isEmptyBody({ paragraph1: "Hello" }), false);
  assert.equal(isEmptyBody({ paragraph2: "<p>Hi</p>" }), false);
});

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

test("POST /generate-coverletter with empty paragraphs returns 422 EMPTY_BODY", async () => {
  const server = spawn("node", ["src/server.js"], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    // wait for "Server running on port 3000"
    let started = false;
    server.stdout.on("data", (d) => { if (String(d).includes("Server running")) started = true; });
    for (let i = 0; i < 30 && !started; i++) await sleep(250);
    assert.ok(started, "server failed to start");

    const res = await fetch("http://localhost:3000/generate-coverletter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        company: "Test Co",
        role: "Test Role",
        paragraph1: "<p></p>",
        paragraph2: "",
        paragraph3: "<br/>",
      }),
    });
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.reason_code, "EMPTY_BODY");
  } finally {
    server.kill();
  }
});
