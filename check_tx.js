const { rpc } = require('@cityofzion/neon-js');

async function checkTx() {
  const rpcClient = new rpc.RPCClient('https://testnet1.neo.coz.io:443');
  const txid = '0x3e37fcfa75b7acf9cfbe84cf7696a532ccd141c5b970732528383b0c887366ae';
  
  try {
    const res = await rpcClient.getApplicationLog(txid);
    console.log("Execution State:", res.executions[0].vmstate);
    if(res.executions[0].vmstate === "FAULT") {
        console.log("Exception:", res.executions[0].exception);
    } else {
        console.log("Success! Extracted info:", JSON.stringify(res.executions[0].stack, null, 2));
    }
  } catch (error) {
    console.log("Transaction not yet mined or failed:", error.message);
  }
}

checkTx();
