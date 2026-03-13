import type { WalletInvokeRequest } from "@platform/neo-sdk";

declare global {
  interface Window {
    NEOLineN3?: unknown;
    neoLineN3?: unknown;
    NEOLine?: unknown;
    neoLine?: unknown;
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
  getAddress?: () => Promise<unknown>;
  getWalletAddress?: () => Promise<unknown>;
  requestAccounts?: () => Promise<unknown>;
  getNetwork?: () => Promise<unknown>;
  getNetworks?: () => Promise<unknown>;
  enable?: () => Promise<unknown>;
  request?: ((payload: { method: string; params?: unknown }) => Promise<unknown>) | ((method: string, params?: unknown) => Promise<unknown>);
  send?: ((payload: { method: string; params?: unknown }) => Promise<unknown>) | ((method: string, params?: unknown) => Promise<unknown>);
  sendAsync?: (
    payload: { method: string; params?: unknown; id?: number; jsonrpc?: string },
    callback: (error: unknown, response?: unknown) => void,
  ) => void;
  invoke?: (payload: WalletInvokeRequest) => Promise<unknown>;
  invokeFunction?: (payload: WalletInvokeRequest) => Promise<unknown>;
}

const NEO_MAINNET_MAGIC = 860833102;
const NEO_TESTNET_MAGIC = 894710606;
const NEO_N3_ADDRESS_REGEX = /^N[1-9A-HJ-NP-Za-km-z]{33}$/;
const N3_READY_EVENT = "NEOLine.N3.EVENT.READY";
const NEO_READY_EVENT = "NEOLine.NEO.EVENT.READY";
const N3_REQUEST_EVENT = "NEOLine.N3.EVENT.REQUEST";
const NEO_REQUEST_EVENT = "NEOLine.NEO.EVENT.REQUEST";
const PROVIDER_READY_WAIT_MS = 5000;
const FACTORY_INIT_TIMEOUT_MS = 8000;
const WALLET_GLOBAL_HINT_REGEX = /(neolinen3|o3|onegate|n3wallet)/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function pushUniqueUnknown(list: unknown[], value: unknown): void {
  if (value === null || value === undefined) {
    return;
  }
  if (!list.includes(value)) {
    list.push(value);
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  const record = asRecord(value);
  return !!record && typeof record.then === "function";
}

function hasProviderMethod(value: unknown): value is NeoLineN3Provider {
  const record = asRecord(value);
  if (!record) {
    return false;
  }

  if (isLikelyEvmOnlyProvider(record)) {
    return false;
  }

  const methodKeys = [
    "getAccount",
    "getAccounts",
    "getAddress",
    "getWalletAddress",
    "requestAccounts",
    "getNetwork",
    "getNetworks",
    "request",
    "send",
    "sendAsync",
    "invoke",
    "invokeFunction",
    "enable",
  ];
  return methodKeys.some((key) => typeof record[key] === "function");
}

function hasNeoN3AccountHints(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) {
    return false;
  }

  if (
    typeof record.getAccount === "function"
    || typeof record.getAccounts === "function"
    || typeof record.getAddress === "function"
    || typeof record.getWalletAddress === "function"
    || typeof record.requestAccounts === "function"
    || typeof record.getNetwork === "function"
    || typeof record.getNetworks === "function"
    || typeof record.invoke === "function"
    || typeof record.invokeFunction === "function"
    || typeof record.enable === "function"
    || typeof record.Init === "function"
    || typeof record.init === "function"
  ) {
    return true;
  }

  const nestedKeys = ["NEOLineN3", "neoLineN3", "n3", "N3", "n3Provider", "N3Provider", "dapp", "api"];
  return nestedKeys.some((key) => record[key] !== undefined && record[key] !== null);
}

function isLikelyEvmOnlyProvider(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) {
    return false;
  }

  // NeoLine N3 wrappers often expose isNEOLine + chainId/networkVersion alongside N3 factories/events.
  if (
    record.isNEOLine === true
    && (
      typeof record.Init === "function"
      || typeof record.init === "function"
      || record.EVENT !== undefined
      || record.EVENTLIST !== undefined
    )
  ) {
    return false;
  }

  const hasEvmMarkers =
    record.isMetaMask === true
    || record.isCoinbaseWallet === true
    || record.isBraveWallet === true
    || record.isRabby === true
    || record.isNEOLine === true
    || record.chainId !== undefined
    || record.networkVersion !== undefined
    || record.selectedAddress !== undefined;

  if (!hasEvmMarkers) {
    return false;
  }

  return !hasNeoN3AccountHints(record);
}

