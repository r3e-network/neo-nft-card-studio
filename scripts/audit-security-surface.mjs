#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runGit(args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
}

function listTrackedFiles() {
  const output = runGit(["ls-files"]);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function printSection(title) {
  console.log(`\n[${title}]`);
}

const trackedFiles = listTrackedFiles();
const findings = [];
const warnings = [];

const forbiddenTrackedNames = new Set([
  ".env",
  ".env.local",
  ".env.testnet",
  ".env.vercel.production",
  ".env.vercel.runtime",
]);

for (const file of trackedFiles) {
  if (forbiddenTrackedNames.has(path.basename(file))) {
    warnings.push(`Tracked environment file detected: ${file}`);
  }
}

const suspiciousPatterns = [
  {
    label: "hardcoded WIF",
    regex: /\b(?:K[1-9A-HJ-NP-Za-km-z]{51}|L[1-9A-HJ-NP-Za-km-z]{50})\b/g,
  },
  {
    label: "Supabase secret key literal",
    regex: /\bsb_secret_[A-Za-z0-9_-]+\b/g,
  },
  {
    label: "Postgres URL with inline credentials",
    regex: /\bpostgres(?:ql)?:\/\/[^/\s:@]+:[^/\s@]+@/g,
  },
  {
    label: "JWT-like bearer token literal",
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b/g,
  },
];

const allowedPathRegexes = [
  /^docs\//,
  /^README\.md$/,
  /^\.env\.example$/,
  /^scripts\/audit-security-surface\.mjs$/,
];

for (const file of trackedFiles) {
  const content = fs.readFileSync(path.join(ROOT, file), "utf8");
  for (const { label, regex } of suspiciousPatterns) {
    const matches = [...content.matchAll(regex)];
    if (matches.length === 0) {
      continue;
    }

    const allowed = allowedPathRegexes.some((entry) => entry.test(file));
    if (allowed) {
      findings.push(`${label} pattern appears in allowed documentation/example file: ${file}`);
      continue;
    }

    warnings.push(`${label} pattern detected in tracked file: ${file}`);
  }
}

const gitignoreText = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
if (/^\.env\.\*\s*$/m.test(gitignoreText) && /^!\.env\.example\s*$/m.test(gitignoreText)) {
  findings.push(".gitignore ignores .env.* files while keeping .env.example");
} else {
  warnings.push(".gitignore does not clearly ignore .env.* while keeping .env.example");
}

printSection("Findings");
if (findings.length === 0) {
  console.log("- none");
} else {
  for (const item of findings) {
    console.log(`- ${item}`);
  }
}

printSection("Warnings");
if (warnings.length === 0) {
  console.log("- none");
} else {
  for (const item of warnings) {
    console.log(`- ${item}`);
  }
}

if (warnings.length > 0) {
  process.exitCode = 1;
}
