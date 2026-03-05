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

function extractEventStringValue(appLog, contractHash, eventName, eventArgIndex, label) {
  const event = findNotification(appLog, contractHash, eventName);
  if (!event?.state?.value?.[eventArgIndex]) {
    throw new Error(`${label}: missing ${eventName} event value index ${eventArgIndex}`);
  }

  const decoded = decodeStackItem(event.state.value[eventArgIndex]);
  if (!decoded || typeof decoded !== "string") {
    throw new Error(`${label}: invalid ${eventName} decoded value: ${decoded}`);
  }

  return decoded;
}

function decodeTopStackItem(invokeResult, label) {
  const stack = Array.isArray(invokeResult?.stack) ? invokeResult.stack : [];
  if (stack.length === 0) {
    throw new Error(`${label}: empty invoke stack`);
  }
  return decodeStackItem(stack[0]);
}

async function readTokenClass(contract, tokenId, label) {
  const value = decodeTopStackItem(
    await contract.testInvoke("getTokenClass", [byteArrayParamFromTextOrHex(tokenId)]),
    `${label}:getTokenClass`,
  );
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label}: token class is not a number (${value})`);
  }
  return parsed;
}

async function assertTokenListed(contract, tokenId, label) {
  const listed = decodeTopStackItem(
    await contract.testInvoke("isTokenListed", [byteArrayParamFromTextOrHex(tokenId)]),
    `${label}:isTokenListed`,
  );
  if (listed !== true) {
    throw new Error(`${label}: token ${tokenId} is not listed`);
  }
  return true;
}

async function main() {
  const sellerWif = requireEnv("TESTNET_WIF");
  const rpcUrl = process.env.TESTNET_RPC_URL?.trim() || DEFAULT_RPC_URL;
  const factoryHash = normalizeHash(process.env.TESTNET_FACTORY_HASH?.trim() || DEFAULT_FACTORY_HASH);
  const salePrice = Number.parseInt(process.env.TESTNET_SALE_PRICE?.trim() || "10000000", 10);
  const buyerFundGas = Number.parseInt(process.env.TESTNET_BUYER_FUND_GAS?.trim() || "5", 10);
  const collectionMaxSupply = Number.parseInt(process.env.TESTNET_COLLECTION_MAX_SUPPLY?.trim() || "1000000", 10);
  if (!Number.isFinite(salePrice) || salePrice <= 0) {
    throw new Error("TESTNET_SALE_PRICE must be a positive integer in GAS fractions (1 GAS = 100000000)");
  }
  if (!Number.isFinite(buyerFundGas) || buyerFundGas <= 0) {
    throw new Error("TESTNET_BUYER_FUND_GAS must be a positive integer (whole GAS)");
  }
  if (!Number.isFinite(collectionMaxSupply) || collectionMaxSupply <= 0) {
    throw new Error("TESTNET_COLLECTION_MAX_SUPPLY must be a positive integer");
  }

  const seller = new wallet.Account(sellerWif);
  const buyerWif = process.env.TESTNET_BUYER_WIF?.trim() || wallet.getWIFFromPrivateKey(wallet.generatePrivateKey());
  const buyer = new wallet.Account(buyerWif);
  if (seller.address === buyer.address) {
    throw new Error("Seller and buyer addresses must be different");
  }

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
    notes: {
      tokenClassStandardValue: 0,
      tokenClassMembershipValue: 1,
      tokenClassCheckInProofValue: 2,
      standardClassPublicMintExposed: true,
      standardClassPublicMintReason: "mintStandard() now supports class 0 minting in C# contracts",
    },
    seller: {
      address: seller.address,
    },
    buyer: {
      address: buyer.address,
      wif: buyerWif,
      generated: !process.env.TESTNET_BUYER_WIF,
      fundedGas: `${buyerFundGas}`,
    },
    txids: {},
    shared: {
      collectionId: "",
      contractHash: factoryHash,
      tokens: {
        standardMinted: "",
        membershipMinted: "",
        dropClaimed: "",
        checkInProof: "",
      },
      tokenClasses: {
        standardMinted: null,
        membershipMinted: null,
        dropClaimed: null,
        checkInProof: null,
      },
      listed: {
        standardMinted: false,
        membershipMinted: false,
        dropClaimed: false,
        checkInProof: false,
      },
    },
    dedicated: {
      collectionId: "",
      contractHash: "",
      tokens: {
        standardMinted: "",
        membershipMinted: "",
        dropClaimed: "",
        checkInProof: "",
      },
      tokenClasses: {
        standardMinted: null,
        membershipMinted: null,
        dropClaimed: null,
        checkInProof: null,
      },
      listed: {
        standardMinted: false,
        membershipMinted: false,
        dropClaimed: false,
        checkInProof: false,
      },
    },
    salePrice: salePrice.toString(),
    collectionMaxSupply,
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
  const dedicatedDisabledByEnv = process.env.TESTNET_DISABLE_DEDICATED?.trim() === "1";
  const dedicatedTemplateReady = hasTemplate === true && hasTemplateSegments === true;
  const runDedicatedFlow = !dedicatedDisabledByEnv && dedicatedTemplateReady;
  if (!runDedicatedFlow) {
    const dedicatedSkipReason = dedicatedDisabledByEnv
      ? "Dedicated flow disabled by TESTNET_DISABLE_DEDICATED=1."
      : `Factory template is not fully configured. hasCollectionContractTemplate=${hasTemplate}, hasCollectionContractTemplateNameSegments=${hasTemplateSegments}`;
    summary.dedicated.skipped = true;
    summary.dedicated.skipReason = dedicatedSkipReason;
    log(`dedicated flow skipped: ${dedicatedSkipReason}`);
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
      sc.ContractParam.integer(collectionMaxSupply),
      sc.ContractParam.integer(350),
      sc.ContractParam.boolean(true),
    ],
  );
  summary.txids.sharedCreateCollection = sharedCreate.txid;

  const sharedCollectionId = extractEventStringValue(
    sharedCreate.appLog,
    factoryHash,
    "CollectionUpserted",
    0,
    "shared:createCollection",
  );
  summary.shared.collectionId = sharedCollectionId;
  log(`shared collectionId: ${sharedCollectionId}`);

  log("shared: mint standard token via mintStandard()");
  const sharedMintStandard = await invokeAndWait(
    "sharedMintStandard",
    platformSeller,
    rpcClient,
    factoryHash,
    "mintStandard",
    [
      byteArrayParamFromTextOrHex(sharedCollectionId),
      sc.ContractParam.hash160(seller.address),
      sc.ContractParam.string(`${sharedBaseUri}standard-1.json`),
      sc.ContractParam.string(JSON.stringify({
        name: `Live Shared Standard Token ${suffix}`,
        image: "https://images.unsplash.com/photo-1463107971871-fbac9ddb920f?w=1200",
        attributes: [
          { trait_type: "mode", value: "shared" },
          { trait_type: "seed", value: suffix },
          { trait_type: "flow", value: "mint-standard" },
          { trait_type: "tokenClass", value: "standard" },
        ],
      })),
    ],
  );
  summary.txids.sharedMintStandard = sharedMintStandard.txid;
  const sharedStandardTokenId = extractEventStringValue(
    sharedMintStandard.appLog,
    factoryHash,
    "TokenUpserted",
    0,
    "shared:mintStandard",
  );
  summary.shared.tokens.standardMinted = sharedStandardTokenId;
  log(`shared standard tokenId: ${sharedStandardTokenId}`);

  log("shared: mint membership token via mint()");
  const sharedMintMembership = await invokeAndWait(
    "sharedMintMembership",
    platformSeller,
    rpcClient,
    factoryHash,
    "mint",
    [
      byteArrayParamFromTextOrHex(sharedCollectionId),
      sc.ContractParam.hash160(seller.address),
      sc.ContractParam.string(`${sharedBaseUri}membership-1.json`),
      sc.ContractParam.string(JSON.stringify({
        name: `Live Shared Membership Token ${suffix}`,
        image: "https://images.unsplash.com/photo-1634973357973-f2ed2657db3c?w=1200",
        attributes: [
          { trait_type: "mode", value: "shared" },
          { trait_type: "seed", value: suffix },
          { trait_type: "flow", value: "mint-membership" },
          { trait_type: "tokenClass", value: "membership" },
        ],
      })),
    ],
  );
  summary.txids.sharedMintMembership = sharedMintMembership.txid;
  const sharedMembershipTokenId = extractEventStringValue(
    sharedMintMembership.appLog,
    factoryHash,
    "TokenUpserted",
    0,
    "shared:mintMembership",
  );
  summary.shared.tokens.membershipMinted = sharedMembershipTokenId;
  log(`shared membership tokenId: ${sharedMembershipTokenId}`);

  log("shared: configure drop");
  const sharedConfigureDrop = await invokeAndWait(
    "sharedConfigureDrop",
    platformSeller,
    rpcClient,
    factoryHash,
    "configureDrop",
    [
      byteArrayParamFromTextOrHex(sharedCollectionId),
      sc.ContractParam.boolean(true),
      sc.ContractParam.integer(0),
      sc.ContractParam.integer(0),
      sc.ContractParam.integer(5),
      sc.ContractParam.boolean(false),
    ],
  );
  summary.txids.sharedConfigureDrop = sharedConfigureDrop.txid;

  log("shared: buyer claimDrop (membership)");
  const sharedClaimDrop = await invokeAndWait(
    "sharedClaimDrop",
    platformBuyer,
    rpcClient,
    factoryHash,
    "claimDrop",
    [
      byteArrayParamFromTextOrHex(sharedCollectionId),
      sc.ContractParam.string(`${sharedBaseUri}drop-1.json`),
      sc.ContractParam.string(
        JSON.stringify({
          name: `Live Shared Drop Token ${suffix}`,
          image: "https://images.unsplash.com/photo-1522542550221-31fd19575a2d?w=1200",
          attributes: [
            { trait_type: "mode", value: "shared" },
            { trait_type: "seed", value: suffix },
            { trait_type: "flow", value: "drop" },
          ],
        }),
      ),
    ],
  );
  summary.txids.sharedClaimDrop = sharedClaimDrop.txid;
  const sharedDropTokenId = extractEventStringValue(
    sharedClaimDrop.appLog,
    factoryHash,
    "TokenUpserted",
    0,
    "shared:claimDrop",
  );
  summary.shared.tokens.dropClaimed = sharedDropTokenId;
  log(`shared drop tokenId: ${sharedDropTokenId}`);

  log("shared: configure check-in program");
  const sharedConfigureCheckIn = await invokeAndWait(
    "sharedConfigureCheckInProgram",
    platformSeller,
    rpcClient,
    factoryHash,
    "configureCheckInProgram",
    [
      byteArrayParamFromTextOrHex(sharedCollectionId),
      sc.ContractParam.boolean(true),
      sc.ContractParam.boolean(true),
      sc.ContractParam.boolean(false),
      sc.ContractParam.integer(0),
      sc.ContractParam.integer(0),
      sc.ContractParam.integer(0),
      sc.ContractParam.integer(0),
      sc.ContractParam.boolean(true),
    ],
  );
  summary.txids.sharedConfigureCheckInProgram = sharedConfigureCheckIn.txid;

  log("shared: buyer checkIn (proof)");
  const sharedCheckIn = await invokeAndWait(
    "sharedCheckIn",
    platformBuyer,
    rpcClient,
    factoryHash,
    "checkIn",
    [
      byteArrayParamFromTextOrHex(sharedCollectionId),
      sc.ContractParam.string(`${sharedBaseUri}checkin-1.json`),
      sc.ContractParam.string(
        JSON.stringify({
          name: `Live Shared Check-In Proof ${suffix}`,
          image: "https://images.unsplash.com/photo-1516534775068-ba3e7458af70?w=1200",
          attributes: [
            { trait_type: "mode", value: "shared" },
            { trait_type: "seed", value: suffix },
            { trait_type: "flow", value: "check-in" },
          ],
        }),
      ),
    ],
  );
  summary.txids.sharedCheckIn = sharedCheckIn.txid;
  const sharedProofTokenId = extractEventStringValue(
    sharedCheckIn.appLog,
    factoryHash,
    "TokenUpserted",
    0,
    "shared:checkIn",
  );
  summary.shared.tokens.checkInProof = sharedProofTokenId;
  log(`shared check-in proof tokenId: ${sharedProofTokenId}`);

  log("shared: list standard token");
  const sharedListStandard = await invokeAndWait(
    "sharedListStandardMinted",
    platformSeller,
    rpcClient,
    factoryHash,
    "listTokenForSale",
    [byteArrayParamFromTextOrHex(sharedStandardTokenId), sc.ContractParam.integer(salePrice)],
  );
  summary.txids.sharedListStandardMinted = sharedListStandard.txid;

  log("shared: list membership token");
  const sharedListMembership = await invokeAndWait(
    "sharedListMembershipMinted",
    platformSeller,
    rpcClient,
    factoryHash,
    "listTokenForSale",
    [byteArrayParamFromTextOrHex(sharedMembershipTokenId), sc.ContractParam.integer(salePrice)],
  );
  summary.txids.sharedListMembershipMinted = sharedListMembership.txid;

  log("shared: list drop token");
  const sharedListDrop = await invokeAndWait(
    "sharedListDropClaimed",
    platformBuyer,
    rpcClient,
    factoryHash,
    "listTokenForSale",
    [byteArrayParamFromTextOrHex(sharedDropTokenId), sc.ContractParam.integer(salePrice)],
  );
  summary.txids.sharedListDropClaimed = sharedListDrop.txid;

  log("shared: list check-in proof token");
  const sharedListProof = await invokeAndWait(
    "sharedListCheckInProof",
    platformBuyer,
    rpcClient,
    factoryHash,
    "listTokenForSale",
    [byteArrayParamFromTextOrHex(sharedProofTokenId), sc.ContractParam.integer(salePrice)],
  );
  summary.txids.sharedListCheckInProof = sharedListProof.txid;

  summary.shared.listed.standardMinted = await assertTokenListed(
    platformSeller,
    sharedStandardTokenId,
    "shared:standardMinted",
  );
  summary.shared.listed.membershipMinted = await assertTokenListed(
    platformSeller,
    sharedMembershipTokenId,
    "shared:membershipMinted",
  );
  summary.shared.listed.dropClaimed = await assertTokenListed(platformSeller, sharedDropTokenId, "shared:dropClaimed");
  summary.shared.listed.checkInProof = await assertTokenListed(platformSeller, sharedProofTokenId, "shared:checkInProof");

  summary.shared.tokenClasses.standardMinted = await readTokenClass(
    platformSeller,
    sharedStandardTokenId,
    "shared:standardMinted",
  );
  summary.shared.tokenClasses.membershipMinted = await readTokenClass(
    platformSeller,
    sharedMembershipTokenId,
    "shared:membershipMinted",
  );
  summary.shared.tokenClasses.dropClaimed = await readTokenClass(platformSeller, sharedDropTokenId, "shared:dropClaimed");
  summary.shared.tokenClasses.checkInProof = await readTokenClass(platformSeller, sharedProofTokenId, "shared:checkInProof");

  if (summary.shared.tokenClasses.standardMinted !== 0) {
    throw new Error(
      `shared standard token class expected 0, got ${summary.shared.tokenClasses.standardMinted}`,
    );
  }
  if (summary.shared.tokenClasses.membershipMinted !== 1) {
    throw new Error(
      `shared membership token class expected 1, got ${summary.shared.tokenClasses.membershipMinted}`,
    );
  }
  if (summary.shared.tokenClasses.dropClaimed !== 1) {
    throw new Error(`shared drop token class expected 1, got ${summary.shared.tokenClasses.dropClaimed}`);
  }
  if (summary.shared.tokenClasses.checkInProof !== 2) {
    throw new Error(`shared check-in proof token class expected 2, got ${summary.shared.tokenClasses.checkInProof}`);
  }

  if (runDedicatedFlow) {
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
        sc.ContractParam.integer(collectionMaxSupply),
        sc.ContractParam.integer(450),
        sc.ContractParam.boolean(true),
        sc.ContractParam.string(JSON.stringify({ source: "live-seed-factory", suffix, mode: "dedicated" })),
      ],
    );
    summary.txids.dedicatedCreateCollectionAndDeploy = dedicatedCreateDeploy.txid;

    const dedicatedCollectionId = extractEventStringValue(
      dedicatedCreateDeploy.appLog,
      factoryHash,
      "CollectionUpserted",
      0,
      "dedicated:createCollectionAndDeploy",
    );
    summary.dedicated.collectionId = dedicatedCollectionId;
    log(`dedicated collectionId: ${dedicatedCollectionId}`);

    const dedicatedRawHash = extractEventStringValue(
      dedicatedCreateDeploy.appLog,
      factoryHash,
      "CollectionContractDeployed",
      2,
      "dedicated:createCollectionAndDeploy",
    );
    const dedicatedContractHash = await resolveContractHashFromStackValue(rpcClient, dedicatedRawHash);
    summary.dedicated.contractHash = dedicatedContractHash;
    log(`dedicated contract: ${dedicatedContractHash}`);

    log("wait 15s for dedicated contract propagation");
    await sleep(15000);
    await waitForContractState(rpcClient, dedicatedContractHash);

    const dedicatedSeller = new experimental.SmartContract(u.HexString.fromHex(dedicatedContractHash), sellerConfig);
    const dedicatedBuyer = new experimental.SmartContract(u.HexString.fromHex(dedicatedContractHash), buyerConfig);

    log("dedicated: mint standard token via mintStandard()");
    const dedicatedMintStandard = await invokeAndWait(
      "dedicatedMintStandard",
      dedicatedSeller,
      rpcClient,
      dedicatedContractHash,
      "mintStandard",
      [
        byteArrayParamFromTextOrHex(dedicatedCollectionId),
        sc.ContractParam.hash160(seller.address),
        sc.ContractParam.string(`${dedicatedBaseUri}standard-1.json`),
        sc.ContractParam.string(JSON.stringify({
          name: `Live Dedicated Standard Token ${suffix}`,
          image: "https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=1200",
          attributes: [
            { trait_type: "mode", value: "dedicated" },
            { trait_type: "seed", value: suffix },
            { trait_type: "flow", value: "mint-standard" },
            { trait_type: "tokenClass", value: "standard" },
          ],
        })),
      ],
    );
    summary.txids.dedicatedMintStandard = dedicatedMintStandard.txid;
    const dedicatedStandardTokenId = extractEventStringValue(
      dedicatedMintStandard.appLog,
      dedicatedContractHash,
      "TokenUpserted",
      0,
      "dedicated:mintStandard",
    );
    summary.dedicated.tokens.standardMinted = dedicatedStandardTokenId;
    log(`dedicated standard tokenId: ${dedicatedStandardTokenId}`);

    log("dedicated: mint membership token via mint()");
    const dedicatedMintMembership = await invokeAndWait(
      "dedicatedMintMembership",
      dedicatedSeller,
      rpcClient,
      dedicatedContractHash,
      "mint",
      [
        byteArrayParamFromTextOrHex(dedicatedCollectionId),
        sc.ContractParam.hash160(seller.address),
        sc.ContractParam.string(`${dedicatedBaseUri}membership-1.json`),
        sc.ContractParam.string(JSON.stringify({
          name: `Live Dedicated Membership Token ${suffix}`,
          image: "https://images.unsplash.com/photo-1639322537228-f710d846310a?w=1200",
          attributes: [
            { trait_type: "mode", value: "dedicated" },
            { trait_type: "seed", value: suffix },
            { trait_type: "flow", value: "mint-membership" },
            { trait_type: "tokenClass", value: "membership" },
          ],
        })),
      ],
    );
    summary.txids.dedicatedMintMembership = dedicatedMintMembership.txid;
    const dedicatedMembershipTokenId = extractEventStringValue(
      dedicatedMintMembership.appLog,
      dedicatedContractHash,
      "TokenUpserted",
      0,
      "dedicated:mintMembership",
    );
    summary.dedicated.tokens.membershipMinted = dedicatedMembershipTokenId;
    log(`dedicated membership tokenId: ${dedicatedMembershipTokenId}`);

    log("dedicated: configure drop");
    const dedicatedConfigureDrop = await invokeAndWait(
      "dedicatedConfigureDrop",
      dedicatedSeller,
      rpcClient,
      dedicatedContractHash,
      "configureDrop",
      [
        byteArrayParamFromTextOrHex(dedicatedCollectionId),
        sc.ContractParam.boolean(true),
        sc.ContractParam.integer(0),
        sc.ContractParam.integer(0),
        sc.ContractParam.integer(5),
        sc.ContractParam.boolean(false),
      ],
    );
    summary.txids.dedicatedConfigureDrop = dedicatedConfigureDrop.txid;

    log("dedicated: buyer claimDrop (membership)");
    const dedicatedClaimDrop = await invokeAndWait(
      "dedicatedClaimDrop",
      dedicatedBuyer,
      rpcClient,
      dedicatedContractHash,
      "claimDrop",
      [
        byteArrayParamFromTextOrHex(dedicatedCollectionId),
        sc.ContractParam.string(`${dedicatedBaseUri}drop-1.json`),
        sc.ContractParam.string(
          JSON.stringify({
            name: `Live Dedicated Drop Token ${suffix}`,
            image: "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=1200",
            attributes: [
              { trait_type: "mode", value: "dedicated" },
              { trait_type: "seed", value: suffix },
              { trait_type: "flow", value: "drop" },
            ],
          }),
        ),
      ],
    );
    summary.txids.dedicatedClaimDrop = dedicatedClaimDrop.txid;
    const dedicatedDropTokenId = extractEventStringValue(
      dedicatedClaimDrop.appLog,
      dedicatedContractHash,
      "TokenUpserted",
      0,
      "dedicated:claimDrop",
    );
    summary.dedicated.tokens.dropClaimed = dedicatedDropTokenId;
    log(`dedicated drop tokenId: ${dedicatedDropTokenId}`);

    log("dedicated: configure check-in program");
    const dedicatedConfigureCheckIn = await invokeAndWait(
      "dedicatedConfigureCheckInProgram",
      dedicatedSeller,
      rpcClient,
      dedicatedContractHash,
      "configureCheckInProgram",
      [
        byteArrayParamFromTextOrHex(dedicatedCollectionId),
        sc.ContractParam.boolean(true),
        sc.ContractParam.boolean(true),
        sc.ContractParam.boolean(false),
        sc.ContractParam.integer(0),
        sc.ContractParam.integer(0),
        sc.ContractParam.integer(0),
        sc.ContractParam.integer(0),
        sc.ContractParam.boolean(true),
      ],
    );
    summary.txids.dedicatedConfigureCheckInProgram = dedicatedConfigureCheckIn.txid;

    log("dedicated: buyer checkIn (proof)");
    const dedicatedCheckIn = await invokeAndWait(
      "dedicatedCheckIn",
      dedicatedBuyer,
      rpcClient,
      dedicatedContractHash,
      "checkIn",
      [
        byteArrayParamFromTextOrHex(dedicatedCollectionId),
        sc.ContractParam.string(`${dedicatedBaseUri}checkin-1.json`),
        sc.ContractParam.string(
          JSON.stringify({
            name: `Live Dedicated Check-In Proof ${suffix}`,
            image: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=1200",
            attributes: [
              { trait_type: "mode", value: "dedicated" },
              { trait_type: "seed", value: suffix },
              { trait_type: "flow", value: "check-in" },
            ],
          }),
        ),
      ],
    );
    summary.txids.dedicatedCheckIn = dedicatedCheckIn.txid;
    const dedicatedProofTokenId = extractEventStringValue(
      dedicatedCheckIn.appLog,
      dedicatedContractHash,
      "TokenUpserted",
      0,
      "dedicated:checkIn",
    );
    summary.dedicated.tokens.checkInProof = dedicatedProofTokenId;
    log(`dedicated check-in proof tokenId: ${dedicatedProofTokenId}`);

    log("dedicated: list standard token");
    const dedicatedListStandard = await invokeAndWait(
      "dedicatedListStandardMinted",
      dedicatedSeller,
      rpcClient,
      dedicatedContractHash,
      "listTokenForSale",
      [byteArrayParamFromTextOrHex(dedicatedStandardTokenId), sc.ContractParam.integer(salePrice)],
    );
    summary.txids.dedicatedListStandardMinted = dedicatedListStandard.txid;

    log("dedicated: list membership token");
    const dedicatedListMembership = await invokeAndWait(
      "dedicatedListMembershipMinted",
      dedicatedSeller,
      rpcClient,
      dedicatedContractHash,
      "listTokenForSale",
      [byteArrayParamFromTextOrHex(dedicatedMembershipTokenId), sc.ContractParam.integer(salePrice)],
    );
    summary.txids.dedicatedListMembershipMinted = dedicatedListMembership.txid;

    log("dedicated: list drop token");
    const dedicatedListDrop = await invokeAndWait(
      "dedicatedListDropClaimed",
      dedicatedBuyer,
      rpcClient,
      dedicatedContractHash,
      "listTokenForSale",
      [byteArrayParamFromTextOrHex(dedicatedDropTokenId), sc.ContractParam.integer(salePrice)],
    );
    summary.txids.dedicatedListDropClaimed = dedicatedListDrop.txid;

    log("dedicated: list check-in proof token");
    const dedicatedListProof = await invokeAndWait(
      "dedicatedListCheckInProof",
      dedicatedBuyer,
      rpcClient,
      dedicatedContractHash,
      "listTokenForSale",
      [byteArrayParamFromTextOrHex(dedicatedProofTokenId), sc.ContractParam.integer(salePrice)],
    );
    summary.txids.dedicatedListCheckInProof = dedicatedListProof.txid;

    summary.dedicated.listed.standardMinted = await assertTokenListed(
      dedicatedSeller,
      dedicatedStandardTokenId,
      "dedicated:standardMinted",
    );
    summary.dedicated.listed.membershipMinted = await assertTokenListed(
      dedicatedSeller,
      dedicatedMembershipTokenId,
      "dedicated:membershipMinted",
    );
    summary.dedicated.listed.dropClaimed = await assertTokenListed(
      dedicatedSeller,
      dedicatedDropTokenId,
      "dedicated:dropClaimed",
    );
    summary.dedicated.listed.checkInProof = await assertTokenListed(
      dedicatedSeller,
      dedicatedProofTokenId,
      "dedicated:checkInProof",
    );

    summary.dedicated.tokenClasses.standardMinted = await readTokenClass(
      dedicatedSeller,
      dedicatedStandardTokenId,
      "dedicated:standardMinted",
    );
    summary.dedicated.tokenClasses.membershipMinted = await readTokenClass(
      dedicatedSeller,
      dedicatedMembershipTokenId,
      "dedicated:membershipMinted",
    );
    summary.dedicated.tokenClasses.dropClaimed = await readTokenClass(
      dedicatedSeller,
      dedicatedDropTokenId,
      "dedicated:dropClaimed",
    );
    summary.dedicated.tokenClasses.checkInProof = await readTokenClass(
      dedicatedSeller,
      dedicatedProofTokenId,
      "dedicated:checkInProof",
    );

    if (summary.dedicated.tokenClasses.standardMinted !== 0) {
      throw new Error(
        `dedicated standard token class expected 0, got ${summary.dedicated.tokenClasses.standardMinted}`,
      );
    }
    if (summary.dedicated.tokenClasses.membershipMinted !== 1) {
      throw new Error(
        `dedicated membership token class expected 1, got ${summary.dedicated.tokenClasses.membershipMinted}`,
      );
    }
    if (summary.dedicated.tokenClasses.dropClaimed !== 1) {
      throw new Error(`dedicated drop token class expected 1, got ${summary.dedicated.tokenClasses.dropClaimed}`);
    }
    if (summary.dedicated.tokenClasses.checkInProof !== 2) {
      throw new Error(
        `dedicated check-in proof token class expected 2, got ${summary.dedicated.tokenClasses.checkInProof}`,
      );
    }
  }

  log("completed on-chain live seeding");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("[live-seed] failed");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
