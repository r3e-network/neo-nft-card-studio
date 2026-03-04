export type ContractDialect = "csharp" | "solidity" | "rust";
export type WalletNetworkName = "mainnet" | "testnet" | "private" | "unknown";
const DEFAULT_TESTNET_RPC_URL = "https://n3seed1.ngd.network:20332";
const DEFAULT_TESTNET_CONTRACT_HASH = "0x81f129ab82e0f41bba5048872405db66cbddb968";

function normalizeDialect(input: string | undefined): ContractDialect {
  if (input === "solidity" || input === "rust") {
    return input;
  }
  return "csharp";
}

function normalizeOptionalValue(input: string | undefined): string | undefined {
  const value = input?.trim();
  return value ? value : undefined;
}

export const APP_CONFIG = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? "/api",
  rpcUrl: DEFAULT_TESTNET_RPC_URL,
  contractHash: DEFAULT_TESTNET_CONTRACT_HASH,
  contractDialect: normalizeDialect(import.meta.env.VITE_CONTRACT_DIALECT),
  networks: {
    mainnet: {
      apiBaseUrl: normalizeOptionalValue(import.meta.env.VITE_API_BASE_URL_MAINNET) ?? "/api",
      rpcUrl: normalizeOptionalValue(import.meta.env.VITE_NEO_RPC_URL_MAINNET) ?? "https://mainnet1.neo.coz.io:443",
      contractHash: normalizeOptionalValue(import.meta.env.VITE_NEO_CONTRACT_HASH_MAINNET),
    },
    testnet: {
      apiBaseUrl: normalizeOptionalValue(import.meta.env.VITE_API_BASE_URL_TESTNET) ?? "/api",
      rpcUrl: DEFAULT_TESTNET_RPC_URL,
      contractHash: DEFAULT_TESTNET_CONTRACT_HASH,
    },
    private: {
      apiBaseUrl: normalizeOptionalValue(import.meta.env.VITE_API_BASE_URL_PRIVATE) ?? "/api",
      rpcUrl: normalizeOptionalValue(import.meta.env.VITE_NEO_RPC_URL_PRIVATE),
      contractHash: normalizeOptionalValue(import.meta.env.VITE_NEO_CONTRACT_HASH_PRIVATE),
    },
    unknown: {
      apiBaseUrl: "/api",
      rpcUrl: DEFAULT_TESTNET_RPC_URL,
      contractHash: DEFAULT_TESTNET_CONTRACT_HASH,
    },
  } as Record<
    WalletNetworkName,
    {
      apiBaseUrl?: string;
      rpcUrl?: string;
      contractHash?: string;
    }
  >,
};
