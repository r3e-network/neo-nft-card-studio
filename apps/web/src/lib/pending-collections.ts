import { NeoRpcService, decodeStackItem } from "@platform/neo-sdk";

import { getRuntimeNetworkConfig } from "./runtime-network";
import type { CollectionDto } from "./types";

const PENDING_COLLECTIONS_KEY = "opennft_pending_collections";
const PENDING_COLLECTIONS_TTL_MS = 10 * 60 * 1000;

interface PendingCollectionRecord extends CollectionDto {
  network: "mainnet" | "testnet" | "private" | "unknown";
  txid: string;
  updatedAtMs?: number;
}

interface RawNotification {
  eventname?: string;
  state?: {
    value?: unknown[];
  };
}

interface RawExecution {
  notifications?: RawNotification[];
}

interface RawApplicationLog {
  executions?: RawExecution[];
}

function readPendingCollectionRecords(): PendingCollectionRecord[] {
  if (typeof window === "undefined") {
    return [];
  }

  const raw = localStorage.getItem(PENDING_COLLECTIONS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as PendingCollectionRecord[] : [];
  } catch {
    return [];
  }
}

function writePendingCollectionRecords(records: PendingCollectionRecord[]): void {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.setItem(PENDING_COLLECTIONS_KEY, JSON.stringify(records));
}

function getRecordUpdatedAtMs(record: PendingCollectionRecord): number {
  if (typeof record.updatedAtMs === "number" && Number.isFinite(record.updatedAtMs)) {
    return record.updatedAtMs;
  }

  const parsedUpdatedAt = Date.parse(record.updatedAt);
  if (Number.isFinite(parsedUpdatedAt)) {
    return parsedUpdatedAt;
  }

  const parsedCreatedAt = Date.parse(record.createdAt);
  if (Number.isFinite(parsedCreatedAt)) {
    return parsedCreatedAt;
  }

  return 0;
}

function pruneExpired(records: PendingCollectionRecord[]): PendingCollectionRecord[] {
  const now = Date.now();
  return records.filter((record) => now - getRecordUpdatedAtMs(record) <= PENDING_COLLECTIONS_TTL_MS);
}

function getPrunedPendingCollectionRecords(): PendingCollectionRecord[] {
  const rawRecords = readPendingCollectionRecords();
  const prunedRecords = pruneExpired(rawRecords);
  if (prunedRecords.length !== rawRecords.length) {
    writePendingCollectionRecords(prunedRecords);
  }
  return prunedRecords;
}

function upsertPendingCollectionRecord(record: PendingCollectionRecord): void {
  const next = getPrunedPendingCollectionRecords().filter(
    (entry) => !(entry.network === record.network && entry.collectionId === record.collectionId),
  );
  next.unshift({
    ...record,
    updatedAtMs: Date.now(),
  });
  writePendingCollectionRecords(next.slice(0, 50));
}

export function clearPendingCollectionById(
  collectionId: string,
  options?: { network?: "mainnet" | "testnet" | "private" | "unknown" },
): void {
  if (typeof window === "undefined") {
    return;
  }

  const network = options?.network ?? getRuntimeNetworkConfig().network;
  const normalizedCollectionId = collectionId.trim();
  if (!normalizedCollectionId) {
    return;
  }

  const next = getPrunedPendingCollectionRecords().filter(
    (entry) => !(entry.network === network && entry.collectionId === normalizedCollectionId),
  );
  writePendingCollectionRecords(next);
}

function normalizeHashCandidate(input: string): string {
  return input.startsWith("0x") ? input.toLowerCase() : `0x${input.toLowerCase()}`;
}

function reverseHex(hex: string): string {
  return hex.match(/.{1,2}/g)?.reverse().join("") ?? hex;
}

async function resolveContractHashFromNotificationValue(rpc: NeoRpcService, value: unknown): Promise<string | null> {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const normalized = normalizeHashCandidate(value.trim());
  const hex = normalized.slice(2);
  const candidates = [normalized];
  if (hex.length === 40) {
    candidates.push(`0x${reverseHex(hex)}`);
  }

  for (const candidate of candidates) {
    try {
      await rpc.getContractState(candidate);
      return candidate;
    } catch {
      // try next candidate
    }
  }

  return null;
}

