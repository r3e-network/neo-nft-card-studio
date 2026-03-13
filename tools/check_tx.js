const { rpc } = require('@cityofzion/neon-js');

async function checkTx() {
  const rpcClient = new rpc.RPCClient('http://seed2t5.neo.org:20332');
  const txid = '0x91682c98b1f5ae3aab4da7a4f5a1423bc928eff78854ab71b1ca9a6b2db770c8';
  
  try {
    const res = await rpcClient.getApplicationLog(txid);
    console.log("Execution State:", res.executions[0].vmstate);
    if(res.executions[0].vmstate === "FAULT") {
        console.log("Exception:", res.executions[0].exception);
    } else {
        console.log("Success! Contract deployed.");
        const deployEvent = res.executions[0].notifications.find(n => n.eventname === "Deploy");
        if (deployEvent) {
             console.log("Deployed Hash:", deployEvent.state.value[0].value);
        }
    }
  } catch (error) {
    console.log("Transaction not yet mined or failed:", error.message);
  }
}

checkTx();
