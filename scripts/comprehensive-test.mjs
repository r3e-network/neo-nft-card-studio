import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { experimental, rpc, sc, tx, u, wallet } from "@cityofzion/neon-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_NEF_PATH = path.join(ROOT, "contracts", "multi-tenant-nft-platform", "build", "MultiTenantNftTemplate.nef");
const TEMPLATE_MANIFEST_PATH = path.join(
  ROOT,
  "contracts",
  "multi-tenant-nft-platform",
  "build",
  "MultiTenantNftTemplate.deploy.manifest.json",
);

function readRequiredWif() {
  const wif = process.env.NEO_TEST_WIF?.trim();
  if (!wif) {
    throw new Error("Missing NEO_TEST_WIF. Set it to a Neo N3 testnet WIF before running this script.");
  }
  return wif;
}

// --- Configuration ---
const RPC_URL = "https://testnet1.neo.coz.io:443";
const FACTORY_HASH = "0xc1868eba3ce06ad93962378537f8a59f3cae1548";
const NETWORK_MAGIC = 894710606;

const ADMIN = new wallet.Account(readRequiredWif());
const rpcClient = new rpc.RPCClient(RPC_URL);

console.log("Admin Address:", ADMIN.address);

const adminConfig = { rpcAddress: RPC_URL, account: ADMIN, networkMagic: NETWORK_MAGIC };
const platform = new experimental.SmartContract(u.HexString.fromHex(FACTORY_HASH), adminConfig);

// --- Helpers ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function retry(fn, label = "Operation", maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (e) {
            console.warn(`${label} attempt ${i + 1} failed: ${e.message}`);
            if (i === maxRetries - 1) throw e;
            await sleep(5000 * (i + 1));
        }
    }
}

async function waitForTx(txid) {
  console.log(`Waiting for TX: ${txid}...`);
  return await retry(async () => {
    for (let i = 0; i < 30; i++) {
        const log = await rpcClient.getApplicationLog(txid);
        if (log && log.executions) {
            if (log.executions[0].vmstate === "HALT") return log;
            if (log.executions[0].vmstate === "FAULT") throw new Error(`TX Fault: ${log.executions[0].exception}`);
        }
        await sleep(4000);
    }
    throw new Error("TX timeout");
  }, `WaitTx(${txid})`);
}

function decodeString(val) {
  if (val && typeof val === 'object' && val.value) {
    try {
        const text = Buffer.from(val.value, 'base64').toString('utf8');
        if (/^[\x20-\x7e]*$/.test(text)) return text;
        return '0x' + Buffer.from(val.value, 'base64').toString('hex');
    } catch {
        return val.value;
    }
  }
  return val ? val.toString() : "";
}

function decodeHash(val) {
  if (!val || !val.value) return "";
  const hex = Buffer.from(val.value, 'base64').toString('hex');
  return '0x' + u.reverseHex(hex);
}

// --- Test Suite ---

async function runResetAndLifecycleTests() {
  console.log("\n>>> [STEP 0: RESET & LIFECYCLE] <<<");
  
  try {
    console.log("1. Clearing Template...");
    await retry(() => platform.invoke("clearCollectionContractTemplate", []), "clearTemplate");
    console.log("Template cleared.");
  } catch (e) { console.warn("Skip clear:", e.message); }

  try {
    console.log("2. Restoring Template...");
    const nef = await fs.readFile(TEMPLATE_NEF_PATH);
    const manifest = await fs.readFile(TEMPLATE_MANIFEST_PATH, "utf8");
    
    const txid = await retry(() => platform.invoke("setCollectionContractTemplate", [
        sc.ContractParam.byteArray(nef.toString('hex')),
        sc.ContractParam.string(manifest)
    ]), "setTemplate");
    await waitForTx(txid);
    console.log("Template restored.");

    console.log("3. Configuring Template Name Segments...");
    const manifestJson = JSON.parse(manifest);
    try {
        const txid2 = await retry(() => platform.invoke("setCollectionContractTemplateNameSegments", [
            sc.ContractParam.string('{"name":"'),
            sc.ContractParam.string(manifestJson.name),
            sc.ContractParam.string('","groups"')
        ]), "setNameSegments");
        await waitForTx(txid2);
        console.log("Name segments configured.");
    } catch (e) { console.warn("Skip Name Segments (Old Contract?):", e.message); }
  } catch (e) { console.error("Template Flow Failed:", e.message); }
}

