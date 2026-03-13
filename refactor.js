const fs = require('fs');
const path = require('path');

const srcDir = path.join(process.cwd(), 'contracts/nft-platform-factory');
const outDir = path.join(process.cwd(), 'contracts/multi-tenant-nft-platform');

// 1. We will read the FACTORY's Internal.cs and Collections.cs because they are more comprehensive on platform methods.
let factoryInternal = fs.readFileSync(path.join(srcDir, 'MultiTenantNftPlatform.Internal.cs'), 'utf8');
let factoryCollections = fs.readFileSync(path.join(srcDir, 'MultiTenantNftPlatform.Collections.cs'), 'utf8');

// 2. We need to grab initializeDedicatedCollection, setDedicatedExtraData, and getDedicatedExtraData from Template's Collections.cs
let templateCollections = fs.readFileSync(path.join(outDir, 'MultiTenantNftPlatform.Collections.cs'), 'utf8');
let initDedicatedMethod = templateCollections.match(/public static void initializeDedicatedCollection[\s\S]*?EmitCollectionUpserted\(collectionId, state\);\s*\n\s*}/)[0];
let setDedicatedExtraDataMethod = templateCollections.match(/public static void setDedicatedExtraData[\s\S]*?SetDedicatedExtraData\(collectionId, extraData\);\s*\n\s*}/)[0];
let getDedicatedExtraDataMethod = templateCollections.match(/\[Safe\]\s*\n\s*public static object getDedicatedExtraData[\s\S]*?return GetDedicatedExtraData\(collectionId\);\s*\n\s*}/)[0];

// Insert them into factoryCollections, right before the last closing brace
let combinedCollections = factoryCollections.replace(/}\s*$/, "\n\n    " + initDedicatedMethod + "\n\n    " + setDedicatedExtraDataMethod + "\n\n    " + getDedicatedExtraDataMethod + "\n}\n");

// Add GAS 10 fee to createCollectionAndDeployFromTemplate
combinedCollections = combinedCollections.replace(
    /UInt160 sender = GetSenderChecked\(\);/,
    `UInt160 sender = GetSenderChecked();\n        byte[] GAS_HASH = new byte[] { 0xe4, 0x24, 0x4a, 0xaf, 0xba, 0x20, 0xe9, 0x08, 0x70, 0x3b, 0xd3, 0x33, 0xe6, 0x9e, 0x04, 0x11, 0x19, 0xf3, 0x4c, 0xd2 };\n        bool feePaid = (bool)Contract.Call((UInt160)GAS_HASH, "transfer", CallFlags.All, sender, Runtime.ExecutingScriptHash, (BigInteger)10_00000000, null);\n        if (!feePaid)\n        {\n            throw new Exception("Insufficient GAS fee for deploying template. Requires 10 GAS.");\n        }`
);

fs.writeFileSync(path.join(outDir, 'MultiTenantNftPlatform.Collections.cs'), combinedCollections);
console.log('Merged Collections.cs');

// 3. We need to grab PrefixInitializerContract, PrefixDedicatedExtraData, GetInitializerContract, setDedicatedExtraData helpers from Template's Internal.cs
let templateInternal = fs.readFileSync(path.join(outDir, 'MultiTenantNftPlatform.Internal.cs'), 'utf8');

function extractCode(str, regex) {
    let match = str.match(regex);
    return match ? match[0] : "";
}

let prefixInit = extractCode(templateInternal, /private static readonly byte\[\] PrefixInitializerContract = \[0x05\];/);
let prefixDedExtra = extractCode(templateInternal, /private static readonly byte\[\] PrefixDedicatedExtraData = \[0x25\];/);

let getInitContract = extractCode(templateInternal, /private static UInt160 GetInitializerContract[\s\S]*?return \(UInt160\)value;\s*\n\s*}/);
let getDedExtraData = extractCode(templateInternal, /private static object GetDedicatedExtraData[\s\S]*?return StdLib\.Deserialize\(serialized\);\s*\n\s*}/);
let setDedExtraData = extractCode(templateInternal, /private static void SetDedicatedExtraData[\s\S]*?DedicatedExtraDataStore\(\)\.Put\(collectionId, StdLib\.Serialize\(extraData\)\);\s*\n\s*}/);
let dedExtraDataStore = extractCode(templateInternal, /private static StorageMap DedicatedExtraDataStore[\s\S]*?return new StorageMap\(Storage\.CurrentContext, PrefixDedicatedExtraData\);\s*\n\s*}/);

