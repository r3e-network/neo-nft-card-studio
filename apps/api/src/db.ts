import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

import type { CollectionRecord, TokenRecord, TransferRecord } from "./types";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collections (
  collection_id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  description TEXT NOT NULL,
  base_uri TEXT NOT NULL,
  contract_hash TEXT,
  max_supply TEXT NOT NULL,
  minted TEXT NOT NULL,
  royalty_bps INTEGER NOT NULL,
  transferable INTEGER NOT NULL,
  paused INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens (
  token_id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  uri TEXT NOT NULL,
  properties_json TEXT NOT NULL,
  burned INTEGER NOT NULL,
  minted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(collection_id) REFERENCES collections(collection_id)
);

CREATE TABLE IF NOT EXISTS transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txid TEXT NOT NULL,
  token_id TEXT NOT NULL,
  from_address TEXT,
  to_address TEXT,
  block_index INTEGER NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collections_owner ON collections(owner);
CREATE INDEX IF NOT EXISTS idx_tokens_owner ON tokens(owner);
CREATE INDEX IF NOT EXISTS idx_tokens_collection ON tokens(collection_id);
CREATE INDEX IF NOT EXISTS idx_transfers_token ON transfers(token_id);
CREATE INDEX IF NOT EXISTS idx_transfers_block ON transfers(block_index);
`;

export class AppDb {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (dir && dir !== ".") {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA_SQL);
    this.ensureCollectionContractHashColumn();
  }

  close(): void {
    this.db.close();
  }

  getSyncState(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM sync_state WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSyncState(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO sync_state(key, value)
         VALUES(?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  private ensureCollectionContractHashColumn(): void {
    const tableInfo = this.db.prepare("PRAGMA table_info(collections)").all() as Array<{ name: string }>;
    const hasColumn = tableInfo.some((column) => column.name === "contract_hash");
    if (!hasColumn) {
      this.db.exec("ALTER TABLE collections ADD COLUMN contract_hash TEXT");
    }
  }

  upsertCollection(input: CollectionRecord): void {
    this.db
      .prepare(
        `INSERT INTO collections(
          collection_id, owner, name, symbol, description, base_uri, contract_hash, max_supply,
          minted, royalty_bps, transferable, paused, created_at, updated_at
        ) VALUES(
          @collectionId, @owner, @name, @symbol, @description, @baseUri, @contractHash, @maxSupply,
          @minted, @royaltyBps, @transferable, @paused, @createdAt, @updatedAt
        )
        ON CONFLICT(collection_id) DO UPDATE SET
          owner=excluded.owner,
          name=excluded.name,
          symbol=excluded.symbol,
          description=excluded.description,
          base_uri=excluded.base_uri,
          contract_hash=COALESCE(excluded.contract_hash, collections.contract_hash),
          max_supply=excluded.max_supply,
          minted=excluded.minted,
          royalty_bps=excluded.royalty_bps,
          transferable=excluded.transferable,
          paused=excluded.paused,
          updated_at=excluded.updated_at`,
      )
      .run({
        ...input,
        contractHash: input.contractHash ?? null,
      });
  }

  setCollectionContractHash(collectionId: string, contractHash: string, updatedAt: string): void {
    this.db
      .prepare(
        `UPDATE collections
         SET contract_hash = ?, updated_at = ?
         WHERE collection_id = ?`,
      )
      .run(contractHash, updatedAt, collectionId);
  }

  listCollectionContractHashes(): string[] {
    const rows = this.db
      .prepare(
        `SELECT contract_hash AS contractHash
         FROM collections
         WHERE contract_hash IS NOT NULL
           AND LENGTH(contract_hash) > 0`,
      )
      .all() as Array<{ contractHash: string }>;

    return rows.map((row) => row.contractHash);
  }

  upsertToken(input: TokenRecord): void {
    this.db
      .prepare(
        `INSERT INTO tokens(
          token_id, collection_id, owner, uri, properties_json, burned, minted_at, updated_at
        ) VALUES(
          @tokenId, @collectionId, @owner, @uri, @propertiesJson, @burned, @mintedAt, @updatedAt
        )
        ON CONFLICT(token_id) DO UPDATE SET
          collection_id=excluded.collection_id,
          owner=excluded.owner,
          uri=excluded.uri,
          properties_json=excluded.properties_json,
          burned=excluded.burned,
          updated_at=excluded.updated_at`,
      )
      .run(input);
  }

  markTokenOwner(tokenId: string, owner: string, updatedAt: string): void {
    this.db
      .prepare(
        `UPDATE tokens
         SET owner = ?, updated_at = ?
         WHERE token_id = ?`,
      )
      .run(owner, updatedAt, tokenId);
  }

  insertTransfer(input: TransferRecord): void {
    this.db
      .prepare(
        `INSERT INTO transfers(txid, token_id, from_address, to_address, block_index, timestamp)
         VALUES(@txid, @tokenId, @fromAddress, @toAddress, @blockIndex, @timestamp)`,
      )
      .run(input);
  }

  applyTransfer(input: TransferRecord): void {
    const txn = this.db.transaction((record: TransferRecord) => {
      if (record.toAddress) {
        this.db
          .prepare(
            `UPDATE tokens
             SET owner = ?, updated_at = ?
             WHERE token_id = ?`,
          )
          .run(record.toAddress, record.timestamp, record.tokenId);
      }

      this.db
        .prepare(
          `INSERT INTO transfers(txid, token_id, from_address, to_address, block_index, timestamp)
           VALUES(@txid, @tokenId, @fromAddress, @toAddress, @blockIndex, @timestamp)`,
        )
        .run(record);
    });

    txn(input);
  }

  listCollections(owner?: string): CollectionRecord[] {
    if (owner) {
      return this.db
        .prepare(
          `SELECT
            collection_id AS collectionId,
            owner,
            name,
            symbol,
            description,
            base_uri AS baseUri,
            contract_hash AS contractHash,
            max_supply AS maxSupply,
            minted,
            royalty_bps AS royaltyBps,
            transferable,
            paused,
            created_at AS createdAt,
            updated_at AS updatedAt
           FROM collections
           WHERE owner = ?
           ORDER BY datetime(created_at) DESC`,
        )
        .all(owner) as CollectionRecord[];
    }

    return this.db
      .prepare(
        `SELECT
          collection_id AS collectionId,
          owner,
          name,
          symbol,
          description,
          base_uri AS baseUri,
          contract_hash AS contractHash,
          max_supply AS maxSupply,
          minted,
          royalty_bps AS royaltyBps,
          transferable,
          paused,
          created_at AS createdAt,
          updated_at AS updatedAt
         FROM collections
         ORDER BY datetime(created_at) DESC`,
      )
      .all() as CollectionRecord[];
  }

  getCollection(collectionId: string): CollectionRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          collection_id AS collectionId,
          owner,
          name,
          symbol,
          description,
          base_uri AS baseUri,
          contract_hash AS contractHash,
          max_supply AS maxSupply,
          minted,
          royalty_bps AS royaltyBps,
          transferable,
          paused,
          created_at AS createdAt,
          updated_at AS updatedAt
         FROM collections
         WHERE collection_id = ?`,
      )
      .get(collectionId) as CollectionRecord | undefined;

    return row ?? null;
  }

  listCollectionTokens(collectionId: string): TokenRecord[] {
    return this.db
      .prepare(
        `SELECT
          token_id AS tokenId,
          collection_id AS collectionId,
          owner,
          uri,
          properties_json AS propertiesJson,
          burned,
          minted_at AS mintedAt,
          updated_at AS updatedAt
         FROM tokens
         WHERE collection_id = ?
           AND burned = 0
         ORDER BY datetime(minted_at) DESC`,
      )
      .all(collectionId) as TokenRecord[];
  }

  listWalletTokens(owner: string): TokenRecord[] {
    return this.db
      .prepare(
        `SELECT
          token_id AS tokenId,
          collection_id AS collectionId,
          owner,
          uri,
          properties_json AS propertiesJson,
          burned,
          minted_at AS mintedAt,
          updated_at AS updatedAt
         FROM tokens
         WHERE owner = ?
           AND burned = 0
         ORDER BY datetime(updated_at) DESC`,
      )
      .all(owner) as TokenRecord[];
  }

  getToken(tokenId: string): TokenRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          token_id AS tokenId,
          collection_id AS collectionId,
          owner,
          uri,
          properties_json AS propertiesJson,
          burned,
          minted_at AS mintedAt,
          updated_at AS updatedAt
         FROM tokens
         WHERE token_id = ?`,
      )
      .get(tokenId) as TokenRecord | undefined;

    return row ?? null;
  }

  listTransfers(tokenId?: string, limit = 100): TransferRecord[] {
    if (tokenId) {
      return this.db
        .prepare(
          `SELECT
            txid,
            token_id AS tokenId,
            from_address AS fromAddress,
            to_address AS toAddress,
            block_index AS blockIndex,
            timestamp
           FROM transfers
           WHERE token_id = ?
           ORDER BY id DESC
           LIMIT ?`,
        )
        .all(tokenId, limit) as TransferRecord[];
    }

    return this.db
      .prepare(
        `SELECT
          txid,
          token_id AS tokenId,
          from_address AS fromAddress,
          to_address AS toAddress,
          block_index AS blockIndex,
          timestamp
         FROM transfers
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(limit) as TransferRecord[];
  }

  getStats(): { collectionCount: number; tokenCount: number; transferCount: number } {
    const collectionCount = (this.db.prepare("SELECT COUNT(1) AS count FROM collections").get() as { count: number }).count;
    const tokenCount = (this.db.prepare("SELECT COUNT(1) AS count FROM tokens WHERE burned = 0").get() as { count: number }).count;
    const transferCount = (this.db.prepare("SELECT COUNT(1) AS count FROM transfers").get() as { count: number }).count;

    return { collectionCount, tokenCount, transferCount };
  }
}
