import { rpc } from "@cityofzion/neon-js";

import { decodeStackItem } from "./stack";
import type { ContractArgument, RpcConfig } from "./types";

export class NeoRpcService {
  private readonly client: any;

  constructor(private readonly config: RpcConfig) {
    this.client = new rpc.RPCClient(config.rpcUrl);
  }

  async invokeRead(operation: string, args: ContractArgument[] = []): Promise<unknown[]> {
    const result = await this.client.invokeFunction(this.config.contractHash, operation, args as never[]);

    if (result.state !== "HALT") {
      throw new Error(`Neo invocation failed: ${result.exception ?? "unknown"}`);
    }

    return (result.stack ?? []).map((item: unknown) => decodeStackItem(item as never));
  }

  async getBlockCount(): Promise<number> {
    return this.client.getBlockCount();
  }

  async getBlock(blockIndex: number, verbose = true): Promise<unknown> {
    return this.client.getBlock(blockIndex, verbose);
  }

  async getApplicationLog(txid: string): Promise<unknown> {
    return this.client.getApplicationLog(txid);
  }

  async getContractState(scriptHash?: string): Promise<unknown> {
    return this.client.getContractState(scriptHash ?? this.config.contractHash);
  }
}
