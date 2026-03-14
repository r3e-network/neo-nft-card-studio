import { getRuntimeNetworkConfig } from "./runtime-network";
import type { MarketListingDto } from "./types";

const PENDING_MARKET_STATE_KEY = "opennft_pending_market_state";
const PENDING_MARKET_TTL_MS = 2 * 60 * 1000;

interface PendingMarketStateRecord {
  tokenId: string;
  network: "mainnet" | "testnet" | "private" | "unknown";
  updatedAtMs: number;
  sale: {
    listed: boolean;
    seller: string;
    price: string;
    listedAt: string;
    updatedAt: string;
  };
  owner?: string;
}

function readPendingMarketState(): PendingMarketStateRecord[] {
  if (typeof window === "undefined") {
    return [];
  }

  const raw = localStorage.getItem(PENDING_MARKET_STATE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as PendingMarketStateRecord[] : [];
  } catch {
    return [];
  }
}

function writePendingMarketState(records: PendingMarketStateRecord[]): void {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.setItem(PENDING_MARKET_STATE_KEY, JSON.stringify(records));
}

function pruneExpired(records: PendingMarketStateRecord[]): PendingMarketStateRecord[] {
  const now = Date.now();
  return records.filter((entry) => now - entry.updatedAtMs <= PENDING_MARKET_TTL_MS);
}

export function setPendingMarketState(input: {
  tokenId: string;
  sale: PendingMarketStateRecord["sale"];
  owner?: string;
  network?: PendingMarketStateRecord["network"];
}): void {
  const network = input.network ?? getRuntimeNetworkConfig().network;
  const nextRecord: PendingMarketStateRecord = {
    tokenId: input.tokenId,
    network,
    updatedAtMs: Date.now(),
    sale: input.sale,
    owner: input.owner,
  };

  const next = pruneExpired(readPendingMarketState()).filter(
    (entry) => !(entry.network === nextRecord.network && entry.tokenId === nextRecord.tokenId),
  );
  next.unshift(nextRecord);
  writePendingMarketState(next.slice(0, 200));
}

export function mergePendingMarketState(
  listings: MarketListingDto[],
  network = getRuntimeNetworkConfig().network,
): MarketListingDto[] {
  const pending = pruneExpired(readPendingMarketState()).filter((entry) => entry.network === network);
  if (pending.length === 0) {
    return listings;
  }

  const byTokenId = new Map(pending.map((entry) => [entry.tokenId, entry] as const));
  return listings.map((listing) => {
    const override = byTokenId.get(listing.token.tokenId);
    if (!override) {
      return listing;
    }

    return {
      ...listing,
      token: {
        ...listing.token,
        owner: override.owner ?? listing.token.owner,
      },
      sale: {
        listed: override.sale.listed,
        seller: override.sale.seller,
        price: override.sale.price,
        listedAt: override.sale.listedAt,
        updatedAt: override.sale.updatedAt,
      },
    };
  });
}