factoryInternal = factoryInternal.replace(/private static StorageMap TokenClasses/, dedExtraDataStore + "\n\n    private static StorageMap TokenClasses");
factoryInternal = factoryInternal.replace(/private static readonly byte\[\] PrefixTotalSupply = \[0x01\];/, "private static readonly byte[] PrefixTotalSupply = [0x01];\n    " + prefixInit + "\n    " + prefixDedExtra);
factoryInternal = factoryInternal.replace(/private static UInt160 GetContractOwner[\s\S]*?return \(UInt160\)Storage.Get\(Storage.CurrentContext, PrefixContractOwner\);\s*\n\s*}/, getInitContract + "\n\n    " + getDedExtraData + "\n\n    " + setDedExtraData + "\n\n    private static UInt160 GetContractOwner()\n    {\n        return (UInt160)Storage.Get(Storage.CurrentContext, PrefixContractOwner);\n    }");

fs.writeFileSync(path.join(outDir, 'MultiTenantNftPlatform.Internal.cs'), factoryInternal);
console.log('Merged Internal.cs');

// 4. Remove 'AssertDedicatedContractMode();' from Top Level functions in Tokens, Membership, Drop
function removeAssert(fileName) {
    let filePath = path.join(outDir, fileName);
    let code = fs.readFileSync(filePath, 'utf8');
    code = code.replace(/^\s*AssertDedicatedContractMode\(\);\s*$/gm, '');
    fs.writeFileSync(filePath, code);
    console.log('Processed', fileName);
}
removeAssert('MultiTenantNftPlatform.Tokens.cs');
removeAssert('MultiTenantNftPlatform.Membership.cs');
removeAssert('MultiTenantNftPlatform.Drop.cs');

// 5. Update main class file
let mainCs = fs.readFileSync(path.join(outDir, 'MultiTenantNftPlatform.cs'), 'utf8');
// make sure SupportedStandards attributes exist 
if (!mainCs.includes('SupportedStandards')) {
    mainCs = mainCs.replace(/\[ContractPermission/, `[SupportedStandards("NEP-11", "NEP-24")]\n[ContractPermission`);
}
mainCs = mainCs.replace(/\[DisplayName\("MultiTenantNftTemplate"\)\]/, '[DisplayName("MultiTenantNftPlatform")]');
mainCs = mainCs.replace(/\[ManifestExtra\("ContractRole", "Template"\)\]/, '[ManifestExtra("ContractRole", "Platform")]');

if (!mainCs.includes('OnCollectionContractDeployed')) {
    mainCs = mainCs.replace(/public static event Action<ByteString, UInt160, bool> OnCollectionOperatorUpdated;/, `public static event Action<ByteString, UInt160, bool> OnCollectionOperatorUpdated;\n\n    [DisplayName("CollectionContractDeployed")]\n    public static event Action<ByteString, UInt160, UInt160> OnCollectionContractDeployed;`);
}

mainCs = mainCs.replace(/public static void onNEP11Payment[\s\S]*?}$/m, `public static void onNEP11Payment(UInt160 _from, BigInteger _amount, ByteString _tokenId, object _data)\n    {\n        throw new Exception("Receiving NEP-11 is not supported");\n    }\n\n    public static void onNEP17Payment(UInt160 _from, BigInteger _amount, object _data)\n    {\n        // Allow receiving NEP-17 (like GAS) for creation fees\n    }\n`);

let factoryMain = fs.readFileSync(path.join(srcDir, 'MultiTenantNftPlatform.cs'), 'utf8');
let factoryPrefixesStr = extractCode(factoryMain, /private static readonly byte\[\] PrefixContractOwner[\s\S]*?PrefixTokenClass = \[0x24\];/);
if (factoryPrefixesStr) {
    mainCs = mainCs.replace(/private static readonly byte\[\] PrefixContractOwner[\s\S]*?PrefixDedicatedExtraData = \[0x25\];/, factoryPrefixesStr + "\n    private static readonly byte[] PrefixDedicatedExtraData = [0x25];\n    private static readonly byte[] PrefixInitializerContract = [0x05];");
}

fs.writeFileSync(path.join(outDir, 'MultiTenantNftPlatform.cs'), mainCs);
console.log('Updated main MultiTenantNftPlatform.cs');

// Also update csproj and scripts/package.json
const pkgPath = path.join(process.cwd(), 'package.json');
let pkgStr = fs.readFileSync(pkgPath, 'utf8');
pkgStr = pkgStr.replace(/contracts\/nft-platform-factory\/MultiTenantNftPlatform.csproj/g, 'contracts/multi-tenant-nft-platform/MultiTenantNftPlatform.csproj');
fs.writeFileSync(pkgPath, pkgStr);

fs.rmSync(srcDir, { recursive: true, force: true });
console.log('Deleted old factory dir');
