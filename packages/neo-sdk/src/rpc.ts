import { rpc } from "@cityofzion/neon-js";

import { decodeStackItem } from "./stack.js";
import type { ContractArgument, RpcConfig } from "./types.js";

const DEFAULT_TESTNET_RPC_FAILOVERS: Record<string, string[]> = {
  "https://n3seed1.ngd.network:20332": [
    "https://n3seed2.ngd.network:20332",
  ],
  "https://n3seed2.ngd.network:20332": [
    "https://n3seed1.ngd.network:20332",
  ],
  "http://seed2t5.neo.org:20332": [
    "http://seed1t5.neo.org:20332",
    "https://n3seed1.ngd.network:20332",
    "https://n3seed2.ngd.network:20332",
  ],
  "http://seed1t5.neo.org:20332": [
    "http://seed2t5.neo.org:20332",
    "https://n3seed1.ngd.network:20332",
    "https://n3seed2.ngd.network:20332",
  ],
};

interface RawInvocationResult {
  state?: string;
  exception?: string;
  stack?: unknown[];
}

function normalizeRpcUrl(input: string): string {
  return input.trim().replace(/\/+$/, "");
}

function isBrowserHttpsPage(): boolean {
  return typeof window !== "undefined" && window.location.protocol === "https:";
}

function resolveRpcUrls(primary: string): string[] {
  const explicit = primary
    .split(",")
    .map((entry) => normalizeRpcUrl(entry))
    .filter((entry) => entry.length > 0);

  const urls = explicit.length > 0 ? explicit : [normalizeRpcUrl(primary)];
  if (urls.length === 0) {
    return [];
  }

  const first = urls[0].toLowerCase();
  const failovers = DEFAULT_TESTNET_RPC_FAILOVERS[first] ?? [];
  for (const fallback of failovers) {
    const normalizedFallback = normalizeRpcUrl(fallback);
    if (!urls.some((entry) => entry.toLowerCase() === normalizedFallback.toLowerCase())) {
      urls.push(normalizedFallback);
    }
  }

  if (!isBrowserHttpsPage()) {
    return urls;
  }

  const secureUrls = urls.filter((url) => !url.toLowerCase().startsWith("http://"));
  return secureUrls.length > 0 ? secureUrls : urls;
}

export class NeoRpcService {
  private client: any;
  private readonly rpcUrls: string[];
  private activeIndex = 0;

  constructor(private readonly config: RpcConfig) {
    this.rpcUrls = resolveRpcUrls(config.rpcUrl);
    if (this.rpcUrls.length === 0) {
      throw new Error("RPC URL is empty");
    }

    this.client = new rpc.RPCClient(this.rpcUrls[0]);
  }

  getActiveRpcUrl(): string {
    return this.rpcUrls[this.activeIndex] ?? this.config.rpcUrl;
  }

  private async runWithFailover<T>(operation: (client: any) => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < this.rpcUrls.length; attempt += 1) {
      const candidateIndex = (this.activeIndex + attempt) % this.rpcUrls.length;
      const candidateUrl = this.rpcUrls[candidateIndex];
      const candidateClient = candidateIndex === this.activeIndex
        ? this.client
        : new rpc.RPCClient(candidateUrl);

      try {
        const result = await operation(candidateClient);
        if (candidateIndex !== this.activeIndex) {
          this.activeIndex = candidateIndex;
          this.client = candidateClient;
        }
        return result;
      } catch (error) {
        lastError = error;
      }
    }

    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`Neo RPC request failed across endpoints (${this.rpcUrls.join(", ")}): ${reason}`);
  }

  async invokeRead(operation: string, args: ContractArgument[] = []): Promise<unknown[]> {
    const result = await this.runWithFailover<RawInvocationResult>((client) =>
      client.invokeFunction(this.config.contractHash, operation, args as never[]),
    );

    if (result.state !== "HALT") {
      throw new Error(`Neo invocation failed: ${result.exception ?? "unknown"}`);
    }

    return (result.stack ?? []).map((item: unknown) => decodeStackItem(item as never));
  }

  async getBlockCount(): Promise<number> {
    return this.runWithFailover((client) => client.getBlockCount());
  }

  async getBlock(blockIndex: number, verbose = true): Promise<unknown> {
    return this.runWithFailover((client) => client.getBlock(blockIndex, verbose));
  }

  async getApplicationLog(txid: string): Promise<unknown> {
    return this.runWithFailover((client) => client.getApplicationLog(txid));
  }

  async getContractState(scriptHash?: string): Promise<unknown> {
    return this.runWithFailover((client) => client.getContractState(scriptHash ?? this.config.contractHash));
  }
}
