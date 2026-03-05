#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import { experimental, rpc, sc, tx, u, wallet } from "@cityofzion/neon-js";

const DEFAULT_RPC_URL = "http://seed2t5.neo.org:20332";
const DEFAULT_FACTORY_HASH = "0xbf7607d16a9ed9e7e9a8ebda24acbedcd6208b22";
const DEFAULT_PLATFORM_NEF_PATH = "contracts/multi-tenant-nft-platform/build/MultiTenantNftPlatform.nef";
const DEFAULT_PLATFORM_MANIFEST_PATH = "contracts/multi-tenant-nft-platform/build/MultiTenantNftPlatform.manifest.json";
const DEFAULT_TEMPLATE_NEF_PATH = "contracts/multi-tenant-nft-platform/build/MultiTenantNftTemplate.nef";
const DEFAULT_TEMPLATE_MANIFEST_PATH = "contracts/multi-tenant-nft-platform/build/MultiTenantNftTemplate.manifest.json";

function log(message) {
  console.log(`[update-factory] ${message}`);
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeHash(value) {
  if (!value || typeof value !== "string") {
    throw new Error(`Invalid hash: ${value}`);
  }

  return value.startsWith("0x") ? value.toLowerCase() : `0x${value.toLowerCase()}`;
}

function decodeStackItem(item) {
  if (!item || typeof item !== "object") {
    return item;
  }

  switch (item.type) {
    case "Integer":
      return item.value?.toString?.() ?? "0";
    case "Boolean":
      return item.value === true || item.value === "true";
    case "ByteString":
    case "Buffer": {
      try {
        const bytes = Buffer.from(item.value, "base64");
        const text = bytes.toString("utf8");
        if (/^[\x20-\x7e]*$/.test(text)) {
          return text;
        }
        return `0x${bytes.toString("hex")}`;
      } catch {
        return item.value;
      }
    }
    case "Array":
      return Array.isArray(item.value) ? item.value.map((entry) => decodeStackItem(entry)) : [];
    default:
      return item.value;
  }
}

function buildGlobalSignerForContract(contract) {
  const accountScriptHash = contract?.config?.account?.scriptHash;
  if (!accountScriptHash) {
    return undefined;
  }

  return [
    new tx.Signer({
      account: accountScriptHash,
      scopes: "Global",
    }),
  ];
}

async function waitForApplicationLog(client, txid, attempts = 90, intervalMs = 3000) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const appLog = await client.getApplicationLog(txid);
      if (appLog?.executions?.length) {
        return appLog;
      }
    } catch {
      // retry
    }
    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for application log: ${txid}`);
}

async function invokeAndWait(label, contract, rpcClient, operation, args) {
  const txid = await contract.invoke(operation, args, buildGlobalSignerForContract(contract));
  const appLog = await waitForApplicationLog(rpcClient, txid);
  const execution = appLog?.executions?.[0] ?? null;
  if (!execution || execution.vmstate !== "HALT") {
    throw new Error(
      `${label} failed. vmstate=${execution?.vmstate ?? "UNKNOWN"}, exception=${execution?.exception ?? "Unknown VM exception"}`,
    );
  }

  return { txid, appLog };
}

function splitManifestNameSegments(manifestText) {
  const match = /"name"\s*:\s*"([^"]*)"/.exec(manifestText);
  if (!match || typeof match.index !== "number") {
    throw new Error('Template manifest does not contain a top-level "name" field');
  }

  const templateNameBase = match[1];
  const quotedName = `"${templateNameBase}"`;
  const nameTokenIndex = manifestText.indexOf(quotedName, match.index);
  if (nameTokenIndex < 0) {
    throw new Error("Failed to locate manifest name token");
  }

  return {
    manifestPrefix: manifestText.slice(0, nameTokenIndex + 1),
    templateNameBase,
    manifestSuffix: manifestText.slice(nameTokenIndex + quotedName.length - 1),
  };
}

async function main() {
  const sellerWif = requireEnv("TESTNET_WIF");
  const rpcUrl = process.env.TESTNET_RPC_URL?.trim() || DEFAULT_RPC_URL;
  const factoryHash = normalizeHash(process.env.TESTNET_FACTORY_HASH?.trim() || DEFAULT_FACTORY_HASH);
  const platformNefPath = process.env.TESTNET_PLATFORM_NEF_PATH?.trim() || DEFAULT_PLATFORM_NEF_PATH;
  const platformManifestPath = process.env.TESTNET_PLATFORM_MANIFEST_PATH?.trim() || DEFAULT_PLATFORM_MANIFEST_PATH;
  const templateNefPath = process.env.TESTNET_TEMPLATE_NEF_PATH?.trim() || DEFAULT_TEMPLATE_NEF_PATH;
  const templateManifestPath = process.env.TESTNET_TEMPLATE_MANIFEST_PATH?.trim() || DEFAULT_TEMPLATE_MANIFEST_PATH;

  const [platformNef, platformManifest, templateNef, templateManifest] = await Promise.all([
    fs.readFile(path.resolve(platformNefPath)),
    fs.readFile(path.resolve(platformManifestPath), "utf8"),
    fs.readFile(path.resolve(templateNefPath)),
    fs.readFile(path.resolve(templateManifestPath), "utf8"),
  ]);

  const seller = new wallet.Account(sellerWif);
  const rpcClient = new rpc.RPCClient(rpcUrl);
  const version = await rpcClient.getVersion();
  const networkMagic = version?.protocol?.network;
  if (!networkMagic) {
    throw new Error("Failed to detect network magic from RPC");
  }

  const config = {
    rpcAddress: rpcUrl,
    account: seller,
    networkMagic,
    blocksTillExpiry: 120,
    prioritisationFee: 0,
  };

  const factory = new experimental.SmartContract(u.HexString.fromHex(factoryHash), config);
  const segments = splitManifestNameSegments(templateManifest);
  const contractState = await rpcClient.getContractState(factoryHash);
  const currentContractName = contractState?.manifest?.name?.toString?.() ?? "";
  if (!currentContractName) {
    throw new Error("Failed to read current factory manifest name from chain");
  }

  const platformManifestJson = JSON.parse(platformManifest);
  platformManifestJson.name = currentContractName;
  const platformManifestForUpdate = JSON.stringify(platformManifestJson);
  const summary = {
    rpcUrl,
    networkMagic,
    factoryHash,
    currentContractName,
    owner: seller.address,
    txids: {},
  };

  log(`rpc: ${rpcUrl}`);
  log(`factory: ${factoryHash}`);
  log(`owner: ${seller.address}`);

  log("update platform contract (same script hash)");
  const updateResult = await invokeAndWait(
    "update",
    factory,
    rpcClient,
    "update",
    [
      sc.ContractParam.byteArray(u.HexString.fromHex(platformNef.toString("hex"), true)),
      sc.ContractParam.string(platformManifestForUpdate),
      sc.ContractParam.any(null),
    ],
  );
  summary.txids.update = updateResult.txid;

  log("wait 6s after update");
  await sleep(6000);

  log("setCollectionContractTemplate");
  const setTemplateResult = await invokeAndWait(
    "setCollectionContractTemplate",
    factory,
    rpcClient,
    "setCollectionContractTemplate",
    [
      sc.ContractParam.byteArray(u.HexString.fromHex(templateNef.toString("hex"), true)),
      sc.ContractParam.string(templateManifest),
    ],
  );
  summary.txids.setCollectionContractTemplate = setTemplateResult.txid;

  log("setCollectionContractTemplateNameSegments");
  const setSegmentsResult = await invokeAndWait(
    "setCollectionContractTemplateNameSegments",
    factory,
    rpcClient,
    "setCollectionContractTemplateNameSegments",
    [
      sc.ContractParam.string(segments.manifestPrefix),
      sc.ContractParam.string(segments.templateNameBase),
      sc.ContractParam.string(segments.manifestSuffix),
    ],
  );
  summary.txids.setCollectionContractTemplateNameSegments = setSegmentsResult.txid;

  const [hasTemplateResult, hasSegmentsResult] = await Promise.all([
    rpcClient.invokeFunction(factoryHash, "hasCollectionContractTemplate", []),
    rpcClient.invokeFunction(factoryHash, "hasCollectionContractTemplateNameSegments", []),
  ]);

  summary.hasTemplate = decodeStackItem(hasTemplateResult?.stack?.[0]) === true;
  summary.hasTemplateNameSegments = decodeStackItem(hasSegmentsResult?.stack?.[0]) === true;

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("[update-factory] failed");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
