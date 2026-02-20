import { NeoNftPlatformClient } from "@platform/neo-sdk";

import { getRuntimeNetworkConfig } from "./runtime-network";
import { getRuntimeContractDialect } from "./runtime-dialect";

const cachedClients = new Map<string, NeoNftPlatformClient>();

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

  return getNftClientForHash(runtime.contractHash);
}

export function getNftClientForHash(contractHash: string): NeoNftPlatformClient {
  const normalized = contractHash.trim();
  if (!normalized) {
    throw new Error("contract hash is empty");
  }

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
