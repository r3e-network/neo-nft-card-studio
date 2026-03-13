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
    const rpcClient = new rpc.RPCClient('http://seed2t5.neo.org:20332');

    const nefBytes = fs.readFileSync(path.join(ARTIFACTS_DIR, 'MultiTenantNftPlatform.nef'));
    const manifestJsonStr = fs.readFileSync(path.join(ARTIFACTS_DIR, 'MultiTenantNftPlatform.manifest.json'), 'utf8');

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

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
