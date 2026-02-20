import type { WalletInvokeRequest } from "@platform/neo-sdk";

declare global {
  interface Window {
    NEOLineN3?: unknown;
    neoLineN3?: unknown;
    o3dapi?: {
      n3: {
        dapp: unknown;
      }
    };
    OneGateProvider?: unknown;
  }
}

export interface NeoLineAccount {
  address: string;
  label?: string;
}

export type NeoWalletNetworkName = "mainnet" | "testnet" | "private" | "unknown";

export interface NeoWalletNetwork {
  network: NeoWalletNetworkName;
  magic: number | null;
  rpcUrl?: string;
  raw?: unknown;
}

export interface NeoLineInvokeResult {
  txid?: string;
  transaction?: string;
  txId?: string;
  transactionId?: string;
  [key: string]: unknown;
}

export interface NeoLineN3Provider {
  getAccount?: () => Promise<unknown>;
  getAccounts?: () => Promise<unknown>;
  getNetwork?: () => Promise<unknown>;
  getNetworks?: () => Promise<unknown>;
  enable?: () => Promise<unknown>;
  request?: ((payload: { method: string; params?: unknown }) => Promise<unknown>) | ((method: string, params?: unknown) => Promise<unknown>);
  invoke?: (payload: WalletInvokeRequest) => Promise<unknown>;
  invokeFunction?: (payload: WalletInvokeRequest) => Promise<unknown>;
}

const NEO_MAINNET_MAGIC = 860833102;
const NEO_TESTNET_MAGIC = 894710606;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function hasProviderMethod(value: unknown): value is NeoLineN3Provider {
  const record = asRecord(value);
  if (!record) {
    return false;
  }

  const methodKeys = [
    "getAccount",
    "getAccounts",
    "getNetwork",
    "getNetworks",
    "request",
    "invoke",
    "invokeFunction",
    "enable",
  ];
  return methodKeys.some((key) => typeof record[key] === "function");
}

function resolveFactoryProvider(value: unknown): unknown {
  if (typeof value !== "function") {
    return null;
  }

  try {
    // NeoLine desktop extension commonly exposes window.NEOLineN3.Init constructor
    return new (value as new () => unknown)();
  } catch {
    // Some providers expose Init() as a plain function
    try {
      return (value as () => unknown)();
    } catch {
      return null;
    }
  }
}

