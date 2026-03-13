using System.Numerics;
using Neo;
using Neo.SmartContract.Framework;
using Neo.SmartContract.Framework.Native;

public class Test : SmartContract {
    public static void Charge() {
        BigInteger fee = 10_00000000;
        UInt160 sender = ((Neo.SmartContract.Framework.Services.Transaction)Runtime.ScriptContainer).Sender;
        bool paid = GAS.Transfer(sender, Runtime.ExecutingScriptHash, fee, null);
    }
}
