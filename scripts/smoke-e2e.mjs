#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

const ROOT = process.cwd();
const DEFAULT_RPC = "https://testnet1.neo.coz.io:443";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runCommand(command, args, options = {}) {
  const printable = `${command} ${args.join(" ")}`;
  console.log(`\n[smoke:e2e] $ ${printable}`);

  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${printable}`);
  }
}

async function fetchJson(url, expectedStatus = 200) {
  const response = await fetch(url);
  if (response.status !== expectedStatus) {
    const body = await response.text();
    throw new Error(`Unexpected status ${response.status} for ${url}. Body: ${body}`);
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  return JSON.parse(text);
}

async function fetchText(url) {
  const response = await fetch(url);
  const text = await response.text();
  return {
    status: response.status,
    text,
    contentType: response.headers.get("content-type") ?? "",
  };
}

async function waitForHealth(baseUrl, timeoutMs = 30000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    try {
      const health = await fetchJson(`${baseUrl}/api/health`, 200);
      if (health?.status === "ok") {
        return;
      }
    } catch {
      // keep retrying
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error("API did not become healthy within timeout");
}

function seedApiDb(dbFile, profile) {
  const normalizedProfile = profile.toLowerCase();
  const collectionId = `test-col-${normalizedProfile}`;
  const tokenId = `test-token-${normalizedProfile}`;
  const txid = `0xsmoketx-${normalizedProfile}`;
  const owner = "NQ5S4x8fWFhktmQfS4wFK6fGY4fQ3dYvMC";
  const db = new Database(dbFile);
  const now = new Date().toISOString();

  db.prepare(
    `INSERT OR REPLACE INTO collections(
      collection_id, owner, name, symbol, description, base_uri, max_supply,
      minted, royalty_bps, transferable, paused, created_at, updated_at
    ) VALUES(
      @collectionId, @owner, @name, @symbol, @description, @baseUri, @maxSupply,
      @minted, @royaltyBps, @transferable, @paused, @createdAt, @updatedAt
    )`,
  ).run({
    collectionId,
    owner,
    name: `Smoke Collection ${normalizedProfile}`,
    symbol: `SM${normalizedProfile.slice(0, 1).toUpperCase()}`,
    description: `Smoke seeded collection (${normalizedProfile})`,
    baseUri: `https://example.com/${normalizedProfile}/meta/`,
    maxSupply: "100",
    minted: "1",
    royaltyBps: 500,
    transferable: 1,
    paused: 0,
    createdAt: now,
    updatedAt: now,
  });

  db.prepare(
    `INSERT OR REPLACE INTO tokens(
      token_id, collection_id, owner, uri, properties_json, burned, minted_at, updated_at
    ) VALUES(
      @tokenId, @collectionId, @owner, @uri, @propertiesJson, @burned, @mintedAt, @updatedAt
    )`,
  ).run({
    tokenId,
    collectionId,
    owner,
    uri: `https://example.com/${normalizedProfile}/meta/1.json`,
    propertiesJson: `{"name":"Smoke NFT ${normalizedProfile}"}`,
    burned: 0,
    mintedAt: now,
    updatedAt: now,
  });

  db.prepare(
    `INSERT INTO transfers(txid, token_id, from_address, to_address, block_index, timestamp)
     VALUES(@txid, @tokenId, @fromAddress, @toAddress, @blockIndex, @timestamp)`,
  ).run({
    txid,
    tokenId,
    fromAddress: null,
    toAddress: owner,
    blockIndex: 1,
    timestamp: now,
  });

  db.close();

  return {
    collectionId,
    tokenId,
    owner,
  };
}

