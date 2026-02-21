#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = process.cwd();
const inputPath = path.join(
  repoRoot,
  "contracts/multi-tenant-nft-platform/build/MultiTenantNftTemplate.manifest.json",
);
const outputPath = path.join(
  repoRoot,
  "contracts/multi-tenant-nft-platform/build/MultiTenantNftTemplate.deploy.manifest.json",
);

function rewriteParams(params) {
  if (!Array.isArray(params)) {
    return [];
  }

  return params.map((entry, index) => ({
    name: `p${index}`,
    type: entry?.type ?? "Any",
  }));
}

function main() {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Template manifest not found: ${inputPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const sourceSize = Buffer.byteLength(JSON.stringify(manifest));

  delete manifest.extra;
  manifest.abi = manifest.abi ?? { methods: [], events: [] };
  manifest.abi.methods = Array.isArray(manifest.abi.methods)
    ? manifest.abi.methods.map((entry) => ({
      ...entry,
      parameters: rewriteParams(entry?.parameters),
    }))
    : [];
  manifest.abi.events = Array.isArray(manifest.abi.events)
    ? manifest.abi.events.map((entry) => ({
      ...entry,
      parameters: rewriteParams(entry?.parameters),
    }))
    : [];

  const output = JSON.stringify(manifest);
  fs.writeFileSync(outputPath, output);

  const targetSize = Buffer.byteLength(output);
  console.log(
    `Generated deploy manifest: ${path.relative(repoRoot, outputPath)} (${sourceSize} -> ${targetSize} bytes)`,
  );
}

main();
