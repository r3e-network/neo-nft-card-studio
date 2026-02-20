import dotenv from "dotenv";
import path from "node:path";
import { z } from "zod";

dotenv.config();

export type ContractDialect = "csharp" | "solidity" | "rust";
export type ApiNetworkName = "mainnet" | "testnet" | "private";

const API_NETWORKS: ApiNetworkName[] = ["mainnet", "testnet", "private"];

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
      return false;
    }
  }
  return value;
}, z.boolean());

const emptyStringToUndefined = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const optionalStringFromEnv = z.preprocess(emptyStringToUndefined, z.string().optional());
const optionalUrlFromEnv = z.preprocess(emptyStringToUndefined, z.string().url().optional());
const optionalHashFromEnv = z.preprocess(emptyStringToUndefined, z.string().min(40).optional());
const optionalDialectFromEnv = z.preprocess(emptyStringToUndefined, z.enum(["csharp", "solidity", "rust"]).optional());

function normalizeOptional(input: string | undefined): string | undefined {
  const value = input?.trim();
  return value && value.length > 0 ? value : undefined;
}

function withNetworkSuffix(filePath: string, network: ApiNetworkName): string {
  const ext = path.extname(filePath);
  if (!ext) {
    return `${filePath}.${network}`;
  }

  const base = filePath.slice(0, -ext.length);
  return `${base}.${network}${ext}`;
}

const configSchema = z.object({
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().default(8080),
  API_CORS_ORIGIN: z.string().default("*"),
  NEO_DEFAULT_NETWORK: z.enum(["mainnet", "testnet", "private"]).default("testnet"),
  DB_FILE: z.string().default("apps/api/data/nft-platform.db"),
  DB_FILE_MAINNET: optionalStringFromEnv,
  DB_FILE_TESTNET: optionalStringFromEnv,
  DB_FILE_PRIVATE: optionalStringFromEnv,
  NEO_RPC_URL: z.string().url(),
  NEO_RPC_URL_MAINNET: optionalUrlFromEnv,
  NEO_RPC_URL_TESTNET: optionalUrlFromEnv,
  NEO_RPC_URL_PRIVATE: optionalUrlFromEnv,
  NEO_CONTRACT_HASH: z.string().min(40),
  NEO_CONTRACT_HASH_MAINNET: optionalHashFromEnv,
  NEO_CONTRACT_HASH_TESTNET: optionalHashFromEnv,
  NEO_CONTRACT_HASH_PRIVATE: optionalHashFromEnv,
  NEO_CONTRACT_DIALECT: z.enum(["csharp", "solidity", "rust"]).default("csharp"),
  NEO_CONTRACT_DIALECT_MAINNET: optionalDialectFromEnv,
  NEO_CONTRACT_DIALECT_TESTNET: optionalDialectFromEnv,
  NEO_CONTRACT_DIALECT_PRIVATE: optionalDialectFromEnv,
  NEOFS_ENABLED: booleanFromEnv.default(true),
  NEOFS_GATEWAY_BASE_URL: z.string().url().default("https://fs.neo.org"),
  NEOFS_OBJECT_URL_TEMPLATE: z
    .string()
    .default("https://fs.neo.org/{containerId}/{objectPath}"),
  NEOFS_CONTAINER_URL_TEMPLATE: z
    .string()
    .default("https://fs.neo.org/{containerId}"),
  NEOFS_METADATA_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  GHOSTMARKET_ENABLED: booleanFromEnv.default(true),
  GHOSTMARKET_BASE_URL: z.string().url().default("https://ghostmarket.io"),
  GHOSTMARKET_COLLECTION_URL_TEMPLATE: z
    .string()
    .default("https://ghostmarket.io/asset/neo/{contractHash}/{collectionId}"),
  GHOSTMARKET_TOKEN_URL_TEMPLATE: z
    .string()
    .default("https://ghostmarket.io/asset/neo/{contractHash}/{tokenId}"),
  INDEXER_POLL_MS: z.coerce.number().int().positive().default(5000),
  INDEXER_BATCH_SIZE: z.coerce.number().int().positive().default(30),
  INDEXER_START_BLOCK: z.coerce.number().int().nonnegative().default(0),
  INDEXER_ENABLE_EVENTS: booleanFromEnv.optional(),
});

type RawAppConfig = z.infer<typeof configSchema>;

export interface ApiNetworkConfig {
  network: ApiNetworkName;
  dbFile: string;
  rpcUrl: string;
  contractHash: string;
  contractDialect: ContractDialect;
}