async function runApiSmoke() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nft-platform-smoke-"));
  const dbFile = path.join(tempDir, "api.db");
  const dbFileMainnet = path.join(tempDir, "api.mainnet.db");
  const apiPort = 18080 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${apiPort}`;

  const env = {
    ...process.env,
    API_HOST: "127.0.0.1",
    API_PORT: String(apiPort),
    NEO_DEFAULT_NETWORK: "testnet",
    DB_FILE: dbFile,
    DB_FILE_MAINNET: dbFileMainnet,
    NEO_RPC_URL: DEFAULT_RPC,
    NEO_CONTRACT_HASH: "0x0000000000000000000000000000000000000000",
    NEO_RPC_URL_MAINNET: DEFAULT_RPC,
    NEO_CONTRACT_HASH_MAINNET: "0x1111111111111111111111111111111111111111",
    NEO_CONTRACT_DIALECT: "csharp",
    INDEXER_ENABLE_EVENTS: "false",
    GHOSTMARKET_ENABLED: "false",
  };

  const apiProcess = spawn("npm", ["run", "start", "--workspace", "@platform/api"], {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });

  try {
    await waitForHealth(baseUrl);

    const seededTestnet = seedApiDb(dbFile, "testnet");
    const seededMainnet = seedApiDb(dbFileMainnet, "mainnet");

    const health = await fetchJson(`${baseUrl}/api/health`);
    assert(health?.status === "ok", "health.status should be ok");
    assert(health?.network === "testnet", "default /health should use testnet profile");
    assert(Array.isArray(health?.availableNetworks), "health should include availableNetworks");
    assert(health.availableNetworks.includes("mainnet"), "availableNetworks should include mainnet");

    const mainnetHealth = await fetchJson(`${baseUrl}/api/health?network=mainnet`);
    assert(mainnetHealth?.network === "mainnet", "mainnet /health should resolve mainnet profile");

    await fetchJson(`${baseUrl}/api/health?network=private`, 404);

    const meta = await fetchJson(`${baseUrl}/api/meta/contract`);
    assert(meta?.dialect === "csharp", "meta dialect should be csharp");

    const neoFsMeta = await fetchJson(`${baseUrl}/api/meta/neofs`);
    assert(typeof neoFsMeta?.enabled === "boolean", "NeoFS meta should expose enabled flag");
    const neoFsResolve = await fetchJson(
      `${baseUrl}/api/meta/neofs/resolve?uri=${encodeURIComponent("neofs://container-1/meta/1.json")}`,
    );
    assert(neoFsResolve?.isNeoFs === true, "NeoFS resolve should detect neofs URI");
    const invalidUpload = await fetch(`${baseUrl}/api/meta/neofs/upload`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "application/json",
        content: "%%%invalid-base64%%%",
      }),
    });
    assert(invalidUpload.status === 400, "NeoFS upload should reject malformed base64");
    const invalidTypeUpload = await fetch(`${baseUrl}/api/meta/neofs/upload`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: 123,
        content: Buffer.from(JSON.stringify({ smoke: true }), "utf8").toString("base64"),
      }),
    });
    assert(invalidTypeUpload.status === 400, "NeoFS upload should reject non-string content type");
    const blankTypeUpload = await fetch(`${baseUrl}/api/meta/neofs/upload`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "   ",
        content: Buffer.from(JSON.stringify({ smoke: true }), "utf8").toString("base64"),
      }),
    });
    assert(blankTypeUpload.status === 400, "NeoFS upload should reject blank content type");
    const validUpload = await fetch(`${baseUrl}/api/meta/neofs/upload`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "APPLICATION/JSON",
        content: `data:application/json;base64,${Buffer.from(JSON.stringify({ smoke: true }), "utf8").toString("base64")}`,
      }),
    });
    assert(validUpload.status === 200, "NeoFS upload should accept valid base64 payload");
    const uploaded = await validUpload.json();
    assert(typeof uploaded?.uri === "string" && uploaded.uri.startsWith("neofs://local_demo/"), "NeoFS upload should return local demo uri");
    const uploadedMetadata = await fetchJson(
      `${baseUrl}/api/meta/neofs/metadata?uri=${encodeURIComponent(uploaded.uri)}`,
    );
    assert(uploadedMetadata?.metadata?.smoke === true, "NeoFS metadata should resolve uploaded local demo JSON payload");
    await fetchJson(`${baseUrl}/api/meta/neofs/resource?uri=${encodeURIComponent("https://example.com/meta/1.json")}`, 400);

    const neoFsResource = await fetchText(
      `${baseUrl}/api/meta/neofs/resource?uri=${encodeURIComponent("neofs://container-1/meta/1.json")}`,
    );
    assert([200, 502].includes(neoFsResource.status), "NeoFS resource endpoint should return 200 or 502");
    if (neoFsResource.status !== 200) {
      const payload = JSON.parse(neoFsResource.text);
      assert(typeof payload?.message === "string", "NeoFS resource error should include message");
    }

    const ghost = await fetchJson(`${baseUrl}/api/meta/ghostmarket`);
    assert(typeof ghost?.contractHash === "string", "ghostmarket meta should include contractHash");
    assert(
      ghost.contractHash === "0x0000000000000000000000000000000000000000",
      "ghostmarket meta should normalize default contract hash",
    );
    const ghostUpperPrefix = await fetchJson(
      `${baseUrl}/api/meta/ghostmarket?contractHash=${encodeURIComponent("0X1111111111111111111111111111111111111111")}`,
    );
    assert(
      ghostUpperPrefix?.contractHash === "0x1111111111111111111111111111111111111111",
      "ghostmarket should normalize uppercase 0X contract hash query",
    );
    await fetchJson(`${baseUrl}/api/meta/ghostmarket?contractHash=${encodeURIComponent("0x1234")}`, 400);
    await fetchJson(`${baseUrl}/api/meta/ghostmarket/collection/1?contractHash=${encodeURIComponent("0x1234")}`, 400);
    await fetchJson(`${baseUrl}/api/meta/ghostmarket/token/1?contractHash=${encodeURIComponent("0x1234")}`, 400);
    await fetchJson(`${baseUrl}/api/stats`);

    const collections = await fetchJson(`${baseUrl}/api/collections`);
    assert(Array.isArray(collections) && collections.length >= 1, "collections should contain seeded row");
    assert(
      collections.some((collection) => collection.collectionId === seededTestnet.collectionId),
      "default network collections should return testnet seed",
    );

    const mainnetCollections = await fetchJson(`${baseUrl}/api/collections?network=mainnet`);
    assert(
      Array.isArray(mainnetCollections) &&
        mainnetCollections.some((collection) => collection.collectionId === seededMainnet.collectionId),
      "mainnet collections should return mainnet seed",
    );

    const collection = await fetchJson(`${baseUrl}/api/collections/${seededTestnet.collectionId}`);
    assert(collection?.collectionId === seededTestnet.collectionId, "collection lookup failed");

    await fetchJson(`${baseUrl}/api/collections/missing-collection`, 404);

    const tokens = await fetchJson(`${baseUrl}/api/collections/${seededTestnet.collectionId}/tokens`);
    assert(Array.isArray(tokens) && tokens.length >= 1, "collection tokens should contain seeded row");

    const token = await fetchJson(`${baseUrl}/api/tokens/${seededTestnet.tokenId}`);
    assert(token?.tokenId === seededTestnet.tokenId, "token lookup failed");

    const walletTokens = await fetchJson(`${baseUrl}/api/wallets/${seededTestnet.owner}/tokens`);
    assert(Array.isArray(walletTokens) && walletTokens.length >= 1, "wallet tokens should contain seeded row");

    const transfers = await fetchJson(`${baseUrl}/api/transfers?limit=10`);
    assert(Array.isArray(transfers) && transfers.length >= 1, "transfers should contain seeded row");

    await fetchJson(`${baseUrl}/api/transfers?limit=0`, 400);

    console.log("[smoke:e2e] API smoke checks passed");
  } finally {
    apiProcess.kill("SIGTERM");
    await new Promise((resolve) => {
      apiProcess.once("exit", () => resolve());
      setTimeout(() => resolve(), 5000);
    });

    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

function runOptionalTestnet() {
  if (process.env.SMOKE_INCLUDE_TESTNET !== "true") {
    console.log("[smoke:e2e] Skip testnet flow (set SMOKE_INCLUDE_TESTNET=true to enable)");
    return;
  }

  runCommand("node", ["scripts/testnet-flow.mjs"]);
}

async function main() {
  runCommand("npm", ["run", "verify:contracts"]);
  runCommand("npm", ["run", "check"]);
  runCommand("npm", ["run", "build"]);
  runCommand("npx", ["tsx", "scripts/assert-sdk.ts"]);
  await runApiSmoke();
  runOptionalTestnet();

  console.log("\n[smoke:e2e] All checks passed");
}

main().catch((error) => {
  console.error("[smoke:e2e] Failed:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
