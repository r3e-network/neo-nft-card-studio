#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import { experimental, rpc, sc, tx, u, wallet } from "@cityofzion/neon-js";

const DEFAULT_RPC_URL = "http://seed2t5.neo.org:20332";
const DEFAULT_RPC_FAILOVER_URLS = ["https://n3seed1.ngd.network:20332"];
const PLATFORM_CONTRACT_NEF =
  process.env.TESTNET_PLATFORM_NEF_PATH?.trim() ||
  "contracts/multi-tenant-nft-platform/build/MultiTenantNftPlatform.nef";
const PLATFORM_CONTRACT_MANIFEST =
  process.env.TESTNET_PLATFORM_MANIFEST_PATH?.trim() ||
  "contracts/multi-tenant-nft-platform/build/MultiTenantNftPlatform.manifest.json";
const TEMPLATE_CONTRACT_NEF =
  process.env.TESTNET_TEMPLATE_NEF_PATH?.trim() ||
  "contracts/multi-tenant-nft-platform/build/MultiTenantNftTemplate.nef";
const TEMPLATE_CONTRACT_MANIFEST =
  process.env.TESTNET_TEMPLATE_MANIFEST_PATH?.trim() ||
  "contracts/multi-tenant-nft-platform/build/MultiTenantNftTemplate.deploy.manifest.json";

const DEDICATED_DEPLOY_FEE = 10_00000000n;
const DEFAULT_SALE_PRICE = 10_000000; // 0.1 GAS
const DEFAULT_WITHDRAW_AMOUNT = 1_00000000; // 1 GAS

function log(message) {
  console.log(`[lifecycle] ${message}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value.trim();
}

function readNonNegativeIntegerEnv(name, defaultValue) {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) {
    return defaultValue;
  }

  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid env: ${name} must be a non-negative integer`);
  }
  return parsed;
}

function readPositiveIntegerEnv(name, defaultValue) {
  const value = readNonNegativeIntegerEnv(name, defaultValue);
  if (value <= 0) {
    throw new Error(`Invalid env: ${name} must be greater than zero`);
  }
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function utf8ToHex(input) {
  return Buffer.from(input, "utf8").toString("hex");
}

function idToByteArrayHex(input) {
  const value = input.trim();
  if (/^0x[0-9a-fA-F]+$/.test(value)) {
    const normalized = value.slice(2);
    if (normalized.length % 2 === 0) {
      return normalized;
    }
  }

  if (/^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0 && !/^[0-9]+$/.test(value)) {
    return value;
  }

  return utf8ToHex(value);
}

function byteArrayParamFromHex(hexValue) {
  return sc.ContractParam.byteArray(u.HexString.fromHex(hexValue, true));
}

function normalizeHash(input) {
  if (!input || typeof input !== "string") {
    throw new Error(`Invalid hash value: ${input}`);
  }
  return input.startsWith("0x") ? input.toLowerCase() : `0x${input.toLowerCase()}`;
}

function isZeroHash(value) {
  if (!value || typeof value !== "string") {
    return false;
  }
  return normalizeHash(value) === `0x${"0".repeat(40)}`;
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
        const asText = bytes.toString("utf8");
        if (/^[\x20-\x7e]*$/.test(asText)) {
          return asText;
        }
        return `0x${bytes.toString("hex")}`;
      } catch {
        return item.value;
      }
    }
    case "Hash160":
    case "Hash256":
      return item.value;
    case "Array":
      return Array.isArray(item.value) ? item.value.map((entry) => decodeStackItem(entry)) : [];
    case "Map":
      if (!Array.isArray(item.value)) {
        return {};
      }
      return Object.fromEntries(
        item.value.map((entry) => [decodeStackItem(entry.key), decodeStackItem(entry.value)]),
      );
    case "Null":
      return null;
    default:
      return item.value;
  }
}

function decodeTopStackItem(invokeResult, label) {
  const stack = Array.isArray(invokeResult?.stack) ? invokeResult.stack : [];
  if (stack.length === 0) {
    throw new Error(`${label}: invoke result stack is empty`);
  }
  return decodeStackItem(stack[0]);
}

function toBigInt(value, label) {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${label}: expected finite number, got ${value}`);
    }
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string") {
    try {
      return value.startsWith("0x") ? BigInt(value) : BigInt(value);
    } catch {
      throw new Error(`${label}: expected integer-like string, got '${value}'`);
    }
  }
  throw new Error(`${label}: cannot convert value to bigint (${String(value)})`);
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
    throw new Error("Failed to locate manifest name value token");
  }

  const manifestPrefix = manifestText.slice(0, nameTokenIndex + 1);
  const manifestSuffix = manifestText.slice(nameTokenIndex + quotedName.length - 1);
  return {
    manifestPrefix,
    templateNameBase,
    manifestSuffix,
  };
}

function buildScopedTemplateManifestName(baseName, collectionId) {
  const suffix = `-col-${collectionId}`;
  const maxManifestNameLength = 200;
  if (baseName.length + suffix.length <= maxManifestNameLength) {
    return `${baseName}${suffix}`;
  }

  const keepLength = maxManifestNameLength - suffix.length;
  if (keepLength <= 0) {
    throw new Error("Collection id suffix is too long for manifest name");
  }
  return `${baseName.slice(0, keepLength)}${suffix}`;
}

async function waitForApplicationLog(client, txid, options = {}) {
  const attempts = options.attempts ?? 90;
  const intervalMs = options.intervalMs ?? 3000;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const appLog = await client.getApplicationLog(txid);
      if (appLog && Array.isArray(appLog.executions) && appLog.executions.length > 0) {
        return appLog;
      }
    } catch {
      // retry
    }
    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for application log: ${txid}`);
}

