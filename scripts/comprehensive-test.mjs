#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function runNodeScript(relativePath, env) {
  const target = path.join(ROOT, relativePath);
  const result = spawnSync(process.execPath, [target], {
    cwd: ROOT,
    stdio: "inherit",
    env,
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: node ${relativePath}`);
  }
}

function main() {
  const sellerWif = requireEnv("NEO_TEST_WIF");
  const buyerWif = process.env.NEO_TEST_BUYER_WIF?.trim() || process.env.TESTNET_BUYER_WIF?.trim() || "";

  const env = {
    ...process.env,
    TESTNET_WIF: sellerWif,
  };

  if (buyerWif) {
    env.TESTNET_BUYER_WIF = buyerWif;
    console.log("[comprehensive-test] running scripts/testnet-full-lifecycle.mjs");
    runNodeScript(path.join("scripts", "testnet-full-lifecycle.mjs"), env);
    return;
  }

  console.log("[comprehensive-test] running scripts/testnet-flow.mjs");
  runNodeScript(path.join("scripts", "testnet-flow.mjs"), env);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
