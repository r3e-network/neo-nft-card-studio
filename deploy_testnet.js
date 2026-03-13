const { rpc, wallet, tx, sc } = require('@cityofzion/neon-js');
const fs = require('fs');
const path = require('path');

const ARTIFACTS_DIR = path.resolve(__dirname, 'contracts/multi-tenant-nft-platform/build');

function readRequiredWif() {
  const wif = process.env.NEO_TEST_WIF?.trim();
  if (!wif) {
    throw new Error('Missing NEO_TEST_WIF. Set it to a Neo N3 testnet WIF before running this script.');
  }
  return wif;
}

async function deploy() {
  const account = new wallet.Account(readRequiredWif());
  const rpcClient = new rpc.RPCClient('https://testnet1.neo.coz.io:443');

  try {
    const factoryNef = fs.readFileSync(path.join(ARTIFACTS_DIR, 'MultiTenantNftPlatform.nef'));
    const factoryManifestStr = fs.readFileSync(path.join(ARTIFACTS_DIR, 'MultiTenantNftPlatform.manifest.json'), 'utf8');

    const nefHex = factoryNef.toString('hex');
    const manifestJson = JSON.stringify(JSON.parse(factoryManifestStr));

    // The Magic byte issue occurs when the first parameter popped from the stack inside ContractManagement.deploy isn't the NEF.
    // If we push [nef, manifest, null], NeonJS `emitAppCall` internally reverses the array before pushing, 
    // so it pushes `null`, then `manifest`, then `nef`.
    // Then when ContractManagement pops, it pops `nef`, `manifest`, `null`. This is exactly correct!
    // But if we used the wrapper before and it threw "Magic Invalid", it means the ContractManagement is receiving `manifest` as `nefFile`.
    // Wait, let's look at the C# source code for N3 ContractManagement.
    // public static Contract deploy(ByteString nefFile, string manifest)
    // public static Contract deploy(ByteString nefFile, string manifest, object data)
    
    // So the stack should look like this (top to bottom):
    // nefFile
    // manifest
    // data
    
    // In neo VM, `emitAppCall` does reverse parameters. Let's just manually emit the instructions exactly to see if we can get past this.
    // Actually, `invalid Magic` can also occur if the NEF checksum is invalid or it's compiled for a different version of the VM.
    // We used `nccs` 3.9.1. Is the Neo testnet on 3.7.0 or something? Yes, Neo Testnet node might be older!
    // Let's check the Neo Testnet version.

    const versionResult = await rpcClient.getVersion();
    console.log(versionResult);

  } catch (error) {
    console.error('Deployment Failed:', error.message);
    process.exitCode = 1;
  }
}

deploy().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