function getNestedField(value: unknown, key: string): unknown {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  return record[key];
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

  const nestedKeys = [
    "provider",
    "dapp",
    "n3",
    "N3",
    "wallet",
    "client",
    "default",
    "api",
    "bridge",
    "neoline",
    "n3Provider",
    "N3Provider",
    "sdk",
  ];
  for (const key of nestedKeys) {
    const resolved = resolveNestedProvider(record[key], depth + 1);
    if (resolved) {
      return resolved;
    }
  }

  if (isLikelyEvmOnlyProvider(value)) {
    return null;
  }

  // Some NeoLine providers expose methods on prototype while own enumerable keys
  // may only contain EVENT/EVENTLIST.
  if (hasProviderMethod(value)) {
    return value;
  }

  if (hasReadyEventOnlyShape(value)) {
    return null;
  }

  return null;
}

let cachedProvider: NeoLineN3Provider | null = null;
const enableAttemptedProviders = new WeakSet<object>();
let pendingReadyWait: Promise<void> | null = null;
let pendingFactoryWarmup: Promise<void> | null = null;
let readyEventListenersInstalled = false;
const attemptedFactoryRoots = new WeakSet<object>();
const deferredProviderCandidates: unknown[] = [];

function pushDeferredProviderCandidate(value: unknown): void {
  pushUniqueUnknown(deferredProviderCandidates, value);
}

function collectWindowHintCandidates(): unknown[] {
  if (typeof window === "undefined") {
    return [];
  }

  const hints: unknown[] = [];
  let keys: string[] = [];
  try {
    keys = Object.getOwnPropertyNames(window);
  } catch {
    return hints;
  }

  const windowRecord = window as unknown as Record<string, unknown>;
  for (const key of keys) {
    if (!WALLET_GLOBAL_HINT_REGEX.test(key)) {
      continue;
    }
    try {
      pushUniqueUnknown(hints, windowRecord[key]);
    } catch {
      // Ignore globals that throw on read
    }
  }

  return hints;
}

function collectWalletGlobalNames(): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  let keys: string[] = [];
  try {
    keys = Object.getOwnPropertyNames(window);
  } catch {
    return [];
  }

  return keys.filter((key) => WALLET_GLOBAL_HINT_REGEX.test(key)).slice(0, 12);
}

function buildNoWalletFoundErrorMessage(): string {
  const base = "No Neo N3 wallet found. Please install NeoLine, O3, or OneGate.";
  const names = collectWalletGlobalNames();
  if (names.length === 0) {
    return base;
  }
  return `${base} Detected wallet-like globals: ${names.join(", ")}.`;
}

function collectReadyEventCandidates(event: Event | null | undefined): unknown[] {
  if (!event) {
    return [];
  }

  const customEvent = event as CustomEvent<unknown>;
  const detail = customEvent.detail;
  const candidates: unknown[] = [detail];
  const detailRecord = asRecord(detail);
  if (detailRecord) {
    const nestedKeys = ["provider", "api", "wallet", "n3", "N3", "NEOLineN3", "neoLineN3", "data", "result"];
    for (const key of nestedKeys) {
      pushUniqueUnknown(candidates, detailRecord[key]);
    }
  }
  return candidates;
}

function captureReadyEventCandidates(event: Event | null | undefined): void {
  const candidates = collectReadyEventCandidates(event);
  for (const candidate of candidates) {
    pushDeferredProviderCandidate(candidate);
  }
}

