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
const N3_READY_EVENT = "NEOLine.N3.EVENT.READY";
const NEO_READY_EVENT = "NEOLine.NEO.EVENT.READY";
const PROVIDER_READY_WAIT_MS = 5000;

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

function hasReadyEventOnlyShape(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) {
    return false;
  }

  const keys = Object.keys(record);
  if (keys.length === 0) {
    return false;
  }

  const hasOnlyEventKeys = keys.every((key) => key === "EVENT" || key === "EVENTLIST");
  if (!hasOnlyEventKeys) {
    return false;
  }

  return true;
}

function resolveNestedProvider(value: unknown, depth = 0): NeoLineN3Provider | null {
  if (depth > 3 || !value) {
    return null;
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const initProvider = resolveFactoryProvider(record.Init ?? record.init);
  if (initProvider && initProvider !== value) {
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

  if (hasReadyEventOnlyShape(value)) {
    return null;
  }

  if (hasProviderMethod(value)) {
    return value;
  }

  return null;
}

let cachedProvider: NeoLineN3Provider | null = null;
const enableAttemptedProviders = new WeakSet<object>();
let pendingReadyWait: Promise<void> | null = null;

function collectResolvedProviders(): NeoLineN3Provider[] {
  const candidates: unknown[] = [
    window.NEOLineN3,
    window.neoLineN3,
    window.o3dapi?.n3?.dapp,
    window.OneGateProvider,
  ];

  const resolvedProviders: NeoLineN3Provider[] = [];
  for (const candidate of candidates) {
    const resolved = resolveNestedProvider(candidate);
    if (!resolved) {
      continue;
    }
    if (!resolvedProviders.includes(resolved)) {
      resolvedProviders.push(resolved);
    }
  }

  return resolvedProviders;
}

function hasDirectAccountCapability(provider: NeoLineN3Provider): boolean {
  const record = asRecord(provider);
  if (!record) {
    return false;
  }

  if (typeof record.getAccount === "function" || typeof record.getAccounts === "function") {
    return true;
  }

  const account = normalizeAccount(record.account ?? record.selectedAddress ?? record.address);
  return account !== null;
}

function hasRequestAccountCapability(provider: NeoLineN3Provider): boolean {
  const record = asRecord(provider);
  if (!record || typeof record.request !== "function") {
    return false;
  }

  return (
    typeof record.enable === "function"
    || typeof record.getNetwork === "function"
    || typeof record.getNetworks === "function"
    || typeof record.invoke === "function"
    || typeof record.invokeFunction === "function"
  );
}

function getCandidateProvidersInPriorityOrder(): NeoLineN3Provider[] {
  const resolved = collectResolvedProviders();
  if (!cachedProvider) {
    return resolved;
  }

  return [cachedProvider, ...resolved.filter((provider) => provider !== cachedProvider)];
}

async function waitForNeoProviderReady(timeoutMs = PROVIDER_READY_WAIT_MS): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  if (collectResolvedProviders().length > 0) {
    return;
  }

  if (pendingReadyWait) {
    return pendingReadyWait;
  }

  pendingReadyWait = new Promise<void>((resolve) => {
    let settled = false;
    let pollTimer: number | null = null;

    const cleanup = () => {
      if (settled) {
        return;
      }
      settled = true;
      window.removeEventListener(N3_READY_EVENT, onReady as EventListener);
      window.removeEventListener(NEO_READY_EVENT, onReady as EventListener);
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
      }
      window.clearTimeout(timer);
      pendingReadyWait = null;
      resolve();
    };

    const onReady = () => {
      cleanup();
    };

    const timer = window.setTimeout(() => {
      cleanup();
    }, timeoutMs);

    pollTimer = window.setInterval(() => {
      if (collectResolvedProviders().length > 0) {
        cleanup();
      }
    }, 150);

    window.addEventListener(N3_READY_EVENT, onReady as EventListener, { once: true });
    window.addEventListener(NEO_READY_EVENT, onReady as EventListener, { once: true });
  });

  return pendingReadyWait;
}

