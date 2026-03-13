const { rpc, tx, sc, wallet, u } = require('@cityofzion/neon-js');
const fs = require('fs');
const path = require('path');

const ARTIFACTS_DIR = path.resolve(__dirname, '../contracts/multi-tenant-nft-platform/build');

function readRequiredWif() {
    const wif = process.env.NEO_TEST_WIF?.trim();
    if (!wif) {
        throw new Error('Missing NEO_TEST_WIF. Set it to a Neo N3 testnet WIF before running this script.');
    }
    return wif;
}

async function main() {
    const account = new wallet.Account(readRequiredWif());
    const rpcClient = new rpc.RPCClient('https://testnet1.neo.coz.io:443');
    
    const manifestJson = JSON.parse(fs.readFileSync(path.join(ARTIFACTS_DIR, 'MultiTenantNftPlatform.manifest.json'), 'utf8'));
    const hasDeploy = manifestJson.abi.methods.some(m => m.name === '_deploy');
    console.log("Has _deploy method:", hasDeploy);
    
    const nef = fs.readFileSync(path.join(ARTIFACTS_DIR, 'MultiTenantNftPlatform.nef'));
    
    const sb = new sc.ScriptBuilder();
    
    // ContractManagement native script hash
    const cmHash = "0xfffdc93764dbaddd97c48f252a53ea4643faa3fd";

    if (hasDeploy) {
        sb.emitAppCall(
            cmHash,
            "deploy",
            [
                sc.ContractParam.byteArray(nef.toString('hex')),
                sc.ContractParam.string(JSON.stringify(manifestJson)),
                sc.ContractParam.any(null)
            ]
        );
    } else {
        sb.emitAppCall(
            cmHash,
            "deploy",
            [
                sc.ContractParam.byteArray(nef.toString('hex')),
                sc.ContractParam.string(JSON.stringify(manifestJson))
            ]
        );
    }
    
    const script = sb.build();
    console.log("Script built");

    const magic = (await rpcClient.getVersion()).protocol.network;
    
    const deployTx = new tx.Transaction({
        signers: [{ account: account.scriptHash, scopes: tx.WitnessScope.Global }],
        validUntilBlock: await rpcClient.getBlockCount() + 1000,
        systemFee: '1500000000', // 15 GAS
        networkFee: '150000000', // 1.5 GAS
        script: script
    });

    deployTx.sign(account.privateKey, magic);
    const txid = await rpcClient.sendRawTransaction(deployTx);
    console.log("TXID:", txid);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
