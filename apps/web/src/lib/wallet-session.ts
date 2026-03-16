import type { NeoWalletNetwork } from "./neoline";

export function hasResolvedWalletNetwork(value: NeoWalletNetwork | null | undefined): value is NeoWalletNetwork {
  if (!value) {
    return false;
  }

  if (value.network !== "unknown") {
    return true;
  }

  if (typeof value.magic === "number") {
    return true;
  }

  return typeof value.rpcUrl === "string" && value.rpcUrl.trim().length > 0;
}

export function resolveWalletSessionSnapshot(input: {
  silent: boolean;
  fallbackAddress: string | null;
  fallbackNetwork: NeoWalletNetwork | null;
  providerAddress: string | null;
  providerNetwork: NeoWalletNetwork | null;
}): {
  address: string | null;
  network: NeoWalletNetwork | null;
} {
  const resolvedNetwork = hasResolvedWalletNetwork(input.providerNetwork) ? input.providerNetwork : null;
  const nextAddress = input.providerAddress || (input.silent ? input.fallbackAddress : null);
  const nextNetwork = nextAddress
    ? resolvedNetwork ?? (input.silent ? input.fallbackNetwork : null)
    : null;

  return {
    address: nextAddress,
    network: nextNetwork,
  };
}
