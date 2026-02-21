import { wallet } from "@cityofzion/neon-js";
import pino from "pino";

import { decodeStackItem, NeoRpcService } from "@platform/neo-sdk";

import type { AppConfig } from "../config";
import { AppDb } from "../db";

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

const SYNC_BLOCK_KEY = "last_synced_block";

function normalizeHash(hash: string): string {
  if (!hash || hash.length === 0) {
    return "";
  }
  const cleaned = hash.startsWith("0x") ? hash : `0x${hash}`;
  return cleaned.toLowerCase();
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

  try {
    return wallet.getAddressFromScriptHash(value);
  } catch {
    return value;
  }
}

function valueAsBool(input: unknown): number {
  return input === true || input === "true" || input === "1" ? 1 : 0;
}

function valueAsString(input: unknown): string {
  return input?.toString() ?? "";
}

export class IndexerService {
  private readonly log = pino({ name: "indexer" });
  private readonly rpc: NeoRpcService;
  private interval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly eventsEnabled: boolean;

  constructor(
    private readonly config: AppConfig,
    private readonly db: AppDb,
  ) {
    this.rpc = new NeoRpcService({
      rpcUrl: config.NEO_RPC_URL,
      contractHash: config.NEO_CONTRACT_HASH,
    });
    this.eventsEnabled = config.INDEXER_ENABLE_EVENTS ?? config.NEO_CONTRACT_DIALECT !== "rust";
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
    try {
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
    } catch (error) {
      this.log.warn({ err: error }, "Failed to read contract manifest via RPC");
      return null;
    }
  }

  getCurrentSyncBlock(): number {
    const saved = this.db.getSyncState(SYNC_BLOCK_KEY);
    if (saved === null) {
      return this.config.INDEXER_START_BLOCK;
    }
    return Number(saved);
  }

  async getChainBlockHeight(): Promise<number | null> {
    try {
      return (await this.rpc.getBlockCount()) - 1;
    } catch (error) {
      this.log.warn({ err: error }, "Failed to fetch chain block height");
      return null;
    }
  }

  private async tick(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    try {
      const chainHeight = (await this.rpc.getBlockCount()) - 1;
      let cursor = this.getCurrentSyncBlock();
      const trackedHashes = this.getTrackedContractHashes();

      if (cursor < this.config.INDEXER_START_BLOCK) {
        cursor = this.config.INDEXER_START_BLOCK;
      }

      if (cursor > chainHeight) {
        return;
      }

      const target = Math.min(chainHeight, cursor + this.config.INDEXER_BATCH_SIZE - 1);

      for (let index = cursor; index <= target; index += 1) {
        await this.indexBlock(index, trackedHashes);
        this.db.setSyncState(SYNC_BLOCK_KEY, (index + 1).toString());
      }

      this.log.info({ cursor: target + 1, chainHeight }, "Indexed blocks");
    } catch (error) {
      this.log.error({ err: error }, "Indexer tick failed");
    } finally {
      this.isRunning = false;
    }
  }

  private getTrackedContractHashes(): Set<string> {
    const tracked = new Set<string>([normalizeHash(this.config.NEO_CONTRACT_HASH)]);
    const discovered = this.db.listCollectionContractHashes();
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

    const timestamp = blockTime ? new Date(blockTime * 1000).toISOString() : new Date().toISOString();

    for (const notification of matched) {
      const args = stackItemsFromNotification(notification);
      this.handleNotification(
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

  private handleNotification(
    eventName: string,
    args: unknown[],
    txid: string,
    blockIndex: number,
    timestamp: string,
    sourceContractHash: string,
    trackedHashes: Set<string>,
  ): void {
    const platformHash = normalizeHash(this.config.NEO_CONTRACT_HASH);
    const sourceIsPlatform = sourceContractHash === platformHash;

    switch (eventName) {
      case "CollectionUpserted": {
        if (args.length < 12) {
          return;
        }

        this.db.upsertCollection({
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
          createdAt: new Date(Number(args[11] ?? 0) * 1000).toISOString(),
          updatedAt: timestamp,
        });
        return;
      }

      case "TokenUpserted": {
        if (args.length < 7) {
          return;
        }

        this.db.upsertToken({
          tokenId: valueAsString(args[0]),
          collectionId: valueAsString(args[1]),
          owner: formatNeoAddress(args[2]),
          uri: valueAsString(args[3]),
          propertiesJson: valueAsString(args[4]),
          burned: valueAsBool(args[5]),
          mintedAt: new Date(Number(args[6] ?? 0) * 1000).toISOString(),
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

        if (toAddress) {
          this.db.markTokenOwner(tokenId, toAddress, timestamp);
        }

        this.db.insertTransfer({
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
        const deployedContractHash = normalizeHash(valueAsString(args[2]));
        if (!collectionId || !deployedContractHash) {
          return;
        }

        this.db.setCollectionContractHash(collectionId, deployedContractHash, timestamp);
        trackedHashes.add(deployedContractHash);
        return;
      }

      default:
        return;
    }
  }
}