export function getNeoProvider(): NeoLineN3Provider | null {
  if (cachedProvider) {
    return cachedProvider;
  }

  const resolvedProviders = collectResolvedProviders();
  if (resolvedProviders.length === 0) {
    return null;
  }

  const directAccountProvider = resolvedProviders.find(hasDirectAccountCapability);
  if (directAccountProvider) {
    cachedProvider = directAccountProvider;
    return directAccountProvider;
  }

  const requestAccountProvider = resolvedProviders.find(hasRequestAccountCapability);
  if (requestAccountProvider) {
    cachedProvider = requestAccountProvider;
    return requestAccountProvider;
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
  const normalizeTxId = (candidate: string): string => {
    const trimmed = candidate.trim();
    if (!/^(?:0x)?[0-9a-fA-F]{64}$/.test(trimmed)) {
      return "";
    }

    return trimmed.startsWith("0x") || trimmed.startsWith("0X")
      ? `0x${trimmed.slice(2)}`
      : `0x${trimmed}`;
  };

  const extractTxId = (input: unknown, depth = 0): string => {
    if (depth > 4 || input === null || input === undefined) {
      return "";
    }

    if (typeof input === "string") {
      return normalizeTxId(input);
    }

    if (Array.isArray(input)) {
      for (const item of input) {
        const found = extractTxId(item, depth + 1);
        if (found) {
          return found;
        }
      }
      return "";
    }

    const record = asRecord(input);
    if (!record) {
      return "";
    }

    const txidKeys = ["txid", "txId", "transaction", "transactionId", "hash"];
    for (const key of txidKeys) {
      const candidate = record[key];
      if (typeof candidate === "string") {
        const normalized = normalizeTxId(candidate);
        if (normalized) {
          return normalized;
        }
      }
    }

    const nestedKeys = ["result", "data", "payload", "response"];
    for (const key of nestedKeys) {
      const found = extractTxId(record[key], depth + 1);
      if (found) {
        return found;
      }
    }

    return "";
  };

  const txid = extractTxId(value);
  if (typeof value === "string") {
    return txid ? { txid } : {};
  }

  const record = asRecord(value);
  if (!record) {
    return txid ? { txid } : {};
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

  if (text.includes("mainnet") || text.includes("main_net") || text.includes("main net")) {
    return "mainnet";
  }

  if (text.includes("testnet") || text.includes("test_net") || text.includes("test net")) {
    return "testnet";
  }

  if (magic && magic > 0) {
    return "private";
  }

  // If we have a magic but it's not standard, it's likely a private net
  if (magic !== null) {
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
  const providerRecord = asRecord(provider);
  if (!providerRecord || typeof providerRecord.enable !== "function") {
    return;
  }

  if (enableAttemptedProviders.has(providerRecord)) {
    return;
  }

  enableAttemptedProviders.add(providerRecord);
  await (providerRecord.enable as () => Promise<unknown>).call(provider);
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

async function findAccountAcrossProviders(
  providers: NeoLineN3Provider[],
  enableBeforeRead: boolean,
): Promise<{ account: NeoLineAccount | null; lastAvailable: string }> {
  let lastAvailable = "";

  for (const provider of providers) {
    const providerRecord = asRecord(provider);
    if (providerRecord && typeof providerRecord.enable === "function") {
      enableAttemptedProviders.delete(providerRecord);
    }

    try {
      if (enableBeforeRead) {
        await ensureProviderEnabled(provider);
      }

      const account = await readAccountFromProvider(provider);
      if (account) {
        cachedProvider = provider;
        return { account, lastAvailable };
      }
    } catch {
      // Try next provider
    }

    lastAvailable = listProviderKeys(provider);
  }

  return { account: null, lastAvailable };
}

async function loadProvidersWithReadySync(): Promise<NeoLineN3Provider[]> {
  let providers = getCandidateProvidersInPriorityOrder();
  if (providers.length > 0) {
    return providers;
  }

  await waitForNeoProviderReady();
  cachedProvider = null;
  providers = getCandidateProvidersInPriorityOrder();
  return providers;
}

export async function connectNeoWallet(): Promise<NeoLineAccount> {
  let providers = await loadProvidersWithReadySync();
  if (providers.length === 0) {
    throw new Error("No Neo N3 wallet found. Please install NeoLine, O3, or OneGate.");
  }

  const firstTry = await findAccountAcrossProviders(providers, true);
  if (firstTry.account) {
    return firstTry.account;
  }

  // Some wallets expose a placeholder object first and hydrate real methods slightly later.
  // Force one additional ready-sync pass before failing.
  await waitForNeoProviderReady();
  cachedProvider = null;
  providers = getCandidateProvidersInPriorityOrder();
  if (providers.length > 0) {
    const secondTry = await findAccountAcrossProviders(providers, true);
    if (secondTry.account) {
      return secondTry.account;
    }

    if (secondTry.lastAvailable) {
      throw new Error(`Connected wallet provider does not expose a compatible account API. Available keys: ${secondTry.lastAvailable}`);
    }
  }

  if (firstTry.lastAvailable) {
    throw new Error(`Connected wallet provider does not expose a compatible account API. Available keys: ${firstTry.lastAvailable}`);
  }

  throw new Error("No Neo N3 wallet found. Please install NeoLine, O3, or OneGate.");
}

export async function getNeoWalletAccount(silent = true): Promise<NeoLineAccount | null> {
  let providers = await loadProvidersWithReadySync();
  if (providers.length === 0) {
    return null;
  }

  const firstTry = await findAccountAcrossProviders(providers, !silent);
  if (firstTry.account) {
    return firstTry.account;
  }

  await waitForNeoProviderReady();
  cachedProvider = null;
  providers = getCandidateProvidersInPriorityOrder();
  if (providers.length === 0) {
    return null;
  }

  const secondTry = await findAccountAcrossProviders(providers, !silent);
  if (secondTry.account) {
    return secondTry.account;
  }

  return null;
}

export async function getNeoWalletNetwork(silent = true): Promise<NeoWalletNetwork> {
  let providers = await loadProvidersWithReadySync();

  const readNetworkFromProviders = async (): Promise<NeoWalletNetwork | null> => {
    for (const provider of providers) {
      try {
        if (!silent) {
          await ensureProviderEnabled(provider);
        }
      } catch {
        // Some wallets reject background enable() calls but still expose network info.
      }

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
          cachedProvider = provider;
          return {
            network,
            magic,
            rpcUrl,
            raw: payload,
          };
        }
      }
    }

    return null;
  };

  if (providers.length === 0) {
    return {
      network: "unknown",
      magic: null,
    };
  }

  const firstTry = await readNetworkFromProviders();
  if (firstTry) {
    return firstTry;
  }

  await waitForNeoProviderReady();
  cachedProvider = null;
  providers = getCandidateProvidersInPriorityOrder();
  if (providers.length > 0) {
    const secondTry = await readNetworkFromProviders();
    if (secondTry) {
      return secondTry;
    }
  }

  return {
    network: "unknown",
    magic: null,
  };
}

export async function invokeNeoWallet(payload: WalletInvokeRequest): Promise<NeoLineInvokeResult> {
  let providers = await loadProvidersWithReadySync();
  const invokeWithProviders = async (): Promise<{ result: NeoLineInvokeResult | null; lastAvailable: string }> => {
    let lastAvailable = "";

    for (const provider of providers) {
      const providerRecord = asRecord(provider);
      if (providerRecord && typeof providerRecord.enable === "function") {
        enableAttemptedProviders.delete(providerRecord);
      }

      try {
        await ensureProviderEnabled(provider);
      } catch {
        // Try next provider
        lastAvailable = listProviderKeys(provider);
        continue;
      }

      const invokeResult = await tryCallProviderMethod(provider, "invoke", payload);
      if (invokeResult !== undefined) {
        cachedProvider = provider;
        return { result: normalizeInvokeResult(invokeResult), lastAvailable };
      }

      const invokeFunctionResult = await tryCallProviderMethod(provider, "invokeFunction", payload);
      if (invokeFunctionResult !== undefined) {
        cachedProvider = provider;
        return { result: normalizeInvokeResult(invokeFunctionResult), lastAvailable };
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
            cachedProvider = provider;
            return { result: normalizeInvokeResult(raw), lastAvailable };
          } catch {
            // try next invoke shape
          }
        }
      }

      lastAvailable = listProviderKeys(provider);
    }

    return { result: null, lastAvailable };
  };

  if (providers.length === 0) {
    throw new Error("No Neo N3 wallet found.");
  }

  const firstTry = await invokeWithProviders();
  if (firstTry.result) {
    return firstTry.result;
  }

  await waitForNeoProviderReady();
  cachedProvider = null;
  providers = getCandidateProvidersInPriorityOrder();
  if (providers.length > 0) {
    const secondTry = await invokeWithProviders();
    if (secondTry.result) {
      return secondTry.result;
    }

    if (secondTry.lastAvailable) {
      throw new Error(`Connected wallet provider does not expose a compatible invoke API. Available keys: ${secondTry.lastAvailable}`);
    }
  }

  if (firstTry.lastAvailable) {
    throw new Error(`Connected wallet provider does not expose a compatible invoke API. Available keys: ${firstTry.lastAvailable}`);
  }

  throw new Error("No Neo N3 wallet found.");
}