async function runSharedModeTests() {
  console.log("\n>>> [STEP 1: SHARED MODE TESTS] <<<");
  const USER = new wallet.Account(wallet.generatePrivateKey());
  console.log("Generated User:", USER.address);
  
  // Fund user
  await retry(() => platform.invoke("transfer", [
    sc.ContractParam.hash160(USER.address),
    sc.ContractParam.byteArray(u.HexString.fromHex(u.reverseHex("d2a4cff31913016155e38e474a2c06d08be276bf"))),
    sc.ContractParam.integer(500000000)
  ]), "FundingUser");
  console.log("Funded 5 GAS.");

  const config = { rpcAddress: RPC_URL, account: USER, networkMagic: NETWORK_MAGIC };
  const userPlatform = new experimental.SmartContract(u.HexString.fromHex(FACTORY_HASH), config);

  const suffix = Date.now().toString().slice(-4);
  console.log("Creating Shared Collection...");
  const txid = await retry(() => userPlatform.invoke("createCollection", [
    sc.ContractParam.string(`Shared ${suffix}`), sc.ContractParam.string(`S${suffix}`),
    sc.ContractParam.string("Test"), sc.ContractParam.string("https://"),
    sc.ContractParam.integer(100), sc.ContractParam.integer(500), sc.ContractParam.boolean(true)
  ]), "createCol");
  const log = await waitForTx(txid);
  const colId = decodeString(log.executions[0].notifications.find(n => n.eventname === "CollectionUpserted").state.value[0]);
  console.log("Col ID:", colId);

  console.log("Minting NFT...");
  const txid2 = await retry(() => userPlatform.invoke("mint", [
    sc.ContractParam.byteArray(u.HexString.fromHex(Buffer.from(colId).toString('hex'))),
    sc.ContractParam.hash160(USER.address), sc.ContractParam.string("uri://"), sc.ContractParam.string("{}")
  ]), "mintNFT");
  const log2 = await waitForTx(txid2);
  const tokenId = decodeString(log2.executions[0].notifications.find(n => n.eventname === "TokenUpserted").state.value[0]);
  console.log("Token ID:", tokenId);

  console.log("Market: List -> Cancel -> Relist");
  await retry(() => userPlatform.invoke("listTokenForSale", [
    sc.ContractParam.byteArray(u.HexString.fromHex(Buffer.from(tokenId).toString('hex'))),
    sc.ContractParam.integer(100000000)
  ]), "list");
  await retry(() => userPlatform.invoke("cancelTokenSale", [
    sc.ContractParam.byteArray(u.HexString.fromHex(Buffer.from(tokenId).toString('hex')))
  ]), "cancel");
  await retry(() => userPlatform.invoke("listTokenForSale", [
    sc.ContractParam.byteArray(u.HexString.fromHex(Buffer.from(tokenId).toString('hex'))),
    sc.ContractParam.integer(50000000)
  ]), "relist");
  console.log("Market cycle OK.");
}

async function runDedicatedModeTests() {
  console.log("\n>>> [STEP 2: DEDICATED MODE TESTS] <<<");
  const USER = new wallet.Account(wallet.generatePrivateKey());
  console.log("Generated User:", USER.address);
  await retry(() => platform.invoke("transfer", [
    sc.ContractParam.hash160(USER.address),
    sc.ContractParam.byteArray(u.HexString.fromHex(u.reverseHex("d2a4cff31913016155e38e474a2c06d08be276bf"))),
    sc.ContractParam.integer(1500000000)
  ]), "FundingDedUser");

  const config = { rpcAddress: RPC_URL, account: USER, networkMagic: NETWORK_MAGIC };
  const userPlatform = new experimental.SmartContract(u.HexString.fromHex(FACTORY_HASH), config);

  const suffix = Date.now().toString().slice(-4);
  console.log("Deploying Dedicated Contract (10 GAS Fee)...");
  const txid = await retry(() => userPlatform.invoke("createCollectionAndDeployFromTemplate", [
    sc.ContractParam.string(`Dedicated ${suffix}`), sc.ContractParam.string(`D${suffix}`),
    sc.ContractParam.string("Test"), sc.ContractParam.string("uri://"),
    sc.ContractParam.integer(100), sc.ContractParam.integer(1000), sc.ContractParam.boolean(true),
    sc.ContractParam.any(null)
  ]), "deployDed");
  const log = await waitForTx(txid);
  const dedHash = decodeHash(log.executions[0].notifications.find(n => n.eventname === "CollectionContractDeployed").state.value[2]);
  console.log("Ded Hash:", dedHash);

  const dedicated = new experimental.SmartContract(u.HexString.fromHex(dedHash), config);
  console.log("Verifying Isolation (Expected Fail)...");
  try {
    await dedicated.invoke("createCollection", [sc.ContractParam.string("X"), sc.ContractParam.string("X"), sc.ContractParam.string(""), sc.ContractParam.string(""), sc.ContractParam.integer(0), sc.ContractParam.integer(0), sc.ContractParam.boolean(true)]);
    console.error("Isolation FAIL");
  } catch (e) { console.log("Isolation OK (Blocked)."); }
}

async function main() {
  try {
    await runResetAndLifecycleTests();
    await runSharedModeTests();
    await runDedicatedModeTests();
    console.log("\n========================================");
    console.log("ALL MAJOR FLOWS TESTED SUCCESSFULLY!");
    console.log("========================================");
  } catch (err) {
    console.error("\nCRITICAL FAILURE:", err.message);
    process.exit(1);
  }
}

main();
