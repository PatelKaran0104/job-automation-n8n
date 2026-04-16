import { test } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:3000";

test("/generate-resume echoes jobId when provided", async () => {
  const resp = await fetch(`${BASE}/generate-resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jobId: "https://example.com/job/123",
      patch: { jobTitle: "Test Developer" },
      company: "TestCo",
      role: "Test Dev",
    }),
  });
  const data = await resp.json();
  assert.equal(data.jobId, "https://example.com/job/123");
});

test("/generate-resume works without jobId (backward compat)", async () => {
  const resp = await fetch(`${BASE}/generate-resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patch: { jobTitle: "Test Developer" },
      company: "TestCo",
      role: "Test Dev",
    }),
  });
  const data = await resp.json();
  assert.equal(data.jobId, undefined);
});

test("/generate-coverletter echoes jobId when provided", async () => {
  const resp = await fetch(`${BASE}/generate-coverletter`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jobId: "https://example.com/job/456",
      role: "Test Dev",
      company: "TestCo",
      companyAddress: "Berlin",
      paragraph1: "Opening paragraph text here.",
      paragraph2: "Evidence paragraph text here.",
      paragraph3: "Closing paragraph text here.",
    }),
  });
  const data = await resp.json();
  assert.equal(data.jobId, "https://example.com/job/456");
});
