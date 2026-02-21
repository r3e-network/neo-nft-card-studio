#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = process.cwd();

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureExists(filePath, errors, label) {
  if (!fs.existsSync(filePath)) {
    errors.push(`${label}: missing file ${filePath}`);
    return false;
  }
  return true;
}

function normalizeType(value) {
  return String(value ?? "").trim();
}

function resolveRustManifest() {
  const preferred = path.join(
    repoRoot,
    "contracts/rust-multi-tenant-nft-platform/target/wasm32-unknown-unknown/release/multi_tenant_nft_platform_rust.manifest.json",
  );
  if (fs.existsSync(preferred)) {
    return preferred;
  }

  const releaseDir = path.join(
    repoRoot,
    "contracts/rust-multi-tenant-nft-platform/target/wasm32-unknown-unknown/release",
  );
  if (!fs.existsSync(releaseDir)) {
    return preferred;
  }

  const manifests = fs
    .readdirSync(releaseDir)
    .filter((name) => name.endsWith(".manifest.json"))
    .sort();

  return manifests.length > 0 ? path.join(releaseDir, manifests[0]) : preferred;
}

function getMethodsByName(manifest) {
  const list = Array.isArray(manifest?.abi?.methods) ? manifest.abi.methods : [];
  const map = new Map();
  for (const method of list) {
    if (!method || typeof method.name !== "string") {
      continue;
    }

    const current = map.get(method.name) ?? [];
    current.push(method);
    map.set(method.name, current);
  }
  return map;
}

function getMethodByArity(methodMap, name, arity) {
  const candidates = methodMap.get(name) ?? [];
  return candidates.find((entry) => Array.isArray(entry.parameters) && entry.parameters.length === arity) ?? null;
}

function includesType(allowed, actual) {
  const normalized = normalizeType(actual).toUpperCase();
  return allowed.some((item) => normalizeType(item).toUpperCase() === normalized);
}

const REQUIRED_STANDARDS = ["NEP-11", "NEP-24"];
const REQUIRED_EVENTS = [
  "Transfer",
  "CollectionUpserted",
  "TokenUpserted",
  "CollectionOperatorUpdated",
  "DropConfigUpdated",
  "DropWhitelistUpdated",
  "DropClaimed",
  "CheckInProgramUpdated",
  "CheckedIn",
];

const FACTORY_REQUIRED_METHODS = [
  "createCollection",
  "createCollectionAndDeployFromTemplate",
  "setCollectionContractTemplate",
  "clearCollectionContractTemplate",
  "hasCollectionContractTemplate",
  "getCollectionContractTemplateDigest",
  "deployCollectionContractFromTemplate",
];

const FACTORY_FORBIDDEN_NFT_METHODS = [
  "symbol",
  "decimals",
  "totalSupply",
  "balanceOf",
  "ownerOf",
  "transfer",
  "tokens",
  "tokensOf",
  "tokenURI",
  "properties",
  "getRoyalties",
  "royaltyInfo",
  "onNEP11Payment",
  "mint",
  "batchMint",
  "burn",
  "claimDrop",
  "checkIn",
  "configureDrop",
  "configureCheckInProgram",
];

