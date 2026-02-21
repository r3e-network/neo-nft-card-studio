import { NeoNftPlatformClient } from "@platform/neo-sdk";

import { getRuntimeNetworkConfig } from "./runtime-network";
import { getRuntimeContractDialect } from "./runtime-dialect";

const cachedClients = new Map<string, NeoNftPlatformClient>();
const UINT160_HASH_REGEX = /^(?:0[xX])?[0-9a-fA-F]{40}$/;

function normalizeContractHash(contractHash: string): string {
  const normalized = contractHash.trim();
  if (!normalized) {
    throw new Error("contract hash is empty");
  }

  if (!UINT160_HASH_REGEX.test(normalized)) {
    throw new Error("Invalid contract hash format. Expected 0x-prefixed 20-byte script hash.");
  }

  const noPrefix = normalized.replace(/^0x/i, "");
  return `0x${noPrefix.toLowerCase()}`;
}

export function getPlatformClient(): NeoNftPlatformClient {
  const runtime = getRuntimeNetworkConfig();

  if (!runtime.rpcUrl) {
    const envName = runtime.network === "private" ? "VITE_NEO_RPC_URL_PRIVATE" : "VITE_NEO_RPC_URL";
    throw new Error(`NFT platform RPC URL is not configured for wallet network '${runtime.network}'. Set ${envName}.`);
  }

  if (!runtime.contractHash) {
    const envName =
      runtime.network === "mainnet"
        ? "VITE_NEO_CONTRACT_HASH_MAINNET"
        : runtime.network === "private"
          ? "VITE_NEO_CONTRACT_HASH_PRIVATE"
          : "VITE_NEO_CONTRACT_HASH";
    throw new Error(
      `NFT platform contract hash is not configured for wallet network '${runtime.network}'. Set ${envName}.`,
    );
  }
  const envName =
    runtime.network === "mainnet"
      ? "VITE_NEO_CONTRACT_HASH_MAINNET"
      : runtime.network === "private"
        ? "VITE_NEO_CONTRACT_HASH_PRIVATE"
        : "VITE_NEO_CONTRACT_HASH";

  try {
    return getNftClientForHash(runtime.contractHash);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "contract hash is empty" || error.message.startsWith("Invalid contract hash format"))
    ) {
      throw new Error(
        `NFT platform contract hash is invalid for wallet network '${runtime.network}'. Check ${envName}.`,
      );
    }
    throw error;
  }
}

export function getNftClientForHash(contractHash: string): NeoNftPlatformClient {
  const normalized = normalizeContractHash(contractHash);

  const runtime = getRuntimeNetworkConfig();
  if (!runtime.rpcUrl) {
    const envName = runtime.network === "private" ? "VITE_NEO_RPC_URL_PRIVATE" : "VITE_NEO_RPC_URL";
    throw new Error(`NFT platform RPC URL is not configured for wallet network '${runtime.network}'. Set ${envName}.`);
  }

  const dialect = getRuntimeContractDialect();
  const cacheKey = `${dialect}|${runtime.rpcUrl}|${normalized.toLowerCase()}`;
  const cached = cachedClients.get(cacheKey);
  if (cached) {
    return cached;
  }

  const client = new NeoNftPlatformClient({
    rpcUrl: runtime.rpcUrl,
    contractHash: normalized,
    dialect,
  });
  cachedClients.set(cacheKey, client);
  return client;
}
