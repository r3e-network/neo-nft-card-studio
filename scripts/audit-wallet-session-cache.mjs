#!/usr/bin/env node

import assert from "node:assert/strict";

import { resolveWalletSessionSnapshot } from "../apps/web/src/lib/wallet-session.ts";

const mainnetNetwork = {
  network: "mainnet",
  magic: 860833102,
  rpcUrl: "https://mainnet1.neo.coz.io:443",
  raw: null,
};

const testnetNetwork = {
  network: "testnet",
  magic: 894710606,
  rpcUrl: "https://testnet1.neo.coz.io:443",
  raw: null,
};

const fallbackAddress = "NR3E4D8NUXh3zhbf5ZkAp3rTxWbQqNih32";

const staleCacheResolved = resolveWalletSessionSnapshot({
  silent: true,
  fallbackAddress,
  fallbackNetwork: mainnetNetwork,
  providerAddress: null,
  providerNetwork: testnetNetwork,
});

assert.equal(staleCacheResolved.address, fallbackAddress, "silent refresh should preserve the connected address");
assert.deepEqual(
  staleCacheResolved.network,
  testnetNetwork,
  "silent refresh should prefer the provider network over stale cached mainnet state",
);

const unknownProviderNetworkFallsBack = resolveWalletSessionSnapshot({
  silent: true,
  fallbackAddress,
  fallbackNetwork: mainnetNetwork,
  providerAddress: null,
  providerNetwork: { network: "unknown", magic: null },
});

assert.equal(
  unknownProviderNetworkFallsBack.network?.network,
  "mainnet",
  "unknown provider network should keep the last known cached network",
);

const interactiveMissingAccountClearsSession = resolveWalletSessionSnapshot({
  silent: false,
  fallbackAddress,
  fallbackNetwork: mainnetNetwork,
  providerAddress: null,
  providerNetwork: testnetNetwork,
});

assert.equal(interactiveMissingAccountClearsSession.address, null, "interactive sync should not preserve a disconnected address");
assert.equal(interactiveMissingAccountClearsSession.network, null, "interactive sync should clear network when no account is available");

console.log("[wallet-session-audit] stale wallet-network cache regression checks passed");