const SHARED_METHOD_SPECS = [
  {
    name: "updateCollection",
    safe: false,
    arity: { csharp: 6, solidity: 6, rust: 7 },
    returnTypes: { csharp: ["Void"], solidity: ["Void"], rust: ["Boolean"] },
    rustFirstParamTypes: ["Hash160"],
  },
  {
    name: "setCollectionOperator",
    safe: false,
    arity: { csharp: 3, solidity: 3, rust: 4 },
    returnTypes: { csharp: ["Void"], solidity: ["Void"], rust: ["Boolean"] },
    rustFirstParamTypes: ["Hash160"],
  },
  {
    name: "isCollectionOperator",
    safe: true,
    arity: { csharp: 2, solidity: 2, rust: 2 },
    returnTypes: { csharp: ["Boolean"], solidity: ["Boolean"], rust: ["Boolean"] },
  },
  {
    name: "mint",
    safe: false,
    arity: { csharp: 4, solidity: 4, rust: 5 },
    returnTypes: { csharp: ["ByteArray"], solidity: ["Hash256"], rust: ["Integer"] },
    rustFirstParamTypes: ["Hash160"],
  },
  {
    name: "burn",
    safe: false,
    arity: { csharp: 1, solidity: 1, rust: 2 },
    returnTypes: { csharp: ["Void"], solidity: ["Void"], rust: ["Boolean"] },
    rustFirstParamTypes: ["Hash160"],
  },
  {
    name: "configureDrop",
    safe: false,
    arity: { csharp: 6, solidity: 6, rust: 7 },
    returnTypes: { csharp: ["Void"], solidity: ["Void"], rust: ["Boolean"] },
    rustFirstParamTypes: ["Hash160"],
  },
  {
    name: "setDropWhitelist",
    safe: false,
    arity: { csharp: 3, solidity: 3, rust: 4 },
    returnTypes: { csharp: ["Void"], solidity: ["Void"], rust: ["Boolean"] },
    rustFirstParamTypes: ["Hash160"],
  },
  {
    name: "setDropWhitelistBatch",
    safe: false,
    arity: { csharp: 3, solidity: 3, rust: 4 },
    returnTypes: { csharp: ["Void"], solidity: ["Void"], rust: ["Boolean"] },
    rustFirstParamTypes: ["Hash160"],
  },
  {
    name: "claimDrop",
    safe: false,
    arity: { csharp: 3, solidity: 3, rust: 4 },
    returnTypes: { csharp: ["ByteArray"], solidity: ["Hash256"], rust: ["Integer"] },
    rustFirstParamTypes: ["Hash160"],
  },
  {
    name: "configureCheckInProgram",
    safe: false,
    arity: { csharp: 9, solidity: 9, rust: 10 },
    returnTypes: { csharp: ["Void"], solidity: ["Void"], rust: ["Boolean"] },
    rustFirstParamTypes: ["Hash160"],
  },
  {
    name: "checkIn",
    safe: false,
    arity: { csharp: 3, solidity: 3, rust: 4 },
    returnTypes: { csharp: ["Array"], solidity: ["Array"], rust: ["Array"] },
    rustFirstParamTypes: ["Hash160"],
  },
  {
    name: "getDropConfig",
    safe: true,
    arity: { csharp: 1, solidity: 1, rust: 1 },
    returnTypes: { csharp: ["Array"], solidity: ["Array"], rust: ["Array"] },
  },
  {
    name: "getCheckInProgram",
    safe: true,
    arity: { csharp: 1, solidity: 1, rust: 1 },
    returnTypes: { csharp: ["Array"], solidity: ["Array"], rust: ["Array"] },
  },
  {
    name: "symbol",
    safe: true,
    arity: { csharp: 0, solidity: 0, rust: 0 },
    returnTypes: { csharp: ["String"], solidity: ["String"], rust: ["String"] },
  },
  {
    name: "decimals",
    safe: true,
    arity: { csharp: 0, solidity: 0, rust: 0 },
    returnTypes: { csharp: ["Integer"], solidity: ["Integer"], rust: ["Integer"] },
  },
  {
    name: "totalSupply",
    safe: true,
    arity: { csharp: 0, solidity: 0, rust: 0 },
    returnTypes: { csharp: ["Integer"], solidity: ["Integer"], rust: ["Integer"] },
  },
  {
    name: "balanceOf",
    safe: true,
    arity: { csharp: 1, solidity: 1, rust: 1 },
    returnTypes: { csharp: ["Integer"], solidity: ["Integer"], rust: ["Integer"] },
  },
  {
    name: "ownerOf",
    safe: true,
    arity: { csharp: 1, solidity: 1, rust: 1 },
    returnTypes: { csharp: ["Hash160"], solidity: ["Hash160"], rust: ["Hash160"] },
  },
  {
    name: "transfer",
    safe: false,
    arity: { csharp: 3, solidity: 3, rust: 3 },
    returnTypes: { csharp: ["Boolean"], solidity: ["Boolean"], rust: ["Boolean"] },
  },
  {
    name: "tokens",
    safe: true,
    arity: { csharp: 0, solidity: 0, rust: 0 },
    returnTypes: { csharp: ["InteropInterface"], solidity: ["Array"], rust: ["InteropInterface"] },
  },
  {
    name: "tokensOf",
    safe: true,
    arity: { csharp: 1, solidity: 1, rust: 1 },
    returnTypes: { csharp: ["InteropInterface"], solidity: ["Array"], rust: ["InteropInterface"] },
  },
  {
    name: "tokenURI",
    safe: true,
    arity: { csharp: 1, solidity: 1, rust: 1 },
    returnTypes: { csharp: ["String"], solidity: ["String"], rust: ["String"] },
  },
  {
    name: "properties",
    safe: true,
    arity: { csharp: 1, solidity: 1, rust: 1 },
    returnTypes: { csharp: ["Map"], solidity: ["ByteArray"], rust: ["Map"] },
  },
  {
    name: "getRoyalties",
    safe: true,
    arity: { csharp: 1, solidity: 1, rust: 1 },
    returnTypes: { csharp: ["String"], solidity: ["String"], rust: ["String"] },
  },
  {
    name: "royaltyInfo",
    safe: true,
    arity: { csharp: 3, solidity: 3, rust: 3 },
    returnTypes: { csharp: ["Array"], solidity: ["Array"], rust: ["Array"] },
  },
  {
    name: "onNEP11Payment",
    safe: false,
    arity: { csharp: 4, solidity: 4, rust: 4 },
    returnTypes: { csharp: ["Void"], solidity: ["Void"], rust: ["Void"] },
  },
];

