import { experimental, sc, u, wallet, tx } from "@cityofzion/neon-js";
import type { WalletInvokeRequest } from "@platform/neo-sdk";
import type { NeoLineInvokeResult, NeoWalletNetworkName } from "./neoline";
import { getRuntimeNetworkConfig } from "./runtime-network";

export function getWifAccount(wif: string) {
  try {
    return new wallet.Account(wif);
  } catch {
    return null;
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

  const args = payload.args.map((a: any) => sc.ContractParam.fromJson(a));

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
