import { getRuntimeNetworkConfig } from "./runtime-network";
import type { TokenDto } from "./types";

const PENDING_TOKENS_KEY = "opennft_pending_tokens";
const PENDING_TOKENS_TTL_MS = 10 * 60 * 1000;

interface PendingTokenRecord extends TokenDto {
  network: "mainnet" | "testnet" | "private" | "unknown";
  txid: string;
  updatedAtMs: number;
}

function readPendingTokens(): PendingTokenRecord[] {
  if (typeof window === "undefined") {
    return [];
  }

  const raw = localStorage.getItem(PENDING_TOKENS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as PendingTokenRecord[] : [];
  } catch {
    return [];
  }
}

function writePendingTokens(records: PendingTokenRecord[]): void {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.setItem(PENDING_TOKENS_KEY, JSON.stringify(records));
}

function pruneExpired(records: PendingTokenRecord[]): PendingTokenRecord[] {
  const now = Date.now();
  return records.filter((entry) => now - entry.updatedAtMs <= PENDING_TOKENS_TTL_MS);
}

function buildPendingToken(input: {
  txid: string;
  collectionId: string;
  owner: string;
  uri: string;
  propertiesJson: string;
  network: PendingTokenRecord["network"];
}): PendingTokenRecord {
  const nowIso = new Date().toISOString();
  return {
    tokenId: `pending:${input.txid}`,
    collectionId: input.collectionId,
    owner: input.owner,
    uri: input.uri,
    propertiesJson: input.propertiesJson,
    burned: 0,
    mintedAt: nowIso,
    updatedAt: nowIso,
    network: input.network,
    txid: input.txid,
    updatedAtMs: Date.now(),
  };
}

export function setPendingToken(input: {
  txid: string;
  collectionId: string;
  owner: string;
  uri: string;
  propertiesJson: string;
  network?: PendingTokenRecord["network"];
}): void {
  const network = input.network ?? getRuntimeNetworkConfig().network;
  const nextRecord = buildPendingToken({
    ...input,
    network,
  });

  const next = pruneExpired(readPendingTokens()).filter(
    (entry) => !(entry.network === nextRecord.network && entry.txid === nextRecord.txid),
  );
  next.unshift(nextRecord);
  writePendingTokens(next.slice(0, 200));
}

function matchesResolvedToken(left: TokenDto, right: TokenDto): boolean {
  if (left.tokenId === right.tokenId) {
    return true;
  }

  return (
    left.collectionId === right.collectionId
    && left.owner === right.owner
    && left.uri === right.uri
    && left.propertiesJson === right.propertiesJson
  );
}

export function mergePendingTokens(
  tokens: TokenDto[],
  options?: {
    owner?: string;
    collectionId?: string;
    network?: "mainnet" | "testnet" | "private" | "unknown";
  },
): TokenDto[] {
  const network = options?.network ?? getRuntimeNetworkConfig().network;
  const owner = options?.owner?.trim() ?? "";
  const collectionId = options?.collectionId?.trim() ?? "";

  const pending = pruneExpired(readPendingTokens()).filter((entry) => {
    if (entry.network !== network) {
      return false;
    }
    if (owner && entry.owner !== owner) {
      return false;
    }
    if (collectionId && entry.collectionId !== collectionId) {
      return false;
    }
    return true;
  });

  if (pending.length === 0) {
    return tokens;
  }

  const unresolved = pending.filter(
    (entry) => !tokens.some((token) => matchesResolvedToken(token, entry)),
  );
  if (unresolved.length === 0) {
    return tokens;
  }

  const sortedUnresolved = [...unresolved].sort((left, right) => right.updatedAtMs - left.updatedAtMs);
  return [...sortedUnresolved, ...tokens];
}
