import type { WalletInvokeRequest } from "@platform/neo-sdk";

declare global {
  interface Window {
    NEOLineN3?: unknown;
    neoLineN3?: unknown;
    NEOLine?: unknown;
    neoLine?: unknown;
    o3dapi?: {
      n3?: {
        dapp?: unknown;
      };
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
  switchWalletAccount?: () => Promise<unknown>;
  getNetwork?: () => Promise<unknown>;
  getNetworks?: () => Promise<unknown>;
  enable?: () => Promise<unknown>;
  request?:
    | ((payload: { method: string; params?: unknown }) => Promise<unknown>)
    | ((method: string, params?: unknown) => Promise<unknown>);
  send?:
    | ((payload: { method: string; params?: unknown }) => Promise<unknown>)
    | ((method: string, params?: unknown) => Promise<unknown>);
  sendAsync?: (
    payload: { method: string; params?: unknown; id?: number; jsonrpc?: string },
    callback: (error: unknown, response?: unknown) => void,
  ) => void;
  invoke?: (payload: WalletInvokeRequest) => Promise<unknown>;
  invokeFunction?: (payload: WalletInvokeRequest) => Promise<unknown>;
  addEventListener?: (event: string, callback: (data: unknown) => void) => void;
  removeEventListener?: (event: string, callback: (data: unknown) => void) => void;
  EVENT?: {
    READY: string;
    ACCOUNT_CHANGED: string;
    NETWORK_CHANGED: string;
    CONNECTED?: string;
    DISCONNECTED?: string;
  };
}

export const NEOLINE_EVENTS = {
  ACCOUNT_CHANGED: "ACCOUNT_CHANGED",
  NETWORK_CHANGED: "NETWORK_CHANGED",
  READY: "READY",
};

const NEO_MAINNET_MAGIC = 860833102;
const NEO_TESTNET_MAGIC = 894710606;
const NEO_N3_ADDRESS_REGEX = /^N[1-9A-HJ-NP-Za-km-z]{33}$/;
const N3_READY_EVENT = "NEOLine.N3.EVENT.READY";
const NEO_READY_EVENT = "NEOLine.NEO.EVENT.READY";
const N3_REQUEST_EVENT = "NEOLine.N3.EVENT.REQUEST";
const NEO_REQUEST_EVENT = "NEOLine.NEO.EVENT.REQUEST";
const PROVIDER_READY_WAIT_MS = 5000;
const WALLET_GLOBAL_HINT_REGEX = /(neolinen3|neoline|o3|onegate|n3wallet)/i;

const wrappedProviders = new WeakMap<object, NeoLineN3Provider>();
const enableAttemptedProviders = new WeakSet<Record<string, unknown>>();

let cachedProvider: NeoLineN3Provider | null = null;
let neoLineInitInstance: unknown = null;
let readyListenersInstalled = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

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

function isLikelyEvmOnlyProvider(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) {
    return false;
  }

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
    || record.chainId !== undefined
    || record.networkVersion !== undefined
    || record.selectedAddress !== undefined;

  if (!hasEvmMarkers) {
    return false;
  }

  return !(
    typeof record.getAccount === "function"
    || typeof record.getAccounts === "function"
    || typeof record.getAddress === "function"
    || typeof record.getWalletAddress === "function"
    || typeof record.requestAccounts === "function"
    || typeof record.getNetwork === "function"
    || typeof record.getNetworks === "function"
    || typeof record.invoke === "function"
    || typeof record.invokeFunction === "function"
  );
}

function hasProviderMethods(value: unknown): value is NeoLineN3Provider {
  const record = asRecord(value);
  if (!record || isLikelyEvmOnlyProvider(record)) {
    return false;
  }

  const methodKeys = [
    "getAccount",
    "getAccounts",
    "getAddress",
    "getWalletAddress",
    "requestAccounts",
    "switchWalletAccount",
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

function resolveFactoryProvider(value: unknown): unknown | null {
  if (typeof value !== "function") {
    return null;
  }

  try {
    return new (value as new () => unknown)();
  } catch {
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

  return keys.every((key) => key === "EVENT" || key === "EVENTLIST");
}

function resolveNestedProvider(value: unknown, depth = 0): NeoLineN3Provider | null {
  if (!value || depth > 3) {
    return null;
  }

  if (hasProviderMethods(value)) {
    return value;
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

  if (hasReadyEventOnlyShape(value) || isLikelyEvmOnlyProvider(value)) {
    return null;
  }

  return null;
}

function normalizeProviderEvents(provider: NeoLineN3Provider): NonNullable<NeoLineN3Provider["EVENT"]> {
  const directEvents = provider.EVENT;
  const record = asRecord(provider);
  const legacyEvents = asRecord(record?.EVENTLIST);

  const ready = directEvents?.READY ?? (typeof legacyEvents?.READY === "string" ? legacyEvents.READY : N3_READY_EVENT);
  const accountChanged =
    directEvents?.ACCOUNT_CHANGED
    ?? (typeof legacyEvents?.ACCOUNT_CHANGED === "string" ? legacyEvents.ACCOUNT_CHANGED : NEOLINE_EVENTS.ACCOUNT_CHANGED);
  const networkChanged =
    directEvents?.NETWORK_CHANGED
    ?? (typeof legacyEvents?.NETWORK_CHANGED === "string" ? legacyEvents.NETWORK_CHANGED : NEOLINE_EVENTS.NETWORK_CHANGED);

  return {
    READY: ready,
    ACCOUNT_CHANGED: accountChanged,
    NETWORK_CHANGED: networkChanged,
    CONNECTED:
      directEvents?.CONNECTED ?? (typeof legacyEvents?.CONNECTED === "string" ? legacyEvents.CONNECTED : undefined),
    DISCONNECTED:
      directEvents?.DISCONNECTED
      ?? (typeof legacyEvents?.DISCONNECTED === "string" ? legacyEvents.DISCONNECTED : undefined),
  };
}

function normalizeProvider(provider: NeoLineN3Provider): NeoLineN3Provider {
  const key = provider as unknown as object;
  const cached = wrappedProviders.get(key);
  if (cached) {
    return cached;
  }

  const normalized: NeoLineN3Provider = {
    getAccount: provider.getAccount?.bind(provider),
    getAccounts: provider.getAccounts?.bind(provider),
    getAddress: provider.getAddress?.bind(provider),
    getWalletAddress: provider.getWalletAddress?.bind(provider),
    requestAccounts: provider.requestAccounts?.bind(provider),
    switchWalletAccount: provider.switchWalletAccount?.bind(provider),
    getNetwork: provider.getNetwork?.bind(provider),
    getNetworks: provider.getNetworks?.bind(provider),
    enable: provider.enable?.bind(provider),
    request: provider.request?.bind(provider) as NeoLineN3Provider["request"],
    send: provider.send?.bind(provider) as NeoLineN3Provider["send"],
    sendAsync: provider.sendAsync?.bind(provider),
    invoke: provider.invoke?.bind(provider),
    invokeFunction: provider.invokeFunction?.bind(provider),
    addEventListener: provider.addEventListener?.bind(provider),
    removeEventListener: provider.removeEventListener?.bind(provider),
    EVENT: normalizeProviderEvents(provider),
  };

  wrappedProviders.set(key, normalized);
  return normalized;
}

function collectWindowCandidates(): unknown[] {
  if (typeof window === "undefined") {
    return [];
  }

  const candidates: unknown[] = [];
  const windowRecord = window as unknown as Record<string, unknown>;
  const directKeys = ["NEOLineN3", "neoLineN3", "NEOLine", "neoLine", "OneGateProvider"];

  for (const key of directKeys) {
    pushUniqueUnknown(candidates, windowRecord[key]);
  }

  pushUniqueUnknown(candidates, window.o3dapi?.n3?.dapp);

  if (!neoLineInitInstance) {
    const initFactory = asRecord(window.NEOLineN3 ?? window.neoLineN3)?.Init;
    neoLineInitInstance = resolveFactoryProvider(initFactory);
  }
  pushUniqueUnknown(candidates, neoLineInitInstance);

  for (const [key, value] of Object.entries(windowRecord)) {
    if (!WALLET_GLOBAL_HINT_REGEX.test(key)) {
      continue;
    }
    pushUniqueUnknown(candidates, value);
  }

  return candidates;
}

function providerScore(provider: NeoLineN3Provider): number {
  let score = 0;

  if (
    typeof provider.getAccount === "function"
    || typeof provider.getAccounts === "function"
    || typeof provider.getAddress === "function"
    || typeof provider.getWalletAddress === "function"
    || typeof provider.requestAccounts === "function"
  ) {
    score += 16;
  }

  if (typeof provider.getNetwork === "function" || typeof provider.getNetworks === "function") {
    score += 8;
  }

  if (typeof provider.invoke === "function" || typeof provider.invokeFunction === "function") {
    score += 8;
  }

  if (typeof provider.request === "function" || typeof provider.send === "function" || typeof provider.sendAsync === "function") {
    score += 4;
  }

  if (typeof provider.addEventListener === "function") {
    score += 2;
  }

  return score;
}

function collectResolvedProviders(): NeoLineN3Provider[] {
  const resolved: NeoLineN3Provider[] = [];
  const seen = new Set<object>();

  for (const candidate of collectWindowCandidates()) {
    const provider = resolveNestedProvider(candidate);
    if (!provider) {
      continue;
    }

    const key = provider as unknown as object;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    resolved.push(normalizeProvider(provider));
  }

  resolved.sort((left, right) => providerScore(right) - providerScore(left));
  return resolved;
}

function hasDirectAccountCapability(provider: NeoLineN3Provider): boolean {
  return (
    typeof provider.getAccount === "function"
    || typeof provider.getAccounts === "function"
    || typeof provider.getAddress === "function"
    || typeof provider.getWalletAddress === "function"
    || typeof provider.requestAccounts === "function"
  );
}

function getCandidateProvidersInPriorityOrder(): NeoLineN3Provider[] {
  const providers = collectResolvedProviders();
  if (!cachedProvider) {
    return providers;
  }

  return providers.sort((left, right) => {
    if (left === cachedProvider) {
      return -1;
    }
    if (right === cachedProvider) {
      return 1;
    }
    return providerScore(right) - providerScore(left);
  });
}

function dispatchProviderRequestEvents(): void {
  if (typeof window === "undefined") {
    return;
  }

  const targets: Array<Pick<Window, "dispatchEvent"> | Pick<Document, "dispatchEvent">> = [window];
  if (typeof document !== "undefined") {
    targets.push(document);
  }

  for (const eventName of [N3_REQUEST_EVENT, NEO_REQUEST_EVENT]) {
    for (const target of targets) {
      try {
        target.dispatchEvent(new Event(eventName));
      } catch {
        // ignore unsupported targets
      }
    }
  }
}

function ensureReadyEventListenersInstalled(): void {
  if (readyListenersInstalled || typeof window === "undefined") {
    return;
  }

  readyListenersInstalled = true;
  const onReady = () => {
    cachedProvider = null;
  };

  for (const eventName of [N3_READY_EVENT, NEO_READY_EVENT]) {
    window.addEventListener(eventName, onReady);
    if (typeof document !== "undefined") {
      document.addEventListener(eventName, onReady);
    }
  }
}

async function waitForNeoProviderReady(): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  ensureReadyEventListenersInstalled();
  dispatchProviderRequestEvents();

  const startedAt = Date.now();
  while (Date.now() - startedAt < PROVIDER_READY_WAIT_MS) {
    if (collectResolvedProviders().length > 0) {
      return;
    }
    await sleep(150);
  }
}

async function forceInitNeoLineProviders(): Promise<void> {
  cachedProvider = null;
  collectResolvedProviders();
  dispatchProviderRequestEvents();
  await sleep(50);
}

async function warmUpFactoryProviders(): Promise<void> {
  collectResolvedProviders();
  await sleep(50);
}

function buildNoWalletFoundErrorMessage(): string {
  return "No Neo N3 wallet found. Install NeoLine or a compatible Neo N3 wallet and refresh the page.";
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
      const address = extractAddress(item);
      if (address) {
        return address;
      }
    }
    return "";
  }

  const record = asRecord(value);
  if (!record) {
    return "";
  }

  const candidateKeys = ["address", "accAddress", "walletAddress", "from", "accountAddress"];
  for (const key of candidateKeys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  const nestedKeys = ["account", "result", "data", "wallet", "detail"];
  for (const key of nestedKeys) {
    const address = extractAddress(record[key]);
    if (address) {
      return address;
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
  if (typeof label === "string" && label.trim().length > 0) {
    return label.trim();
  }

  return extractLabel(record.detail);
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
        const txid = extractTxId(item, depth + 1);
        if (txid) {
          return txid;
        }
      }
      return "";
    }

    const record = asRecord(input);
    if (!record) {
      return "";
    }

    for (const key of ["txid", "txId", "transaction", "transactionId", "hash"]) {
      const candidate = record[key];
      if (typeof candidate === "string") {
        const txid = normalizeTxId(candidate);
        if (txid) {
          return txid;
        }
      }
    }

    for (const key of ["result", "data", "payload", "response"]) {
      const txid = extractTxId(record[key], depth + 1);
      if (txid) {
        return txid;
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

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
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
      const magic = extractNetworkMagic(item);
      if (magic) {
        return magic;
      }
    }
    return null;
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  for (const key of ["magic", "networkMagic", "protocolMagic", "chainId", "networkId", "net"]) {
    const magic = parseIntegerLike(record[key]);
    if (magic && magic > 0) {
      return magic;
    }
  }

  for (const key of ["network", "result", "data", "chain", "current", "selected", "detail"]) {
    const magic = extractNetworkMagic(record[key]);
    if (magic) {
      return magic;
    }
  }

  return null;
}

function extractRpcUrl(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return /^https?:\/\//i.test(trimmed) ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const rpcUrl = extractRpcUrl(item);
      if (rpcUrl) {
        return rpcUrl;
      }
    }
    return undefined;
  }

  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  for (const key of ["rpcUrl", "rpcURL", "rpc", "url", "node", "nodeUrl", "endpoint", "provider"]) {
    const rpcUrl = extractRpcUrl(record[key]);
    if (rpcUrl) {
      return rpcUrl;
    }
  }

  for (const key of ["network", "result", "data", "current", "selected", "detail"]) {
    const rpcUrl = extractRpcUrl(record[key]);
    if (rpcUrl) {
      return rpcUrl;
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

  return magic !== null ? "private" : "unknown";
}

function pickNetworkPayload(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  const selected = value.find((entry) => {
    const record = asRecord(entry);
    return !!record && (record.selected === true || record.current === true || record.isCurrent === true);
  });

  return selected ?? value[0] ?? null;
}

function unwrapRpcResponse(value: unknown): unknown {
  const record = asRecord(value);
  if (record && "result" in record) {
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
  } catch {
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

  const callWithFallback = async (
    fn: (...args: unknown[]) => unknown,
    attempts: unknown[][],
  ): Promise<unknown> => {
    let lastError: unknown;

    for (const args of attempts) {
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

    if (lastError) {
      throw lastError;
    }

    throw new Error("provider request failed");
  };

  if (typeof record.request === "function") {
    return callWithFallback(record.request as (...args: unknown[]) => unknown, [[payload], [payload.method, payload.params]]);
  }

  if (typeof record.send === "function") {
    return callWithFallback(record.send as (...args: unknown[]) => unknown, [[payload], [payload.method, payload.params]]);
  }

  if (typeof record.sendAsync === "function") {
    const sendAsync = record.sendAsync as (
      request: { method: string; params?: unknown; id?: number; jsonrpc?: string },
      callback: (error: unknown, response?: unknown) => void,
    ) => void;

    return new Promise<unknown>((resolve, reject) => {
      try {
        sendAsync.call(
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
  try {
    return await (providerRecord.enable as () => Promise<unknown>).call(provider);
  } catch {
    return undefined;
  }
}

function readDirectAccountFromProvider(provider: NeoLineN3Provider): NeoLineAccount | null {
  const providerRecord = asRecord(provider);
  return normalizeAccount(providerRecord?.account ?? providerRecord?.selectedAddress ?? providerRecord?.address);
}

async function readAccountFromProvider(provider: NeoLineN3Provider): Promise<NeoLineAccount | null> {
  for (const methodName of ["getAccount", "getAccounts", "getAddress", "getWalletAddress"] as const) {
    const value = await tryCallProviderMethod(provider, methodName);
    if (value !== undefined) {
      const account = normalizeAccount(value);
      if (account) {
        return account;
      }
    }
  }

  const providerRecord = asRecord(provider);
  const directAccount = readDirectAccountFromProvider(provider);
  if (directAccount) {
    return directAccount;
  }

  if (providerRecord?.request || providerRecord?.send || providerRecord?.sendAsync) {
    for (const method of ["getAccount", "getAccounts", "getAddress", "getWalletAddress"]) {
      try {
        const account = normalizeAccount(await requestProvider(provider, { method }));
        if (account) {
          return account;
        }
      } catch {
        // try next shape
      }
    }
  }

  return null;
}

async function findAccountAcrossProviders(
  providers: NeoLineN3Provider[],
  enableBeforeRead: boolean,
): Promise<NeoLineAccount | null> {
  for (const provider of providers) {
    const providerRecord = asRecord(provider);
    if (providerRecord && typeof providerRecord.enable === "function") {
      enableAttemptedProviders.delete(providerRecord);
    }

    if (enableBeforeRead) {
      const enabledResult = await ensureProviderEnabled(provider);
      const enabledAccount = normalizeAccount(enabledResult);
      if (enabledAccount) {
        cachedProvider = provider;
        return enabledAccount;
      }
    }

    const account = await readAccountFromProvider(provider);
    if (account) {
      cachedProvider = provider;
      return account;
    }
  }

  return null;
}

async function connectSingleProvider(provider: NeoLineN3Provider): Promise<NeoLineAccount | null> {
  const providerRecord = asRecord(provider);
  if (providerRecord && typeof providerRecord.enable === "function") {
    enableAttemptedProviders.delete(providerRecord);
  }
  const CONNECT_METHOD_TIMEOUT_MS = 12000;

  const waitForConnectedEvent = () => new Promise<NeoLineAccount | null>((resolve) => {
    const connectedEvent = provider.EVENT?.CONNECTED;
    const accountChangedEvent = provider.EVENT?.ACCOUNT_CHANGED;
    const globalEvents = [
      connectedEvent,
      accountChangedEvent,
      "NEOLine.NEO.EVENT.CONNECTED",
      "NEOLine.NEO.EVENT.ACCOUNT_CHANGED",
      "NEOLine.N3.EVENT.CONNECTED",
      "NEOLine.N3.EVENT.ACCOUNT_CHANGED",
    ].filter((value, index, list): value is string => typeof value === "string" && list.indexOf(value) === index);

    const canListenProvider = !!provider.addEventListener && (!!connectedEvent || !!accountChangedEvent);
    const canListenWindow = typeof window !== "undefined" && globalEvents.length > 0;
    if (!canListenProvider && !canListenWindow) {
      resolve(null);
      return;
    }

    let settled = false;
    let timeoutId = 0 as unknown as ReturnType<typeof globalThis.setTimeout>;

    const cleanup = () => {
      globalThis.clearTimeout(timeoutId);
      if (canListenProvider) {
        if (connectedEvent) {
          provider.removeEventListener?.(connectedEvent, onAccountEvent);
        }
        if (accountChangedEvent) {
          provider.removeEventListener?.(accountChangedEvent, onAccountEvent);
        }
      }
      if (canListenWindow) {
        for (const eventName of globalEvents) {
          window.removeEventListener(eventName, onAccountEvent as EventListener);
          document.removeEventListener?.(eventName, onAccountEvent as EventListener);
        }
      }
    };

    const onAccountEvent = (value: unknown) => {
      const account = normalizeAccount(value);
      if (!account || settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(account);
    };

    timeoutId = globalThis.setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(null);
    }, 30000);

    if (canListenProvider) {
      if (connectedEvent) {
        provider.addEventListener!(connectedEvent, onAccountEvent);
      }
      if (accountChangedEvent) {
        provider.addEventListener!(accountChangedEvent, onAccountEvent);
      }
    }
    if (canListenWindow) {
      for (const eventName of globalEvents) {
        window.addEventListener(eventName, onAccountEvent as EventListener);
        document.addEventListener?.(eventName, onAccountEvent as EventListener);
      }
    }
  });

  const pendingConnectedEvent = waitForConnectedEvent();

  const withTimeoutOrEvent = async (attempt: () => Promise<unknown | undefined>): Promise<NeoLineAccount | null> => {
    const result = await Promise.race<unknown | NeoLineAccount | null>([
      attempt(),
      pendingConnectedEvent,
      sleep(CONNECT_METHOD_TIMEOUT_MS).then(() => null),
    ]);

    const eventAccount = normalizeAccount(result);
    if (eventAccount) {
      cachedProvider = provider;
      return eventAccount;
    }

    return null;
  };

  const interactiveMethods: Array<keyof NeoLineN3Provider> = [
    "getAccount",
    "requestAccounts",
    "getAddress",
    "getWalletAddress",
    "getAccounts",
  ];

  for (const methodName of interactiveMethods) {
    const account = await withTimeoutOrEvent(async () => {
      const value = await tryCallProviderMethod(provider, methodName);
      if (value === undefined) {
        return undefined;
      }
      return normalizeAccount(value);
    });
    if (account) {
      cachedProvider = provider;
      return account;
    }
  }

  for (const method of ["getAccount", "requestAccounts", "getAddress", "getWalletAddress", "getAccounts"]) {
    try {
      const account = await withTimeoutOrEvent(async () => normalizeAccount(await requestProvider(provider, { method })));
      if (account) {
        cachedProvider = provider;
        return account;
      }
    } catch {
      // try next interactive method
    }
  }

  const enabledAccount = await withTimeoutOrEvent(async () => {
    const enabledResult = await ensureProviderEnabled(provider);
    return normalizeAccount(enabledResult);
  });
  if (enabledAccount) {
    cachedProvider = provider;
    return enabledAccount;
  }

  const accountAfterEnable = await Promise.race([
    readAccountFromProvider(provider),
    pendingConnectedEvent,
    sleep(CONNECT_METHOD_TIMEOUT_MS).then(() => null),
  ]);
  if (accountAfterEnable) {
    cachedProvider = provider;
    return accountAfterEnable;
  }

  const accountFromEvent = await pendingConnectedEvent;
  if (accountFromEvent) {
    cachedProvider = provider;
    return accountFromEvent;
  }

  return null;
}

async function readNetworkFromProvider(provider: NeoLineN3Provider): Promise<NeoWalletNetwork | null> {
  const attempts: unknown[] = [];

  for (const methodName of ["getNetwork", "getNetworks"] as const) {
    const value = await tryCallProviderMethod(provider, methodName);
    if (value !== undefined) {
      attempts.push(value);
    }
  }

  const providerRecord = asRecord(provider);
  if (providerRecord) {
    attempts.push(providerRecord.network, providerRecord.currentNetwork, providerRecord.selectedNetwork);
  }

  if (providerRecord?.request || providerRecord?.send || providerRecord?.sendAsync) {
    for (const method of ["getNetwork", "getNetworks"]) {
      try {
        attempts.push(await requestProvider(provider, { method }));
      } catch {
        // try next request shape
      }
    }
  }

  for (const attempt of attempts) {
    const payload = pickNetworkPayload(attempt);
    const magic = extractNetworkMagic(payload);
    const rpcUrl = extractRpcUrl(payload);
    const network = normalizeNetworkName(payload, magic);

    if (network !== "unknown" || magic !== null || rpcUrl) {
      return {
        network,
        magic,
        rpcUrl,
        raw: payload,
      };
    }
  }

  return null;
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
  return getCandidateProvidersInPriorityOrder();
}

export function getNeoProvider(): NeoLineN3Provider | null {
  if (typeof window === "undefined") {
    return null;
  }

  if (cachedProvider) {
    return cachedProvider;
  }

  const providers = getCandidateProvidersInPriorityOrder();
  const directAccountProvider = providers.find(hasDirectAccountCapability) ?? providers[0] ?? null;
  if (!directAccountProvider) {
    dispatchProviderRequestEvents();
    return null;
  }

  cachedProvider = directAccountProvider;
  return directAccountProvider;
}

export async function connectNeoWallet(): Promise<NeoLineAccount> {
  const providers = await loadProvidersWithReadySync();
  if (providers.length === 0) {
    throw new Error(buildNoWalletFoundErrorMessage());
  }

  const preferredProvider = getNeoProvider() ?? providers[0];
  const account = preferredProvider ? await connectSingleProvider(preferredProvider) : null;
  if (account) {
    return account;
  }

  throw new Error("Failed to connect to wallet.");
}

export async function getNeoWalletAccount(silent = true): Promise<NeoLineAccount | null> {
  let providers = getCandidateProvidersInPriorityOrder();
  if (!silent && providers.length === 0) {
    providers = await loadProvidersWithReadySync();
  }

  if (providers.length === 0) {
    return null;
  }

  if (silent) {
    for (const provider of providers) {
      const account = readDirectAccountFromProvider(provider);
      if (account) {
        cachedProvider = provider;
        return account;
      }
    }

    return null;
  }

  return findAccountAcrossProviders(providers, false);
}

export async function getNeoWalletNetwork(silent = true): Promise<NeoWalletNetwork> {
  let providers = getCandidateProvidersInPriorityOrder();
  if (!silent && providers.length === 0) {
    providers = await loadProvidersWithReadySync();
  }

  for (const provider of providers) {
    const network = await readNetworkFromProvider(provider);
    if (network) {
      cachedProvider = provider;
      return network;
    }
  }

  return { network: "unknown", magic: null };
}

export async function invokeNeoWallet(payload: WalletInvokeRequest): Promise<NeoLineInvokeResult> {
  const providers = await loadProvidersWithReadySync();
  if (providers.length === 0) {
    throw new Error(buildNoWalletFoundErrorMessage());
  }

  let lastError: unknown = null;

  for (const provider of providers) {
    try {
      if (typeof provider.invoke === "function") {
        cachedProvider = provider;
        return normalizeInvokeResult(await provider.invoke(payload));
      }

      if (typeof provider.invokeFunction === "function") {
        cachedProvider = provider;
        return normalizeInvokeResult(await provider.invokeFunction(payload));
      }

      cachedProvider = provider;
      return normalizeInvokeResult(
        await requestProvider(provider, {
          method: "invoke",
          params: [payload],
        }),
      );
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to invoke wallet.");
}
