#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function extractEnvKeys(envText) {
  return envText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && line.includes("="))
    .map((line) => line.slice(0, line.indexOf("=")).trim());
}

function hasPatternInFiles(files, pattern) {
  return files.some((relativePath) => pattern.test(readText(relativePath)));
}

function printSection(title) {
  console.log(`\n[${title}]`);
}

const pkg = readJson("package.json");
const vercel = readJson("vercel.json");
const envExample = readText(".env.example");
const envKeys = new Set(extractEnvKeys(envExample));

const findings = [];
const warnings = [];

if (pkg.engines?.node) {
  findings.push(`package.json pins Node via engines.node=${pkg.engines.node}`);
}

if (pkg.devDependencies?.vercel || pkg.dependencies?.vercel) {
  warnings.push("The Vercel CLI is installed in project dependencies, so Vercel build logs will warn that it is ignored.");
}

if (vercel.buildCommand !== "npm run vercel-build") {
  warnings.push(`vercel.json buildCommand is ${JSON.stringify(vercel.buildCommand)} instead of the expected \"npm run vercel-build\".`);
} else {
  findings.push("vercel.json buildCommand uses npm run vercel-build");
}

if (vercel.outputDirectory !== "apps/web/dist") {
  warnings.push(`vercel.json outputDirectory is ${JSON.stringify(vercel.outputDirectory)}; this repo currently expects apps/web/dist.`);
} else {
  findings.push("vercel.json outputDirectory points at apps/web/dist");
}

const cronPaths = Array.isArray(vercel.crons) ? vercel.crons.map((entry) => entry.path) : [];
if (cronPaths.length === 0) {
  warnings.push("No Vercel crons are configured; API indexing will only run on request-driven paths.");
} else {
  findings.push(`Configured Vercel cron paths: ${cronPaths.join(", ")}`);
  if (cronPaths.every((pathValue) => typeof pathValue === "string" && pathValue.includes("network=testnet"))) {
    warnings.push("Cron indexing is currently testnet-only. Add additional cron entries if mainnet/private indexing is required.");
  }
}

const recommendedServerVars = [
  "NEO_DEFAULT_NETWORK",
  "NEO_RPC_URL",
  "NEO_RPC_URL_MAINNET",
  "NEO_RPC_URL_TESTNET",
  "NEO_RPC_URL_PRIVATE",
  "NEO_CONTRACT_HASH",
  "NEO_CONTRACT_HASH_MAINNET",
  "NEO_CONTRACT_HASH_TESTNET",
  "NEO_CONTRACT_HASH_PRIVATE",
  "NEO_CONTRACT_DIALECT",
  "NEO_CONTRACT_DIALECT_MAINNET",
  "NEO_CONTRACT_DIALECT_TESTNET",
  "NEO_CONTRACT_DIALECT_PRIVATE",
  "INDEXER_ENABLE_EVENTS",
  "INDEXER_POLL_MS",
  "INDEXER_BATCH_SIZE",
  "INDEXER_BOOTSTRAP_BLOCK_WINDOW",
  "INDEXER_START_BLOCK",
  "NEOFS_ENABLED",
  "NEOFS_GATEWAY_BASE_URL",
  "NEOFS_OBJECT_URL_TEMPLATE",
  "NEOFS_CONTAINER_URL_TEMPLATE",
  "NEOFS_METADATA_TIMEOUT_MS",
  "GHOSTMARKET_ENABLED",
  "GHOSTMARKET_BASE_URL",
  "GHOSTMARKET_COLLECTION_URL_TEMPLATE",
  "GHOSTMARKET_TOKEN_URL_TEMPLATE",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const recommendedClientVars = [
  "VITE_API_BASE_URL",
  "VITE_API_BASE_URL_MAINNET",
  "VITE_API_BASE_URL_TESTNET",
  "VITE_API_BASE_URL_PRIVATE",
  "VITE_NEO_RPC_URL",
  "VITE_NEO_RPC_URL_MAINNET",
  "VITE_NEO_RPC_URL_TESTNET",
  "VITE_NEO_RPC_URL_PRIVATE",
  "VITE_NEO_CONTRACT_HASH",
  "VITE_NEO_CONTRACT_HASH_MAINNET",
  "VITE_NEO_CONTRACT_HASH_TESTNET",
  "VITE_NEO_CONTRACT_HASH_PRIVATE",
  "VITE_CONTRACT_DIALECT",
];

for (const requiredKey of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "VITE_API_BASE_URL", "VITE_CONTRACT_DIALECT"]) {
  if (!envKeys.has(requiredKey)) {
    warnings.push(`.env.example is missing ${requiredKey}`);
  }
}

if (!envKeys.has("VITE_WALLET_DEBUG")) {
  warnings.push(".env.example is missing VITE_WALLET_DEBUG");
} else {
  findings.push(".env.example includes VITE_WALLET_DEBUG and leaves it unset by default");
}

const publicSupabaseVars = [...envKeys].filter((key) => key.startsWith("VITE_") && key.includes("SUPABASE"));
if (publicSupabaseVars.length > 0) {
  warnings.push(`Public Supabase client env vars are present in .env.example: ${publicSupabaseVars.join(", ")}`);
} else {
  findings.push("No VITE_* Supabase variables are exposed in .env.example");
}

const nextPublicSupabaseVars = [...envKeys].filter((key) => key.startsWith("NEXT_PUBLIC_SUPABASE"));
if (nextPublicSupabaseVars.length > 0) {
  warnings.push(`NEXT_PUBLIC_SUPABASE* vars are present in .env.example: ${nextPublicSupabaseVars.join(", ")}`);
}

if (hasPatternInFiles(["apps/web/src/lib/config.ts"], /VITE_.*SUPABASE/)) {
  warnings.push("Frontend code references VITE_* Supabase variables; verify that no secret keys are exposed to the client.");
} else {
  findings.push("Frontend config does not use VITE_* Supabase secrets");
}

if (hasPatternInFiles(["apps/web/src/lib/neoline.ts"], /VITE_WALLET_DEBUG/)) {
  findings.push("Wallet debug logging is behind DEV or VITE_WALLET_DEBUG=true");
}

if (hasPatternInFiles(["apps/api/src/config.ts", "api/index.ts"], /NEXT_PUBLIC_SUPABASE/)) {
  warnings.push("API config still accepts NEXT_PUBLIC_SUPABASE* fallbacks. Prefer server-only SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in production.");
}

printSection("Findings");
for (const line of findings) {
  console.log(`- ${line}`);
}

printSection("Warnings");
if (warnings.length === 0) {
  console.log("- none");
} else {
  for (const line of warnings) {
    console.log(`- ${line}`);
  }
}

printSection("Recommended Server Env");
for (const key of recommendedServerVars) {
  console.log(`- ${key}`);
}

printSection("Recommended Client Env");
for (const key of recommendedClientVars) {
  console.log(`- ${key}`);
}

printSection("Decision");
console.log("- Keep VITE_WALLET_DEBUG unset in production unless actively debugging wallet issues.");
console.log("- Do not place SUPABASE_SERVICE_ROLE_KEY, SUPABASE_SECRET_KEY, POSTGRES_* secrets in client-visible env namespaces.");
console.log("- If production indexing should include mainnet, add a dedicated Vercel cron for the mainnet sync path.");
