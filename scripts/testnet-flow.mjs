#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import { experimental, rpc, sc, u, wallet } from "@cityofzion/neon-js";

const DEFAULT_RPC_URL = "https://testnet1.neo.coz.io:443";
const CONTRACT_NEF = "contracts/multi-tenant-nft-platform/build/MultiTenantNftPlatform.nef";
const CONTRACT_MANIFEST = "contracts/multi-tenant-nft-platform/build/MultiTenantNftPlatform.manifest.json";

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

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
    default:
      return item.value;
  }
}

function normalizeHash(input) {
  return input.startsWith("0x") ? input.toLowerCase() : `0x${input.toLowerCase()}`;
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
      // try next candidate
    }
  }

  throw new Error(`Unable to resolve deployed contract hash from value: ${input}`);
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

async function waitForApplicationLog(client, txid, options = {}) {
  const attempts = options.attempts ?? 80;
  const intervalMs = options.intervalMs ?? 3000;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const appLog = await client.getApplicationLog(txid);
      if (appLog && Array.isArray(appLog.executions) && appLog.executions.length > 0) {
        return appLog;
      }
    } catch {
      // ignore and retry
    }

    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for application log: ${txid}`);
}

async function waitForContractState(client, hash, options = {}) {
  const attempts = options.attempts ?? 40;
  const intervalMs = options.intervalMs ?? 3000;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const state = await client.getContractState(hash);
      if (state?.manifest?.name) {
        return state;
      }
    } catch {
      // ignore and retry
    }
    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for contract state: ${hash}`);
}

function findNotification(appLog, contractHash, eventName) {
  const normalized = normalizeHash(contractHash);
  const executions = Array.isArray(appLog.executions) ? appLog.executions : [];

  for (const execution of executions) {
    const notifications = Array.isArray(execution.notifications) ? execution.notifications : [];
    for (const notification of notifications) {
      const notifHash = normalizeHash(notification.contract ?? "");
      if (notifHash !== normalized) {
        continue;
      }
      if ((notification.eventname ?? "") !== eventName) {
        continue;
      }
      return notification;
    }
  }

  return null;
}

async function invokeAndWait(label, smartContract, rpcClient, contractHash, operation, params) {
  const txid = await smartContract.invoke(operation, params);
  const appLog = await waitForApplicationLog(rpcClient, txid);
  const execution = Array.isArray(appLog.executions) && appLog.executions.length > 0 ? appLog.executions[0] : null;
  if (!execution || execution.vmstate !== "HALT") {
    const exception = execution?.exception ?? "Unknown VM exception";
    throw new Error(`${label} failed. vmstate=${execution?.vmstate ?? "UNKNOWN"}, exception=${exception}`);
  }

  return { txid, appLog };
}

async function assertFaultInvoke(label, rpcClient, contractHash, operation, params, expectedExceptionFragment) {
  const result = await rpcClient.invokeFunction(contractHash, operation, params);
  if (result?.state !== "FAULT") {
    throw new Error(
      `${label} expected FAULT but got ${result?.state ?? "UNKNOWN"}`
    );
  }

  const exception = result?.exception?.toString?.() ?? "";
  if (
    expectedExceptionFragment
    && (!exception || !exception.includes(expectedExceptionFragment))
  ) {
    throw new Error(
      `${label} exception mismatch. expected to include '${expectedExceptionFragment}', got '${exception || "<empty>"}'`,
    );
  }

  return exception;
}

