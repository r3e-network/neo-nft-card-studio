import { experimental, sc, u, wallet, tx } from "@cityofzion/neon-js";
import type { ContractArgument, WalletInvokeRequest } from "@platform/neo-sdk";
import type { NeoLineInvokeResult, NeoWalletNetworkName } from "./neoline";
import { getRuntimeNetworkConfig } from "./runtime-network";

export function getWifAccount(wif: string) {
  try {
    return new wallet.Account(wif);
  } catch {
    return null;
  }
}

function toContractParam(arg: ContractArgument): any {
  switch (arg.type) {
    case "ByteArray":
      return sc.ContractParam.byteArray(u.HexString.fromHex(String(arg.value ?? ""), true));
    case "String":
      return sc.ContractParam.string(String(arg.value ?? ""));
    case "Integer":
      return sc.ContractParam.integer(String(arg.value ?? "0"));
    case "Hash160":
      return sc.ContractParam.hash160(String(arg.value ?? ""));
    case "Hash256":
      return sc.ContractParam.hash256(String(arg.value ?? ""));
    case "Boolean":
      return sc.ContractParam.boolean(Boolean(arg.value));
    case "Array":
      return sc.ContractParam.array(...((Array.isArray(arg.value) ? arg.value : []) as ContractArgument[]).map(toContractParam));
    case "Any": {
      if (arg.value === null || arg.value === undefined) {
        return sc.ContractParam.any(null);
      }

      if (typeof arg.value === "string") {
        return sc.ContractParam.any(arg.value);
      }

      return sc.ContractParam.any(JSON.stringify(arg.value));
    }
    default:
      return sc.ContractParam.fromJson(arg as any);
  }
}

export async function invokeNeoWalletWithWif(
  wif: string,
  payload: WalletInvokeRequest
): Promise<NeoLineInvokeResult> {
  const account = getWifAccount(wif);
  if (!account) {
    throw new Error("Invalid WIF key");
  }

  const networkConfig = getRuntimeNetworkConfig();
  if (!networkConfig.rpcUrl || !networkConfig.magic) {
    throw new Error(`RPC URL or Magic not available for network ${networkConfig.network}`);
  }

  const scriptHashStr = payload.scriptHash.startsWith("0x") ? payload.scriptHash : `0x${payload.scriptHash}`;

  const config = {
    rpcAddress: networkConfig.rpcUrl,
    account: account,
    networkMagic: networkConfig.magic,
    blocksTillExpiry: 120,
    prioritisationFee: 0,
  };

  const args = payload.args.map((arg) => toContractParam(arg));

  const contract = new experimental.SmartContract(u.HexString.fromHex(scriptHashStr), config);

  // default to global scope for dev mode
  const signers = [
    new tx.Signer({
      account: account.scriptHash,
      scopes: "Global",
    })
  ];

  const txid = await contract.invoke(payload.operation, args, signers);
  return { txid };
}
