const { rpc, tx, sc, wallet } = require('@cityofzion/neon-js');
const fs = require('fs');

async function main() {
    const account = new wallet.Account('KzjaqMvqzF1uup6KrTKRxTgjcXE7PbKLRH84e6ckyXDt3fu7afUb');
    // Using the requested official Neo testnet seed node
    const rpcClient = new rpc.RPCClient('http://seed2t5.neo.org:20332');

    try {
        const nefBytes = fs.readFileSync('../contracts/nft-platform-factory/bin/sc/MultiTenantNftPlatform.nef');
        const manifestStr = fs.readFileSync('../contracts/nft-platform-factory/bin/sc/MultiTenantNftPlatform.manifest.json', 'utf8');

        const nefHex = nefBytes.toString('hex');
        const manifestJson = JSON.stringify(JSON.parse(manifestStr));

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
        console.log("Connected to node version:", versionResult.useragent);
        const magic = versionResult.protocol.network;
        
        // Execute the script on the new node to see if the Magic byte trace fails
        const netFeeResult = await rpcClient.execute(new rpc.Query({
            method: "invokescript",
            params: [script, [{ account: account.scriptHash, scopes: "Global" }]]
        }));

        if (netFeeResult.state !== "HALT") {
             console.error("Simulation failed:", netFeeResult.exception);
        } else {
             console.log("Simulation succeeded!");
        }

        const deployTx = new tx.Transaction({
            signers: [{ account: account.scriptHash, scopes: tx.WitnessScope.Global }],
            validUntilBlock: await rpcClient.getBlockCount() + 1000,
            systemFee: '1500000000', // 15 GAS
            networkFee: '150000000', // 1.5 GAS
            script: script
        });

        deployTx.sign(account.privateKey, magic);
        const txid = await rpcClient.sendRawTransaction(deployTx);
        console.log('TXID:', txid);
    } catch (error) {
        console.error('Deployment Failed:', error.message);
    }
}

main().catch(console.error);
