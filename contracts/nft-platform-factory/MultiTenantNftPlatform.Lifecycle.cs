using System;
using Neo;
using Neo.SmartContract.Framework;
using Neo.SmartContract.Framework.Native;
using Neo.SmartContract.Framework.Services;

namespace NeoN3.MultiTenantNftPlatform;

public partial class MultiTenantNftPlatform
{
    public static void _deploy(object data, bool update)
    {
        if (update)
        {
            return;
        }

        Transaction tx = Runtime.Transaction;
        Storage.Put(Storage.CurrentContext, PrefixContractOwner, tx.Sender);
        Storage.Put(Storage.CurrentContext, PrefixTotalSupply, 0);
        Storage.Put(Storage.CurrentContext, PrefixCollectionIdCounter, 0);

        TryInitializeCollectionFromDeployData(data);
    }

    public static bool verify()
    {
        return Runtime.CheckWitness(GetContractOwner());
    }

    public static void update(ByteString nefFile, string manifest, object data)
    {
        AssertDirectInvocation();
        if (!Runtime.CheckWitness(GetContractOwner()))
        {
            throw new Exception("No authorization");
        }

        ContractManagement.Update(nefFile, manifest, data);
    }
}
