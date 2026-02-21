export interface CollectionDto {
  collectionId: string;
  owner: string;
  name: string;
  symbol: string;
  description: string;
  baseUri: string;
  contractHash?: string | null;
  maxSupply: string;
  minted: string;
  royaltyBps: number;
  transferable: number;
  paused: number;
  createdAt: string;
  updatedAt: string;
}

export interface TokenDto {
  tokenId: string;
  collectionId: string;
  owner: string;
  uri: string;
  propertiesJson: string;
  burned: number;
  mintedAt: string;
  updatedAt: string;
}

export interface TransferDto {
  txid: string;
  tokenId: string;
  fromAddress: string | null;
  toAddress: string | null;
  blockIndex: number;
  timestamp: string;
}

export interface StatsDto {
  collectionCount: number;
  tokenCount: number;
  transferCount: number;
}

export interface HealthDto {
  status: string;
  network?: "mainnet" | "testnet" | "private";
  defaultNetwork?: "mainnet" | "testnet" | "private";
  availableNetworks?: Array<"mainnet" | "testnet" | "private">;
  contract: {
    hash: string;
    dialect: "csharp" | "solidity" | "rust";
  };
  endpoint: {
    rpcUrl: string;
    chainBlockHeight: number | null;
    reachable: boolean;
  };
  stats: StatsDto;
  timestamp: string;
}

export interface ContractMetaDto {
  network?: "mainnet" | "testnet" | "private";
  defaultNetwork?: "mainnet" | "testnet" | "private";
  availableNetworks?: Array<"mainnet" | "testnet" | "private">;
  hash: string;
  dialect: "csharp" | "solidity" | "rust";
  eventIndexingEnabled: boolean;
  rpcUrl: string;
  ghostMarketEnabled?: boolean;
}

export interface GhostMarketMethodSummaryDto {
  name: string;
  parameterTypes: string[];
  returnType: string;
}

export interface NeoFsMetaDto {
  network?: "mainnet" | "testnet" | "private";
  defaultNetwork?: "mainnet" | "testnet" | "private";
  availableNetworks?: Array<"mainnet" | "testnet" | "private">;
  enabled: boolean;
  gatewayBaseUrl: string;
  objectUrlTemplate: string;
  containerUrlTemplate: string;
  metadataTimeoutMs: number;
  checkedAt: string;
}

export interface NeoFsResolveDto {
  network?: "mainnet" | "testnet" | "private";
  enabled: boolean;
  originalUri: string;
  resolvedUri: string;
  isNeoFs: boolean;
  containerId?: string;
  objectPath?: string;
  objectId?: string;
  isContainerOnly?: boolean;
  checkedAt: string;
}

export interface NeoFsMetadataDto {
  network?: "mainnet" | "testnet" | "private";
  uri: string;
  resolvedUri: string;
  containerId: string;
  objectId: string;
  contentType: string;
  metadata: unknown;
  fetchedAt: string;
}

export interface GhostMarketMetaDto {
  network?: "mainnet" | "testnet" | "private";
  defaultNetwork?: "mainnet" | "testnet" | "private";
  availableNetworks?: Array<"mainnet" | "testnet" | "private">;
  enabled: boolean;
  baseUrl: string;
  contractHash: string;
  platformContractHash?: string;
  isPlatformContract?: boolean;
  collectionUrlTemplate: string;
  tokenUrlTemplate: string;
  contractSearchUrl: string;
  compatibility: {
    compatible: boolean;
    reasons: string[];
    warnings: string[];
    reasonIssues?: Array<{
      code: string;
      message: string;
      params?: Record<string, string>;
    }>;
    warningIssues?: Array<{
      code: string;
      message: string;
      params?: Record<string, string>;
    }>;
    checkedAt: string;
  };
  manifest: {
    supportedStandards: string[];
    methods: GhostMarketMethodSummaryDto[];
  } | null;
}