function resolveNestedProvider(value: unknown, depth = 0): NeoLineN3Provider | null {
  if (depth > 3 || !value) {
    return null;
  }

  if (hasProviderMethod(value)) {
    return value;
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const initProvider = resolveFactoryProvider(record.Init ?? record.init);
  if (initProvider) {
    const resolved = resolveNestedProvider(initProvider, depth + 1);
    if (resolved) {
      return resolved;
    }
  }

  const nestedKeys = ["provider", "dapp", "n3", "N3", "wallet", "client", "default"];
  for (const key of nestedKeys) {
    const resolved = resolveNestedProvider(record[key], depth + 1);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

let cachedProvider: NeoLineN3Provider | null = null;

export function getNeoProvider(): NeoLineN3Provider | null {
  if (cachedProvider) {
    return cachedProvider;
  }

  const candidates: unknown[] = [
    window.NEOLineN3,
    window.neoLineN3,
    window.o3dapi?.n3?.dapp,
    window.OneGateProvider,
  ];

  for (const candidate of candidates) {
    const resolved = resolveNestedProvider(candidate);
    if (resolved) {
      cachedProvider = resolved;
      return resolved;
    }
  }

  return null;
}

function extractAddress(value: unknown): string {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractAddress(item);
      if (found) {
        return found;
      }
    }
    return "";
  }

  const record = asRecord(value);
  if (!record) {
    return "";
  }

  const direct = record.address;
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct.trim();
  }

  const altAddressKeys = ["accAddress", "walletAddress", "from", "accountAddress"];
  for (const key of altAddressKeys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  const nestedKeys = ["account", "result", "data", "wallet"];
  for (const key of nestedKeys) {
    const found = extractAddress(record[key]);
    if (found) {
      return found;
    }
  }

  return "";
}

function extractLabel(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const label = record.label;
  return typeof label === "string" && label.trim().length > 0 ? label.trim() : undefined;
}

function normalizeAccount(value: unknown): NeoLineAccount | null {
  const address = extractAddress(value);
  if (!address) {
    return null;
  }
  return {
    address,
    label: extractLabel(value),
  };
}

function normalizeInvokeResult(value: unknown): NeoLineInvokeResult {
  if (typeof value === "string") {
    return { txid: value };
  }

  const record = asRecord(value);
  if (!record) {
    return {};
  }

  const txid =
    typeof record.txid === "string"
      ? record.txid
      : typeof record.txId === "string"
        ? record.txId
        : typeof record.transaction === "string"
          ? record.transaction
          : typeof record.transactionId === "string"
            ? record.transactionId
            : undefined;

  if (!txid) {
    const nestedTx = extractAddress(record.result);
    if (nestedTx) {
      return { ...record, txid: nestedTx };
    }
  }

  return {
    ...record,
    ...(txid ? { txid } : {}),
  };
}

function parseIntegerLike(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function extractNetworkMagic(value: unknown): number | null {
  const direct = parseIntegerLike(value);
  if (direct && direct > 0) {
    return direct;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractNetworkMagic(item);
      if (found) {
        return found;
      }
    }
    return null;
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const candidateKeys = [
    "magic",
    "networkMagic",
    "networkmagic",
    "protocolMagic",
    "protocolmagic",
    "chainId",
    "chainid",
    "networkId",
    "networkid",
    "net",
  ];

  for (const key of candidateKeys) {
    const found = parseIntegerLike(record[key]);
    if (found && found > 0) {
      return found;
    }
  }

  const nestedKeys = ["network", "result", "data", "chain", "current", "selected"];
  for (const key of nestedKeys) {
    const found = extractNetworkMagic(record[key]);
    if (found) {
      return found;
    }
  }

  return null;
}

function extractRpcUrl(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractRpcUrl(item);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const candidateKeys = ["rpcUrl", "rpcURL", "rpc", "url", "node", "nodeUrl", "endpoint", "provider"];
  for (const key of candidateKeys) {
    const found = extractRpcUrl(record[key]);
    if (found) {
      return found;
    }
  }

  const nestedKeys = ["network", "result", "data", "current", "selected"];
  for (const key of nestedKeys) {
    const found = extractRpcUrl(record[key]);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function normalizeNetworkName(value: unknown, magic: number | null): NeoWalletNetworkName {
  if (magic === NEO_MAINNET_MAGIC) {
    return "mainnet";
  }

  if (magic === NEO_TESTNET_MAGIC) {
    return "testnet";
  }

  let text = "";
  if (typeof value === "string") {
    text = value.toLowerCase();
  } else {
    try {
      text = JSON.stringify(value ?? "").toLowerCase();
    } catch {
      text = "";
    }
  }

  if (text.includes("mainnet") || text.includes("main_net")) {
    return "mainnet";
  }

  if (text.includes("testnet") || text.includes("test_net")) {
    return "testnet";
  }

  if (magic && magic > 0) {
    return "private";
  }

  return "unknown";
}

function pickNetworkPayload(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  if (value.length === 0) {
    return null;
  }

  const selected = value.find((entry) => {
    const record = asRecord(entry);
    if (!record) {
      return false;
    }
    return record.selected === true || record.current === true || record.isCurrent === true;
  });

  return selected ?? value[0];
}

function listProviderKeys(provider: NeoLineN3Provider): string {
  const record = asRecord(provider);
  return record ? Object.keys(record).join(", ") : "";
}

async function tryCallProviderMethod(
  provider: NeoLineN3Provider,
  methodName: keyof NeoLineN3Provider,
  ...args: unknown[]
): Promise<unknown | undefined> {
  const record = asRecord(provider);
  if (!record) {
    return undefined;
  }

  const method = record[methodName as string];
  if (typeof method !== "function") {
    return undefined;
  }

  try {
    return await (method as (...innerArgs: unknown[]) => unknown).apply(provider, args);
  } catch {
    return undefined;
  }
}

async function requestProvider(
  provider: NeoLineN3Provider,
  payload: { method: string; params?: unknown },
): Promise<unknown> {
  const record = asRecord(provider);
  if (!record || typeof record.request !== "function") {
    throw new Error("request is not available");
  }

  const requestFn = record.request as (...args: unknown[]) => Promise<unknown>;

  try {
    return await requestFn.call(provider, payload);
  } catch {
    return await requestFn.call(provider, payload.method, payload.params);
  }
}

async function ensureProviderEnabled(provider: NeoLineN3Provider): Promise<void> {
  const enabled = await tryCallProviderMethod(provider, "enable");
  if (enabled !== undefined) {
    return;
  }
}

async function readAccountFromProvider(provider: NeoLineN3Provider): Promise<NeoLineAccount | null> {
  const singleAccount = await tryCallProviderMethod(provider, "getAccount");
  if (singleAccount !== undefined) {
    const account = normalizeAccount(singleAccount);
    if (account) {
      return account;
    }
  }

  const multiAccount = await tryCallProviderMethod(provider, "getAccounts");
  if (multiAccount !== undefined) {
    const account = normalizeAccount(multiAccount);
    if (account) {
      return account;
    }
  }

  const providerRecord = asRecord(provider);
  const directAccount = normalizeAccount(providerRecord?.account ?? providerRecord?.selectedAddress ?? providerRecord?.address);
  if (directAccount) {
    return directAccount;
  }

  if (providerRecord?.request) {
    const attempts: Array<{ method: string; params?: unknown }> = [
      { method: "getAccount" },
      { method: "wallet_getAccount" },
      { method: "wallet.getAccount" },
      { method: "neo_getAccount" },
      { method: "getAccount", params: [] },
    ];

    for (const payload of attempts) {
      try {
        const raw = await requestProvider(provider, payload);
        const account = normalizeAccount(raw);
        if (account) {
          return account;
        }
      } catch {
        // try next request shape
      }
    }
  }

  return null;
}

export async function connectNeoWallet(): Promise<NeoLineAccount> {
  const provider = getNeoProvider();
  if (!provider) {
    throw new Error("No Neo N3 wallet found. Please install NeoLine, O3, or OneGate.");
  }

  await ensureProviderEnabled(provider);

  const account = await readAccountFromProvider(provider);
  if (account) {
    return account;
  }

  const available = listProviderKeys(provider);
  throw new Error(`Connected wallet provider does not expose a compatible account API. Available keys: ${available}`);
}

export async function getNeoWalletAccount(): Promise<NeoLineAccount | null> {
  const provider = getNeoProvider();
  if (!provider) {
    return null;
  }

  try {
    await ensureProviderEnabled(provider);
  } catch {
    // ignore provider enable errors for background sync
  }

  try {
    return await readAccountFromProvider(provider);
  } catch {
    return null;
  }
}

export async function getNeoWalletNetwork(): Promise<NeoWalletNetwork> {
  const provider = getNeoProvider();
  if (!provider) {
    return {
      network: "unknown",
      magic: null,
    };
  }

  await ensureProviderEnabled(provider);

  const attempts: unknown[] = [];
  const directNetwork = await tryCallProviderMethod(provider, "getNetwork");
  if (directNetwork !== undefined) {
    attempts.push(directNetwork);
  }

  const directNetworks = await tryCallProviderMethod(provider, "getNetworks");
  if (directNetworks !== undefined) {
    attempts.push(directNetworks);
  }

  if (asRecord(provider)?.request) {
    const requestAttempts: Array<{ method: string; params?: unknown }> = [
      { method: "getNetwork" },
      { method: "getNetworks" },
      { method: "wallet_getNetwork" },
      { method: "wallet.getNetwork" },
      { method: "neo_getNetwork" },
      { method: "neo_getNetworks" },
    ];

    for (const payload of requestAttempts) {
      try {
        attempts.push(await requestProvider(provider, payload));
      } catch {
        // try next request shape
      }
    }
  }

  const providerRecord = asRecord(provider);
  if (providerRecord) {
    attempts.push(
      providerRecord.network,
      providerRecord.networks,
      providerRecord.chain,
      providerRecord.currentNetwork,
      providerRecord.selectedNetwork,
    );
  }

  for (const raw of attempts) {
    const payload = pickNetworkPayload(raw);
    const magic = extractNetworkMagic(payload);
    const network = normalizeNetworkName(payload, magic);
    const rpcUrl = extractRpcUrl(payload);

    if (network !== "unknown" || magic !== null || rpcUrl) {
      return {
        network,
        magic,
        rpcUrl,
        raw: payload,
      };
    }
  }

  return {
    network: "unknown",
    magic: null,
  };
}

export async function invokeNeoWallet(payload: WalletInvokeRequest): Promise<NeoLineInvokeResult> {
  const provider = getNeoProvider();
  if (!provider) {
    throw new Error("No Neo N3 wallet found.");
  }

  await ensureProviderEnabled(provider);

  const invokeResult = await tryCallProviderMethod(provider, "invoke", payload);
  if (invokeResult !== undefined) {
    return normalizeInvokeResult(invokeResult);
  }

  const invokeFunctionResult = await tryCallProviderMethod(provider, "invokeFunction", payload);
  if (invokeFunctionResult !== undefined) {
    return normalizeInvokeResult(invokeFunctionResult);
  }

  if (asRecord(provider)?.request) {
    const attempts: Array<{ method: string; params: unknown }> = [
      { method: "invoke", params: payload },
      { method: "invoke", params: [payload] },
      { method: "invokeFunction", params: payload },
      { method: "invokeFunction", params: [payload] },
      { method: "wallet.invoke", params: payload },
    ];

    for (const request of attempts) {
      try {
        const raw = await requestProvider(provider, request);
        return normalizeInvokeResult(raw);
      } catch {
        // try next invoke shape
      }
    }
  }

  const available = listProviderKeys(provider);
  throw new Error(`Connected wallet provider does not expose a compatible invoke API. Available keys: ${available}`);
}