function checkStandards(label, manifest, errors) {
  const standards = new Set((manifest.supportedstandards ?? []).map((value) => String(value).toUpperCase()));
  for (const standard of REQUIRED_STANDARDS) {
    if (!standards.has(standard.toUpperCase())) {
      errors.push(`${label}: missing supported standard ${standard}`);
    }
  }
}

function checkEvents(label, manifest, errors) {
  const events = Array.isArray(manifest?.abi?.events) ? manifest.abi.events : [];
  const names = new Set(events.map((item) => String(item?.name ?? "")));

  for (const eventName of REQUIRED_EVENTS) {
    if (!names.has(eventName)) {
      errors.push(`${label}: missing event ${eventName}`);
    }
  }
}

function checkFactoryManifest(manifest, errors) {
  const standards = new Set((manifest?.supportedstandards ?? []).map((value) => String(value).toUpperCase()));
  const methods = Array.isArray(manifest?.abi?.methods) ? manifest.abi.methods : [];
  const methodNames = new Set(methods.map((method) => String(method?.name ?? "")));

  for (const standard of REQUIRED_STANDARDS) {
    if (standards.has(standard.toUpperCase())) {
      errors.push(`csharp-factory: must not declare ${standard}`);
    }
  }

  for (const methodName of FACTORY_REQUIRED_METHODS) {
    if (!methodNames.has(methodName)) {
      errors.push(`csharp-factory: missing required factory method ${methodName}`);
    }
  }

  for (const methodName of FACTORY_FORBIDDEN_NFT_METHODS) {
    if (methodNames.has(methodName)) {
      errors.push(`csharp-factory: must not expose NFT runtime method ${methodName}`);
    }
  }
}

