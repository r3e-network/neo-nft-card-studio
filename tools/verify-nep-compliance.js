#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = process.cwd();

const REQUIRED_STANDARDS = ["NEP-11", "NEP-24"];

const METHOD_SHAPES = {
  symbol: {
    safe: true,
    returnTypes: ["String"],
    paramTypes: [],
  },
  decimals: {
    safe: true,
    returnTypes: ["Integer"],
    paramTypes: [],
  },
  totalSupply: {
    safe: true,
    returnTypes: ["Integer"],
    paramTypes: [],
  },
  balanceOf: {
    safe: true,
    returnTypes: ["Integer"],
    paramTypes: [["Hash160"]],
  },
  ownerOf: {
    safe: true,
    returnTypes: ["Hash160"],
    paramTypes: [["ByteArray", "Hash256"]],
  },
  transfer: {
    safe: false,
    returnTypes: ["Boolean"],
    paramTypes: [["Hash160"], ["ByteArray", "Hash256"], ["Any", "ByteArray"]],
  },
  tokens: {
    safe: true,
    returnTypes: ["InteropInterface", "Array"],
    paramTypes: [],
  },
  tokensOf: {
    safe: true,
    returnTypes: ["InteropInterface", "Array"],
    paramTypes: [["Hash160"]],
  },
  tokenURI: {
    safe: true,
    returnTypes: ["String"],
    paramTypes: [["ByteArray", "Hash256"]],
  },
  properties: {
    safe: true,
    returnTypes: ["Map", "ByteArray"],
    paramTypes: [["ByteArray", "Hash256"]],
  },
  getRoyalties: {
    safe: true,
    returnTypes: ["String"],
    paramTypes: [["ByteArray", "Hash256"]],
  },
  royaltyInfo: {
    safe: true,
    returnTypes: ["Array"],
    paramTypes: [["ByteArray", "Hash256"], ["Hash160"], ["Integer"]],
  },
  onNEP11Payment: {
    safe: false,
    returnTypes: ["Void"],
    paramTypes: [["Hash160"], ["Integer"], ["ByteArray", "Hash256"], ["Any", "ByteArray"]],
  },
};

const TRANSFER_EVENT_PARAM_TYPES = [
  ["Hash160"],
  ["Hash160"],
  ["Integer"],
  ["ByteArray", "Hash256"],
];

const CSHARP_TEMPLATE_REQUIRED_METHODS = [
  "setCollectionContractTemplate",
  "clearCollectionContractTemplate",
  "hasCollectionContractTemplate",
  "getCollectionContractTemplateDigest",
  "deployCollectionContractFromTemplate",
  "createCollectionAndDeployFromTemplate",
  "getOwnerDedicatedCollectionContract",
  "hasOwnerDedicatedCollectionContract",
];

const CSHARP_TEMPLATE_FORBIDDEN_METHODS = ["deployCollectionContract"];

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function ensureFileExists(filePath, errors, label) {
  if (!fs.existsSync(filePath)) {
    errors.push(`${label}: manifest not found at ${filePath}`);
    return false;
  }
  return true;
}

function resolveRustManifest() {
  const preferred = path.join(
    repoRoot,
    "contracts/rust-multi-tenant-nft-platform/target/wasm32-unknown-unknown/release/multi_tenant_nft_platform_rust.manifest.json"
  );
  if (fs.existsSync(preferred)) {
    return preferred;
  }

  const releaseDir = path.join(
    repoRoot,
    "contracts/rust-multi-tenant-nft-platform/target/wasm32-unknown-unknown/release"
  );
  if (!fs.existsSync(releaseDir)) {
    return preferred;
  }

  const manifests = fs
    .readdirSync(releaseDir)
    .filter((name) => name.endsWith(".manifest.json"))
    .sort();

  if (manifests.length === 0) {
    return preferred;
  }

  return path.join(releaseDir, manifests[0]);
}

function normalizeType(type) {
  return String(type ?? "").trim();
}

function includesType(allowedTypes, actualType) {
  return allowedTypes.some((expected) => expected.toUpperCase() === actualType.toUpperCase());
}