async function waitForContractState(client, hash, options = {}) {
  const attempts = options.attempts ?? 45;
  const intervalMs = options.intervalMs ?? 3000;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const state = await client.getContractState(hash);
      if (state?.manifest?.name) {
        return state;
      }
    } catch {
      // retry
    }
    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for contract state: ${hash}`);
}

function findNotification(appLog, contractHash, eventName) {
  const normalized = normalizeHash(contractHash);
  const executions = Array.isArray(appLog?.executions) ? appLog.executions : [];

  for (const execution of executions) {
    const notifications = Array.isArray(execution?.notifications) ? execution.notifications : [];
    for (const notification of notifications) {
      const notifHash = normalizeHash(notification?.contract ?? "");
      if (notifHash !== normalized) {
        continue;
      }
      if ((notification?.eventname ?? "") !== eventName) {
        continue;
      }
      return notification;
    }
  }

  return null;
}

function decodeContractHashFromDeployExecution(execution) {
  const stateRoot = execution?.stack?.[0];
  if (!stateRoot || stateRoot.type !== "Array" || !Array.isArray(stateRoot.value) || stateRoot.value.length < 3) {
    throw new Error("Unexpected deploy execution stack shape");
  }

  const hashItem = stateRoot.value[2];
  if (!hashItem || hashItem.type !== "ByteString") {
    throw new Error("Missing contract hash ByteString in deploy execution stack");
  }

  const bigEndianHash = Buffer.from(hashItem.value, "base64").toString("hex");
  return normalizeHash(u.reverseHex(bigEndianHash));
}

async function resolveContractHashFromStackValue(client, input) {
  if (!input || typeof input !== "string") {
    throw new Error(`Invalid contract hash value: ${input}`);
  }

  const normalized = normalizeHash(input);
  const hex = normalized.slice(2);
  const candidates = [normalized];
  if (hex.length === 40) {
    candidates.push(normalizeHash(u.reverseHex(hex)));
  }

  for (const candidate of candidates) {
    try {
      await client.getContractState(candidate);
      return candidate;
    } catch {
      // try next
    }
  }

  throw new Error(`Unable to resolve deployed contract hash from value: ${input}`);
}

function buildGlobalSignerForContract(smartContract) {
  const accountScriptHash = smartContract?.config?.account?.scriptHash;
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

async function invokeAndWait(label, smartContract, rpcClient, contractHash, operation, params = [], signers) {
  log(`${label}: invoke ${operation}`);
  const txid = await smartContract.invoke(operation, params, signers ?? buildGlobalSignerForContract(smartContract));
  log(`${label}: txid ${txid}`);
  const appLog = await waitForApplicationLog(rpcClient, txid);
  const execution = Array.isArray(appLog.executions) && appLog.executions.length > 0 ? appLog.executions[0] : null;
  if (!execution || execution.vmstate !== "HALT") {
    const exception = execution?.exception ?? "Unknown VM exception";
    throw new Error(
      `${label} failed. contract=${contractHash} operation=${operation} vmstate=${execution?.vmstate ?? "UNKNOWN"} exception=${exception}`,
    );
  }

  return { txid, appLog, execution };
}

async function assertFaultInvoke(label, rpcClient, contractHash, operation, params, expectedFragments) {
  const result = await rpcClient.invokeFunction(contractHash, operation, params);
  if (result?.state !== "FAULT") {
    throw new Error(`${label}: expected FAULT but got ${result?.state ?? "UNKNOWN"}`);
  }

  const exception = result?.exception?.toString?.() ?? "";
  const fragments = Array.isArray(expectedFragments)
    ? expectedFragments
    : expectedFragments
      ? [expectedFragments]
      : [];

  if (fragments.length > 0) {
    const matched = fragments.some((fragment) => exception.includes(fragment));
    if (!matched) {
      throw new Error(
        `${label}: exception mismatch, expected one of [${fragments.join(" | ")}], got '${exception || "<empty>"}'`,
      );
    }
  }

  log(`${label}: expected fault '${exception}'`);
  return exception;
}

function extractCollectionId(appLog, contractHash, label) {
  const notification = findNotification(appLog, contractHash, "CollectionUpserted");
  if (!notification || !notification.state || !Array.isArray(notification.state.value) || notification.state.value.length === 0) {
    throw new Error(`${label}: missing CollectionUpserted notification`);
  }
  const value = decodeStackItem(notification.state.value[0]);
  if (!value || typeof value !== "string") {
    throw new Error(`${label}: invalid collection id from CollectionUpserted: ${value}`);
  }
  return value;
}

function extractTokenId(appLog, contractHash, label) {
  const notification = findNotification(appLog, contractHash, "TokenUpserted");
  if (!notification || !notification.state || !Array.isArray(notification.state.value) || notification.state.value.length === 0) {
    throw new Error(`${label}: missing TokenUpserted notification`);
  }
  const value = decodeStackItem(notification.state.value[0]);
  if (!value || typeof value !== "string") {
    throw new Error(`${label}: invalid token id from TokenUpserted: ${value}`);
  }
  return value;
}

async function extractDeployedCollectionHash(appLog, platformHash, rpcClient, label) {
  const notification = findNotification(appLog, platformHash, "CollectionContractDeployed");
  if (!notification?.state?.value?.[2]) {
    throw new Error(`${label}: missing CollectionContractDeployed notification`);
  }

  const rawHash = decodeStackItem(notification.state.value[2]);
  return resolveContractHashFromStackValue(rpcClient, rawHash);
}

function tokenParam(tokenId) {
  return byteArrayParamFromHex(idToByteArrayHex(tokenId));
}

function collectionParam(collectionId) {
  return byteArrayParamFromHex(idToByteArrayHex(collectionId));
}

function resolveRpcCandidates() {
  const primaryFromEnv = process.env.TESTNET_RPC_URL
    ?.split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const failoverFromEnv = process.env.TESTNET_RPC_FALLBACK_URLS
    ?.split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const ordered = [
    DEFAULT_RPC_URL,
    ...(primaryFromEnv ?? []),
    ...(failoverFromEnv && failoverFromEnv.length > 0 ? failoverFromEnv : DEFAULT_RPC_FAILOVER_URLS),
  ];

  const deduped = [];
  const seen = new Set();
  for (const entry of ordered) {
    const key = entry.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}

function isTransientRpcError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();
  return (
    lower.includes("econnreset") ||
    lower.includes("etimedout") ||
    lower.includes("eai_again") ||
    lower.includes("socket hang up") ||
    lower.includes("network error") ||
    lower.includes("fetch failed") ||
    lower.includes("gateway timeout") ||
    lower.includes("bad gateway") ||
    lower.includes("service unavailable") ||
    lower.includes("temporarily unavailable")
  );
}

async function runLifecycleWithRpc(rpcUrl) {
  const sellerWif = requireEnv("TESTNET_WIF");
  const buyerWif = requireEnv("TESTNET_BUYER_WIF");
  const salePrice = readPositiveIntegerEnv("TESTNET_SALE_PRICE", DEFAULT_SALE_PRICE);
  const withdrawAmount = readPositiveIntegerEnv("TESTNET_WITHDRAW_AMOUNT", DEFAULT_WITHDRAW_AMOUNT);

  const sellerAccount = new wallet.Account(sellerWif);
  const buyerAccount = new wallet.Account(buyerWif);
  if (sellerAccount.address === buyerAccount.address) {
    throw new Error("TESTNET_WIF and TESTNET_BUYER_WIF must be different accounts");
  }

  log(`seller: ${sellerAccount.address}`);
  log(`buyer: ${buyerAccount.address}`);
  log(`rpc: ${rpcUrl}`);

  const rpcClient = new rpc.RPCClient(rpcUrl);
  const version = await rpcClient.getVersion();
  const networkMagic = version?.protocol?.network;
  if (!networkMagic) {
    throw new Error("Failed to detect network magic from RPC getVersion");
  }

  const sellerConfig = {
    rpcAddress: rpcUrl,
    account: sellerAccount,
    networkMagic,
    blocksTillExpiry: 120,
    prioritisationFee: 0,
  };
  const buyerConfig = {
    rpcAddress: rpcUrl,
    account: buyerAccount,
    networkMagic,
    blocksTillExpiry: 120,
    prioritisationFee: 0,
  };

  const [platformNefBytes, platformManifestText, templateNefBytes, templateManifestTextRaw] = await Promise.all([
    fs.readFile(path.resolve(PLATFORM_CONTRACT_NEF)),
    fs.readFile(path.resolve(PLATFORM_CONTRACT_MANIFEST), "utf8"),
    fs.readFile(path.resolve(TEMPLATE_CONTRACT_NEF)),
    fs.readFile(path.resolve(TEMPLATE_CONTRACT_MANIFEST), "utf8"),
  ]);

  const platformNef = sc.NEF.fromBuffer(platformNefBytes);
  const platformManifestJson = JSON.parse(platformManifestText);
  const templateManifestJson = JSON.parse(templateManifestTextRaw);

  const runSuffix = Date.now().toString().slice(-8);
  const templateNameSuffix = process.env.TESTNET_TEMPLATE_NAME_SUFFIX?.trim() || runSuffix;
  const requestedDeployName =
    process.env.TESTNET_DEPLOY_NAME?.trim() || `${platformManifestJson.name}Lifecycle${runSuffix}`;
  const dedicatedExtraData = JSON.stringify({ source: "testnet-full-lifecycle", runSuffix, mode: "dedicated" });

  function buildDeployArtifacts(name) {
    const templateNameBase = (templateManifestJson.name || "MultiTenantNftTemplate").slice(0, 220);
    const scopedTemplateManifestJson = {
      ...templateManifestJson,
      name: `${templateNameBase}-${templateNameSuffix}`,
    };
    const deployManifestJson = {
      ...platformManifestJson,
      name,
    };

    return {
      deployName: name,
      templateManifestText: JSON.stringify(scopedTemplateManifestJson),
      templateNameBase,
      manifest: sc.ContractManifest.fromJson(deployManifestJson),
      predictedHash: normalizeHash(
        experimental.getContractHash(sellerAccount.scriptHash, platformNef.checksum, name),
      ),
    };
  }

  const summary = {
    rpcUrl,
    networkMagic,
    sellerAddress: sellerAccount.address,
    buyerAddress: buyerAccount.address,
    salePrice,
    withdrawAmount,
    deployName: "",
    predictedPlatformHash: "",
    platformHash: "",
    txids: {},
    shared: {},
    dedicated: {},
    template: {},
    deploymentFees: {},
  };

  function recordTx(key, txid) {
    summary.txids[key] = txid;
  }

  let deployArtifacts = buildDeployArtifacts(requestedDeployName);
  summary.deployName = deployArtifacts.deployName;
  summary.predictedPlatformHash = deployArtifacts.predictedHash;

  log(`deploy platform: ${deployArtifacts.deployName}`);
  let deployTxid;
  for (;;) {
    try {
      deployTxid = await experimental.deployContract(platformNef, deployArtifacts.manifest, sellerConfig);
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isNameCollision = message.toLowerCase().includes("contract already exists");
      if (!isNameCollision || deployArtifacts.deployName !== requestedDeployName) {
        throw error;
      }

      const fallbackName = `${requestedDeployName}-${Date.now().toString().slice(-6)}`;
      log(`deploy name collision, retry with ${fallbackName}`);
      deployArtifacts = buildDeployArtifacts(fallbackName);
      summary.deployName = deployArtifacts.deployName;
      summary.predictedPlatformHash = deployArtifacts.predictedHash;
    }
  }

  recordTx("deployPlatform", deployTxid);
  const deployLog = await waitForApplicationLog(rpcClient, deployTxid);
  const deployExecution = Array.isArray(deployLog.executions) && deployLog.executions.length > 0 ? deployLog.executions[0] : null;
  if (!deployExecution || deployExecution.vmstate !== "HALT") {
    throw new Error(
      `Platform deploy failed. txid=${deployTxid}, vmstate=${deployExecution?.vmstate ?? "UNKNOWN"}, exception=${deployExecution?.exception ?? "Unknown VM exception"}`,
    );
  }
  summary.platformHash = decodeContractHashFromDeployExecution(deployExecution);
  await waitForContractState(rpcClient, summary.platformHash);
  log(`platform hash: ${summary.platformHash}`);

  const platformSeller = new experimental.SmartContract(u.HexString.fromHex(summary.platformHash), sellerConfig);
  const platformBuyer = new experimental.SmartContract(u.HexString.fromHex(summary.platformHash), buyerConfig);

  const manifestNameSegments = splitManifestNameSegments(deployArtifacts.templateManifestText);

  const setTemplateResult = await invokeAndWait(
    "template:setCollectionContractTemplate",
    platformSeller,
    rpcClient,
    summary.platformHash,
    "setCollectionContractTemplate",
    [
      byteArrayParamFromHex(templateNefBytes.toString("hex")),
      sc.ContractParam.string(deployArtifacts.templateManifestText),
    ],
  );
  recordTx("setTemplate", setTemplateResult.txid);

  const setTemplateNameSegmentsResult = await invokeAndWait(
    "template:setCollectionContractTemplateNameSegments",
    platformSeller,
    rpcClient,
    summary.platformHash,
    "setCollectionContractTemplateNameSegments",
    [
      sc.ContractParam.string(manifestNameSegments.manifestPrefix),
      sc.ContractParam.string(manifestNameSegments.templateNameBase),
      sc.ContractParam.string(manifestNameSegments.manifestSuffix),
    ],
  );
  recordTx("setTemplateNameSegments", setTemplateNameSegmentsResult.txid);

  const hasTemplate = decodeTopStackItem(
    await platformSeller.testInvoke("hasCollectionContractTemplate", []),
    "template:hasCollectionContractTemplate",
  );
  const hasTemplateNameSegments = decodeTopStackItem(
    await platformSeller.testInvoke("hasCollectionContractTemplateNameSegments", []),
    "template:hasCollectionContractTemplateNameSegments",
  );
  const templateDigest = decodeTopStackItem(
    await platformSeller.testInvoke("getCollectionContractTemplateDigest", []),
    "template:getCollectionContractTemplateDigest",
  );
  assert(hasTemplate === true, "Template should be configured");
  assert(hasTemplateNameSegments === true, "Template name segments should be configured");
  assert(Array.isArray(templateDigest) && templateDigest[0] === true, "Template digest should be available");
  summary.template.initialDigest = templateDigest;

  log("shared mode lifecycle start");
  const sharedSuffix = runSuffix.slice(-6);
  const sharedCreateResult = await invokeAndWait(
    "shared:createCollection",
    platformSeller,
    rpcClient,
    summary.platformHash,
    "createCollection",
    [
      sc.ContractParam.string(`Shared Lifecycle ${sharedSuffix}`),
      sc.ContractParam.string(`SH${sharedSuffix.slice(-2)}`),
      sc.ContractParam.string("Shared mode lifecycle test"),
      sc.ContractParam.string(`https://example.com/lifecycle/shared/${sharedSuffix}/`),
      sc.ContractParam.integer(0),
      sc.ContractParam.integer(500),
      sc.ContractParam.boolean(true),
    ],
  );
  recordTx("sharedCreateCollection", sharedCreateResult.txid);
  const sharedCollectionId = extractCollectionId(sharedCreateResult.appLog, summary.platformHash, "shared:createCollection");
  summary.shared.collectionId = sharedCollectionId;

  const sharedCollectionContractRead = decodeTopStackItem(
    await platformSeller.testInvoke("getCollectionContract", [collectionParam(sharedCollectionId)]),
    "shared:getCollectionContract",
  );
  assert(isZeroHash(sharedCollectionContractRead), "Shared collection should not have dedicated contract hash");

  const sharedUpdateResult = await invokeAndWait(
    "shared:updateCollection",
    platformSeller,
    rpcClient,
    summary.platformHash,
    "updateCollection",
    [
      collectionParam(sharedCollectionId),
      sc.ContractParam.string("Shared mode lifecycle test (updated)"),
      sc.ContractParam.string(`https://example.com/lifecycle/shared/${sharedSuffix}/updated/`),
      sc.ContractParam.integer(450),
      sc.ContractParam.boolean(true),
      sc.ContractParam.boolean(false),
    ],
  );
  recordTx("sharedUpdateCollection", sharedUpdateResult.txid);

  const sharedSetOperatorOnResult = await invokeAndWait(
    "shared:setCollectionOperator:on",
    platformSeller,
    rpcClient,
    summary.platformHash,
    "setCollectionOperator",
    [
      collectionParam(sharedCollectionId),
      sc.ContractParam.hash160(buyerAccount.address),
      sc.ContractParam.boolean(true),
    ],
  );
  recordTx("sharedSetOperatorOn", sharedSetOperatorOnResult.txid);

  const sharedOperatorEnabled = decodeTopStackItem(
    await platformSeller.testInvoke("isCollectionOperator", [
      collectionParam(sharedCollectionId),
      sc.ContractParam.hash160(buyerAccount.address),
    ]),
    "shared:isCollectionOperator:on",
  );
  assert(sharedOperatorEnabled === true, "Shared collection operator should be enabled");

  const sharedMintByOperatorResult = await invokeAndWait(
    "shared:mint:operator",
    platformBuyer,
    rpcClient,
    summary.platformHash,
    "mint",
    [
      collectionParam(sharedCollectionId),
      sc.ContractParam.hash160(buyerAccount.address),
      sc.ContractParam.string(`https://example.com/lifecycle/shared/${sharedSuffix}/operator.json`),
      sc.ContractParam.string('{"name":"Shared Operator Mint"}'),
    ],
  );
  recordTx("sharedMintByOperator", sharedMintByOperatorResult.txid);
  summary.shared.operatorMintTokenId = extractTokenId(
    sharedMintByOperatorResult.appLog,
    summary.platformHash,
    "shared:mint:operator",
  );

  const sharedSetOperatorOffResult = await invokeAndWait(
    "shared:setCollectionOperator:off",
    platformSeller,
    rpcClient,
    summary.platformHash,
    "setCollectionOperator",
    [
      collectionParam(sharedCollectionId),
      sc.ContractParam.hash160(buyerAccount.address),
      sc.ContractParam.boolean(false),
    ],
  );
  recordTx("sharedSetOperatorOff", sharedSetOperatorOffResult.txid);

  const sharedOperatorDisabled = decodeTopStackItem(
    await platformSeller.testInvoke("isCollectionOperator", [
      collectionParam(sharedCollectionId),
      sc.ContractParam.hash160(buyerAccount.address),
    ]),
    "shared:isCollectionOperator:off",
  );
  assert(sharedOperatorDisabled === false, "Shared collection operator should be disabled");

  const sharedMintSaleResult = await invokeAndWait(
    "shared:mint:saleToken",
    platformSeller,
    rpcClient,
    summary.platformHash,
    "mint",
    [
      collectionParam(sharedCollectionId),
      sc.ContractParam.hash160(sellerAccount.address),
      sc.ContractParam.string(`https://example.com/lifecycle/shared/${sharedSuffix}/sale.json`),
      sc.ContractParam.string('{"name":"Shared Sale Token"}'),
    ],
  );
  recordTx("sharedMintSaleToken", sharedMintSaleResult.txid);
  const sharedSaleTokenId = extractTokenId(sharedMintSaleResult.appLog, summary.platformHash, "shared:mint:saleToken");
  summary.shared.saleTokenId = sharedSaleTokenId;

  const sharedRoyaltiesResult = await platformSeller.testInvoke("getRoyalties", [tokenParam(sharedSaleTokenId)]);
  const sharedRoyaltiesStack = Array.isArray(sharedRoyaltiesResult?.stack) ? sharedRoyaltiesResult.stack[0] : null;
  assert(
    sharedRoyaltiesStack?.type === "ByteString" &&
      typeof sharedRoyaltiesStack.value === "string" &&
      sharedRoyaltiesStack.value.length > 0,
    "Shared getRoyalties should return non-empty ByteString payload",
  );

  const sharedRoyaltyInfo = decodeTopStackItem(
    await platformSeller.testInvoke("royaltyInfo", [
      tokenParam(sharedSaleTokenId),
      sc.ContractParam.hash160(sellerAccount.address),
      sc.ContractParam.integer(salePrice),
    ]),
    "shared:royaltyInfo",
  );
  assert(Array.isArray(sharedRoyaltyInfo) && sharedRoyaltyInfo.length > 0, "Shared royaltyInfo should return non-empty array");

  const sharedProperties = decodeTopStackItem(
    await platformSeller.testInvoke("properties", [tokenParam(sharedSaleTokenId)]),
    "shared:properties",
  );
  assert(sharedProperties && typeof sharedProperties === "object", "Shared properties should return a map");

  const sharedTokenUri = decodeTopStackItem(
    await platformSeller.testInvoke("tokenURI", [tokenParam(sharedSaleTokenId)]),
    "shared:tokenURI",
  );
  assert(typeof sharedTokenUri === "string" && sharedTokenUri.includes("shared"), "Shared tokenURI should resolve");

  const sharedListFirstResult = await invokeAndWait(
    "shared:listTokenForSale:first",
    platformSeller,
    rpcClient,
    summary.platformHash,
    "listTokenForSale",
    [tokenParam(sharedSaleTokenId), sc.ContractParam.integer(salePrice)],
  );
  recordTx("sharedListTokenFirst", sharedListFirstResult.txid);
  const sharedListedAfterFirstList = decodeTopStackItem(
    await platformSeller.testInvoke("isTokenListed", [tokenParam(sharedSaleTokenId)]),
    "shared:isTokenListed:first",
  );
  assert(sharedListedAfterFirstList === true, "Shared token should be listed after first listing");

  const sharedCancelResult = await invokeAndWait(
    "shared:cancelTokenSale",
    platformSeller,
    rpcClient,
    summary.platformHash,
    "cancelTokenSale",
    [tokenParam(sharedSaleTokenId)],
  );
  recordTx("sharedCancelTokenSale", sharedCancelResult.txid);
  const sharedListedAfterCancel = decodeTopStackItem(
    await platformSeller.testInvoke("isTokenListed", [tokenParam(sharedSaleTokenId)]),
    "shared:isTokenListed:afterCancel",
  );
  assert(sharedListedAfterCancel === false, "Shared token listing should be cleared after cancel");

  const sharedListSecondResult = await invokeAndWait(
    "shared:listTokenForSale:second",
    platformSeller,
    rpcClient,
    summary.platformHash,
    "listTokenForSale",
    [tokenParam(sharedSaleTokenId), sc.ContractParam.integer(salePrice)],
  );
  recordTx("sharedListTokenSecond", sharedListSecondResult.txid);

  const sharedBuyResult = await invokeAndWait(
    "shared:buyToken",
    platformBuyer,
    rpcClient,
    summary.platformHash,
    "buyToken",
    [tokenParam(sharedSaleTokenId)],
  );
  recordTx("sharedBuyToken", sharedBuyResult.txid);
  const sharedListedAfterBuy = decodeTopStackItem(
    await platformSeller.testInvoke("isTokenListed", [tokenParam(sharedSaleTokenId)]),
    "shared:isTokenListed:afterBuy",
  );
  assert(sharedListedAfterBuy === false, "Shared token listing should be cleared after buy");

  const sharedTransferResult = await invokeAndWait(
    "shared:transfer",
    platformBuyer,
    rpcClient,
    summary.platformHash,
    "transfer",
    [
      sc.ContractParam.hash160(sellerAccount.address),
      tokenParam(sharedSaleTokenId),
      sc.ContractParam.any(null),
    ],
  );
  recordTx("sharedTransfer", sharedTransferResult.txid);

  const sharedBurnResult = await invokeAndWait(
    "shared:burn",
    platformSeller,
    rpcClient,
    summary.platformHash,
    "burn",
    [tokenParam(sharedSaleTokenId)],
  );
  recordTx("sharedBurn", sharedBurnResult.txid);

  await assertFaultInvoke(
    "shared:ownerOfBurned",
    rpcClient,
    summary.platformHash,
    "ownerOf",
    [tokenParam(sharedSaleTokenId)],
    "Token not found",
  );

  const sharedConfigureDropResult = await invokeAndWait(
    "shared:configureDrop",
    platformSeller,
    rpcClient,
    summary.platformHash,
    "configureDrop",
    [
      collectionParam(sharedCollectionId),
      sc.ContractParam.boolean(true),
      sc.ContractParam.integer(0),
      sc.ContractParam.integer(0),
      sc.ContractParam.integer(2),
      sc.ContractParam.boolean(true),
    ],
  );
  recordTx("sharedConfigureDrop", sharedConfigureDropResult.txid);

  const sharedWhitelistBatchResult = await invokeAndWait(
    "shared:setDropWhitelistBatch",
    platformSeller,
    rpcClient,
    summary.platformHash,
    "setDropWhitelistBatch",
    [
      collectionParam(sharedCollectionId),
      sc.ContractParam.array(
        sc.ContractParam.hash160(sellerAccount.address),
        sc.ContractParam.hash160(buyerAccount.address),
      ),
      sc.ContractParam.array(sc.ContractParam.integer(2), sc.ContractParam.integer(1)),
    ],
  );
  recordTx("sharedSetDropWhitelistBatch", sharedWhitelistBatchResult.txid);

  const sharedCanClaimBefore = decodeTopStackItem(
    await platformSeller.testInvoke("canClaimDrop", [
      collectionParam(sharedCollectionId),
      sc.ContractParam.hash160(buyerAccount.address),
    ]),
    "shared:canClaimDrop:before",
  );
  assert(sharedCanClaimBefore === true, "Buyer should be able to claim shared drop before claim");

  const sharedClaimDropResult = await invokeAndWait(
    "shared:claimDrop",
    platformBuyer,
    rpcClient,
    summary.platformHash,
    "claimDrop",
    [
      collectionParam(sharedCollectionId),
      sc.ContractParam.string(`https://example.com/lifecycle/shared/${sharedSuffix}/drop.json`),
      sc.ContractParam.string('{"name":"Shared Drop Token"}'),
    ],
  );
  recordTx("sharedClaimDrop", sharedClaimDropResult.txid);
  const sharedDropTokenId = extractTokenId(sharedClaimDropResult.appLog, summary.platformHash, "shared:claimDrop");
  summary.shared.dropTokenId = sharedDropTokenId;

  const sharedDropStats = decodeTopStackItem(
    await platformSeller.testInvoke("getDropWalletStats", [
      collectionParam(sharedCollectionId),
      sc.ContractParam.hash160(buyerAccount.address),
    ]),
    "shared:getDropWalletStats",
  );
  assert(Array.isArray(sharedDropStats) && sharedDropStats.length === 4, "Shared drop wallet stats shape mismatch");
  assert(toBigInt(sharedDropStats[0], "sharedDropStats.claimedCount") === 1n, "Shared drop claimedCount should be 1");
  assert(toBigInt(sharedDropStats[1], "sharedDropStats.whitelistAllowance") === 1n, "Shared whitelist allowance should be 1");
  assert(toBigInt(sharedDropStats[2], "sharedDropStats.remaining") === 0n, "Shared remaining claim count should be 0");
  assert(sharedDropStats[3] === false, "Shared claimableNow should be false after allowance exhausted");

  const sharedCanClaimAfter = decodeTopStackItem(
    await platformSeller.testInvoke("canClaimDrop", [
      collectionParam(sharedCollectionId),
      sc.ContractParam.hash160(buyerAccount.address),
    ]),
    "shared:canClaimDrop:after",
  );
  assert(sharedCanClaimAfter === false, "Buyer should not be able to claim shared drop after allowance exhausted");

  const sharedConfigureCheckInResult = await invokeAndWait(
    "shared:configureCheckInProgram",
    platformSeller,
    rpcClient,
    summary.platformHash,
    "configureCheckInProgram",
    [
      collectionParam(sharedCollectionId),
      sc.ContractParam.boolean(true),
      sc.ContractParam.boolean(true),
      sc.ContractParam.boolean(false),
      sc.ContractParam.integer(0),
      sc.ContractParam.integer(0),
      sc.ContractParam.integer(0),
      sc.ContractParam.integer(1),
      sc.ContractParam.boolean(true),
    ],
  );
  recordTx("sharedConfigureCheckInProgram", sharedConfigureCheckInResult.txid);

  const sharedCanCheckInBefore = decodeTopStackItem(
    await platformSeller.testInvoke("canCheckIn", [
      collectionParam(sharedCollectionId),
      sc.ContractParam.hash160(buyerAccount.address),
    ]),
    "shared:canCheckIn:before",
  );
  assert(sharedCanCheckInBefore === true, "Buyer should be able to check in before first check-in");

  const sharedCheckInResult = await invokeAndWait(
    "shared:checkIn",
    platformBuyer,
    rpcClient,
    summary.platformHash,
    "checkIn",
    [
      collectionParam(sharedCollectionId),
      sc.ContractParam.string(`https://example.com/lifecycle/shared/${sharedSuffix}/checkin.json`),
      sc.ContractParam.string('{"name":"Shared CheckIn Proof"}'),
    ],
  );
  recordTx("sharedCheckIn", sharedCheckInResult.txid);
  const sharedProofTokenId = extractTokenId(sharedCheckInResult.appLog, summary.platformHash, "shared:checkIn");
  summary.shared.checkInProofTokenId = sharedProofTokenId;

  const sharedCanCheckInAfter = decodeTopStackItem(
    await platformSeller.testInvoke("canCheckIn", [
      collectionParam(sharedCollectionId),
      sc.ContractParam.hash160(buyerAccount.address),
    ]),
    "shared:canCheckIn:after",
  );
  assert(sharedCanCheckInAfter === false, "Buyer should not be able to check in after max check-in count reached");

  const sharedMembershipStatus = decodeTopStackItem(
    await platformSeller.testInvoke("getMembershipStatus", [
      collectionParam(sharedCollectionId),
      sc.ContractParam.hash160(buyerAccount.address),
    ]),
    "shared:getMembershipStatus",
  );
  assert(Array.isArray(sharedMembershipStatus) && sharedMembershipStatus.length === 4, "Shared membership status shape mismatch");
  assert(sharedMembershipStatus[1] === true, "Shared membership status should indicate membership");

  const sharedDropTokenClass = toBigInt(
    decodeTopStackItem(await platformSeller.testInvoke("getTokenClass", [tokenParam(sharedDropTokenId)]), "shared:getTokenClass:drop"),
    "sharedDropTokenClass",
  );
  const sharedProofTokenClass = toBigInt(
    decodeTopStackItem(await platformSeller.testInvoke("getTokenClass", [tokenParam(sharedProofTokenId)]), "shared:getTokenClass:proof"),
    "sharedProofTokenClass",
  );
  assert(sharedDropTokenClass === 1n, `Shared drop token class expected 1, got ${sharedDropTokenClass}`);
  assert(sharedProofTokenClass === 2n, `Shared check-in proof token class expected 2, got ${sharedProofTokenClass}`);

  log("dedicated mode lifecycle start");
  const deploymentFeeBefore = toBigInt(
    decodeTopStackItem(await platformSeller.testInvoke("getDeploymentFeeBalance", []), "dedicated:getDeploymentFeeBalance:before"),
    "deploymentFeeBefore",
  );
  summary.deploymentFees.before = deploymentFeeBefore.toString();

  const dedicatedSuffix = `${runSuffix.slice(-4)}d`;
  const dedicatedCreateAndDeployResult = await invokeAndWait(
    "dedicated:createCollectionAndDeployFromTemplate",
    platformSeller,
    rpcClient,
    summary.platformHash,
    "createCollectionAndDeployFromTemplate",
    [
      sc.ContractParam.string(`Dedicated Lifecycle ${dedicatedSuffix}`),
      sc.ContractParam.string(`DD${dedicatedSuffix.slice(-2)}`),
      sc.ContractParam.string("Dedicated mode lifecycle test"),
      sc.ContractParam.string(`https://example.com/lifecycle/dedicated/${dedicatedSuffix}/`),
      sc.ContractParam.integer(0),
      sc.ContractParam.integer(500),
      sc.ContractParam.boolean(true),
      sc.ContractParam.string(dedicatedExtraData),
    ],
  );
  recordTx("dedicatedCreateAndDeploy", dedicatedCreateAndDeployResult.txid);

  const dedicatedCollectionId = extractCollectionId(
    dedicatedCreateAndDeployResult.appLog,
    summary.platformHash,
    "dedicated:createCollectionAndDeployFromTemplate",
  );
  const dedicatedHash = await extractDeployedCollectionHash(
    dedicatedCreateAndDeployResult.appLog,
    summary.platformHash,
    rpcClient,
    "dedicated:createCollectionAndDeployFromTemplate",
  );
  summary.dedicated.collectionId = dedicatedCollectionId;
  summary.dedicated.contractHash = dedicatedHash;

  const dedicatedState = await waitForContractState(rpcClient, dedicatedHash);
  const expectedDedicatedManifestName = buildScopedTemplateManifestName(
    manifestNameSegments.templateNameBase,
    dedicatedCollectionId,
  );
  assert(
    dedicatedState?.manifest?.name === expectedDedicatedManifestName,
    `Dedicated manifest name mismatch: expected '${expectedDedicatedManifestName}', got '${dedicatedState?.manifest?.name ?? ""}'`,
  );
  summary.dedicated.contractName = dedicatedState.manifest.name;

  const dedicatedFromPlatformRaw = decodeTopStackItem(
    await platformSeller.testInvoke("getCollectionContract", [collectionParam(dedicatedCollectionId)]),
    "dedicated:getCollectionContract",
  );
  const dedicatedFromPlatform = await resolveContractHashFromStackValue(rpcClient, dedicatedFromPlatformRaw);
  assert(normalizeHash(dedicatedFromPlatform) === normalizeHash(dedicatedHash), "Platform getCollectionContract mismatch");

  const dedicatedHasContract = decodeTopStackItem(
    await platformSeller.testInvoke("hasCollectionContract", [collectionParam(dedicatedCollectionId)]),
    "dedicated:hasCollectionContract",
  );
  assert(dedicatedHasContract === true, "Platform should report dedicated contract exists");

  const ownerDedicatedCollection = decodeTopStackItem(
    await platformSeller.testInvoke("getOwnerDedicatedCollection", [sc.ContractParam.hash160(sellerAccount.address)]),
    "dedicated:getOwnerDedicatedCollection",
  );
  assert(ownerDedicatedCollection === dedicatedCollectionId, "Owner dedicated collection mismatch");

  const ownerDedicatedContractRaw = decodeTopStackItem(
    await platformSeller.testInvoke("getOwnerDedicatedCollectionContract", [sc.ContractParam.hash160(sellerAccount.address)]),
    "dedicated:getOwnerDedicatedCollectionContract",
  );
  const ownerDedicatedContract = await resolveContractHashFromStackValue(rpcClient, ownerDedicatedContractRaw);
  assert(normalizeHash(ownerDedicatedContract) === normalizeHash(dedicatedHash), "Owner dedicated contract hash mismatch");

  const hasOwnerDedicatedContract = decodeTopStackItem(
    await platformSeller.testInvoke("hasOwnerDedicatedCollectionContract", [sc.ContractParam.hash160(sellerAccount.address)]),
    "dedicated:hasOwnerDedicatedCollectionContract",
  );
  assert(hasOwnerDedicatedContract === true, "Owner should have dedicated collection contract");

  const deployExtraData = decodeTopStackItem(
    await platformSeller.testInvoke("getCollectionDeployExtraData", [collectionParam(dedicatedCollectionId)]),
    "dedicated:getCollectionDeployExtraData",
  );
  assert(deployExtraData === dedicatedExtraData, "Dedicated deploy extraData mismatch on platform");

  const deploymentFeeAfterDeploy = toBigInt(
    decodeTopStackItem(await platformSeller.testInvoke("getDeploymentFeeBalance", []), "dedicated:getDeploymentFeeBalance:afterDeploy"),
    "deploymentFeeAfterDeploy",
  );
  summary.deploymentFees.afterDeploy = deploymentFeeAfterDeploy.toString();
  assert(
    deploymentFeeAfterDeploy - deploymentFeeBefore === DEDICATED_DEPLOY_FEE,
    `Deployment fee delta mismatch, expected ${DEDICATED_DEPLOY_FEE}, got ${deploymentFeeAfterDeploy - deploymentFeeBefore}`,
  );

  const dedicatedSeller = new experimental.SmartContract(u.HexString.fromHex(dedicatedHash), sellerConfig);
  const dedicatedBuyer = new experimental.SmartContract(u.HexString.fromHex(dedicatedHash), buyerConfig);

  log("wait for dedicated contract propagation");
  await sleep(15000);

  const dedicatedUpdateCollectionResult = await invokeAndWait(
    "dedicated:updateCollection",
    dedicatedSeller,
    rpcClient,
    dedicatedHash,
    "updateCollection",
    [
      collectionParam(dedicatedCollectionId),
      sc.ContractParam.string("Dedicated mode lifecycle test (updated)"),
      sc.ContractParam.string(`https://example.com/lifecycle/dedicated/${dedicatedSuffix}/updated/`),
      sc.ContractParam.integer(400),
      sc.ContractParam.boolean(true),
      sc.ContractParam.boolean(false),
    ],
  );
  recordTx("dedicatedUpdateCollection", dedicatedUpdateCollectionResult.txid);

  const dedicatedSetOperatorOnResult = await invokeAndWait(
    "dedicated:setCollectionOperator:on",
    dedicatedSeller,
    rpcClient,
    dedicatedHash,
    "setCollectionOperator",
    [
      collectionParam(dedicatedCollectionId),
      sc.ContractParam.hash160(buyerAccount.address),
      sc.ContractParam.boolean(true),
    ],
  );
  recordTx("dedicatedSetOperatorOn", dedicatedSetOperatorOnResult.txid);

  const dedicatedOperatorEnabled = decodeTopStackItem(
    await dedicatedSeller.testInvoke("isCollectionOperator", [
      collectionParam(dedicatedCollectionId),
      sc.ContractParam.hash160(buyerAccount.address),
    ]),
    "dedicated:isCollectionOperator:on",
  );
  assert(dedicatedOperatorEnabled === true, "Dedicated collection operator should be enabled");

  const dedicatedMintByOperatorResult = await invokeAndWait(
    "dedicated:mint:operator",
    dedicatedBuyer,
    rpcClient,
    dedicatedHash,
    "mint",
    [
      collectionParam(dedicatedCollectionId),
      sc.ContractParam.hash160(buyerAccount.address),
      sc.ContractParam.string(`https://example.com/lifecycle/dedicated/${dedicatedSuffix}/operator.json`),
      sc.ContractParam.string('{"name":"Dedicated Operator Mint"}'),
    ],
  );
  recordTx("dedicatedMintByOperator", dedicatedMintByOperatorResult.txid);
  summary.dedicated.operatorMintTokenId = extractTokenId(
    dedicatedMintByOperatorResult.appLog,
    dedicatedHash,
    "dedicated:mint:operator",
  );

  const dedicatedSetOperatorOffResult = await invokeAndWait(
    "dedicated:setCollectionOperator:off",
    dedicatedSeller,
    rpcClient,
    dedicatedHash,
    "setCollectionOperator",
    [
      collectionParam(dedicatedCollectionId),
      sc.ContractParam.hash160(buyerAccount.address),
      sc.ContractParam.boolean(false),
    ],
  );
  recordTx("dedicatedSetOperatorOff", dedicatedSetOperatorOffResult.txid);

  const dedicatedOperatorDisabled = decodeTopStackItem(
    await dedicatedSeller.testInvoke("isCollectionOperator", [
      collectionParam(dedicatedCollectionId),
      sc.ContractParam.hash160(buyerAccount.address),
    ]),
    "dedicated:isCollectionOperator:off",
  );
  assert(dedicatedOperatorDisabled === false, "Dedicated collection operator should be disabled");

  const dedicatedMintSaleResult = await invokeAndWait(
    "dedicated:mint:saleToken",
    dedicatedSeller,
    rpcClient,
    dedicatedHash,
    "mint",
    [
      collectionParam(dedicatedCollectionId),
      sc.ContractParam.hash160(sellerAccount.address),
      sc.ContractParam.string(`https://example.com/lifecycle/dedicated/${dedicatedSuffix}/sale.json`),
      sc.ContractParam.string('{"name":"Dedicated Sale Token"}'),
    ],
  );
  recordTx("dedicatedMintSaleToken", dedicatedMintSaleResult.txid);
  const dedicatedSaleTokenId = extractTokenId(
    dedicatedMintSaleResult.appLog,
    dedicatedHash,
    "dedicated:mint:saleToken",
  );
  summary.dedicated.saleTokenId = dedicatedSaleTokenId;

  const dedicatedListFirstResult = await invokeAndWait(
    "dedicated:listTokenForSale:first",
    dedicatedSeller,
    rpcClient,
    dedicatedHash,
    "listTokenForSale",
    [tokenParam(dedicatedSaleTokenId), sc.ContractParam.integer(salePrice)],
  );
  recordTx("dedicatedListTokenFirst", dedicatedListFirstResult.txid);

  const dedicatedCancelResult = await invokeAndWait(
    "dedicated:cancelTokenSale",
    dedicatedSeller,
    rpcClient,
    dedicatedHash,
    "cancelTokenSale",
    [tokenParam(dedicatedSaleTokenId)],
  );
  recordTx("dedicatedCancelTokenSale", dedicatedCancelResult.txid);

  const dedicatedListedAfterCancel = decodeTopStackItem(
    await dedicatedSeller.testInvoke("isTokenListed", [tokenParam(dedicatedSaleTokenId)]),
    "dedicated:isTokenListed:afterCancel",
  );
  assert(dedicatedListedAfterCancel === false, "Dedicated token listing should be cleared after cancel");

  const dedicatedListSecondResult = await invokeAndWait(
    "dedicated:listTokenForSale:second",
    dedicatedSeller,
    rpcClient,
    dedicatedHash,
    "listTokenForSale",
    [tokenParam(dedicatedSaleTokenId), sc.ContractParam.integer(salePrice)],
  );
  recordTx("dedicatedListTokenSecond", dedicatedListSecondResult.txid);

  const dedicatedBuyResult = await invokeAndWait(
    "dedicated:buyToken",
    dedicatedBuyer,
    rpcClient,
    dedicatedHash,
    "buyToken",
    [tokenParam(dedicatedSaleTokenId)],
  );
  recordTx("dedicatedBuyToken", dedicatedBuyResult.txid);

  const dedicatedListedAfterBuy = decodeTopStackItem(
    await dedicatedSeller.testInvoke("isTokenListed", [tokenParam(dedicatedSaleTokenId)]),
    "dedicated:isTokenListed:afterBuy",
  );
  assert(dedicatedListedAfterBuy === false, "Dedicated token listing should be cleared after buy");

  const dedicatedTransferResult = await invokeAndWait(
    "dedicated:transfer",
    dedicatedBuyer,
    rpcClient,
    dedicatedHash,
    "transfer",
    [
      sc.ContractParam.hash160(sellerAccount.address),
      tokenParam(dedicatedSaleTokenId),
      sc.ContractParam.any(null),
    ],
  );
  recordTx("dedicatedTransfer", dedicatedTransferResult.txid);

  const dedicatedBurnResult = await invokeAndWait(
    "dedicated:burn",
    dedicatedSeller,
    rpcClient,
    dedicatedHash,
    "burn",
    [tokenParam(dedicatedSaleTokenId)],
  );
  recordTx("dedicatedBurn", dedicatedBurnResult.txid);

  const dedicatedConfigureDropResult = await invokeAndWait(
    "dedicated:configureDrop",
    dedicatedSeller,
    rpcClient,
    dedicatedHash,
    "configureDrop",
    [
      collectionParam(dedicatedCollectionId),
      sc.ContractParam.boolean(true),
      sc.ContractParam.integer(0),
      sc.ContractParam.integer(0),
      sc.ContractParam.integer(2),
      sc.ContractParam.boolean(true),
    ],
  );
  recordTx("dedicatedConfigureDrop", dedicatedConfigureDropResult.txid);

  const dedicatedSetWhitelistResult = await invokeAndWait(
    "dedicated:setDropWhitelist",
    dedicatedSeller,
    rpcClient,
    dedicatedHash,
    "setDropWhitelist",
    [
      collectionParam(dedicatedCollectionId),
      sc.ContractParam.hash160(buyerAccount.address),
      sc.ContractParam.integer(1),
    ],
  );
  recordTx("dedicatedSetDropWhitelist", dedicatedSetWhitelistResult.txid);

  const dedicatedCanClaimBefore = decodeTopStackItem(
    await dedicatedSeller.testInvoke("canClaimDrop", [
      collectionParam(dedicatedCollectionId),
      sc.ContractParam.hash160(buyerAccount.address),
    ]),
    "dedicated:canClaimDrop:before",
  );
  assert(dedicatedCanClaimBefore === true, "Buyer should be able to claim dedicated drop before claim");

  const dedicatedClaimDropResult = await invokeAndWait(
    "dedicated:claimDrop",
    dedicatedBuyer,
    rpcClient,
    dedicatedHash,
    "claimDrop",
    [
      collectionParam(dedicatedCollectionId),
      sc.ContractParam.string(`https://example.com/lifecycle/dedicated/${dedicatedSuffix}/drop.json`),
      sc.ContractParam.string('{"name":"Dedicated Drop Token"}'),
    ],
  );
  recordTx("dedicatedClaimDrop", dedicatedClaimDropResult.txid);
  const dedicatedDropTokenId = extractTokenId(
    dedicatedClaimDropResult.appLog,
    dedicatedHash,
    "dedicated:claimDrop",
  );
  summary.dedicated.dropTokenId = dedicatedDropTokenId;

  const dedicatedCanClaimAfter = decodeTopStackItem(
    await dedicatedSeller.testInvoke("canClaimDrop", [
      collectionParam(dedicatedCollectionId),
      sc.ContractParam.hash160(buyerAccount.address),
    ]),
    "dedicated:canClaimDrop:after",
  );
  assert(dedicatedCanClaimAfter === false, "Buyer should not be able to claim dedicated drop after allowance exhausted");

  const dedicatedConfigureCheckInResult = await invokeAndWait(
    "dedicated:configureCheckInProgram",
    dedicatedSeller,
    rpcClient,
    dedicatedHash,
    "configureCheckInProgram",
    [
      collectionParam(dedicatedCollectionId),
      sc.ContractParam.boolean(true),
      sc.ContractParam.boolean(true),
      sc.ContractParam.boolean(false),
      sc.ContractParam.integer(0),
      sc.ContractParam.integer(0),
      sc.ContractParam.integer(0),
      sc.ContractParam.integer(1),
      sc.ContractParam.boolean(true),
    ],
  );
  recordTx("dedicatedConfigureCheckInProgram", dedicatedConfigureCheckInResult.txid);

  const dedicatedCanCheckInBefore = decodeTopStackItem(
    await dedicatedSeller.testInvoke("canCheckIn", [
      collectionParam(dedicatedCollectionId),
      sc.ContractParam.hash160(buyerAccount.address),
    ]),
    "dedicated:canCheckIn:before",
  );
  assert(dedicatedCanCheckInBefore === true, "Buyer should be able to check in before first dedicated check-in");

  const dedicatedCheckInResult = await invokeAndWait(
    "dedicated:checkIn",
    dedicatedBuyer,
    rpcClient,
    dedicatedHash,
    "checkIn",
    [
      collectionParam(dedicatedCollectionId),
      sc.ContractParam.string(`https://example.com/lifecycle/dedicated/${dedicatedSuffix}/checkin.json`),
      sc.ContractParam.string('{"name":"Dedicated CheckIn Proof"}'),
    ],
  );
  recordTx("dedicatedCheckIn", dedicatedCheckInResult.txid);
  const dedicatedProofTokenId = extractTokenId(dedicatedCheckInResult.appLog, dedicatedHash, "dedicated:checkIn");
  summary.dedicated.checkInProofTokenId = dedicatedProofTokenId;

  const dedicatedCanCheckInAfter = decodeTopStackItem(
    await dedicatedSeller.testInvoke("canCheckIn", [
      collectionParam(dedicatedCollectionId),
      sc.ContractParam.hash160(buyerAccount.address),
    ]),
    "dedicated:canCheckIn:after",
  );
  assert(dedicatedCanCheckInAfter === false, "Buyer should not be able to check in after dedicated max check-in count reached");

  const dedicatedExtraDataRead = decodeTopStackItem(
    await dedicatedSeller.testInvoke("getDedicatedExtraData", [collectionParam(dedicatedCollectionId)]),
    "dedicated:getDedicatedExtraData",
  );
  assert(dedicatedExtraDataRead === dedicatedExtraData, "Dedicated extraData mismatch on dedicated contract");

  const dedicatedDropTokenClass = toBigInt(
    decodeTopStackItem(await dedicatedSeller.testInvoke("getTokenClass", [tokenParam(dedicatedDropTokenId)]), "dedicated:getTokenClass:drop"),
    "dedicatedDropTokenClass",
  );
  const dedicatedProofTokenClass = toBigInt(
    decodeTopStackItem(await dedicatedSeller.testInvoke("getTokenClass", [tokenParam(dedicatedProofTokenId)]), "dedicated:getTokenClass:proof"),
    "dedicatedProofTokenClass",
  );
  assert(dedicatedDropTokenClass === 1n, `Dedicated drop token class expected 1, got ${dedicatedDropTokenClass}`);
  assert(dedicatedProofTokenClass === 2n, `Dedicated proof token class expected 2, got ${dedicatedProofTokenClass}`);

  const wrongCollectionId = (() => {
    const parsed = Number.parseInt(dedicatedCollectionId, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return (parsed + 1).toString();
    }
    return `${dedicatedCollectionId}-other`;
  })();

  summary.dedicated.isolation = {};
  summary.dedicated.isolation.platformMethodBlockedException = await assertFaultInvoke(
    "dedicated:isolation:createCollection",
    rpcClient,
    dedicatedHash,
    "createCollection",
    [
      sc.ContractParam.string("ShouldFail"),
      sc.ContractParam.string("FAIL"),
      sc.ContractParam.string("Must fail in dedicated mode"),
      sc.ContractParam.string("https://example.com/forbidden"),
      sc.ContractParam.integer(0),
      sc.ContractParam.integer(0),
      sc.ContractParam.boolean(true),
    ],
    [
      "Operation not allowed in dedicated NFT contract mode",
      "method not found: createCollection/7",
      "Method \"createCollection\" with 7 parameter(s) doesn't exist in the contract",
    ],
  );
  summary.dedicated.isolation.wrongScopeException = await assertFaultInvoke(
    "dedicated:isolation:mintWrongScope",
    rpcClient,
    dedicatedHash,
    "mint",
    [
      collectionParam(wrongCollectionId),
      sc.ContractParam.hash160(sellerAccount.address),
      sc.ContractParam.string(""),
      sc.ContractParam.string("{}"),
    ],
    "Collection id not bound to this dedicated NFT contract",
  );

  log("template lifecycle: clear + restore");
  const clearTemplateResult = await invokeAndWait(
    "template:clearCollectionContractTemplate",
    platformSeller,
    rpcClient,
    summary.platformHash,
    "clearCollectionContractTemplate",
    [],
  );
  recordTx("clearTemplate", clearTemplateResult.txid);

  const hasTemplateAfterClear = decodeTopStackItem(
    await platformSeller.testInvoke("hasCollectionContractTemplate", []),
    "template:hasCollectionContractTemplate:afterClear",
  );
  const hasTemplateNameSegmentsAfterClear = decodeTopStackItem(
    await platformSeller.testInvoke("hasCollectionContractTemplateNameSegments", []),
    "template:hasCollectionContractTemplateNameSegments:afterClear",
  );
  assert(hasTemplateAfterClear === false, "Template should be cleared");
  assert(hasTemplateNameSegmentsAfterClear === false, "Template name segments should be cleared");

  const restoreTemplateResult = await invokeAndWait(
    "template:restore:setCollectionContractTemplate",
    platformSeller,
    rpcClient,
    summary.platformHash,
    "setCollectionContractTemplate",
    [
      byteArrayParamFromHex(templateNefBytes.toString("hex")),
      sc.ContractParam.string(deployArtifacts.templateManifestText),
    ],
  );
  recordTx("restoreSetTemplate", restoreTemplateResult.txid);

  const restoreSegmentsResult = await invokeAndWait(
    "template:restore:setCollectionContractTemplateNameSegments",
    platformSeller,
    rpcClient,
    summary.platformHash,
    "setCollectionContractTemplateNameSegments",
    [
      sc.ContractParam.string(manifestNameSegments.manifestPrefix),
      sc.ContractParam.string(manifestNameSegments.templateNameBase),
      sc.ContractParam.string(manifestNameSegments.manifestSuffix),
    ],
  );
  recordTx("restoreSetTemplateNameSegments", restoreSegmentsResult.txid);

  const hasTemplateAfterRestore = decodeTopStackItem(
    await platformSeller.testInvoke("hasCollectionContractTemplate", []),
    "template:hasCollectionContractTemplate:afterRestore",
  );
  const hasTemplateNameSegmentsAfterRestore = decodeTopStackItem(
    await platformSeller.testInvoke("hasCollectionContractTemplateNameSegments", []),
    "template:hasCollectionContractTemplateNameSegments:afterRestore",
  );
  const digestAfterRestore = decodeTopStackItem(
    await platformSeller.testInvoke("getCollectionContractTemplateDigest", []),
    "template:getCollectionContractTemplateDigest:afterRestore",
  );
  assert(hasTemplateAfterRestore === true, "Template should be restored");
  assert(hasTemplateNameSegmentsAfterRestore === true, "Template name segments should be restored");
  assert(Array.isArray(digestAfterRestore) && digestAfterRestore[0] === true, "Template digest should be restored");
  summary.template.digestAfterRestore = digestAfterRestore;

  const deploymentFeeBeforeWithdraw = toBigInt(
    decodeTopStackItem(await platformSeller.testInvoke("getDeploymentFeeBalance", []), "fees:getDeploymentFeeBalance:beforeWithdraw"),
    "deploymentFeeBeforeWithdraw",
  );
  summary.deploymentFees.beforeWithdraw = deploymentFeeBeforeWithdraw.toString();

  const withdrawAmountBigInt = BigInt(withdrawAmount);
  assert(
    deploymentFeeBeforeWithdraw >= withdrawAmountBigInt,
    `Insufficient deploy fee balance for withdrawal: balance=${deploymentFeeBeforeWithdraw} amount=${withdrawAmountBigInt}`,
  );

  const withdrawResult = await invokeAndWait(
    "fees:withdrawDeploymentFees",
    platformSeller,
    rpcClient,
    summary.platformHash,
    "withdrawDeploymentFees",
    [sc.ContractParam.hash160(sellerAccount.address), sc.ContractParam.integer(withdrawAmount)],
  );
  recordTx("withdrawDeploymentFees", withdrawResult.txid);

  const deploymentFeeAfterWithdraw = toBigInt(
    decodeTopStackItem(await platformSeller.testInvoke("getDeploymentFeeBalance", []), "fees:getDeploymentFeeBalance:afterWithdraw"),
    "deploymentFeeAfterWithdraw",
  );
  summary.deploymentFees.afterWithdraw = deploymentFeeAfterWithdraw.toString();
  assert(
    deploymentFeeBeforeWithdraw - deploymentFeeAfterWithdraw === withdrawAmountBigInt,
    `Withdraw delta mismatch, expected ${withdrawAmountBigInt}, got ${deploymentFeeBeforeWithdraw - deploymentFeeAfterWithdraw}`,
  );

  log("full lifecycle test succeeded");
  console.log(JSON.stringify(summary, null, 2));
}

async function main() {
  const candidates = resolveRpcCandidates();
  let lastError = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const rpcUrl = candidates[index];
    if (index > 0) {
      log(`retry with failover RPC (${index + 1}/${candidates.length}): ${rpcUrl}`);
    }

    try {
      await runLifecycleWithRpc(rpcUrl);
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientRpcError(error) || index === candidates.length - 1) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      log(`transient RPC error on ${rpcUrl}: ${message}`);
    }
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error("No RPC endpoints configured");
}

main().catch((error) => {
  console.error("Full lifecycle test failed:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
