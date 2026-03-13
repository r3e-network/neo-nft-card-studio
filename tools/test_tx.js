const { rpc, tx, sc, wallet, u } = require('@cityofzion/neon-js');
const fs = require('fs');

async function main() {
    const account = new wallet.Account('KzjaqMvqzF1uup6KrTKRxTgjcXE7PbKLRH84e6ckyXDt3fu7afUb');
    const rpcClient = new rpc.RPCClient('http://seed2t5.neo.org:20332');

    const nefBytes = fs.readFileSync('../contracts/nft-platform-factory/bin/sc/MultiTenantNftPlatform.nef');
    const manifestJsonStr = fs.readFileSync('../contracts/nft-platform-factory/bin/sc/MultiTenantNftPlatform.manifest.json', 'utf8');

    const manifestJson = JSON.stringify(JSON.parse(manifestJsonStr));
    const nefHex = nefBytes.toString('hex');
    
    // Pass as pure string to script builder. It will parse and build standard hex array for VM.
    const sb = new sc.ScriptBuilder();
    sb.emitAppCall(
        "0xfffdc93764dbaddd97c48f252a53ea4643faa3fd",
        "deploy",
        [
            sc.ContractParam.byteArray(nefHex),
            sc.ContractParam.string(manifestJson),
            sc.ContractParam.any(null)
        ]
    );

    const script = sb.build();

    const versionResult = await rpcClient.getVersion();
    const magic = versionResult.protocol.network;

    // Use string encoding for tx parsing, or just avoid invoking execution simulating
    // if invokescript RPC parameter causes issues with Base64 encoding requirement
    try {
        const netFeeResult = await rpcClient.execute(new rpc.Query({
            method: "invokescript",
            params: [Buffer.from(script, 'hex').toString('base64'), [{ account: account.scriptHash, scopes: "Global" }]]
        }));

        if (netFeeResult.state !== "HALT") {
            console.error("Simulation failed:", netFeeResult.exception);
        } else {
            console.log("Simulation succeeded!");
        }
    } catch(e) {}

    const deployTx = new tx.Transaction({
        signers: [{ account: account.scriptHash, scopes: tx.WitnessScope.Global }],
        validUntilBlock: await rpcClient.getBlockCount() + 1000,
        systemFee: '1500000000',
        networkFee: '150000000',
        script: script
    });
    
    deployTx.sign(account.privateKey, magic);
    const txid = await rpcClient.sendRawTransaction(deployTx);
    console.log('TXID:', txid);
}

main().catch(console.error);