function dispatchProviderRequestEvents(): void {
  if (typeof window === "undefined") {
    return;
  }

  for (const eventName of [N3_REQUEST_EVENT, NEO_REQUEST_EVENT]) {
    try {
      window.dispatchEvent(new Event(eventName));
    } catch {
      // Ignore unsupported custom event dispatch behavior.
    }
  }
}

function ensureReadyEventListenersInstalled(): void {
  if (typeof window === "undefined" || readyEventListenersInstalled) {
    return;
  }

  const onReady = (event: Event) => {
    captureReadyEventCandidates(event);
  };

  window.addEventListener(N3_READY_EVENT, onReady as EventListener);
  window.addEventListener(NEO_READY_EVENT, onReady as EventListener);
  readyEventListenersInstalled = true;
}

async function resolveFactoryProviderAsync(value: unknown): Promise<unknown> {
  if (typeof value !== "function") {
    return null;
  }

  let created: unknown = null;
  try {
    created = new (value as new () => unknown)();
  } catch {
    try {
      created = (value as () => unknown)();
    } catch {
      return null;
    }
  }

  if (!isPromiseLike(created)) {
    return created;
  }

  try {
    const timeout = new Promise<null>((resolve) => {
      window.setTimeout(() => resolve(null), FACTORY_INIT_TIMEOUT_MS);
    });
    const resolved = await Promise.race([created, timeout]);
    return resolved;
  } catch {
    return null;
  }
}

async function warmUpFactoryProviders(): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  if (pendingFactoryWarmup) {
    return pendingFactoryWarmup;
  }

  pendingFactoryWarmup = (async () => {
    const roots: unknown[] = [
      window.NEOLineN3,
      window.neoLineN3,
      window.NEOLine,
      window.neoLine,
      getNestedField(window.NEOLine, "N3"),
      getNestedField(window.NEOLine, "n3"),
      getNestedField(window.neoLine, "N3"),
      getNestedField(window.neoLine, "n3"),
      window.o3dapi,
      window.o3dapi?.n3,
      window.o3dapi?.n3?.dapp,
      window.OneGateProvider,
      ...deferredProviderCandidates,
      ...collectWindowHintCandidates(),
    ];

    for (const root of roots) {
      const record = asRecord(root);
      if (!record || attemptedFactoryRoots.has(record)) {
        continue;
      }

      const initFactory = record.Init ?? record.init;
      if (typeof initFactory !== "function") {
        continue;
      }

      const created = await resolveFactoryProviderAsync(initFactory);
      if (!created) {
        continue;
      }

      attemptedFactoryRoots.add(record);
      pushDeferredProviderCandidate(created);
    }
  })().finally(() => {
    pendingFactoryWarmup = null;
  });

  return pendingFactoryWarmup;
}

async function forceInitNeoLineProviders(): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  const roots: unknown[] = [
    window.NEOLineN3,
    window.neoLineN3,
    window.NEOLine,
    window.neoLine,
  ];

  for (const root of roots) {
    const record = asRecord(root);
    if (!record) {
      continue;
    }

    const initFactory = record.Init ?? record.init;
    if (typeof initFactory !== "function") {
      continue;
    }

    const created = await resolveFactoryProviderAsync(initFactory);
    if (!created) {
      continue;
    }

    pushDeferredProviderCandidate(created);
  }
}