async function main() {
  const rpcUrl = process.env.TESTNET_RPC_URL?.trim() || DEFAULT_RPC_URL;
  const wif = requireEnv("TESTNET_WIF");

  const account = new wallet.Account(wif);
  const rpcClient = new rpc.RPCClient(rpcUrl);
  const version = await rpcClient.getVersion();
  const networkMagic = version?.protocol?.network;
  if (!networkMagic) {
    throw new Error("Failed to detect network magic from RPC getVersion");
  }

  const config = {
    rpcAddress: rpcUrl,
    account,
    networkMagic,
    blocksTillExpiry: 120,
    prioritisationFee: 0,
  };

  const nefPath = path.resolve(CONTRACT_NEF);
  const manifestPath = path.resolve(CONTRACT_MANIFEST);

  const [nefBytes, manifestText] = await Promise.all([fs.readFile(nefPath), fs.readFile(manifestPath, "utf8")]);
  const manifestJson = JSON.parse(manifestText);
  const deploySuffix = Date.now().toString().slice(-8);
  const requestedDeployName = process.env.TESTNET_DEPLOY_NAME?.trim() || `${manifestJson.name}Smoke${deploySuffix}`;
  const collectionMaxSupply = readNonNegativeIntegerEnv("TESTNET_COLLECTION_MAX_SUPPLY", 0);

  const nef = sc.NEF.fromBuffer(nefBytes);

  function buildDeployArtifacts(name) {
    const deployManifestJson = {
      ...manifestJson,
      name,
    };

    return {
      deployName: name,
      manifest: sc.ContractManifest.fromJson(deployManifestJson),
      templateManifestText: JSON.stringify({
        ...deployManifestJson,
        name: `${name}Template`,
      }),
      predictedHash: normalizeHash(
        experimental.getContractHash(account.scriptHash, nef.checksum, name),
      ),
    };
  }

  let deployArtifacts = buildDeployArtifacts(requestedDeployName);

  const summary = {
    rpcUrl,
    networkMagic,
    deployerAddress: account.address,
    deployName: deployArtifacts.deployName,
    collectionMaxSupply,
    predictedContractHash: deployArtifacts.predictedHash,
    contractHash: "",
    deployedNow: true,
    txids: {},
    collectionId: null,
    tokenId: null,
    checkInProofTokenId: null,
    deployedCollectionContractHash: null,
    dedicatedIsolation: null,
  };

  let deployTxid;
  for (;;) {
    console.log(`[testnet] Deploying platform contract: ${deployArtifacts.deployName}`);
    try {
      deployTxid = await experimental.deployContract(nef, deployArtifacts.manifest, config);
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isNameCollision = message.toLowerCase().includes("contract already exists");
      if (!isNameCollision || deployArtifacts.deployName !== requestedDeployName) {
        throw error;
      }

      const fallbackName = `${requestedDeployName}-${Date.now().toString().slice(-6)}`;
      console.log(`[testnet] deploy name already exists, retrying with: ${fallbackName}`);
      deployArtifacts = buildDeployArtifacts(fallbackName);
      summary.deployName = deployArtifacts.deployName;
      summary.predictedContractHash = deployArtifacts.predictedHash;
    }
  }

  console.log(`[testnet] deploy txid: ${deployTxid}`);
  const deployLog = await waitForApplicationLog(rpcClient, deployTxid);
  const deployExecution = Array.isArray(deployLog.executions) && deployLog.executions.length > 0 ? deployLog.executions[0] : null;
  if (!deployExecution || deployExecution.vmstate !== "HALT") {
    throw new Error(
      `Platform deploy failed. txid=${deployTxid}, vmstate=${deployExecution?.vmstate ?? "UNKNOWN"}, exception=${deployExecution?.exception ?? "Unknown VM exception"
      }`,
    );
  }
  const deployedHash = decodeContractHashFromDeployExecution(deployExecution);
  summary.contractHash = deployedHash;
  await waitForContractState(rpcClient, deployedHash);
  summary.txids.deployPlatform = deployTxid;

  const platform = new experimental.SmartContract(u.HexString.fromHex(deployedHash), config);

  console.log("[testnet] setCollectionContractTemplate");
  const templateInvoke = await invokeAndWait(
    "setCollectionContractTemplate",
    platform,
    rpcClient,
    deployedHash,
    "setCollectionContractTemplate",
    [
      byteArrayParamFromHex(nefBytes.toString("hex")),
      sc.ContractParam.string(deployArtifacts.templateManifestText),
    ],
  );
  summary.txids.setTemplate = templateInvoke.txid;

  const suffix = Date.now().toString().slice(-6);
  console.log(`[testnet] createCollectionAndDeployFromTemplate (maxSupply=${collectionMaxSupply})`);
  const createAndDeployInvoke = await invokeAndWait(
    "createCollectionAndDeployFromTemplate",
    platform,
    rpcClient,
    deployedHash,
    "createCollectionAndDeployFromTemplate",
    [
      sc.ContractParam.string(`Smoke Collection ${suffix}`),
      sc.ContractParam.string(`SMK${suffix.slice(-3)}`),
      sc.ContractParam.string("E2E test collection"),
      sc.ContractParam.string(`https://example.com/meta/${suffix}/`),
      sc.ContractParam.integer(collectionMaxSupply),
      sc.ContractParam.integer(500),
      sc.ContractParam.boolean(true),
      sc.ContractParam.string(JSON.stringify({ source: "smoke-e2e", suffix, mode: "per-user-dedicated" })),
    ],
  );
  summary.txids.createCollectionAndDeployFromTemplate = createAndDeployInvoke.txid;
  summary.txids.createCollection = createAndDeployInvoke.txid; // legacy alias
  summary.txids.deployCollectionContractFromTemplate = createAndDeployInvoke.txid; // legacy alias
  summary.txids.deployCollectionContract = createAndDeployInvoke.txid; // legacy alias

  const collectionNotification = findNotification(createAndDeployInvoke.appLog, deployedHash, "CollectionUpserted");
  if (!collectionNotification || !collectionNotification.state || !Array.isArray(collectionNotification.state.value)) {
    throw new Error("Failed to locate CollectionUpserted notification for createCollectionAndDeployFromTemplate");
  }
  const collectionId = decodeStackItem(collectionNotification.state.value[0]);
  if (!collectionId || typeof collectionId !== "string") {
    throw new Error(`Invalid collectionId extracted from event: ${collectionId}`);
  }
  summary.collectionId = collectionId;
  console.log(`[testnet] collectionId: ${collectionId}`);

  const deployedNotification = findNotification(createAndDeployInvoke.appLog, deployedHash, "CollectionContractDeployed");
  if (deployedNotification?.state?.value?.[2]) {
    const rawHash = decodeStackItem(deployedNotification.state.value[2]);
    summary.deployedCollectionContractHash = await resolveContractHashFromStackValue(rpcClient, rawHash);
  }
  if (!summary.deployedCollectionContractHash || typeof summary.deployedCollectionContractHash !== "string") {
    throw new Error("Failed to locate deployed collection contract hash in CollectionContractDeployed event");
  }

  const collectionContract = new experimental.SmartContract(
    u.HexString.fromHex(summary.deployedCollectionContractHash),
    config,
  );

  console.log("[testnet] waiting 15s for ContractManagement propagation...");
  await sleep(15000);

  console.log("[testnet] mint");
  const mintInvoke = await invokeAndWait(
    "mint",
    collectionContract,
    rpcClient,
    summary.deployedCollectionContractHash,
    "mint",
    [
      byteArrayParamFromHex(idToByteArrayHex(collectionId)),
      sc.ContractParam.hash160(account.address),
      sc.ContractParam.string(`https://example.com/meta/${suffix}/1.json`),
      sc.ContractParam.string('{"name":"Smoke NFT","attributes":[{"trait_type":"tier","value":"test"}]}'),
    ],
  );
  summary.txids.mint = mintInvoke.txid;

  const tokenNotification = findNotification(
    mintInvoke.appLog,
    summary.deployedCollectionContractHash,
    "TokenUpserted",
  );
  if (!tokenNotification || !tokenNotification.state || !Array.isArray(tokenNotification.state.value)) {
    throw new Error("Failed to locate TokenUpserted notification for mint");
  }

  const tokenId = decodeStackItem(tokenNotification.state.value[0]);
  if (!tokenId || typeof tokenId !== "string") {
    throw new Error(`Invalid tokenId extracted from event: ${tokenId}`);
  }
  summary.tokenId = tokenId;
  console.log(`[testnet] tokenId: ${tokenId}`);

  console.log("[testnet] configureCheckInProgram");
  const checkInProgramInvoke = await invokeAndWait(
    "configureCheckInProgram",
    collectionContract,
    rpcClient,
    summary.deployedCollectionContractHash,
    "configureCheckInProgram",
    [
      byteArrayParamFromHex(idToByteArrayHex(collectionId)),
      sc.ContractParam.boolean(true), // enabled
      sc.ContractParam.boolean(true), // membershipRequired
      sc.ContractParam.boolean(false), // membershipSoulbound
      sc.ContractParam.integer(0), // startAt
      sc.ContractParam.integer(0), // endAt
      sc.ContractParam.integer(0), // intervalSeconds
      sc.ContractParam.integer(0), // maxCheckInsPerWallet
      sc.ContractParam.boolean(true), // mintProofNft
    ],
  );
  summary.txids.configureCheckInProgram = checkInProgramInvoke.txid;

  console.log("[testnet] checkIn");
  const checkInInvoke = await invokeAndWait(
    "checkIn",
    collectionContract,
    rpcClient,
    summary.deployedCollectionContractHash,
    "checkIn",
    [
      byteArrayParamFromHex(idToByteArrayHex(collectionId)),
      sc.ContractParam.string(`https://example.com/meta/${suffix}/checkin-1.json`),
      sc.ContractParam.string('{\"name\":\"CheckIn Proof\",\"attributes\":[{\"trait_type\":\"type\",\"value\":\"check-in\"}]}'),
    ],
  );
  summary.txids.checkIn = checkInInvoke.txid;

  const checkInProofNotification = findNotification(
    checkInInvoke.appLog,
    summary.deployedCollectionContractHash,
    "TokenUpserted",
  );
  if (checkInProofNotification?.state?.value?.[0]) {
    const checkInProofTokenId = decodeStackItem(checkInProofNotification.state.value[0]);
    if (typeof checkInProofTokenId === "string" && checkInProofTokenId.length > 0) {
      summary.checkInProofTokenId = checkInProofTokenId;
    }
  }

  const recipient = new wallet.Account(wallet.generatePrivateKey()).address;
  console.log("[testnet] transfer");
  const transferInvoke = await invokeAndWait(
    "transfer",
    collectionContract,
    rpcClient,
    summary.deployedCollectionContractHash,
    "transfer",
    [
      sc.ContractParam.hash160(recipient),
      byteArrayParamFromHex(idToByteArrayHex(tokenId)),
      sc.ContractParam.any(null),
    ],
  );
  summary.txids.transfer = transferInvoke.txid;

  console.log("[testnet] burn");
  const burnInvoke = await invokeAndWait(
    "burn",
    collectionContract,
    rpcClient,
    summary.deployedCollectionContractHash,
    "burn",
    [byteArrayParamFromHex(idToByteArrayHex(tokenId))],
  );
  summary.txids.burn = burnInvoke.txid;

  const contractRead = await platform.testInvoke("getCollectionContract", [
    byteArrayParamFromHex(idToByteArrayHex(collectionId)),
  ]);
  const readValue = contractRead?.stack?.[0] ? decodeStackItem(contractRead.stack[0]) : null;
  if (readValue) {
    const resolved = await resolveContractHashFromStackValue(rpcClient, readValue);
    summary.deployedCollectionContractHash = summary.deployedCollectionContractHash || resolved;
  }

  const wrongCollectionId = (() => {
    const parsed = Number.parseInt(collectionId, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return (parsed + 1).toString();
    }
    return `${collectionId}-other`;
  })();

  console.log("[testnet] dedicated isolation checks");
  const platformMethodBlockedException = await assertFaultInvoke(
    "dedicated:createCollection",
    rpcClient,
    summary.deployedCollectionContractHash,
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
    "Operation not allowed in dedicated NFT contract mode",
  );

  const wrongScopeException = await assertFaultInvoke(
    "dedicated:getCollectionWrongScope",
    rpcClient,
    summary.deployedCollectionContractHash,
    "getCollection",
    [byteArrayParamFromHex(idToByteArrayHex(wrongCollectionId))],
    "Collection id not bound to this dedicated NFT contract",
  );

  summary.dedicatedIsolation = {
    platformMethodBlocked: true,
    wrongScopeBlocked: true,
    createCollectionException: platformMethodBlockedException,
    wrongScopeException,
  };

  console.log("Testnet flow succeeded:");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("Testnet flow failed:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
