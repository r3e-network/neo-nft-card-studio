import { createClient, SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type BetterSqlite3 from "better-sqlite3";

import type {
  CollectionRecord,
  MarketListingRecord,
  TokenListingRecord,
  TokenRecord,
  TransferRecord,
} from "./types.js";

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

CREATE TABLE IF NOT EXISTS token_listings (
  token_id TEXT PRIMARY KEY,
  seller TEXT NOT NULL,
  price TEXT NOT NULL,
  listed INTEGER NOT NULL,
  listed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(token_id) REFERENCES tokens(token_id)
);

CREATE INDEX IF NOT EXISTS idx_collections_owner ON collections(owner);
CREATE INDEX IF NOT EXISTS idx_tokens_owner ON tokens(owner);
CREATE INDEX IF NOT EXISTS idx_tokens_collection ON tokens(collection_id);
CREATE INDEX IF NOT EXISTS idx_transfers_token ON transfers(token_id);
CREATE INDEX IF NOT EXISTS idx_transfers_block ON transfers(block_index);
CREATE INDEX IF NOT EXISTS idx_token_listings_listed ON token_listings(listed);
CREATE INDEX IF NOT EXISTS idx_token_listings_updated ON token_listings(updated_at);
`;

const require = createRequire(import.meta.url);
type SqliteDatabase = InstanceType<typeof BetterSqlite3>;
type SqliteConstructor = typeof BetterSqlite3;

function loadSqliteConstructor(): SqliteConstructor {
  try {
    return require("better-sqlite3") as SqliteConstructor;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `SQLite backend is unavailable because better-sqlite3 failed to load (${message}). Configure SUPABASE_URL with SUPABASE_SERVICE_ROLE_KEY to run on serverless platforms.`,
    );
  }
}

function formatSupabaseError(error: unknown): string {
  if (!error) {
    return "unknown error";
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (typeof error === "object") {
    const withMessage = error as {
      message?: unknown;
      code?: unknown;
      details?: unknown;
      hint?: unknown;
    };
    const parts = [
      typeof withMessage.code === "string" ? `code=${withMessage.code}` : "",
      typeof withMessage.message === "string" ? withMessage.message : "",
      typeof withMessage.details === "string" ? withMessage.details : "",
      typeof withMessage.hint === "string" ? withMessage.hint : "",
    ].filter((entry) => entry.length > 0);

    if (parts.length > 0) {
      return parts.join(" | ");
    }
  }

  return String(error);
}

function isSupabaseNoRowsError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code === "PGRST116" || candidate.code === "PGRST505") {
    return true;
  }

  if (typeof candidate.message !== "string") {
    return false;
  }

  const message = candidate.message.toLowerCase();
  return message.includes("0 rows") || message.includes("no rows");
}

function assertSupabaseSuccess(error: unknown, operation: string): void {
  if (!error) {
    return;
  }

  throw new Error(`Supabase ${operation} failed: ${formatSupabaseError(error)}`);
}

export class AppDb {
  private readonly sqlite: SqliteDatabase | null = null;
  private readonly supabase: SupabaseClient | null = null;

  constructor(dbPath: string, supabaseUrl?: string, supabaseKey?: string) {
    if (supabaseUrl && supabaseKey) {
      this.supabase = createClient(supabaseUrl, supabaseKey);
    } else {
      const dir = path.dirname(dbPath);
      if (dir && dir !== ".") {
        fs.mkdirSync(dir, { recursive: true });
      }

      const Sqlite = loadSqliteConstructor();
      this.sqlite = new Sqlite(dbPath);
      this.sqlite.pragma("journal_mode = WAL");
      this.sqlite.exec(SCHEMA_SQL);
      this.ensureCollectionContractHashColumn();
    }
  }

  close(): void {
    this.sqlite?.close();
  }

  async getSyncState(key: string): Promise<string | null> {
    if (this.supabase) {
      const { data, error } = await this.supabase
        .from("sync_state")
        .select("value")
        .eq("key", key)
        .maybeSingle();
      if (error) {
        if (isSupabaseNoRowsError(error)) {
          return null;
        }
        assertSupabaseSuccess(error, `read sync_state key='${key}'`);
      }
      return data?.value ?? null;
    }

    const row = this.sqlite!.prepare("SELECT value FROM sync_state WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  async setSyncState(key: string, value: string): Promise<void> {
    if (this.supabase) {
      const { error } = await this.supabase
        .from("sync_state")
        .upsert({ key, value }, { onConflict: "key" });
      assertSupabaseSuccess(error, `upsert sync_state key='${key}'`);
      return;
    }

    this.sqlite!
      .prepare(
        `INSERT INTO sync_state(key, value)
         VALUES(?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  private ensureCollectionContractHashColumn(): void {
    if (!this.sqlite) return;
    const tableInfo = this.sqlite.prepare("PRAGMA table_info(collections)").all() as Array<{ name: string }>;
    const hasColumn = tableInfo.some((column) => column.name === "contract_hash");
    if (!hasColumn) {
      this.sqlite.exec("ALTER TABLE collections ADD COLUMN contract_hash TEXT");
    }
  }

  async upsertCollection(input: CollectionRecord): Promise<void> {
    if (this.supabase) {
      const { error } = await this.supabase
        .from("collections")
        .upsert({
          collection_id: input.collectionId,
          owner: input.owner,
          name: input.name,
          symbol: input.symbol,
          description: input.description,
          base_uri: input.baseUri,
          contract_hash: input.contractHash ?? null,
          max_supply: input.maxSupply,
          minted: input.minted,
          royalty_bps: input.royaltyBps,
          transferable: input.transferable,
          paused: input.paused,
          created_at: input.createdAt,
          updated_at: input.updatedAt,
        }, { onConflict: "collection_id" });
      assertSupabaseSuccess(error, `upsert collections collection_id='${input.collectionId}'`);
      return;
    }

    this.sqlite!
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

  async setCollectionContractHash(collectionId: string, contractHash: string, updatedAt: string): Promise<void> {
    if (this.supabase) {
      const { error } = await this.supabase
        .from("collections")
        .update({ contract_hash: contractHash, updated_at: updatedAt })
        .eq("collection_id", collectionId);
      assertSupabaseSuccess(error, `update collections.contract_hash for collection_id='${collectionId}'`);
      return;
    }

    this.sqlite!
      .prepare(
        `UPDATE collections
         SET contract_hash = ?, updated_at = ?
         WHERE collection_id = ?`,
      )
      .run(contractHash, updatedAt, collectionId);
  }

  async listCollectionContractHashes(): Promise<string[]> {
    if (this.supabase) {
      const { data, error } = await this.supabase
        .from("collections")
        .select("contract_hash")
        .not("contract_hash", "is", null);
      assertSupabaseSuccess(error, "list collection contract hashes");
      return (data ?? []).map((row) => row.contract_hash).filter(Boolean) as string[];
    }

    const rows = this.sqlite!
      .prepare(
        `SELECT contract_hash AS contractHash
         FROM collections
         WHERE contract_hash IS NOT NULL
           AND LENGTH(contract_hash) > 0`,
      )
      .all() as Array<{ contractHash: string }>;

    return rows.map((row) => row.contractHash);
  }

  async upsertToken(input: TokenRecord): Promise<void> {
    if (this.supabase) {
      const { error } = await this.supabase
        .from("tokens")
        .upsert({
          token_id: input.tokenId,
          collection_id: input.collectionId,
          owner: input.owner,
          uri: input.uri,
          properties_json: input.propertiesJson,
          burned: input.burned,
          minted_at: input.mintedAt,
          updated_at: input.updatedAt,
        }, { onConflict: "token_id" });
      assertSupabaseSuccess(error, `upsert tokens token_id='${input.tokenId}'`);
      return;
    }

    this.sqlite!
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

  async markTokenOwner(tokenId: string, owner: string, updatedAt: string): Promise<void> {
    if (this.supabase) {
      const { error } = await this.supabase
        .from("tokens")
        .update({ owner, updated_at: updatedAt })
        .eq("token_id", tokenId);
      assertSupabaseSuccess(error, `update token owner for token_id='${tokenId}'`);
      return;
    }

    this.sqlite!
      .prepare(
        `UPDATE tokens
         SET owner = ?, updated_at = ?
         WHERE token_id = ?`,
      )
      .run(owner, updatedAt, tokenId);
  }

  async insertTransfer(input: TransferRecord): Promise<void> {
    if (this.supabase) {
      const existing = await this.supabase
        .from("transfers")
        .select("id")
        .eq("txid", input.txid)
        .eq("token_id", input.tokenId)
        .eq("block_index", input.blockIndex)
        .maybeSingle();
      if (existing.error && !isSupabaseNoRowsError(existing.error)) {
        assertSupabaseSuccess(existing.error, `read transfer txid='${input.txid}' token_id='${input.tokenId}'`);
      }
      if (existing.data) {
        return;
      }

      const { error } = await this.supabase
        .from("transfers")
        .insert({
          txid: input.txid,
          token_id: input.tokenId,
          from_address: input.fromAddress,
          to_address: input.toAddress,
          block_index: input.blockIndex,
          timestamp: input.timestamp,
        });
      assertSupabaseSuccess(error, `insert transfer txid='${input.txid}' token_id='${input.tokenId}'`);
      return;
    }

    const existing = this.sqlite!
      .prepare(
        `SELECT 1 AS found
         FROM transfers
         WHERE txid = ?
           AND token_id = ?
           AND block_index = ?
         LIMIT 1`,
      )
      .get(input.txid, input.tokenId, input.blockIndex) as { found: number } | undefined;
    if (existing?.found === 1) {
      return;
    }

    this.sqlite!
      .prepare(
        `INSERT INTO transfers(txid, token_id, from_address, to_address, block_index, timestamp)
         VALUES(@txid, @tokenId, @fromAddress, @toAddress, @blockIndex, @timestamp)`,
      )
      .run(input);
  }

  async applyTransfer(input: TransferRecord): Promise<void> {
    if (this.supabase) {
      // In Supabase we don't have built-in easy synchronous transactions across tables like this
      // but we can perform them sequentially or use a RPC function.
      // For simplicity here, we do it sequentially.
      if (input.toAddress) {
        await this.markTokenOwner(input.tokenId, input.toAddress, input.timestamp);
      }
      await this.insertTransfer(input);
      return;
    }

    const txn = this.sqlite!.transaction((record: TransferRecord) => {
      if (record.toAddress) {
        this.sqlite!
          .prepare(
            `UPDATE tokens
             SET owner = ?, updated_at = ?
             WHERE token_id = ?`,
          )
          .run(record.toAddress, record.timestamp, record.tokenId);
      }

      const existing = this.sqlite!
        .prepare(
          `SELECT 1 AS found
           FROM transfers
           WHERE txid = ?
             AND token_id = ?
             AND block_index = ?
           LIMIT 1`,
        )
        .get(record.txid, record.tokenId, record.blockIndex) as { found: number } | undefined;
      if (existing?.found === 1) {
        return;
      }

      this.sqlite!
        .prepare(
          `INSERT INTO transfers(txid, token_id, from_address, to_address, block_index, timestamp)
           VALUES(@txid, @tokenId, @fromAddress, @toAddress, @blockIndex, @timestamp)`,
        )
        .run(record);
    });

    txn(input);
  }

  async upsertTokenListing(input: TokenListingRecord): Promise<void> {
    if (this.supabase) {
      const { error } = await this.supabase
        .from("token_listings")
        .upsert({
          token_id: input.tokenId,
          seller: input.seller,
          price: input.price,
          listed: input.listed,
          listed_at: input.listedAt,
          updated_at: input.updatedAt,
        }, { onConflict: "token_id" });
      assertSupabaseSuccess(error, `upsert token_listings token_id='${input.tokenId}'`);
      return;
    }

    this.sqlite!
      .prepare(
        `INSERT INTO token_listings(
          token_id, seller, price, listed, listed_at, updated_at
        ) VALUES(
          @tokenId, @seller, @price, @listed, @listedAt, @updatedAt
        )
        ON CONFLICT(token_id) DO UPDATE SET
          seller=excluded.seller,
          price=excluded.price,
          listed=excluded.listed,
          listed_at=excluded.listed_at,
          updated_at=excluded.updated_at`,
      )
      .run(input);
  }

  async listMarketListings(input?: {
    collectionId?: string;
    owner?: string;
    listedOnly?: boolean;
    limit?: number;
  }): Promise<MarketListingRecord[]> {
    if (this.supabase) {
      let query = this.supabase
        .from("tokens")
        .select(`
          tokenId:token_id,
          collectionId:collection_id,
          owner,
          uri,
          propertiesJson:properties_json,
          burned,
          mintedAt:minted_at,
          tokenUpdatedAt:updated_at,
          collections!inner (
            collectionOwner:owner,
            collectionName:name,
            collectionSymbol:symbol,
            collectionDescription:description,
            collectionBaseUri:base_uri,
            collectionContractHash:contract_hash,
            collectionMaxSupply:max_supply,
            collectionMinted:minted,
            collectionRoyaltyBps:royalty_bps,
            collectionTransferable:transferable,
            collectionPaused:paused,
            collectionCreatedAt:created_at,
            collectionUpdatedAt:updated_at
          ),
          token_listings (
            listed,
            seller,
            price,
            listedAt:listed_at,
            listingUpdatedAt:updated_at
          )
        `)
        .eq("burned", 0);

      if (input?.collectionId) query = query.eq("collection_id", input.collectionId);
      if (input?.owner) query = query.eq("owner", input.owner);
      if (input?.listedOnly) query = query.eq("token_listings.listed", 1);

      const { data, error } = await query
        .order("token_id", { ascending: false }) // Simplified ordering for now
        .limit(Math.min(input?.limit ?? 100, 500));

      if (error) return [];

      return (data as any[]).map(item => ({
        ...item,
        ...item.collections,
        ...(item.token_listings?.[0] || { listed: 0, seller: null, price: null, listedAt: null, listingUpdatedAt: null })
      }));
    }

    const limit = Math.min(Math.max(input?.limit ?? 100, 1), 500);
    const whereClauses = ["t.burned = 0"];
    const params: Array<string | number> = [];

    if (input?.collectionId) {
      whereClauses.push("t.collection_id = ?");
      params.push(input.collectionId);
    }

    if (input?.owner) {
      whereClauses.push("t.owner = ?");
      params.push(input.owner);
    }

    if (input?.listedOnly) {
      whereClauses.push("COALESCE(l.listed, 0) = 1");
    }

    params.push(limit);

    const sql = `
      SELECT
        t.token_id AS tokenId,
        t.collection_id AS collectionId,
        t.owner AS owner,
        t.uri AS uri,
        t.properties_json AS propertiesJson,
        t.burned AS burned,
        t.minted_at AS mintedAt,
        t.updated_at AS tokenUpdatedAt,
        c.owner AS collectionOwner,
        c.name AS collectionName,
        c.symbol AS collectionSymbol,
        c.description AS collectionDescription,
        c.base_uri AS collectionBaseUri,
        c.contract_hash AS collectionContractHash,
        c.max_supply AS collectionMaxSupply,
        c.minted AS collectionMinted,
        c.royalty_bps AS collectionRoyaltyBps,
        c.transferable AS collectionTransferable,
        c.paused AS collectionPaused,
        c.created_at AS collectionCreatedAt,
        c.updated_at AS collectionUpdatedAt,
        COALESCE(l.listed, 0) AS listed,
        l.seller AS seller,
        l.price AS price,
        l.listed_at AS listedAt,
        l.updated_at AS listingUpdatedAt
      FROM tokens t
      INNER JOIN collections c ON c.collection_id = t.collection_id
      LEFT JOIN token_listings l ON l.token_id = t.token_id
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY COALESCE(l.listed, 0) DESC, datetime(l.listed_at) DESC, datetime(t.updated_at) DESC
      LIMIT ?
    `;

    return this.sqlite!.prepare(sql).all(...params) as MarketListingRecord[];
  }

  async listCollections(owner?: string): Promise<CollectionRecord[]> {
    if (this.supabase) {
      let query = this.supabase
        .from("collections")
        .select(`
          collectionId:collection_id,
          owner,
          name,
          symbol,
          description,
          baseUri:base_uri,
          contractHash:contract_hash,
          maxSupply:max_supply,
          minted,
          royaltyBps:royalty_bps,
          transferable,
          paused,
          createdAt:created_at,
          updatedAt:updated_at
        `);
      
      if (owner) query = query.eq("owner", owner);
      
      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) return [];
      return data as CollectionRecord[];
    }

    if (owner) {
      return this.sqlite!
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

    return this.sqlite!
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

  async getCollection(collectionId: string): Promise<CollectionRecord | null> {
    if (this.supabase) {
      const { data, error } = await this.supabase
        .from("collections")
        .select(`
          collectionId:collection_id,
          owner,
          name,
          symbol,
          description,
          baseUri:base_uri,
          contractHash:contract_hash,
          maxSupply:max_supply,
          minted,
          royaltyBps:royalty_bps,
          transferable,
          paused,
          createdAt:created_at,
          updatedAt:updated_at
        `)
        .eq("collection_id", collectionId)
        .single();
      
      if (error) return null;
      return data as CollectionRecord;
    }

    const row = this.sqlite!
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

  async listCollectionTokens(collectionId: string): Promise<TokenRecord[]> {
    if (this.supabase) {
      const { data, error } = await this.supabase
        .from("tokens")
        .select(`
          tokenId:token_id,
          collectionId:collection_id,
          owner,
          uri,
          propertiesJson:properties_json,
          burned,
          mintedAt:minted_at,
          updatedAt:updated_at
        `)
        .eq("collection_id", collectionId)
        .eq("burned", 0)
        .order("minted_at", { ascending: false });
      
      if (error) return [];
      return data as TokenRecord[];
    }

    return this.sqlite!
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

  async listWalletTokens(owner: string): Promise<TokenRecord[]> {
    if (this.supabase) {
      const { data, error } = await this.supabase
        .from("tokens")
        .select(`
          tokenId:token_id,
          collectionId:collection_id,
          owner,
          uri,
          propertiesJson:properties_json,
          burned,
          mintedAt:minted_at,
          updatedAt:updated_at
        `)
        .eq("owner", owner)
        .eq("burned", 0)
        .order("updated_at", { ascending: false });
      
      if (error) return [];
      return data as TokenRecord[];
    }

    return this.sqlite!
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

  async getToken(tokenId: string): Promise<TokenRecord | null> {
    if (this.supabase) {
      const { data, error } = await this.supabase
        .from("tokens")
        .select(`
          tokenId:token_id,
          collectionId:collection_id,
          owner,
          uri,
          propertiesJson:properties_json,
          burned,
          mintedAt:minted_at,
          updatedAt:updated_at
        `)
        .eq("token_id", tokenId)
        .single();
      
      if (error) return null;
      return data as TokenRecord;
    }

    const row = this.sqlite!
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

  async listTransfers(tokenId?: string, limit = 100): Promise<TransferRecord[]> {
    if (this.supabase) {
      let query = this.supabase
        .from("transfers")
        .select(`
          txid,
          tokenId:token_id,
          fromAddress:from_address,
          toAddress:to_address,
          blockIndex:block_index,
          timestamp
        `);
      
      if (tokenId) query = query.eq("token_id", tokenId);
      
      const { data, error } = await query
        .order("id", { ascending: false })
        .limit(limit);
      
      if (error) return [];
      return data as TransferRecord[];
    }

    if (tokenId) {
      return this.sqlite!
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

    return this.sqlite!
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

  async getStats(): Promise<{ collectionCount: number; tokenCount: number; transferCount: number }> {
    if (this.supabase) {
      const [collectionsResult, tokensResult, transfersResult] = await Promise.all([
        this.supabase.from("collections").select("*", { count: "exact", head: true }),
        this.supabase.from("tokens").select("*", { count: "exact", head: true }).eq("burned", 0),
        this.supabase.from("transfers").select("*", { count: "exact", head: true }),
      ]);
      assertSupabaseSuccess(collectionsResult.error, "count collections");
      assertSupabaseSuccess(tokensResult.error, "count active tokens");
      assertSupabaseSuccess(transfersResult.error, "count transfers");

      return {
        collectionCount: collectionsResult.count || 0,
        tokenCount: tokensResult.count || 0,
        transferCount: transfersResult.count || 0,
      };
    }

    const collectionCount = (this.sqlite!.prepare("SELECT COUNT(1) AS count FROM collections").get() as { count: number }).count;
    const tokenCount = (this.sqlite!.prepare("SELECT COUNT(1) AS count FROM tokens WHERE burned = 0").get() as { count: number }).count;
    const transferCount = (this.sqlite!.prepare("SELECT COUNT(1) AS count FROM transfers").get() as { count: number }).count;

    return { collectionCount, tokenCount, transferCount };
  }
}
