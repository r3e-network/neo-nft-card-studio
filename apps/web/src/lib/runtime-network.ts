import { useSyncExternalStore } from "react";

import { APP_CONFIG, type WalletNetworkName } from "./config";
import type { NeoWalletNetwork } from "./neoline";

export type FrontendNetworkName = Exclude<WalletNetworkName, "unknown">;
const FRONTEND_NETWORK_STORAGE_KEY = "opennft_frontend_network";
const runtimeNetworkListeners = new Set<() => void>();
let walletNetwork: NeoWalletNetwork | null = null;
let selectedFrontendNetwork: FrontendNetworkName = readStoredFrontendNetwork();
let runtimeNetworkSnapshot: RuntimeNetworkState | null = null;

export interface RuntimeNetworkConfig {
  network: WalletNetworkName;
  magic: number | null;
  rpcUrl: string;
  apiBaseUrl: string;
  contractHash: string;
}

export interface RuntimeNetworkState {
  selectedNetwork: FrontendNetworkName;
  effectiveNetwork: WalletNetworkName;
  walletNetwork: NeoWalletNetwork | null;
  walletMatchesSelection: boolean | null;
  runtimeKey: string;
}

function emitRuntimeNetworkChange(): void {
  runtimeNetworkListeners.forEach((listener) => listener());
}

function subscribeRuntimeNetwork(listener: () => void): () => void {
  runtimeNetworkListeners.add(listener);
  return () => {
    runtimeNetworkListeners.delete(listener);
  };
}

function normalizeFrontendNetwork(
  input: string | null | undefined,
): FrontendNetworkName {
  const normalized = input?.trim().toLowerCase();
  if (normalized === "mainnet" || normalized === "private") {
    return normalized;
  }
  return "testnet";
}

function readStoredFrontendNetwork(): FrontendNetworkName {
  if (typeof window === "undefined") {
    return "testnet";
  }
  return normalizeFrontendNetwork(window.localStorage.getItem(FRONTEND_NETWORK_STORAGE_KEY));
}

function getEffectiveRuntimeNetworkName(): WalletNetworkName {
  if (walletNetwork) {
    return walletNetwork.network;
  }
  return selectedFrontendNetwork;
}

export function setRuntimeWalletNetwork(network: NeoWalletNetwork | null): void {
  walletNetwork = network;
  emitRuntimeNetworkChange();
}

export function getRuntimeWalletNetwork(): NeoWalletNetwork | null {
  return walletNetwork;
}

export function getRuntimeSelectedFrontendNetwork(): FrontendNetworkName {
  return selectedFrontendNetwork;
}

export function setRuntimeSelectedFrontendNetwork(network: FrontendNetworkName): void {
  const next = normalizeFrontendNetwork(network);
  if (selectedFrontendNetwork === next) {
    return;
  }

  selectedFrontendNetwork = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(FRONTEND_NETWORK_STORAGE_KEY, next);
  }
  emitRuntimeNetworkChange();
}

export function getRuntimeNetworkStateSnapshot(): RuntimeNetworkState {
  const effectiveNetwork = getEffectiveRuntimeNetworkName();
  const runtimeKey = walletNetwork
    ? `wallet|${walletNetwork.network}|${walletNetwork.magic ?? "no-magic"}`
    : `selected|${selectedFrontendNetwork}`;
  const nextSnapshot: RuntimeNetworkState = {
    selectedNetwork: selectedFrontendNetwork,
    effectiveNetwork,
    walletNetwork,
    walletMatchesSelection: walletNetwork ? walletNetwork.network === selectedFrontendNetwork : null,
    runtimeKey,
  };

  if (
    runtimeNetworkSnapshot &&
    runtimeNetworkSnapshot.selectedNetwork === nextSnapshot.selectedNetwork &&
    runtimeNetworkSnapshot.effectiveNetwork === nextSnapshot.effectiveNetwork &&
    runtimeNetworkSnapshot.walletNetwork === nextSnapshot.walletNetwork &&
    runtimeNetworkSnapshot.walletMatchesSelection === nextSnapshot.walletMatchesSelection &&
    runtimeNetworkSnapshot.runtimeKey === nextSnapshot.runtimeKey
  ) {
    return runtimeNetworkSnapshot;
  }

  runtimeNetworkSnapshot = nextSnapshot;
  return nextSnapshot;
}

export function useRuntimeNetworkState(): RuntimeNetworkState {
  return useSyncExternalStore(
    subscribeRuntimeNetwork,
    getRuntimeNetworkStateSnapshot,
    getRuntimeNetworkStateSnapshot,
  );
}

function shouldAvoidInsecureHttpRpc(): boolean {
  return typeof window !== "undefined" && window.location.protocol === "https:";
}

function normalizeRpcUrl(url: string | undefined): string {
  return (url ?? "").trim();
}

function chooseRuntimeRpcUrl(profileRpcUrl: string | undefined): string {
  const walletRpcUrl = normalizeRpcUrl(walletNetwork?.rpcUrl);
  const fallbackRpcUrl = normalizeRpcUrl(profileRpcUrl) || normalizeRpcUrl(APP_CONFIG.rpcUrl);

  if (!walletRpcUrl) {
    return fallbackRpcUrl;
  }

  if (shouldAvoidInsecureHttpRpc() && walletRpcUrl.toLowerCase().startsWith("http://")) {
    return fallbackRpcUrl;
  }

  return walletRpcUrl;
}

export function getRuntimeNetworkConfig(): RuntimeNetworkConfig {
  const walletBound = walletNetwork !== null;
  const network = getEffectiveRuntimeNetworkName();
  const profile = APP_CONFIG.networks[network] ?? APP_CONFIG.networks.unknown;
  const unknownWalletNetwork = walletBound && network === "unknown";

  let rpcUrl = "";
  if (!unknownWalletNetwork) {
    rpcUrl = chooseRuntimeRpcUrl(profile.rpcUrl);
  }
  const apiBaseUrl = profile.apiBaseUrl || APP_CONFIG.apiBaseUrl;

  let contractHash = "";
  if (!unknownWalletNetwork) {
    // When wallet is bound to a specific network (e.g. mainnet), only use that
    // network's explicit contract hash. Do not silently fallback to the global
    // testnet hash, otherwise API calls can be routed to unsupported networks.
    contractHash = walletBound ? profile.contractHash || "" : profile.contractHash || "";
  }

  return {
    network,
    magic: walletNetwork?.magic ?? null,
    rpcUrl,
    apiBaseUrl,
    contractHash,
  };
}
