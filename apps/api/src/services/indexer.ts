import { u, wallet } from "@cityofzion/neon-js";
import pino from "pino";

import { decodeStackItem, NeoRpcService } from "@platform/neo-sdk";

import type { ResolvedNetworkAppConfig } from "../config.js";
import { AppDb } from "../db.js";

interface RawNotification {
  contract: string;
  eventname: string;
  state: {
    type: string;
    value: unknown[];
  };
}

interface RawExecution {
  notifications?: RawNotification[];
}

interface RawAppLog {
  executions?: RawExecution[];
}

interface RawTransaction {
  hash?: string;
  txid?: string;
}

interface RawBlock {
  tx?: Array<string | RawTransaction>;
  time?: number;
}

interface RawContractMethod {
  name?: string;
  parameters?: Array<{ type?: string }>;
  returntype?: string;
}

interface RawContractManifest {
  supportedstandards?: string[];
  abi?: {
    methods?: RawContractMethod[];
  };
}

interface RawContractState {
  manifest?: RawContractManifest;
}

interface RawNeotubeContractResponse {
  data?: {
    block_index?: unknown;
  };
}

const SYNC_BLOCK_KEY_PREFIX = "last_synced_block";
const UINT160_HASH_WITH_PREFIX_REGEX = /^0x[0-9a-f]{40}$/;

function normalizeHash(hash: string): string {
  if (!hash || hash.length === 0) {
    return "";
  }

  const trimmed = hash.trim();
  const noPrefix = trimmed.replace(/^0x/i, "");
  if (/^[0-9a-fA-F]{40}$/.test(noPrefix)) {
    return `0x${noPrefix.toLowerCase()}`;
  }

  return trimmed.toLowerCase();
}

function stackItemsFromNotification(notification: RawNotification): unknown[] {
  if (!notification.state || notification.state.type !== "Array" || !Array.isArray(notification.state.value)) {
    return [];
  }

  return (notification.state.value as Record<string, unknown>[]).map((item) => decodeStackItem(item as never));
}

function formatNeoAddress(input: unknown): string {
  const value = input?.toString() ?? "";
  if (!value) {
    return "";
  }

  if (!value.startsWith("0x")) {
    return value;
  }

  const normalized = value.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{40}$/.test(normalized)) {
    return value;
  }

  const direct = normalized.toLowerCase();
  const reversed = u.reverseHex(direct).toLowerCase();

  try {
    // Hash160 values emitted in VM notifications are little-endian script hashes.
    return wallet.getAddressFromScriptHash(reversed);
  } catch {
    try {
      return wallet.getAddressFromScriptHash(direct);
    } catch {
      return value;
    }
  }
}

function valueAsBool(input: unknown): number {
  return input === true || input === "true" || input === "1" ? 1 : 0;
}

function valueAsString(input: unknown): string {
  return input?.toString() ?? "";
}

function parseUnixTimestampMs(input: unknown): number | null {
  const raw = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(raw) || raw <= 0) {
    return null;
  }

  // Chain events may emit either seconds or milliseconds.
  if (raw >= 1_000_000_000_000) {
    return Math.floor(raw);
  }

  return Math.floor(raw * 1000);
}

function unixTimestampToIso(input: unknown, fallbackIso: string): string {
  const millis = parseUnixTimestampMs(input);
  if (millis === null) {
    return fallbackIso;
  }

  const date = new Date(millis);
  const time = date.getTime();
  if (!Number.isFinite(time)) {
    return fallbackIso;
  }

  return date.toISOString();
}

export class IndexerService {
  private readonly log = pino({ name: "indexer" });
  private readonly rpc: NeoRpcService;
  private interval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly eventsEnabled: boolean;
  private lastKnownChainBlockHeight: number | null = null;
  private chainHeightFetchInFlight: Promise<number | null> | null = null;

  constructor(
    private readonly config: ResolvedNetworkAppConfig,
    private readonly db: AppDb,
  ) {
    this.rpc = new NeoRpcService({
      rpcUrl: config.NEO_RPC_URL,
      contractHash: config.NEO_CONTRACT_HASH,
    });
    this.eventsEnabled = config.INDEXER_ENABLE_EVENTS ?? config.NEO_CONTRACT_DIALECT !== "rust";
  }

  private getSyncStateKey(): string {
    return `${SYNC_BLOCK_KEY_PREFIX}:${normalizeHash(this.config.NEO_CONTRACT_HASH)}`;
  }

