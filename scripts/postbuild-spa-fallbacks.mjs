#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = path.join(ROOT, "apps", "web", "dist");
const INDEX_HTML_PATH = path.join(DIST_DIR, "index.html");

const STATIC_ROUTE_HTML_PATHS = [
  "404.html",
  path.join("explore", "index.html"),
  path.join("mint", "index.html"),
  path.join("portfolio", "index.html"),
  path.join("collections", "new", "index.html"),
];

function ensureFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }
}

function main() {
  ensureFileExists(INDEX_HTML_PATH);
  const indexHtml = fs.readFileSync(INDEX_HTML_PATH, "utf8");

  for (const relativeTarget of STATIC_ROUTE_HTML_PATHS) {
    const targetPath = path.join(DIST_DIR, relativeTarget);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, indexHtml, "utf8");
  }

  console.log(
    `[postbuild-spa-fallbacks] wrote ${STATIC_ROUTE_HTML_PATHS.length} SPA fallback entrypoints in ${DIST_DIR}`,
  );
}

main();
