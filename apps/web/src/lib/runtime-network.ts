import { APP_CONFIG, type WalletNetworkName } from "./config";
import type { NeoWalletNetwork } from "./neoline";

let walletNetwork: NeoWalletNetwork | null = null;

export interface RuntimeNetworkConfig {
  network: WalletNetworkName;
  magic: number | null;
  rpcUrl: string;
  apiBaseUrl: string;
  contractHash: string;
}

export function setRuntimeWalletNetwork(network: NeoWalletNetwork | null): void {
  walletNetwork = network;
}

export function getRuntimeWalletNetwork(): NeoWalletNetwork | null {
  return walletNetwork;
}

export function getRuntimeNetworkConfig(): RuntimeNetworkConfig {
  const walletBound = walletNetwork !== null;
  const network = walletNetwork?.network ?? "unknown";
  const profile = APP_CONFIG.networks[network] ?? APP_CONFIG.networks.unknown;
  const unknownWalletNetwork = walletBound && network === "unknown";

  let rpcUrl = "";
  if (!unknownWalletNetwork) {
    rpcUrl = walletNetwork?.rpcUrl || profile.rpcUrl || "";
  }
  if (!rpcUrl && (network === "testnet" || (!walletBound && network === "unknown"))) {
    rpcUrl = APP_CONFIG.rpcUrl;
  }
  const apiBaseUrl = profile.apiBaseUrl || APP_CONFIG.apiBaseUrl;

  let contractHash = "";
  if (!unknownWalletNetwork) {
    if (network === "mainnet") {
      contractHash = profile.contractHash ?? "";
    } else if (network === "private") {
      contractHash = profile.contractHash ?? "";
    } else if (network === "testnet") {
      contractHash = profile.contractHash || APP_CONFIG.contractHash;
    } else {
      contractHash = APP_CONFIG.contractHash;
    }
  }

  return {
    network,
    magic: walletNetwork?.magic ?? null,
    rpcUrl,
    apiBaseUrl,
    contractHash,
  };
}