function checkMethodShape(label, methodMap, methodName, definition, errors) {
  const entry = methodMap.get(methodName);
  if (!entry) {
    errors.push(`${label}: missing method ${methodName}`);
    return;
  }

  if (entry.safe !== definition.safe) {
    errors.push(`${label}: method ${methodName} should be safe=${definition.safe}`);
  }

  const actualReturnType = normalizeType(entry.returntype);
  if (!includesType(definition.returnTypes, actualReturnType)) {
    errors.push(
      `${label}: method ${methodName} return type should be one of [${definition.returnTypes.join(
        ", "
      )}], got ${actualReturnType || "<empty>"}`
    );
  }

  const params = Array.isArray(entry.parameters) ? entry.parameters : [];
  if (params.length !== definition.paramTypes.length) {
    errors.push(
      `${label}: method ${methodName} should accept exactly ${definition.paramTypes.length} parameters, got ${params.length}`
    );
    return;
  }

  for (const [index, allowedParamTypes] of definition.paramTypes.entries()) {
    const actual = normalizeType(params[index]?.type);
    if (!includesType(allowedParamTypes, actual)) {
      errors.push(
        `${label}: method ${methodName} param #${index + 1} should be one of [${allowedParamTypes.join(
          ", "
        )}], got ${actual || "<empty>"}`
      );
    }
  }
}

function checkTransferEvent(label, events, errors) {
  const transferEvent = events.find((event) => event.name === "Transfer");
  if (!transferEvent) {
    errors.push(`${label}: missing Transfer event`);
    return;
  }

  const params = Array.isArray(transferEvent.parameters) ? transferEvent.parameters : [];
  if (params.length !== 4) {
    errors.push(`${label}: Transfer event should contain 4 parameters, got ${params.length}`);
    return;
  }

  for (const [index, allowedTypes] of TRANSFER_EVENT_PARAM_TYPES.entries()) {
    const actual = normalizeType(params[index]?.type);
    if (!includesType(allowedTypes, actual)) {
      errors.push(
        `${label}: Transfer event param #${index + 1} should be one of [${allowedTypes.join(
          ", "
        )}], got ${actual || "<empty>"}`
      );
    }
  }
}

function checkNftPlatformIdentity(label, manifest, errors) {
  const name = String(manifest?.name ?? "");
  if (!name) {
    errors.push(`${label}: manifest name is empty`);
    return;
  }

  if (/nep11/i.test(name)) {
    errors.push(`${label}: manifest name should use NFT platform naming, got '${name}'`);
  }
}

function checkTemplateDeploymentOnly(label, methodMap, errors) {
  for (const methodName of CSHARP_TEMPLATE_REQUIRED_METHODS) {
    if (!methodMap.has(methodName)) {
      errors.push(`${label}: missing template deployment method ${methodName}`);
    }
  }

  for (const methodName of CSHARP_TEMPLATE_FORBIDDEN_METHODS) {
    if (methodMap.has(methodName)) {
      errors.push(`${label}: forbidden custom deploy method '${methodName}' is still exposed`);
    }
  }
}

function checkManifest(label, manifestPath, errors) {
  if (!ensureFileExists(manifestPath, errors, label)) {
    return;
  }

  const manifest = readJson(manifestPath);
  const standards = new Set((manifest.supportedstandards || []).map((v) => String(v).toUpperCase()));
  const methods = manifest?.abi?.methods || [];
  const events = manifest?.abi?.events || [];

  for (const standard of REQUIRED_STANDARDS) {
    if (!standards.has(standard.toUpperCase())) {
      errors.push(`${label}: missing supported standard ${standard}`);
    }
  }

  const methodMap = new Map(methods.map((method) => [method.name, method]));

  checkNftPlatformIdentity(label, manifest, errors);

  for (const [methodName, definition] of Object.entries(METHOD_SHAPES)) {
    checkMethodShape(label, methodMap, methodName, definition, errors);
  }

  if (label === "CSharp") {
    checkTemplateDeploymentOnly(label, methodMap, errors);
  }

  checkTransferEvent(label, events, errors);
}

function main() {
  const errors = [];

  const manifests = [
    {
      label: "CSharp",
      file: path.join(repoRoot, "contracts/multi-tenant-nft-platform/build/MultiTenantNftPlatform.manifest.json"),
    },
    {
      label: "Solidity",
      file: path.join(repoRoot, "contracts/solidity/build/MultiTenantNftPlatform.manifest.json"),
    },
    {
      label: "Rust",
      file: resolveRustManifest(),
    },
  ];

  for (const target of manifests) {
    checkManifest(target.label, target.file, errors);
  }

  if (errors.length > 0) {
    console.error("NEP compliance verification failed:");
    for (const [index, error] of errors.entries()) {
      console.error(`${index + 1}. ${error}`);
    }
    process.exit(1);
  }

  console.log("NEP compliance verification passed for CSharp, Solidity, Rust manifests.");
}

main();
