import { rpc } from "@cityofzion/neon-js";

async function run() {
  const rpcClient = new rpc.RPCClient("https://n3seed1.ngd.network:20332");
  
  const blockCount = await rpcClient.getBlockCount();
  console.log("Current block count: ", blockCount);
}
run();