function checkCsharpRoleSplitSource(errors) {
  const factoryDir = path.join(repoRoot, "contracts/nft-platform-factory");
  const factoryProject = fs.readFileSync(
    path.join(factoryDir, "MultiTenantNftPlatform.csproj"),
    "utf8",
  );
  const templateProject = fs.readFileSync(
    path.join(repoRoot, "contracts/multi-tenant-nft-platform/MultiTenantNftTemplate.csproj"),
    "utf8",
  );
  const factoryFiles = fs.readdirSync(factoryDir);
  const factoryEntry = fs.readFileSync(
    path.join(factoryDir, "MultiTenantNftPlatform.cs"),
    "utf8",
  );
  const templateEntry = fs.readFileSync(
    path.join(repoRoot, "contracts/multi-tenant-nft-platform/MultiTenantNftPlatform.cs"),
    "utf8",
  );

  if (!/PackageReference\s+Include="Neo\.SmartContract\.Framework"/.test(factoryProject)) {
    errors.push("CSharp source: factory csproj should reference Neo.SmartContract.Framework");
  }
  if (!/PackageReference\s+Include="Neo\.SmartContract\.Framework"/.test(templateProject)) {
    errors.push("CSharp source: template csproj should reference Neo.SmartContract.Framework");
  }
  if (factoryFiles.some((name) => /Tokens|Drop|Membership/.test(name))) {
    errors.push("CSharp source: factory directory must not include NFT runtime source files");
  }

  for (const requiredFactoryFile of [
    "MultiTenantNftPlatform.cs",
    "MultiTenantNftPlatform.Lifecycle.cs",
    "MultiTenantNftPlatform.Collections.cs",
    "MultiTenantNftPlatform.Internal.cs",
  ]) {
    if (!factoryFiles.includes(requiredFactoryFile)) {
      errors.push(`CSharp source: factory directory missing ${requiredFactoryFile}`);
    }
  }

  if (/SupportedStandards\("NEP-11"/.test(factoryEntry)) {
    errors.push("CSharp source: factory entry must not declare NEP-11");
  }
  if (!/ManifestExtra\("ContractRole",\s*"Factory"\)/.test(factoryEntry)) {
    errors.push("CSharp source: factory entry must declare ContractRole=Factory");
  }
  if (!/SupportedStandards\("NEP-11",\s*"NEP-24"\)/.test(templateEntry)) {
    errors.push("CSharp source: template entry must declare NEP-11/NEP-24");
  }
}

function checkSharedMethods(methodMaps, errors) {
  for (const spec of SHARED_METHOD_SPECS) {
    for (const dialect of ["csharp", "solidity", "rust"]) {
      const method = getMethodByArity(methodMaps[dialect], spec.name, spec.arity[dialect]);
      if (!method) {
        errors.push(
          `${dialect}: missing method ${spec.name} with arity ${spec.arity[dialect]}`,
        );
        continue;
      }

      if (Boolean(method.safe) !== spec.safe) {
        errors.push(`${dialect}: ${spec.name} safe flag mismatch, expected ${spec.safe}`);
      }

      if (!includesType(spec.returnTypes[dialect], method.returntype)) {
        errors.push(
          `${dialect}: ${spec.name} return type mismatch, expected one of [${spec.returnTypes[dialect].join(", ")}], got ${normalizeType(method.returntype)}`,
        );
      }

      if (dialect === "rust" && Array.isArray(spec.rustFirstParamTypes) && spec.rustFirstParamTypes.length > 0) {
        const params = Array.isArray(method.parameters) ? method.parameters : [];
        if (params.length === 0 || !includesType(spec.rustFirstParamTypes, params[0]?.type)) {
          errors.push(
            `rust: ${spec.name} first parameter must be one of [${spec.rustFirstParamTypes.join(", ")}], got ${normalizeType(params[0]?.type)}`,
          );
        }
      }
    }
  }
}

function checkSymbolConsistency(errors) {
  const csharp = fs.readFileSync(
    path.join(repoRoot, "contracts/multi-tenant-nft-platform/MultiTenantNftPlatform.Lifecycle.cs"),
    "utf8",
  );
  const solidity = fs.readFileSync(
    path.join(repoRoot, "contracts/solidity/src/NftStorage.sol"),
    "utf8",
  );
  const rust = fs.readFileSync(
    path.join(repoRoot, "contracts/rust-multi-tenant-nft-platform/src/methods/core.rs"),
    "utf8",
  );

  if (!/symbol\(\)[\s\S]*?"MNFTP"/.test(csharp)) {
    errors.push("CSharp source: symbol must be MNFTP");
  }

  if (!/_SYMBOL\s*=\s*"MNFTP"\s*;/.test(solidity)) {
    errors.push("Solidity source: _SYMBOL must be MNFTP");
  }

  if (!/NeoString::from_str\("MNFTP"\)/.test(rust)) {
    errors.push("Rust source: symbol must be MNFTP");
  }
}

function checkCsharpDedicatedInitializationHardening(errors) {
  const templateLifecycle = fs.readFileSync(
    path.join(repoRoot, "contracts/multi-tenant-nft-platform/MultiTenantNftPlatform.Lifecycle.cs"),
    "utf8",
  );
  const templateCollections = fs.readFileSync(
    path.join(repoRoot, "contracts/multi-tenant-nft-platform/MultiTenantNftPlatform.Collections.cs"),
    "utf8",
  );
  const factoryCollections = fs.readFileSync(
    path.join(repoRoot, "contracts/nft-platform-factory/MultiTenantNftPlatform.Collections.cs"),
    "utf8",
  );

  if (!/object\[\]\s+values\s*=\s*\(object\[\]\)data;/.test(templateLifecycle)
    || !/\(values\.Length == 1 \|\| values\.Length == 13\)/.test(templateLifecycle)
    || !/UInt160\s+initializerContract\s*=\s*\(UInt160\)values\[0\];/.test(templateLifecycle)) {
    errors.push("CSharp source: template _deploy should safely parse initializer contract from deploy data");
  }

  if (!/Runtime\.CheckWitness\(owner\)/.test(templateCollections)) {
    errors.push("CSharp source: initializeDedicatedCollection should evaluate owner witness");
  }

  if (!/Runtime\.CallingScriptHash == initializerContract/.test(templateCollections)
    || !/if\s*\(!ownerWitness && !initializerAuthorized\)/.test(templateCollections)) {
    errors.push("CSharp source: initializeDedicatedCollection should allow either owner witness or configured initializer contract");
  }

  if (!/Runtime\.ExecutingScriptHash/.test(factoryCollections)
    || !/ContractManagement\.Deploy\(templateNef,\s*templateManifest,\s*deployData\)/.test(factoryCollections)) {
    errors.push("CSharp source: factory deploy should pass its own script hash into template deploy data");
  }
}

function checkQueryLayoutConsistency(errors) {
  const solidity = fs.readFileSync(
    path.join(repoRoot, "contracts/solidity/src/NftQueryLogic.sol"),
    "utf8",
  );

  if (!/function\s+getCollection\([^)]*\)\s*[\s\S]*?returns\s*\(\s*uint256\s+id\s*,/m.test(solidity)) {
    errors.push("Solidity source: getCollection must return collectionId as first field");
  }

  if (!/function\s+getToken\([^)]*\)\s*[\s\S]*?returns\s*\(\s*bytes32\s+id\s*,/m.test(solidity)) {
    errors.push("Solidity source: getToken must return tokenId as first field");
  }
}

function checkRustStringStorageConsistency(errors) {
  const token = fs.readFileSync(
    path.join(repoRoot, "contracts/rust-multi-tenant-nft-platform/src/methods/token.rs"),
    "utf8",
  );
  const collection = fs.readFileSync(
    path.join(repoRoot, "contracts/rust-multi-tenant-nft-platform/src/methods/collection.rs"),
    "utf8",
  );
  const query = fs.readFileSync(
    path.join(repoRoot, "contracts/rust-multi-tenant-nft-platform/src/methods/query.rs"),
    "utf8",
  );

  if (!/write_string_field\([\s\S]*?TOKEN_FIELD_URI_REF[\s\S]*?effective_token_uri/m.test(token)) {
    errors.push("Rust source: mint path must persist token URI via write_string_field");
  }
  if (!/write_string_field\([\s\S]*?TOKEN_FIELD_PROPERTIES_REF[\s\S]*?effective_properties/m.test(token)) {
    errors.push("Rust source: mint path must persist token properties via write_string_field");
  }
  if (/write_i64\(\s*storage,\s*&token_field_key\(token_id,\s*TOKEN_FIELD_URI_REF\)/m.test(token)) {
    errors.push("Rust source: mint path must not persist token URI via write_i64");
  }
  if (/write_i64\(\s*storage,\s*&token_field_key\(token_id,\s*TOKEN_FIELD_PROPERTIES_REF\)/m.test(token)) {
    errors.push("Rust source: mint path must not persist token properties via write_i64");
  }

  const collectionStringWrites = [
    "FIELD_NAME_REF",
    "FIELD_SYMBOL_REF",
    "FIELD_DESC_REF",
    "FIELD_BASE_URI_REF",
  ];
  for (const field of collectionStringWrites) {
    const pattern = new RegExp(`write_string_field\\(\\s*&storage,\\s*&collection_field_key\\(collection_id,\\s*${field}\\)`, "m");
    if (!pattern.test(collection)) {
      errors.push(`Rust source: create/update collection must persist ${field} via write_string_field`);
    }
  }

  if (!/pub\s+fn\s+token_uri\([^)]*\)\s*->\s*NeoString[\s\S]*?read_string_field\(&storage,\s*&token_field_key\(token_id,\s*TOKEN_FIELD_URI_REF\)\)/m.test(query)) {
    errors.push("Rust source: tokenURI query must read from read_string_field");
  }
  if (!/get_token_field[\s\S]*?TOKEN_FIELD_URI_REF[\s\S]*?read_string_field/m.test(query)) {
    errors.push("Rust source: getTokenField(uri/properties) should surface string values via read_string_field");
  }
}

function checkNep11ReceiverCallbackConsistency(errors) {
  const csharp = fs.readFileSync(
    path.join(repoRoot, "contracts/multi-tenant-nft-platform/MultiTenantNftPlatform.Internal.cs"),
    "utf8",
  );
  const solidity = fs.readFileSync(
    path.join(repoRoot, "contracts/solidity/src/NftTokenLogic.sol"),
    "utf8",
  );
  const rust = fs.readFileSync(
    path.join(repoRoot, "contracts/rust-multi-tenant-nft-platform/src/methods/token.rs"),
    "utf8",
  );

  if (!/ContractManagement\.GetContract\(to\)/.test(csharp) || !/Contract\.Call\(to,\s*"onNEP11Payment"/.test(csharp)) {
    errors.push("CSharp source: PostTransfer should call receiver onNEP11Payment when destination is a contract");
  }

  if (!/INEP26Receiver\(to\)\.onNEP11Payment\(/.test(solidity)) {
    errors.push("Solidity source: mint/transfer should call receiver onNEP11Payment for contract destinations");
  }

  if (!/onNEP11Payment/.test(rust) || !/call_nep11_receiver\(/.test(rust)) {
    errors.push("Rust source: mint/transfer should route receiver callback via onNEP11Payment");
  }
}

function main() {
  const errors = [];

  const manifestPaths = {
    csharpFactory: path.join(repoRoot, "contracts/multi-tenant-nft-platform/build/MultiTenantNftPlatform.manifest.json"),
    csharpTemplate: path.join(repoRoot, "contracts/multi-tenant-nft-platform/build/MultiTenantNftTemplate.manifest.json"),
    solidity: path.join(repoRoot, "contracts/solidity/build/MultiTenantNftPlatform.manifest.json"),
    rust: resolveRustManifest(),
  };

  for (const [dialect, file] of Object.entries(manifestPaths)) {
    ensureExists(file, errors, dialect);
  }

  if (errors.length > 0) {
    console.error("Contract consistency check failed:");
    errors.forEach((error, index) => {
      console.error(`${index + 1}. ${error}`);
    });
    process.exit(1);
  }

  const manifests = {
    csharpFactory: readJson(manifestPaths.csharpFactory),
    csharpTemplate: readJson(manifestPaths.csharpTemplate),
    solidity: readJson(manifestPaths.solidity),
    rust: readJson(manifestPaths.rust),
  };

  for (const [dialect, manifest] of Object.entries({
    csharpTemplate: manifests.csharpTemplate,
    solidity: manifests.solidity,
    rust: manifests.rust,
  })) {
    checkStandards(dialect, manifest, errors);
    checkEvents(dialect, manifest, errors);
  }

  checkFactoryManifest(manifests.csharpFactory, errors);

  const methodMaps = {
    csharp: getMethodsByName(manifests.csharpTemplate),
    solidity: getMethodsByName(manifests.solidity),
    rust: getMethodsByName(manifests.rust),
  };

  checkSharedMethods(methodMaps, errors);
  checkCsharpRoleSplitSource(errors);
  checkCsharpDedicatedInitializationHardening(errors);
  checkSymbolConsistency(errors);
  checkQueryLayoutConsistency(errors);
  checkRustStringStorageConsistency(errors);
  checkNep11ReceiverCallbackConsistency(errors);

  if (errors.length > 0) {
    console.error("Contract consistency check failed:");
    errors.forEach((error, index) => {
      console.error(`${index + 1}. ${error}`);
    });
    process.exit(1);
  }

  console.log("Contract consistency verification passed for CSharp factory/template, Solidity, Rust.");
}

main();
