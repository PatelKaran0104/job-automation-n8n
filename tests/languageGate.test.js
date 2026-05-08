import { test } from "node:test";
import assert from "node:assert/strict";
import { decideLanguage } from "../src/languageGate.js";

test("majority-German JD returns 'de'", () => {
  const description =
    "Wir suchen einen Softwareentwickler für unser Team in München. " +
    "Deine Aufgaben umfassen die Entwicklung von Webanwendungen. " +
    "Du arbeitest mit modernen Technologien und einem agilen Team. ".repeat(5);
  const result = decideLanguage({ description, languageRequirements: [] });
  assert.equal(result, "de");
});

test("majority-English JD returns 'en'", () => {
  const description =
    "We are looking for a software developer to join our team in Berlin. " +
    "Your responsibilities include building web applications using modern " +
    "frameworks. You'll work with a friendly agile team. ".repeat(5);
  const result = decideLanguage({ description, languageRequirements: [] });
  assert.equal(result, "en");
});

test("English JD with hard German C1 still returns 'en' (Phase 0 behavior)", () => {
  const description =
    "We are looking for a developer. Responsibilities: build features. " +
    "Requirements: 2+ years experience. ".repeat(5);
  const result = decideLanguage({
    description,
    languageRequirements: [{ language: "de", level: "C1", hard: true }],
  });
  assert.equal(result, "en");
});

test("English JD with German nice-to-have returns 'en'", () => {
  const description =
    "We are looking for a developer. Responsibilities: build features. " +
    "Requirements: 2+ years experience. ".repeat(5);
  const result = decideLanguage({
    description,
    languageRequirements: [{ language: "de", level: "B1", hard: false }],
  });
  assert.equal(result, "en");
});

test("empty description defaults to 'en'", () => {
  const result = decideLanguage({ description: "", languageRequirements: [] });
  assert.equal(result, "en");
});

test("bilingual JD with German requirements section returns 'de'", () => {
  const description =
    "We are a Berlin-based startup looking for a developer. " +
    "Anforderungen: 2+ Jahre Erfahrung mit JavaScript. " +
    "Du solltest mit modernen Frameworks vertraut sein. " +
    "Deine Aufgaben umfassen die Entwicklung neuer Features. ".repeat(3);
  const result = decideLanguage({ description, languageRequirements: [] });
  assert.equal(result, "de");
});
