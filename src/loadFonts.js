// src/loadFonts.js
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const FONTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../node_modules/@fontsource/source-serif-pro/files"
);

function fontB64(file) {
  try {
    return readFileSync(join(FONTS_DIR, file)).toString("base64");
  } catch {
    throw new Error(`Font file "${file}" not found. Run "npm install" to restore font dependencies.`);
  }
}

export const FONT_CSS = [
  ["source-serif-pro-latin-400-normal.woff2", "normal", 400],
  ["source-serif-pro-latin-400-italic.woff2", "italic", 400],
  ["source-serif-pro-latin-600-normal.woff2", "normal", 600],
  ["source-serif-pro-latin-700-normal.woff2", "normal", 700],
].map(
  ([file, style, weight]) => `
  @font-face {
    font-family: 'Source Serif Pro';
    font-style: ${style}; font-weight: ${weight};
    src: url('data:font/woff2;base64,${fontB64(file)}') format('woff2');
  }`
).join("");
