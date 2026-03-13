import { rpc, tx, sc, wallet } from '@cityofzion/neon-js';
import fs from 'fs';

const account = new wallet.Account('KzjaqMvqzF1uup6KrTKRxTgjcXE7PbKLRH84e6ckyXDt3fu7afUb');
const rpcClient = new rpc.RPCClient('https://testnet1.neo.coz.io:443');

async function main() {
    const nefStr = fs.readFileSync('./contracts/nft-platform-factory/bin/sc/MultiTenantNftPlatform.nef').toString('hex');
    const manifestStr = fs.readFileSync('./contracts/nft-platform-factory/bin/sc/MultiTenantNftPlatform.manifest.json', 'utf8');

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
main().catch(console.error);
