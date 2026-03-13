const { rpc, wallet, tx, sc, u } = require('@cityofzion/neon-js');
const fs = require('fs');

async function deploy() {
  const privateKey = 'KzjaqMvqzF1uup6KrTKRxTgjcXE7PbKLRH84e6ckyXDt3fu7afUb';
  const account = new wallet.Account(privateKey);
  const rpcClient = new rpc.RPCClient('https://testnet1.neo.coz.io:443');

  try {
    const factoryNef = fs.readFileSync('./contracts/nft-platform-factory/bin/sc/MultiTenantNftPlatform.nef');
    const factoryManifestStr = fs.readFileSync('./contracts/nft-platform-factory/bin/sc/MultiTenantNftPlatform.manifest.json', 'utf8');

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
  }
}

deploy();
