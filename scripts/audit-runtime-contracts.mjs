#!/usr/bin/env node

import { rpc } from "@cityofzion/neon-js";

const DEFAULT_TARGETS = [
  {
    name: "testnet",
    rpcUrl: process.env.RUNTIME_AUDIT_TESTNET_RPC_URL?.trim() || "https://testnet1.neo.coz.io:443",
    contractHash: process.env.RUNTIME_AUDIT_TESTNET_CONTRACT_HASH?.trim() || "0xbf7607d16a9ed9e7e9a8ebda24acbedcd6208b22",
  },
  {
    name: "mainnet",
    rpcUrl: process.env.RUNTIME_AUDIT_MAINNET_RPC_URL?.trim() || "https://mainnet1.neo.coz.io:443",
    contractHash: process.env.RUNTIME_AUDIT_MAINNET_CONTRACT_HASH?.trim() || "0xc1868eba3ce06ad93962378537f8a59f3cae1548",
  },
];

const REQUIRED_METHODS = [
  "createCollection/7",
  "createCollectionAndDeployFromTemplate/8",
  "getCollectionContract/1",
  "getCollectionContractTemplateDigest/0",
  "isCollectionOperator/2",
  "mintStandard/4",
  "mintWithClass/5",
  "listTokenForSale/2",
  "cancelTokenSale/1",
  "buyToken/1",
];

function normalizeHash(input) {
  const value = String(input ?? "").trim();
  return value.startsWith("0x") ? value.toLowerCase() : `0x${value.toLowerCase()}`;
}

function methodSignatures(manifest) {
  return new Set(
    (manifest?.abi?.methods ?? []).map((method) => `${method.name}/${Array.isArray(method.parameters) ? method.parameters.length : 0}`),
  );
}

async function fetchRemoteManifest(target) {
  const client = new rpc.RPCClient(target.rpcUrl);
  const state = await client.getContractState(target.contractHash);
  return state.manifest;
}

async function main() {
  const errors = [];

  for (const target of DEFAULT_TARGETS) {
    const remoteManifest = await fetchRemoteManifest(target);
    const remoteMethods = methodSignatures(remoteManifest);

    for (const method of REQUIRED_METHODS) {
      if (!remoteMethods.has(method)) {
        errors.push(`${target.name}: missing required runtime method ${method}`);
      }
    }

    const remoteStandards = new Set(remoteManifest.supportedstandards ?? []);
    for (const standard of ["NEP-11", "NEP-24"]) {
      if (!remoteStandards.has(standard)) {
        errors.push(`${target.name}: missing supported standard ${standard}`);
      }
    }

    console.log(`[runtime-audit] ${target.name} ${normalizeHash(target.contractHash)} ok`);
  }

  if (errors.length > 0) {
    console.error("[runtime-audit] failed");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("[runtime-audit] runtime contract interfaces match expected audited methods");
}

main().catch((error) => {
  console.error("[runtime-audit] failed");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
