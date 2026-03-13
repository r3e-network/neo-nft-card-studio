const { sc } = require("@cityofzion/neon-js");
const param1 = sc.ContractParam.fromJson({ type: "ByteArray", value: "3134" });
console.log("From Hex 3134:", param1.value.toString("hex"), "or", param1.value);

const param2 = sc.ContractParam.fromJson({ type: "ByteArray", value: Buffer.from("14", "utf8").toString("base64") });
console.log("From Base64 MTQ=:", param2.value.toString("hex"), "or", param2.value);

const param3 = sc.ContractParam.fromJson({ type: "String", value: "14" });
console.log("From String 14:", param3.value);
