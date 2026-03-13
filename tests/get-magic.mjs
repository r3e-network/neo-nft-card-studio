import { rpc } from "@cityofzion/neon-js";

async function run() {
  const rpcClient = new rpc.RPCClient("https://n3seed1.ngd.network:20332");
  const version = await rpcClient.getVersion();
  console.log("Magic:", version.protocol.network);
}
run();
