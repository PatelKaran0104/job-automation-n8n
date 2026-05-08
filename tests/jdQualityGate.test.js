import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateJdQuality } from "../src/jdQualityGate.js";

test("rejects when description is shorter than 600 chars", () => {
  const job = {
    title: "Software Developer",
    company: "Acme",
    description: "Short JD".repeat(10), // ~80 chars
  };
  const result = evaluateJdQuality(job);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "description_too_short");
});

test("rejects when company is empty", () => {
  const job = {
    title: "Software Developer",
    company: "",
    description: "x".repeat(700) + " responsibilities: build things",
  };
  const result = evaluateJdQuality(job);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "company_missing");
});

test("rejects when company is literally 'Unknown'", () => {
  const job = {
    title: "Software Developer",
    company: "Unknown",
    description: "x".repeat(700) + " responsibilities: build things",
  };
  const result = evaluateJdQuality(job);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "company_missing");
});

test("rejects when title is empty", () => {
  const job = {
    title: "",
    company: "Acme",
    description: "x".repeat(700) + " responsibilities: build things",
  };
  const result = evaluateJdQuality(job);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "title_missing");
});

test("rejects when JD has no responsibility/requirement signal", () => {
  const job = {
    title: "Software Developer",
    company: "Acme",
    description: "x".repeat(700), // 700 chars but no keyword
  };
  const result = evaluateJdQuality(job);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_jd_structure");
});

test("rejects boilerplate-heavy text", () => {
  const job = {
    title: "Software Developer",
    company: "Acme",
    description:
      "responsibilities: build things. " +
      ("cookie privacy policy impressum equal opportunity employer datenschutz cookie ".repeat(30)),
  };
  const result = evaluateJdQuality(job);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "boilerplate_heavy");
});

test("accepts a normal-looking JD with English keywords", () => {
  const job = {
    title: "Software Developer",
    company: "Acme",
    description:
      "We are looking for a software developer. " +
      "Responsibilities: build features, write tests, review PRs. " +
      "Requirements: 2+ years JS, Node, React. ".repeat(15),
  };
  const result = evaluateJdQuality(job);
  assert.equal(result.ok, true);
  assert.equal(result.reason, null);
});

test("accepts a normal-looking JD with German keywords", () => {
  const job = {
    title: "Softwareentwickler",
    company: "Acme GmbH",
    description:
      "Wir suchen einen Softwareentwickler. " +
      "Deine Aufgaben: Features bauen, Tests schreiben. " +
      "Was du mitbringst: 2+ Jahre Erfahrung. ".repeat(15),
  };
  const result = evaluateJdQuality(job);
  assert.equal(result.ok, true);
  assert.equal(result.reason, null);
});