function collectResolvedProviders(): NeoLineN3Provider[] {
  ensureReadyEventListenersInstalled();

  const candidates: unknown[] = [
    window.NEOLineN3,
    window.neoLineN3,
    getNestedField(window.NEOLine, "N3"),
    getNestedField(window.NEOLine, "n3"),
    getNestedField(window.neoLine, "N3"),
    getNestedField(window.neoLine, "n3"),
    window.o3dapi,
    window.o3dapi?.n3,
    window.o3dapi?.n3?.dapp,
    window.OneGateProvider,
    ...deferredProviderCandidates,
    ...collectWindowHintCandidates(),
  ];

  const resolvedProviders: NeoLineN3Provider[] = [];
  for (const candidate of candidates) {
    const resolved = resolveNestedProvider(candidate);
    if (!resolved) {
      continue;
    }
    if (isLikelyEvmOnlyProvider(resolved)) {
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
  if (isLikelyEvmOnlyProvider(record)) {
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
  if (
    !record
    || isLikelyEvmOnlyProvider(record)
    || (
      typeof record.request !== "function"
      && typeof record.send !== "function"
      && typeof record.sendAsync !== "function"
    )
  ) {
    return false;
  }

  return (
    typeof record.enable === "function"
    || typeof record.requestAccounts === "function"
    || typeof record.getAddress === "function"
    || typeof record.getWalletAddress === "function"
    || typeof record.getNetwork === "function"
    || typeof record.getNetworks === "function"
    || typeof record.invoke === "function"
    || typeof record.invokeFunction === "function"
  );
}

function getCandidateProvidersInPriorityOrder(): NeoLineN3Provider[] {
  const resolved = collectResolvedProviders();
  if (cachedProvider && isLikelyEvmOnlyProvider(cachedProvider)) {
    cachedProvider = null;
  }

  if (!cachedProvider) {
    return resolved;
  }

  return [cachedProvider, ...resolved.filter((provider) => provider !== cachedProvider)];
}

async function waitForNeoProviderReady(timeoutMs = PROVIDER_READY_WAIT_MS): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  ensureReadyEventListenersInstalled();

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

    const onReady = (event: Event) => {
      captureReadyEventCandidates(event);
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
    dispatchProviderRequestEvents();
  });

  return pendingReadyWait;
}

export function getNeoProvider(): NeoLineN3Provider | null {
  ensureReadyEventListenersInstalled();

  if (cachedProvider) {
    return cachedProvider;
  }

  const resolvedProviders = collectResolvedProviders();
  if (resolvedProviders.length === 0) {
    dispatchProviderRequestEvents();
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
  if (!address || !NEO_N3_ADDRESS_REGEX.test(address)) {
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

function unwrapRpcResponse(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) {
    return value;
  }
  if ("result" in record) {
    return record.result;
  }
  return value;
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
  } catch (err) {
    const errorRecord = asRecord(err);
    if (errorRecord && errorRecord.type === "CONNECTION_DENIED") {
      // User likely rejected the request or too many pending requests
      return undefined;
    }
    return undefined;
  }
}

async function requestProvider(
  provider: NeoLineN3Provider,
  payload: { method: string; params?: unknown },
): Promise<unknown> {
  const record = asRecord(provider);
  if (!record) {
    throw new Error("provider is not available");
  }

  const callWithCallbackFallback = async (
    fn: (...args: unknown[]) => unknown,
    argsList: unknown[][],
  ): Promise<unknown> => {
    let lastError: unknown;
    for (const args of argsList) {
      try {
        const result = fn.call(provider, ...args);
        if (isPromiseLike(result)) {
          return unwrapRpcResponse(await result);
        }
        if (result !== undefined) {
          return unwrapRpcResponse(result);
        }
      } catch (error) {
        lastError = error;
      }
    }

    const callbackTimeoutMs = 1500;
    for (const args of argsList) {
      try {
        return await new Promise<unknown>((resolve, reject) => {
          let settled = false;
          const timer = globalThis.setTimeout(() => {
            if (!settled) {
              settled = true;
              reject(new Error("provider callback request timeout"));
            }
          }, callbackTimeoutMs);

          const callback = (error: unknown, response?: unknown) => {
            if (settled) {
              return;
            }
            settled = true;
            globalThis.clearTimeout(timer);
            if (error) {
              const errorRecord = asRecord(error);
              if (errorRecord && errorRecord.type === "CONNECTION_DENIED") {
                resolve(undefined); // Treat denial as "not found" during silent reads
                return;
              }
              reject(error);
              return;
            }
            resolve(unwrapRpcResponse(response));
          };

          try {
            fn.call(provider, ...args, callback);
          } catch (error) {
            if (!settled) {
              settled = true;
              globalThis.clearTimeout(timer);
              reject(error);
            }
          }
        });
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) {
      throw lastError;
    }
    throw new Error("provider request failed");
  };

  if (typeof record.request === "function") {
    const requestFn = record.request as (...args: unknown[]) => unknown;
    return await callWithCallbackFallback(requestFn, [[payload]]);
  }

  if (typeof record.send === "function") {
    const sendFn = record.send as (...args: unknown[]) => unknown;
    return await callWithCallbackFallback(sendFn, [[payload]]);
  }

  if (typeof record.sendAsync === "function") {
    const sendAsyncFn = record.sendAsync as (
      request: { method: string; params?: unknown; id?: number; jsonrpc?: string },
      callback: (error: unknown, response?: unknown) => void,
    ) => void;

    return await new Promise<unknown>((resolve, reject) => {
      try {
        sendAsyncFn.call(
          provider,
          {
            id: Date.now(),
            jsonrpc: "2.0",
            method: payload.method,
            params: payload.params,
          },
          (error, response) => {
            if (error) {
              reject(error);
              return;
            }
            resolve(unwrapRpcResponse(response));
          },
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  throw new Error("request/send/sendAsync is not available");
}

async function ensureProviderEnabled(provider: NeoLineN3Provider): Promise<unknown | undefined> {
  const providerRecord = asRecord(provider);
  if (!providerRecord || typeof providerRecord.enable !== "function") {
    return undefined;
  }

  if (enableAttemptedProviders.has(providerRecord)) {
    return undefined;
  }

  enableAttemptedProviders.add(providerRecord);
  return await (providerRecord.enable as () => Promise<unknown>).call(provider);
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

  const addressMethods: Array<keyof NeoLineN3Provider> = [
    "getAddress",
    "getWalletAddress",
    "requestAccounts",
  ];
  for (const methodName of addressMethods) {
    const value = await tryCallProviderMethod(provider, methodName);
    if (value !== undefined) {
      const account = normalizeAccount(value);
      if (account) {
        return account;
      }
    }
  }

  const providerRecord = asRecord(provider);
  const directAccount = normalizeAccount(providerRecord?.account ?? providerRecord?.selectedAddress ?? providerRecord?.address);
  if (directAccount) {
    return directAccount;
  }

  if (providerRecord?.request || providerRecord?.send || providerRecord?.sendAsync) {
    const attempts: Array<{ method: string; params?: unknown }> = [
      { method: "getAccount" },
      { method: "getAccounts" },
      { method: "getAddress" },
      { method: "getWalletAddress" },
      { method: "requestAccounts" },
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
      let enabledResult: unknown = undefined;
      if (enableBeforeRead) {
        enabledResult = await ensureProviderEnabled(provider);
      }

      const enabledAccount = normalizeAccount(enabledResult);
      if (enabledAccount) {
        cachedProvider = provider;
        return { account: enabledAccount, lastAvailable };
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
  ensureReadyEventListenersInstalled();

  let providers = getCandidateProvidersInPriorityOrder();
  if (providers.length > 0) {
    return providers;
  }

  await forceInitNeoLineProviders();
  providers = getCandidateProvidersInPriorityOrder();
  if (providers.length > 0) {
    return providers;
  }

  await warmUpFactoryProviders();
  providers = getCandidateProvidersInPriorityOrder();
  if (providers.length > 0) {
    return providers;
  }

  await waitForNeoProviderReady();
  await forceInitNeoLineProviders();
  await warmUpFactoryProviders();
  cachedProvider = null;
  providers = getCandidateProvidersInPriorityOrder();
  return providers;
}

export async function connectNeoWallet(): Promise<NeoLineAccount> {
  let providers = await loadProvidersWithReadySync();
  if (providers.length === 0) {
    throw new Error(buildNoWalletFoundErrorMessage());
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

  throw new Error(buildNoWalletFoundErrorMessage());
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
    throw new Error(buildNoWalletFoundErrorMessage());
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

  throw new Error(buildNoWalletFoundErrorMessage());
}
