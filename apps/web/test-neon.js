import { sc } from "@cityofzion/neon-js";

const payloadMsg = { type: "String", value: "Hello World" };
const param = sc.ContractParam.fromJson(payloadMsg);

console.log(param);
