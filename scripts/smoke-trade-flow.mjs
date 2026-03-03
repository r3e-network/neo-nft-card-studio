#!/usr/bin/env node

import { spawn } from "node:child_process";
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

async function fetchJson(url, expectedStatus = 200) {
  const response = await fetch(url);
  if (response.status !== expectedStatus) {
    const body = await response.text();
    throw new Error(`Unexpected status ${response.status} for ${url}. Body: ${body}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
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
      // retry
    }

    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  throw new Error("API did not become healthy within timeout");
}

function insertCollection(dbFile, input) {
  const db = new Database(dbFile);
  db.prepare(
    `INSERT OR REPLACE INTO collections(
      collection_id, owner, name, symbol, description, base_uri, contract_hash, max_supply,
      minted, royalty_bps, transferable, paused, created_at, updated_at
    ) VALUES(
      @collectionId, @owner, @name, @symbol, @description, @baseUri, @contractHash, @maxSupply,
      @minted, @royaltyBps, @transferable, @paused, @createdAt, @updatedAt
    )`,
  ).run(input);
  db.close();
}

function mintToken(dbFile, input) {
  const db = new Database(dbFile);
  const txn = db.transaction(() => {
    db.prepare(
      `INSERT OR REPLACE INTO tokens(
        token_id, collection_id, owner, uri, properties_json, burned, minted_at, updated_at
      ) VALUES(
        @tokenId, @collectionId, @owner, @uri, @propertiesJson, @burned, @mintedAt, @updatedAt
      )`,
    ).run(input);

    db.prepare(
      `UPDATE collections
       SET minted = @minted, updated_at = @updatedAt
       WHERE collection_id = @collectionId`,
    ).run({
      collectionId: input.collectionId,
      minted: "1",
      updatedAt: input.updatedAt,
    });

    db.prepare(
      `INSERT INTO transfers(txid, token_id, from_address, to_address, block_index, timestamp)
       VALUES(@txid, @tokenId, @fromAddress, @toAddress, @blockIndex, @timestamp)`,
    ).run({
      txid: `0xmint-${Date.now().toString(16)}`,
      tokenId: input.tokenId,
      fromAddress: null,
      toAddress: input.owner,
      blockIndex: 1,
      timestamp: input.updatedAt,
    });
  });

  txn();
  db.close();
}

function listToken(dbFile, input) {
  const db = new Database(dbFile);
  db.prepare(
    `INSERT OR REPLACE INTO token_listings(
      token_id, seller, price, listed, listed_at, updated_at
    ) VALUES(
      @tokenId, @seller, @price, @listed, @listedAt, @updatedAt
    )`,
  ).run(input);
  db.close();
}

function buyToken(dbFile, input) {
  const db = new Database(dbFile);
  const txn = db.transaction(() => {
    db.prepare(
      `UPDATE tokens
       SET owner = @buyer, updated_at = @updatedAt
       WHERE token_id = @tokenId`,
    ).run(input);

    db.prepare(
      `INSERT OR REPLACE INTO token_listings(
        token_id, seller, price, listed, listed_at, updated_at
      ) VALUES(
        @tokenId, @seller, @price, 0, @listedAt, @updatedAt
      )`,
    ).run(input);

    db.prepare(
      `INSERT INTO transfers(txid, token_id, from_address, to_address, block_index, timestamp)
       VALUES(@txid, @tokenId, @fromAddress, @toAddress, @blockIndex, @timestamp)`,
    ).run({
      txid: `0xbuy-${Date.now().toString(16)}`,
      tokenId: input.tokenId,
      fromAddress: input.seller,
      toAddress: input.buyer,
      blockIndex: 2,
      timestamp: input.updatedAt,
    });
  });

  txn();
  db.close();
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nft-platform-trade-smoke-"));
  const dbFile = path.join(tempDir, "trade-smoke.db");
  const apiPort = 19100 + Math.floor(Math.random() * 500);
  const baseUrl = `http://127.0.0.1:${apiPort}`;

  const seller = "NQ5S4x8fWFhktmQfS4wFK6fGY4fQ3dYvMC";
  const buyer = "NhVvQ32ybDkM9x7Nx2A3LQx8ZnTbQ3Z5A8";
  const collectionId = `trade-col-${Date.now().toString(36)}`;
  const tokenId = `${collectionId}:1`;
  const now = new Date().toISOString();

  const env = {
    ...process.env,
    API_HOST: "127.0.0.1",
    API_PORT: String(apiPort),
    NEO_DEFAULT_NETWORK: "testnet",
    DB_FILE: dbFile,
    NEO_RPC_URL: DEFAULT_RPC,
    NEO_CONTRACT_HASH: "0x0000000000000000000000000000000000000000",
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

    // 1) Create collection
    insertCollection(dbFile, {
      collectionId,
      owner: seller,
      name: "Trade Smoke Collection",
      symbol: "TRDS",
      description: "Smoke flow: create -> mint -> list -> buy",
      baseUri: "https://example.com/trade/meta/",
      contractHash: null,
      maxSupply: "100",
      minted: "0",
      royaltyBps: 500,
      transferable: 1,
      paused: 0,
      createdAt: now,
      updatedAt: now,
    });

    const createdCollection = await fetchJson(`${baseUrl}/api/collections/${collectionId}`);
    assert(createdCollection?.collectionId === collectionId, "create collection verification failed");

    // 2) Mint token
    mintToken(dbFile, {
      tokenId,
      collectionId,
      owner: seller,
      uri: "https://example.com/trade/meta/1.json",
      propertiesJson: '{"name":"Trade Smoke #1"}',
      burned: 0,
      mintedAt: now,
      updatedAt: now,
    });

    const sellerTokensAfterMint = await fetchJson(`${baseUrl}/api/wallets/${seller}/tokens`);
    assert(
      Array.isArray(sellerTokensAfterMint) && sellerTokensAfterMint.some((token) => token.tokenId === tokenId),
      "mint verification failed: seller wallet token missing",
    );

    // 3) List token
    listToken(dbFile, {
      tokenId,
      seller,
      price: "200000000",
      listed: 1,
      listedAt: now,
      updatedAt: now,
    });

    const listedMarket = await fetchJson(`${baseUrl}/api/market/listings?listedOnly=true&collectionId=${encodeURIComponent(collectionId)}`);
    assert(Array.isArray(listedMarket) && listedMarket.length === 1, "listing verification failed: expected one listed item");
    assert(listedMarket[0]?.sale?.listed === true, "listing verification failed: sale.listed should be true");

    // 4) Buy token (simulate indexed state transition)
    buyToken(dbFile, {
      tokenId,
      seller,
      buyer,
      price: "200000000",
      listedAt: now,
      updatedAt: new Date(Date.now() + 1000).toISOString(),
    });

    // 5) Portfolio validation
    const buyerTokens = await fetchJson(`${baseUrl}/api/wallets/${buyer}/tokens`);
    assert(
      Array.isArray(buyerTokens) && buyerTokens.some((token) => token.tokenId === tokenId),
      "portfolio verification failed: buyer does not own purchased token",
    );

    const sellerTokens = await fetchJson(`${baseUrl}/api/wallets/${seller}/tokens`);
    assert(
      Array.isArray(sellerTokens) && !sellerTokens.some((token) => token.tokenId === tokenId),
      "portfolio verification failed: seller still holds purchased token",
    );

    const buyerMarket = await fetchJson(`${baseUrl}/api/market/listings?owner=${encodeURIComponent(buyer)}&collectionId=${encodeURIComponent(collectionId)}`);
    assert(Array.isArray(buyerMarket) && buyerMarket.length === 1, "portfolio verification failed: buyer market view missing token");
    assert(buyerMarket[0]?.sale?.listed === false, "portfolio verification failed: purchased token should not remain listed");

    console.log("[smoke:trade] Flow passed: create -> mint -> list -> buy -> portfolio validation");
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

main().catch((error) => {
  console.error("[smoke:trade] Failed:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