  private static parseNonNegativeInteger(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return Math.floor(value);
    }

    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return Math.floor(parsed);
      }
    }

    return null;
  }

  private async resolveNeotubeBootstrapBlock(): Promise<number | null> {
    if (!this.config.NEOTUBE_ENABLED || this.config.NETWORK_NAME === "private") {
      return null;
    }

    const contractHash = normalizeHash(this.config.NEO_CONTRACT_HASH);
    if (!contractHash) {
      return null;
    }

    const baseUrl = this.config.NEOTUBE_API_BASE_URL.replace(/\/+$/, "");
    const endpoint = `${baseUrl}/v1/contract/${contractHash}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.NEOTUBE_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        headers: {
          Network: this.config.NETWORK_NAME,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        this.log.warn(
          { endpoint, status: response.status, network: this.config.NETWORK_NAME },
          "Neotube contract probe failed",
        );
        return null;
      }

      const payload = (await response.json()) as RawNeotubeContractResponse;
      const blockIndex = IndexerService.parseNonNegativeInteger(payload?.data?.block_index);
      if (blockIndex === null) {
        this.log.warn(
          { endpoint, network: this.config.NETWORK_NAME },
          "Neotube contract probe returned no deployment block",
        );
        return null;
      }

      return blockIndex;
    } catch (error) {
      this.log.warn(
        { err: error, endpoint, network: this.config.NETWORK_NAME },
        "Neotube contract probe failed",
      );
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async resolveContractHashFromEventValue(input: unknown): Promise<string> {
    const normalized = normalizeHash(valueAsString(input));
    if (!UINT160_HASH_WITH_PREFIX_REGEX.test(normalized)) {
      return "";
    }

    const reversed = `0x${u.reverseHex(normalized.slice(2)).toLowerCase()}`;
    const candidates = [...new Set([normalized, reversed])];

    for (const candidate of candidates) {
      try {
        await this.rpc.getContractState(candidate);
        return candidate;
      } catch {
        // try next candidate
      }
    }

    return normalized;
  }

  start(): void {
    if (!this.eventsEnabled) {
      this.log.warn(
        { dialect: this.config.NEO_CONTRACT_DIALECT },
        "Event indexer disabled by configuration for current contract dialect",
      );
      return;
    }

    if (this.interval) {
      return;
    }

    this.interval = setInterval(() => {
      void this.tick();
    }, this.config.INDEXER_POLL_MS);

    void this.tick();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  isEventIndexingEnabled(): boolean {
    return this.eventsEnabled;
  }

  getActiveRpcUrl(): string {
    return this.rpc.getActiveRpcUrl();
  }

  async getContractManifestSummary(contractHash?: string): Promise<
    | {
        supportedStandards: string[];
        methods: Array<{
          name: string;
          parameterTypes: string[];
          returnType: string;
        }>;
      }
    | null
  > {
    const state = (await this.rpc.getContractState(contractHash)) as RawContractState;
    const manifest = state?.manifest;
    if (!manifest) {
      return null;
    }

    const supportedStandards = Array.isArray(manifest.supportedstandards)
      ? manifest.supportedstandards.map((entry) => entry.toString())
      : [];
    const methods = Array.isArray(manifest.abi?.methods)
      ? manifest.abi.methods
          .filter((method) => typeof method?.name === "string" && method.name.length > 0)
          .map((method) => ({
            name: (method.name as string).toString(),
            parameterTypes: Array.isArray(method.parameters)
              ? method.parameters.map((parameter) => parameter?.type?.toString() ?? "Any")
              : [],
            returnType: method.returntype?.toString() ?? "Void",
          }))
      : [];

    return {
      supportedStandards,
      methods,
    };
  }

  async getCurrentSyncBlock(): Promise<number> {
    const saved = await this.db.getSyncState(this.getSyncStateKey());
    if (saved === null) {
      return this.config.INDEXER_START_BLOCK;
    }
    return Number(saved);
  }

  private async resolveSyncCursor(chainHeight: number): Promise<number> {
    const syncStateKey = this.getSyncStateKey();
    const saved = await this.db.getSyncState(syncStateKey);
    const parsedSaved = saved === null ? Number.NaN : Number(saved);
    if (Number.isFinite(parsedSaved) && parsedSaved >= 0) {
      if (parsedSaved >= this.config.INDEXER_START_BLOCK) {
        return parsedSaved;
      }

      await this.db.setSyncState(syncStateKey, this.config.INDEXER_START_BLOCK.toString());
      return this.config.INDEXER_START_BLOCK;
    }

    let bootstrapFrom = this.config.INDEXER_START_BLOCK;
    const neotubeBootstrapBlock = await this.resolveNeotubeBootstrapBlock();
    if (neotubeBootstrapBlock !== null) {
      bootstrapFrom = Math.max(bootstrapFrom, neotubeBootstrapBlock);
      this.log.info(
        { contractHash: this.config.NEO_CONTRACT_HASH, bootstrapFrom, neotubeBootstrapBlock },
        "No sync cursor found, bootstrapping from Neotube deployment block",
      );
    }

    const window = this.config.INDEXER_BOOTSTRAP_BLOCK_WINDOW;
    if (
      neotubeBootstrapBlock === null &&
      bootstrapFrom === 0
      && window > 0
      && chainHeight > window
    ) {
      bootstrapFrom = Math.max(0, chainHeight - window + 1);
      this.log.info(
        { chainHeight, bootstrapWindow: window, bootstrapFrom },
        "No sync cursor found, bootstrapping near chain tip",
      );
    }

    await this.db.setSyncState(syncStateKey, bootstrapFrom.toString());
    return bootstrapFrom;
  }

  getLastKnownChainBlockHeight(): number | null {
    return this.lastKnownChainBlockHeight;
  }

  async getChainBlockHeight(): Promise<number | null> {
    if (this.chainHeightFetchInFlight) {
      return this.chainHeightFetchInFlight;
    }

    this.chainHeightFetchInFlight = this.fetchChainBlockHeight();
    return this.chainHeightFetchInFlight;
  }

  async runSyncBatch(batchSize: number): Promise<void> {
    const chainHeight = await this.getChainBlockHeight();
    if (chainHeight === null) return;

    const cursor = await this.resolveSyncCursor(chainHeight);
    const syncStateKey = this.getSyncStateKey();

    if (cursor > chainHeight) return;

    const target = Math.min(chainHeight, cursor + batchSize - 1);
    const trackedHashes = await this.getTrackedContractHashes();

    this.log.info({ from: cursor, to: target }, "Running one-off sync batch");

    for (let index = cursor; index <= target; index += 1) {
      await this.indexBlock(index, trackedHashes);
      await this.db.setSyncState(syncStateKey, (index + 1).toString());
    }
  }

  private async tick(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    try {
      const chainHeight = await this.getChainBlockHeight();
      if (chainHeight === null) {
        return;
      }
      const cursor = await this.resolveSyncCursor(chainHeight);
      const syncStateKey = this.getSyncStateKey();
      const trackedHashes = await this.getTrackedContractHashes();

      if (cursor > chainHeight) {
        return;
      }

      const target = Math.min(chainHeight, cursor + this.config.INDEXER_BATCH_SIZE - 1);

      for (let index = cursor; index <= target; index += 1) {
        await this.indexBlock(index, trackedHashes);
        await this.db.setSyncState(syncStateKey, (index + 1).toString());
      }

      this.log.info({ cursor: target + 1, chainHeight }, "Indexed blocks");
    } catch (error) {
      this.log.error({ err: error }, "Indexer tick failed");
    } finally {
      this.isRunning = false;
    }
  }

  private async fetchChainBlockHeight(): Promise<number | null> {
    try {
      const height = (await this.rpc.getBlockCount()) - 1;
      this.lastKnownChainBlockHeight = height;
      return height;
    } catch (error) {
      this.log.warn({ err: error }, "Failed to fetch chain block height");
      return this.lastKnownChainBlockHeight;
    } finally {
      this.chainHeightFetchInFlight = null;
    }
  }

  private async getTrackedContractHashes(): Promise<Set<string>> {
    const tracked = new Set<string>([normalizeHash(this.config.NEO_CONTRACT_HASH)]);
    const discovered = await this.db.listCollectionContractHashes();
    discovered.forEach((hash) => {
      const normalized = normalizeHash(hash);
      if (normalized) {
        tracked.add(normalized);
      }
    });
    return tracked;
  }

  private async indexBlock(blockIndex: number, trackedHashes: Set<string>): Promise<void> {
    const block = (await this.rpc.getBlock(blockIndex, true)) as RawBlock;
    const txids = (block.tx ?? [])
      .map((tx) => (typeof tx === "string" ? tx : tx.hash ?? tx.txid ?? ""))
      .filter((value) => value.length > 0);

    for (const txid of txids) {
      await this.indexTransaction(blockIndex, txid, block.time, trackedHashes);
    }
  }

  private async indexTransaction(
    blockIndex: number,
    txid: string,
    blockTime: number | undefined,
    trackedHashes: Set<string>,
  ): Promise<void> {
    const appLog = (await this.rpc.getApplicationLog(txid)) as RawAppLog;
    const notifications = (appLog.executions ?? []).flatMap((execution) => execution.notifications ?? []);
    const matched = notifications.filter((notification) => trackedHashes.has(normalizeHash(notification.contract)));

    if (matched.length === 0) {
      return;
    }

    const nowIso = new Date().toISOString();
    const timestamp = unixTimestampToIso(blockTime, nowIso);

    for (const notification of matched) {
      const args = stackItemsFromNotification(notification);
      await this.handleNotification(
        notification.eventname,
        args,
        txid,
        blockIndex,
        timestamp,
        normalizeHash(notification.contract),
        trackedHashes,
      );
    }
  }

  private async handleNotification(
    eventName: string,
    args: unknown[],
    txid: string,
    blockIndex: number,
    timestamp: string,
    sourceContractHash: string,
    trackedHashes: Set<string>,
  ): Promise<void> {
    const platformHash = normalizeHash(this.config.NEO_CONTRACT_HASH);
    const sourceIsPlatform = sourceContractHash === platformHash;

    switch (eventName) {
      case "CollectionUpserted": {
        if (args.length < 12) {
          return;
        }

        const eventTime = unixTimestampToIso(args[11], timestamp);

        await this.db.upsertCollection({
          collectionId: valueAsString(args[0]),
          owner: formatNeoAddress(args[1]),
          name: valueAsString(args[2]),
          symbol: valueAsString(args[3]),
          description: valueAsString(args[4]),
          baseUri: valueAsString(args[5]),
          contractHash: sourceIsPlatform ? null : sourceContractHash,
          maxSupply: valueAsString(args[6]),
          minted: valueAsString(args[7]),
          royaltyBps: Number(args[8] ?? 0),
          transferable: valueAsBool(args[9]),
          paused: valueAsBool(args[10]),
          createdAt: eventTime,
          updatedAt: timestamp,
        });
        return;
      }

      case "TokenUpserted": {
        if (args.length < 7) {
          return;
        }

        const mintedAt = unixTimestampToIso(args[6], timestamp);

        await this.db.upsertToken({
          tokenId: valueAsString(args[0]),
          collectionId: valueAsString(args[1]),
          owner: formatNeoAddress(args[2]),
          uri: valueAsString(args[3]),
          propertiesJson: valueAsString(args[4]),
          burned: valueAsBool(args[5]),
          mintedAt,
          updatedAt: timestamp,
        });
        return;
      }

      case "Transfer": {
        if (args.length < 4) {
          return;
        }

        const fromAddress = formatNeoAddress(args[0]) || null;
        const toAddress = formatNeoAddress(args[1]) || null;
        const tokenId = valueAsString(args[3]);

        await this.db.applyTransfer({
          txid,
          tokenId,
          fromAddress,
          toAddress,
          blockIndex,
          timestamp,
        });
        return;
      }

      case "CollectionContractDeployed": {
        if (args.length < 3) {
          return;
        }

        const collectionId = valueAsString(args[0]);
        const deployedContractHash = await this.resolveContractHashFromEventValue(args[2]);
        if (!collectionId || !deployedContractHash) {
          return;
        }

        await this.db.setCollectionContractHash(collectionId, deployedContractHash, timestamp);
        trackedHashes.add(deployedContractHash);
        return;
      }

      case "TokenListingUpdated": {
        if (args.length < 5) {
          return;
        }

        const tokenId = valueAsString(args[0]);
        if (!tokenId) {
          return;
        }

        const listed = valueAsBool(args[3]);
        const listedAt = unixTimestampToIso(args[4], timestamp);

        await this.db.upsertTokenListing({
          tokenId,
          seller: formatNeoAddress(args[1]),
          price: listed ? valueAsString(args[2]) : "0",
          listed,
          listedAt,
          updatedAt: timestamp,
        });
        return;
      }

      case "TokenSaleMatched": {
        if (args.length < 5) {
          return;
        }

        const tokenId = valueAsString(args[0]);
        if (!tokenId) {
          return;
        }

        const listedAt = unixTimestampToIso(args[4], timestamp);

        await this.db.upsertTokenListing({
          tokenId,
          seller: formatNeoAddress(args[1]),
          price: "0",
          listed: 0,
          listedAt,
          updatedAt: timestamp,
        });
        return;
      }

      default:
        return;
    }
  }
}
