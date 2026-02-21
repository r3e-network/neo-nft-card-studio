import { NeoNftPlatformClient } from "../packages/neo-sdk/src/index";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function main(): void {
  const rpcUrl = "https://testnet1.neo.coz.io:443";
  const contractHash = "0x0000000000000000000000000000000000000001";

  const csharp = new NeoNftPlatformClient({ rpcUrl, contractHash, dialect: "csharp" });
  assert(
    !("buildDeployCollectionContractInvoke" in (csharp as Record<string, unknown>)),
    "Legacy custom deploy invoke builder should not exist",
  );
  assert(typeof csharp.getOwnerDedicatedCollection === "function", "Missing getOwnerDedicatedCollection reader");
  assert(
    typeof csharp.getOwnerDedicatedCollectionContract === "function",
    "Missing getOwnerDedicatedCollectionContract reader",
  );
  assert(
    typeof csharp.hasOwnerDedicatedCollectionContract === "function",
    "Missing hasOwnerDedicatedCollectionContract reader",
  );
  assert(
    typeof csharp.hasCollectionContractTemplateNameSegments === "function",
    "Missing hasCollectionContractTemplateNameSegments reader",
  );

  const csharpMint = csharp.buildMintInvoke({
    collectionId: "1",
    to: "0x0000000000000000000000000000000000000001",
    tokenUri: "https://example.com/1.json",
    propertiesJson: "{}",
  });
  assert(csharpMint.args[0].type === "ByteArray", "C# mint collectionId should be ByteArray");
  assert(csharpMint.args[0].value === "31", "C# collectionId '1' should be UTF-8 encoded as 31");

  const templateInvoke = csharp.buildDeployCollectionContractFromTemplateInvoke({
    collectionId: "1",
    extraData: { mode: "smoke" },
  });
  assert(
    templateInvoke.operation === "deployCollectionContractFromTemplate",
    "Template deploy operation mismatch",
  );
  const templateSegmentsInvoke = csharp.buildSetCollectionContractTemplateNameSegmentsInvoke({
    manifestPrefix: '{"name":"',
    templateNameBase: "MultiTenantNftTemplate",
    manifestSuffix: '"}',
  });
  assert(
    templateSegmentsInvoke.operation === "setCollectionContractTemplateNameSegments",
    "Template manifest-name segments operation mismatch",
  );

  const createAndDeployInvoke = csharp.buildCreateCollectionAndDeployFromTemplateInvoke({
    name: "Smoke",
    symbol: "SMK",
    description: "Smoke",
    baseUri: "https://example.com/",
    maxSupply: "10",
    royaltyBps: 500,
    transferable: true,
    extraData: { mode: "dedicated" },
  });
  assert(
    createAndDeployInvoke.operation === "createCollectionAndDeployFromTemplate",
    "Create-and-deploy operation mismatch",
  );

  const dropConfigInvoke = csharp.buildConfigureDropInvoke({
    collectionId: "1",
    enabled: true,
    startAt: 0,
    endAt: 0,
    perWalletLimit: 1,
    whitelistRequired: true,
  });
  assert(dropConfigInvoke.operation === "configureDrop", "Drop config operation mismatch");

  const dropClaimInvoke = csharp.buildClaimDropInvoke({
    collectionId: "1",
    tokenUri: "",
    propertiesJson: "{}",
  });
  assert(dropClaimInvoke.operation === "claimDrop", "Drop claim operation mismatch");

  const checkInProgramInvoke = csharp.buildConfigureCheckInProgramInvoke({
    collectionId: "1",
    enabled: true,
    membershipRequired: true,
    membershipSoulbound: true,
    startAt: 0,
    endAt: 0,
    intervalSeconds: 86400,
    maxCheckInsPerWallet: 0,
    mintProofNft: true,
  });
  assert(checkInProgramInvoke.operation === "configureCheckInProgram", "Check-in program operation mismatch");

  const checkInInvoke = csharp.buildCheckInInvoke({
    collectionId: "1",
    tokenUri: "",
    propertiesJson: "{}",
  });
  assert(checkInInvoke.operation === "checkIn", "Check-in operation mismatch");

  const solidity = new NeoNftPlatformClient({ rpcUrl, contractHash, dialect: "solidity" });
  const solidityTransfer = solidity.buildTransferInvoke(
    "0x0000000000000000000000000000000000000001",
    "0x1111111111111111111111111111111111111111111111111111111111111111",
    { dataRef: "0x00" },
  );
  assert(solidityTransfer.args[1].type === "Hash256", "Solidity tokenId should map to Hash256");
  const solidityWhitelistBatch = solidity.buildSetDropWhitelistBatchInvoke({
    collectionId: "1",
    entries: [
      {
        account: "0x0000000000000000000000000000000000000001",
        allowance: 1,
      },
    ],
  });
  assert(solidityWhitelistBatch.operation === "setDropWhitelistBatch", "Solidity whitelist batch mismatch");

  const rust = new NeoNftPlatformClient({ rpcUrl, contractHash, dialect: "rust" });
  const rustCreate = rust.buildCreateCollectionInvoke({
    name: "x",
    symbol: "X",
    description: "x",
    baseUri: "x",
    maxSupply: "10",
    royaltyBps: 0,
    transferable: true,
    creatorRef: "1",
    nameRef: "100",
    symbolRef: "101",
    descriptionRef: "102",
    baseUriRef: "103",
  });
  assert(rustCreate.args[0].type === "Integer", "Rust creatorRef should be Integer");
  const rustClaim = rust.buildClaimDropInvoke({
    collectionId: "1",
    claimerRef: "1",
    tokenUriRef: "2001",
    propertiesRef: "2002",
  });
  assert(rustClaim.args[0].type === "Integer", "Rust claimDrop claimerRef should be Integer");

  console.log("SDK assertions passed");
}

main();