export interface AppConfig extends RawAppConfig {
  NETWORKS: Partial<Record<ApiNetworkName, ApiNetworkConfig>>;
}

function getNetworkEnvValues(config: RawAppConfig, network: ApiNetworkName): {
  dbFile?: string;
  rpcUrl?: string;
  contractHash?: string;
  contractDialect?: ContractDialect;
} {
  switch (network) {
    case "mainnet":
      return {
        dbFile: normalizeOptional(config.DB_FILE_MAINNET),
        rpcUrl: normalizeOptional(config.NEO_RPC_URL_MAINNET),
        contractHash: normalizeOptional(config.NEO_CONTRACT_HASH_MAINNET),
        contractDialect: config.NEO_CONTRACT_DIALECT_MAINNET,
      };
    case "testnet":
      return {
        dbFile: normalizeOptional(config.DB_FILE_TESTNET),
        rpcUrl: normalizeOptional(config.NEO_RPC_URL_TESTNET),
        contractHash: normalizeOptional(config.NEO_CONTRACT_HASH_TESTNET),
        contractDialect: config.NEO_CONTRACT_DIALECT_TESTNET,
      };
    case "private":
      return {
        dbFile: normalizeOptional(config.DB_FILE_PRIVATE),
        rpcUrl: normalizeOptional(config.NEO_RPC_URL_PRIVATE),
        contractHash: normalizeOptional(config.NEO_CONTRACT_HASH_PRIVATE),
        contractDialect: config.NEO_CONTRACT_DIALECT_PRIVATE,
      };
    default:
      return {};
  }
}

function resolveNetworkConfig(config: RawAppConfig, network: ApiNetworkName): ApiNetworkConfig | null {
  const envValues = getNetworkEnvValues(config, network);
  const isDefault = network === config.NEO_DEFAULT_NETWORK;

  const rpcUrl = envValues.rpcUrl ?? (isDefault ? config.NEO_RPC_URL : undefined);
  const contractHash = envValues.contractHash ?? (isDefault ? config.NEO_CONTRACT_HASH : undefined);

  const hasAnyNetworkSpecificValue =
    !!envValues.dbFile ||
    !!envValues.rpcUrl ||
    !!envValues.contractHash ||
    !!envValues.contractDialect;

  if (!rpcUrl && !contractHash) {
    if (hasAnyNetworkSpecificValue) {
      throw new Error(
        `Incomplete network config for ${network}: both NEO_RPC_URL_${network.toUpperCase()} and NEO_CONTRACT_HASH_${network.toUpperCase()} are required`,
      );
    }
    return null;
  }

  if (!rpcUrl || !contractHash) {
    throw new Error(
      `Incomplete network config for ${network}: both NEO_RPC_URL_${network.toUpperCase()} and NEO_CONTRACT_HASH_${network.toUpperCase()} are required`,
    );
  }

  const dbFile = envValues.dbFile ?? (isDefault ? config.DB_FILE : withNetworkSuffix(config.DB_FILE, network));
  const contractDialect = envValues.contractDialect ?? config.NEO_CONTRACT_DIALECT;

  if (hasAnyNetworkSpecificValue && !isDefault && dbFile === config.DB_FILE) {
    throw new Error(`Network ${network} must not share DB_FILE with default network. Use DB_FILE_${network.toUpperCase()}.`);
  }

  return {
    network,
    dbFile,
    rpcUrl,
    contractHash,
    contractDialect,
  };
}

function resolveNetworks(config: RawAppConfig): Partial<Record<ApiNetworkName, ApiNetworkConfig>> {
  const networks: Partial<Record<ApiNetworkName, ApiNetworkConfig>> = {};
  for (const network of API_NETWORKS) {
    const resolved = resolveNetworkConfig(config, network);
    if (resolved) {
      networks[network] = resolved;
    }
  }

  const defaultResolved = networks[config.NEO_DEFAULT_NETWORK];
  if (!defaultResolved) {
    const configured = Object.keys(networks).join(", ") || "none";
    throw new Error(
      `NEO_DEFAULT_NETWORK=${config.NEO_DEFAULT_NETWORK} is not configured. Available networks: ${configured}`,
    );
  }

  return networks;
}

export function loadConfig(): AppConfig {
  const parsed = configSchema.parse(process.env);
  return {
    ...parsed,
    NETWORKS: resolveNetworks(parsed),
  };
}
