import { experimental, rpc, sc, tx, u, wallet } from "@cityofzion/neon-js";

// Configuration
const RPC_URL = "https://testnet1.neo.coz.io:443";
const FACTORY_HASH = "0xc1868eba3ce06ad93962378537f8a59f3cae1548";
const NETWORK_MAGIC = 894710606; // N3 Testnet

function readRequiredWif() {
  const wif = process.env.NEO_TEST_WIF?.trim();
  if (!wif) {
    throw new Error("Missing NEO_TEST_WIF. Set it to a Neo N3 testnet WIF before running this script.");
  }
  return wif;
}

const ACCOUNT = new wallet.Account(readRequiredWif());
const rpcClient = new rpc.RPCClient(RPC_URL);

async function main() {
  const config = {
    rpcAddress: RPC_URL,
    account: ACCOUNT,
    networkMagic: NETWORK_MAGIC,
  };

  try {
    console.log("Account Address:", ACCOUNT.address);

    // 1. Resolve existing collections
    console.log("\n--- Resolving Collections ---");
    const dedicatedHashRes = await rpcClient.invokeFunction(FACTORY_HASH, "getOwnerDedicatedCollectionContract", [
      sc.ContractParam.hash160(ACCOUNT.address)
    ]);
    
    let dedicatedHash = "";
    if (dedicatedHashRes.stack && dedicatedHashRes.stack[0] && dedicatedHashRes.stack[0].value) {
        const dedicatedHashBase64 = dedicatedHashRes.stack[0].value;
        const dedicatedHashBigEndian = Buffer.from(dedicatedHashBase64, 'base64').toString('hex');
        dedicatedHash = '0x' + u.reverseHex(dedicatedHashBigEndian);
        console.log("Found Dedicated Collection Contract:", dedicatedHash);
    } else {
        throw new Error("Could not find dedicated collection contract for this WIF.");
    }

    const dedicatedIdRes = await rpcClient.invokeFunction(FACTORY_HASH, "getOwnerDedicatedCollectionId", [
      sc.ContractParam.hash160(ACCOUNT.address)
    ]);
    
    let dedicatedId = "elite_pass";
    if (dedicatedIdRes.stack && dedicatedIdRes.stack[0] && dedicatedIdRes.stack[0].value) {
        dedicatedId = Buffer.from(dedicatedIdRes.stack[0].value, 'base64').toString('utf8');
    }
    console.log("Using Dedicated Collection ID:", dedicatedId);

    // 2. Mint NFTs
    console.log("\n--- Minting NFTs to Dedicated Contract ---");
    
    const dedicatedContract = new experimental.SmartContract(u.HexString.fromHex(dedicatedHash), config);

    // Mint 1
    console.log("Minting 'Elite Cyber Samurai #001'...");
    const mint1 = await dedicatedContract.invoke("mint", [
      sc.ContractParam.byteArray(Buffer.from(dedicatedId).toString('hex')),
      sc.ContractParam.hash160(ACCOUNT.address),
      sc.ContractParam.string("https://cyber.r3e.network/nfts/1"),
      sc.ContractParam.string(JSON.stringify({
        name: "Elite Cyber Samurai #001",
        description: "The legendary protector of the R3E ecosystem.",
        image: "https://images.unsplash.com/photo-1614728263952-84ea256f9679?w=800",
        attributes: [
          { trait_type: "Class", value: "Warrior" },
          { trait_type: "Rarity", value: "Legendary" }
        ]
      }))
    ]);
    console.log("Mint 1 TX:", mint1);

    // Mint 2
    console.log("Minting 'Cyber Pulse #42'...");
    const mint2 = await dedicatedContract.invoke("mint", [
      sc.ContractParam.byteArray(Buffer.from(dedicatedId).toString('hex')),
      sc.ContractParam.hash160(ACCOUNT.address),
      sc.ContractParam.string("https://cyber.r3e.network/nfts/42"),
      sc.ContractParam.string(JSON.stringify({
        name: "Cyber Pulse #42",
        description: "Pure energy encapsulated in a digital frame.",
        image: "https://images.unsplash.com/photo-1633167606207-d840b5070fc2?w=800",
        attributes: [
          { trait_type: "Type", value: "Energy" }
        ]
      }))
    ]);
    console.log("Mint 2 TX:", mint2);

    console.log("\nSuccess: NFTs minted.");
    console.log("Check the frontend under 'Portfolio' to see your new items.");

  } catch (err) {
    console.error("Error in script:", err);
    process.exitCode = 1;
  }
}

main();