function toBooleanFlag(value: unknown): number {
  return value === true ? 1 : 0;
}

export function mergePendingCollections(
  collections: CollectionDto[],
  options?: { owner?: string; network?: "mainnet" | "testnet" | "private" | "unknown" },
): CollectionDto[] {
  const network = options?.network ?? getRuntimeNetworkConfig().network;
  const owner = options?.owner?.trim() ?? "";
  const pending = getPrunedPendingCollectionRecords().filter((entry) => {
    if (entry.network !== network) {
      return false;
    }
    if (owner && entry.owner !== owner) {
      return false;
    }
    return true;
  });

  if (pending.length === 0) {
    return collections;
  }

  const realIds = new Set(collections.map((entry) => entry.collectionId));
  const unresolvedPending = pending.filter((entry) => !realIds.has(entry.collectionId));
  if (unresolvedPending.length === 0) {
    return collections;
  }

  return [...unresolvedPending, ...collections];
}

export function getPendingCollectionById(
  collectionId: string,
  options?: { network?: "mainnet" | "testnet" | "private" | "unknown" },
): CollectionDto | null {
  const network = options?.network ?? getRuntimeNetworkConfig().network;
  const normalizedCollectionId = collectionId.trim();
  if (!normalizedCollectionId) {
    return null;
  }

  return (
    getPrunedPendingCollectionRecords().find(
      (entry) => entry.network === network && entry.collectionId === normalizedCollectionId,
    ) ?? null
  );
}

export async function cachePendingCollectionFromTx(input: {
  txid: string;
  owner: string;
  fallback: {
    name: string;
    symbol: string;
    description: string;
    baseUri: string;
    maxSupply: string;
    royaltyBps: number;
    transferable: boolean;
  };
}): Promise<CollectionDto | null> {
  const runtime = getRuntimeNetworkConfig();
  if (!runtime.rpcUrl || !runtime.contractHash || runtime.network === "unknown") {
    return null;
  }

  const rpc = new NeoRpcService({
    rpcUrl: runtime.rpcUrl,
    contractHash: runtime.contractHash,
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < 45000) {
    try {
      const appLog = await rpc.getApplicationLog(input.txid) as RawApplicationLog;
      const execution = Array.isArray(appLog.executions) ? appLog.executions[0] : null;
      const notifications = Array.isArray(execution?.notifications) ? execution.notifications : [];

      const collectionNotification = notifications.find((entry) => entry.eventname === "CollectionUpserted");
      if (!collectionNotification?.state?.value || !Array.isArray(collectionNotification.state.value)) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        continue;
      }

      const decodedArgs = collectionNotification.state.value.map((value) => decodeStackItem(value as never));
      const collectionId = typeof decodedArgs[0] === "string" ? decodedArgs[0] : "";
      if (!collectionId) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        continue;
      }

      const deployedNotification = notifications.find((entry) => entry.eventname === "CollectionContractDeployed");
      const contractHash = deployedNotification?.state?.value?.[2]
        ? await resolveContractHashFromNotificationValue(rpc, decodeStackItem(deployedNotification.state.value[2] as never))
        : null;

      const collection: PendingCollectionRecord = {
        collectionId,
        owner: input.owner,
        name: typeof decodedArgs[2] === "string" ? decodedArgs[2] : input.fallback.name,
        symbol: typeof decodedArgs[3] === "string" ? decodedArgs[3] : input.fallback.symbol,
        description: typeof decodedArgs[4] === "string" ? decodedArgs[4] : input.fallback.description,
        baseUri: typeof decodedArgs[5] === "string" ? decodedArgs[5] : input.fallback.baseUri,
        contractHash,
        maxSupply: typeof decodedArgs[6] === "string" ? decodedArgs[6] : input.fallback.maxSupply,
        minted: typeof decodedArgs[7] === "string" ? decodedArgs[7] : "0",
        royaltyBps: typeof decodedArgs[8] === "string" ? Number(decodedArgs[8]) : input.fallback.royaltyBps,
        transferable: toBooleanFlag(decodedArgs[9]),
        paused: toBooleanFlag(decodedArgs[10]),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        network: runtime.network,
        txid: input.txid,
        updatedAtMs: Date.now(),
      };

      upsertPendingCollectionRecord(collection);
      return collection;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  return null;
}
