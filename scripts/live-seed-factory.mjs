#!/usr/bin/env node

import { experimental, rpc, sc, tx, u, wallet } from "@cityofzion/neon-js";

const DEFAULT_RPC_URL = "http://seed2t5.neo.org:20332";
const DEFAULT_FACTORY_HASH = "0x81f129ab82e0f41bba5048872405db66cbddb968";
const GAS_HASH = "0xd2a4cff31913016155e38e474a2c06d08be276cf";

function log(message) {
  console.log(`[live-seed] ${message}`);
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
    throw new Error(`Invalid hash value: ${value}`);
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
      return Object.fromEntries(item.value.map((entry) => [decodeStackItem(entry.key), decodeStackItem(entry.value)]));
    case "Null":
      return null;
    default:
      return item.value;
  }
}

function idToByteArrayHex(input) {
  const value = String(input).trim();
  if (/^0x[0-9a-fA-F]+$/.test(value)) {
    const normalized = value.slice(2);
    if (normalized.length % 2 === 0) {
      return normalized;
    }
  }

  if (/^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0 && !/^[0-9]+$/.test(value)) {
    return value;
  }

  return Buffer.from(value, "utf8").toString("hex");
}

function byteArrayParamFromTextOrHex(input) {
  return sc.ContractParam.byteArray(u.HexString.fromHex(idToByteArrayHex(input), true));
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

async function waitForApplicationLog(client, txid, attempts = 90, intervalMs = 3000) {
  for (let i = 1; i <= attempts; i += 1) {
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

async function waitForContractState(client, hash, attempts = 45, intervalMs = 3000) {
  for (let i = 1; i <= attempts; i += 1) {
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
  const normalizedContract = normalizeHash(contractHash);
  const executions = Array.isArray(appLog?.executions) ? appLog.executions : [];

  for (const execution of executions) {
    const notifications = Array.isArray(execution?.notifications) ? execution.notifications : [];
    for (const notification of notifications) {
      const thisHash = normalizeHash(notification?.contract ?? "");
      if (thisHash !== normalizedContract) {
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

async function resolveContractHashFromStackValue(client, input) {
  if (!input || typeof input !== "string") {
    throw new Error(`Invalid contract hash stack value: ${input}`);
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
      // continue
    }
  }

  throw new Error(`Unable to resolve deployed contract hash from stack value: ${input}`);
}

async function invokeAndWait(label, smartContract, rpcClient, contractHash, operation, args) {
  const txid = await smartContract.invoke(operation, args, buildGlobalSignerForContract(smartContract));
  const appLog = await waitForApplicationLog(rpcClient, txid);
  const execution = appLog?.executions?.[0] ?? null;
  if (!execution || execution.vmstate !== "HALT") {
    throw new Error(
      `${label} failed. vmstate=${execution?.vmstate ?? "UNKNOWN"}, exception=${execution?.exception ?? "Unknown VM exception"}`,
    );
  }

  return {
    txid,
    appLog,
    contractHash,
    operation,
  };
}

async function main() {
  const sellerWif = requireEnv("TESTNET_WIF");
  const rpcUrl = process.env.TESTNET_RPC_URL?.trim() || DEFAULT_RPC_URL;
  const factoryHash = normalizeHash(process.env.TESTNET_FACTORY_HASH?.trim() || DEFAULT_FACTORY_HASH);
  const salePrice = Number.parseInt(process.env.TESTNET_SALE_PRICE?.trim() || "10000000", 10);
  const buyerFundGas = Number.parseInt(process.env.TESTNET_BUYER_FUND_GAS?.trim() || "5", 10);
  if (!Number.isFinite(salePrice) || salePrice <= 0) {
    throw new Error("TESTNET_SALE_PRICE must be a positive integer in GAS fractions (1 GAS = 100000000)");
  }
  if (!Number.isFinite(buyerFundGas) || buyerFundGas <= 0) {
    throw new Error("TESTNET_BUYER_FUND_GAS must be a positive integer (whole GAS)");
  }

  const seller = new wallet.Account(sellerWif);
  const buyerWif = process.env.TESTNET_BUYER_WIF?.trim() || wallet.getWIFFromPrivateKey(wallet.generatePrivateKey());
  const buyer = new wallet.Account(buyerWif);
  if (seller.address === buyer.address) {
    throw new Error("Seller and buyer addresses must be different");
  }

  const recipient = new wallet.Account(wallet.generatePrivateKey());

  const rpcClient = new rpc.RPCClient(rpcUrl);
  const version = await rpcClient.getVersion();
  const networkMagic = version?.protocol?.network;
  if (!networkMagic) {
    throw new Error("Failed to get network magic from RPC");
  }

  const sellerConfig = {
    rpcAddress: rpcUrl,
    account: seller,
    networkMagic,
    blocksTillExpiry: 120,
    prioritisationFee: 0,
  };
  const buyerConfig = {
    rpcAddress: rpcUrl,
    account: buyer,
    networkMagic,
    blocksTillExpiry: 120,
    prioritisationFee: 0,
  };

  const summary = {
    rpcUrl,
    networkMagic,
    factoryHash,
    seller: {
      address: seller.address,
    },
    buyer: {
      address: buyer.address,
      wif: buyerWif,
      generated: !process.env.TESTNET_BUYER_WIF,
      fundedGas: `${buyerFundGas}`,
    },
    recipient: recipient.address,
    txids: {},
    shared: {
      collectionId: "",
      tokenId: "",
    },
    dedicated: {
      collectionId: "",
      contractHash: "",
      tokenId: "",
    },
    salePrice: salePrice.toString(),
  };

  log(`rpc: ${rpcUrl}`);
  log(`factory: ${factoryHash}`);
  log(`seller: ${seller.address}`);
  log(`buyer: ${buyer.address} ${summary.buyer.generated ? "(generated)" : "(provided)"}`);

  const gasBalanceSeller = await rpcClient.invokeFunction(GAS_HASH, "balanceOf", [
    sc.ContractParam.hash160(seller.address),
  ]);
  log(`seller GAS balance (fractions): ${gasBalanceSeller?.stack?.[0]?.value ?? "unknown"}`);

  const factoryReadTemplate = await rpcClient.invokeFunction(factoryHash, "hasCollectionContractTemplate", []);
  const factoryReadTemplateSegments = await rpcClient.invokeFunction(factoryHash, "hasCollectionContractTemplateNameSegments", []);
  const hasTemplate = decodeStackItem(factoryReadTemplate?.stack?.[0]);
  const hasTemplateSegments = decodeStackItem(factoryReadTemplateSegments?.stack?.[0]);
  if (hasTemplate !== true || hasTemplateSegments !== true) {
    throw new Error(
      `Factory template is not fully configured. hasCollectionContractTemplate=${hasTemplate}, hasCollectionContractTemplateNameSegments=${hasTemplateSegments}`,
    );
  }

  const gasContractSeller = new experimental.SmartContract(u.HexString.fromHex(GAS_HASH), sellerConfig);
  const fundAmountFractions = buyerFundGas * 100000000;
  log(`fund buyer with ${buyerFundGas} GAS`);
  const fundBuyer = await invokeAndWait(
    "fundBuyer",
    gasContractSeller,
    rpcClient,
    GAS_HASH,
    "transfer",
    [
      sc.ContractParam.hash160(seller.address),
      sc.ContractParam.hash160(buyer.address),
      sc.ContractParam.integer(fundAmountFractions),
      sc.ContractParam.any(null),
    ],
  );
  summary.txids.fundBuyer = fundBuyer.txid;

  const platformSeller = new experimental.SmartContract(u.HexString.fromHex(factoryHash), sellerConfig);
  const platformBuyer = new experimental.SmartContract(u.HexString.fromHex(factoryHash), buyerConfig);

  const suffix = Date.now().toString().slice(-8);
  const sharedName = `Live Shared ${suffix}`;
  const sharedSymbol = `LS${suffix.slice(-3)}`;
  const sharedBaseUri = `https://example.com/live/shared/${suffix}/`;

  log("create shared collection in factory");
  const sharedCreate = await invokeAndWait(
    "sharedCreateCollection",
    platformSeller,
    rpcClient,
    factoryHash,
    "createCollection",
    [
      sc.ContractParam.string(sharedName),
      sc.ContractParam.string(sharedSymbol),
      sc.ContractParam.string("Live shared-mode collection for frontend indexing"),
      sc.ContractParam.string(sharedBaseUri),
      sc.ContractParam.integer(0),
      sc.ContractParam.integer(350),
      sc.ContractParam.boolean(true),
    ],
  );
  summary.txids.sharedCreateCollection = sharedCreate.txid;

  const sharedCollectionEvent = findNotification(sharedCreate.appLog, factoryHash, "CollectionUpserted");
  if (!sharedCollectionEvent?.state?.value?.[0]) {
    throw new Error("Missing shared CollectionUpserted event");
  }
  const sharedCollectionId = decodeStackItem(sharedCollectionEvent.state.value[0]);
  if (!sharedCollectionId || typeof sharedCollectionId !== "string") {
    throw new Error(`Invalid shared collection id: ${sharedCollectionId}`);
  }
  summary.shared.collectionId = sharedCollectionId;
  log(`shared collectionId: ${sharedCollectionId}`);

  log("mint shared token");
  const sharedMint = await invokeAndWait(
    "sharedMint",
    platformSeller,
    rpcClient,
    factoryHash,
    "mint",
    [
      byteArrayParamFromTextOrHex(sharedCollectionId),
      sc.ContractParam.hash160(seller.address),
      sc.ContractParam.string(`${sharedBaseUri}seed-1.json`),
      sc.ContractParam.string(JSON.stringify({
        name: `Live Shared Token ${suffix}`,
        image: "https://images.unsplash.com/photo-1634973357973-f2ed2657db3c?w=1200",
        attributes: [
          { trait_type: "mode", value: "shared" },
          { trait_type: "seed", value: suffix },
        ],
      })),
    ],
  );
  summary.txids.sharedMint = sharedMint.txid;

  const sharedTokenEvent = findNotification(sharedMint.appLog, factoryHash, "TokenUpserted");
  if (!sharedTokenEvent?.state?.value?.[0]) {
    throw new Error("Missing shared TokenUpserted event");
  }
  const sharedTokenId = decodeStackItem(sharedTokenEvent.state.value[0]);
  if (!sharedTokenId || typeof sharedTokenId !== "string") {
    throw new Error(`Invalid shared token id: ${sharedTokenId}`);
  }
  summary.shared.tokenId = sharedTokenId;
  log(`shared tokenId: ${sharedTokenId}`);

  log(`list shared token for sale: ${salePrice}`);
  const sharedList = await invokeAndWait(
    "sharedListTokenForSale",
    platformSeller,
    rpcClient,
    factoryHash,
    "listTokenForSale",
    [byteArrayParamFromTextOrHex(sharedTokenId), sc.ContractParam.integer(salePrice)],
  );
  summary.txids.sharedListTokenForSale = sharedList.txid;

  log("buyer buys shared token");
  const sharedBuy = await invokeAndWait(
    "sharedBuyToken",
    platformBuyer,
    rpcClient,
    factoryHash,
    "buyToken",
    [byteArrayParamFromTextOrHex(sharedTokenId)],
  );
  summary.txids.sharedBuyToken = sharedBuy.txid;

  log("buyer transfers shared token to recipient");
  const sharedTransfer = await invokeAndWait(
    "sharedTransfer",
    platformBuyer,
    rpcClient,
    factoryHash,
    "transfer",
    [
      sc.ContractParam.hash160(recipient.address),
      byteArrayParamFromTextOrHex(sharedTokenId),
      sc.ContractParam.any(null),
    ],
  );
  summary.txids.sharedTransfer = sharedTransfer.txid;

  const dedicatedName = `Live Dedicated ${suffix}`;
  const dedicatedSymbol = `LD${suffix.slice(-3)}`;
  const dedicatedBaseUri = `https://example.com/live/dedicated/${suffix}/`;

  log("create dedicated collection and deploy contract from template");
  const dedicatedCreateDeploy = await invokeAndWait(
    "dedicatedCreateCollectionAndDeployFromTemplate",
    platformSeller,
    rpcClient,
    factoryHash,
    "createCollectionAndDeployFromTemplate",
    [
      sc.ContractParam.string(dedicatedName),
      sc.ContractParam.string(dedicatedSymbol),
      sc.ContractParam.string("Live dedicated-mode collection for frontend indexing"),
      sc.ContractParam.string(dedicatedBaseUri),
      sc.ContractParam.integer(0),
      sc.ContractParam.integer(450),
      sc.ContractParam.boolean(true),
      sc.ContractParam.string(JSON.stringify({ source: "live-seed-factory", suffix, mode: "dedicated" })),
    ],
  );
  summary.txids.dedicatedCreateCollectionAndDeploy = dedicatedCreateDeploy.txid;

  const dedicatedCollectionEvent = findNotification(dedicatedCreateDeploy.appLog, factoryHash, "CollectionUpserted");
  if (!dedicatedCollectionEvent?.state?.value?.[0]) {
    throw new Error("Missing dedicated CollectionUpserted event");
  }
  const dedicatedCollectionId = decodeStackItem(dedicatedCollectionEvent.state.value[0]);
  if (!dedicatedCollectionId || typeof dedicatedCollectionId !== "string") {
    throw new Error(`Invalid dedicated collection id: ${dedicatedCollectionId}`);
  }
  summary.dedicated.collectionId = dedicatedCollectionId;
  log(`dedicated collectionId: ${dedicatedCollectionId}`);

  const dedicatedDeployedEvent = findNotification(
    dedicatedCreateDeploy.appLog,
    factoryHash,
    "CollectionContractDeployed",
  );
  if (!dedicatedDeployedEvent?.state?.value?.[2]) {
    throw new Error("Missing CollectionContractDeployed event for dedicated collection");
  }
  const dedicatedRawHash = decodeStackItem(dedicatedDeployedEvent.state.value[2]);
  const dedicatedContractHash = await resolveContractHashFromStackValue(rpcClient, dedicatedRawHash);
  summary.dedicated.contractHash = dedicatedContractHash;
  log(`dedicated contract: ${dedicatedContractHash}`);

  log("wait 15s for dedicated contract propagation");
  await sleep(15000);
  await waitForContractState(rpcClient, dedicatedContractHash);

  const dedicatedSeller = new experimental.SmartContract(u.HexString.fromHex(dedicatedContractHash), sellerConfig);
  const dedicatedBuyer = new experimental.SmartContract(u.HexString.fromHex(dedicatedContractHash), buyerConfig);

  log("mint dedicated token");
  const dedicatedMint = await invokeAndWait(
    "dedicatedMint",
    dedicatedSeller,
    rpcClient,
    dedicatedContractHash,
    "mint",
    [
      byteArrayParamFromTextOrHex(dedicatedCollectionId),
      sc.ContractParam.hash160(seller.address),
      sc.ContractParam.string(`${dedicatedBaseUri}seed-1.json`),
      sc.ContractParam.string(JSON.stringify({
        name: `Live Dedicated Token ${suffix}`,
        image: "https://images.unsplash.com/photo-1639322537228-f710d846310a?w=1200",
        attributes: [
          { trait_type: "mode", value: "dedicated" },
          { trait_type: "seed", value: suffix },
        ],
      })),
    ],
  );
  summary.txids.dedicatedMint = dedicatedMint.txid;

  const dedicatedTokenEvent = findNotification(dedicatedMint.appLog, dedicatedContractHash, "TokenUpserted");
  if (!dedicatedTokenEvent?.state?.value?.[0]) {
    throw new Error("Missing dedicated TokenUpserted event");
  }
  const dedicatedTokenId = decodeStackItem(dedicatedTokenEvent.state.value[0]);
  if (!dedicatedTokenId || typeof dedicatedTokenId !== "string") {
    throw new Error(`Invalid dedicated token id: ${dedicatedTokenId}`);
  }
  summary.dedicated.tokenId = dedicatedTokenId;
  log(`dedicated tokenId: ${dedicatedTokenId}`);

  log("list dedicated token for sale");
  const dedicatedList = await invokeAndWait(
    "dedicatedListTokenForSale",
    dedicatedSeller,
    rpcClient,
    dedicatedContractHash,
    "listTokenForSale",
    [byteArrayParamFromTextOrHex(dedicatedTokenId), sc.ContractParam.integer(salePrice)],
  );
  summary.txids.dedicatedListTokenForSale = dedicatedList.txid;

  log("buyer buys dedicated token");
  const dedicatedBuy = await invokeAndWait(
    "dedicatedBuyToken",
    dedicatedBuyer,
    rpcClient,
    dedicatedContractHash,
    "buyToken",
    [byteArrayParamFromTextOrHex(dedicatedTokenId)],
  );
  summary.txids.dedicatedBuyToken = dedicatedBuy.txid;

  log("buyer transfers dedicated token to recipient");
  const dedicatedTransfer = await invokeAndWait(
    "dedicatedTransfer",
    dedicatedBuyer,
    rpcClient,
    dedicatedContractHash,
    "transfer",
    [
      sc.ContractParam.hash160(recipient.address),
      byteArrayParamFromTextOrHex(dedicatedTokenId),
      sc.ContractParam.any(null),
    ],
  );
  summary.txids.dedicatedTransfer = dedicatedTransfer.txid;

  log("completed on-chain live seeding");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("[live-seed] failed");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
