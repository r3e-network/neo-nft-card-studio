const { rpc, wallet, tx, sc, u } = require('@cityofzion/neon-js');
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

    // The correct way to represent an empty Any parameter without throwing InvalidParams
    // or REVERSEITEMS stack faults on the Neo VM is often a Null parameter,
    // which in Neon-JS v5 can be added without wrapping in ContractParam.any()
    
    const script = new sc.ScriptBuilder()
      .emitAppCall(
        "0xfffdc93764dbaddd97c48f252a53ea4643faa3fd",
        "deploy",
        [
          sc.ContractParam.byteArray(nefHex),
          sc.ContractParam.string(manifestJson),
          null // Plain null value correctly gets encoded to a Null stack item in newer versions
        ]
      ).build();

    const versionResult = await rpcClient.getVersion();
    const magic = versionResult.protocol.network;

    let netFeeResult = await rpcClient.execute(new rpc.Query({
        method: "invokescript",
        params: [script, [{ account: account.scriptHash, scopes: "Global" }]]
    }));

    if (netFeeResult.state !== "HALT") {
      throw new Error("Deploy failed: " + netFeeResult.exception);
    }
    
    const deployTx = new tx.Transaction({
      signers: [{
        account: account.scriptHash,
        scopes: tx.WitnessScope.Global
      }],
      validUntilBlock: await rpcClient.getBlockCount() + 1000,
      systemFee: (BigInt(netFeeResult.gasconsumed) + BigInt(1000000000)).toString(),
      networkFee: "150000000",
      script: script
    });

    const signedTx = deployTx.sign(account, magic);
    const txid = await rpcClient.sendRawTransaction(signedTx);
    
    console.log('Factory Contract Deployed! TXID:', txid);
    
  } catch (error) {
    console.error('Deployment Failed:', error.message);
    process.exitCode = 1;
  }
}

deploy().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
