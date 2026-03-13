import { rpc, tx, sc, wallet } from '@cityofzion/neon-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = path.join(ROOT_DIR, 'contracts', 'multi-tenant-nft-platform', 'build');

function readRequiredWif() {
    const wif = process.env.NEO_TEST_WIF?.trim();
    if (!wif) {
        throw new Error('Missing NEO_TEST_WIF. Set it to a Neo N3 testnet WIF before running this script.');
    }
    return wif;
}

const account = new wallet.Account(readRequiredWif());
const rpcClient = new rpc.RPCClient('https://testnet1.neo.coz.io:443');

async function main() {
    const nefStr = fs.readFileSync(path.join(ARTIFACTS_DIR, 'MultiTenantNftPlatform.nef')).toString('hex');
    const manifestStr = fs.readFileSync(path.join(ARTIFACTS_DIR, 'MultiTenantNftPlatform.manifest.json'), 'utf8');

    const script = sc.createScript({
        scriptHash: '0xfffdc93764dbaddd97c48f252a53ea4643faa3fd', // ContractManagement
        operation: 'deploy',
        args: [
            sc.ContractParam.byteArray(nefStr),
            sc.ContractParam.string(manifestStr),
            sc.ContractParam.any(null)
        ]
    });

    const magic = (await rpcClient.getVersion()).protocol.network;

    const deployTx = new tx.Transaction({
        signers: [{ account: account.scriptHash, scopes: tx.WitnessScope.Global }],
        validUntilBlock: await rpcClient.getBlockCount() + 1000,
        systemFee: '1500000000',
        networkFee: '150000000',
        script: script
    });

    deployTx.sign(account.privateKey, magic);
    const txid = await rpcClient.sendRawTransaction(deployTx);
    console.log("Deployed with valid neon-js wrapper script. TXID:", txid);
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
