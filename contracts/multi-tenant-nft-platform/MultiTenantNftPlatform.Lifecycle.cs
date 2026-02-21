using System;
using System.Numerics;
using Neo;
using Neo.SmartContract.Framework;
using Neo.SmartContract.Framework.Attributes;
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

        if (data is not null)
        {
            object[] values = (object[])data;
            if ((values.Length == 1 || values.Length == 13) && values.Length > 0)
            {
                UInt160 initializerContract = (UInt160)values[0];
                if (initializerContract.IsValid)
                {
                    Storage.Put(Storage.CurrentContext, PrefixInitializerContract, initializerContract);
                }
            }
        }

        TryInitializeCollectionFromDeployData(data);
    }

    public static bool verify()
    {
        return Runtime.CheckWitness(GetContractOwner());
    }

    public static void update(ByteString nefFile, string manifest, object data)
    {
        if (!Runtime.CheckWitness(GetContractOwner()))
        {
            throw new Exception("No authorization");
        }

        ContractManagement.Update(nefFile, manifest, data);
    }

    [Safe]
    public static string symbol()
    {
        AssertDedicatedContractMode();
        return "MNFTP";
    }

    [Safe]
    public static byte decimals()
    {
        AssertDedicatedContractMode();
        return 0;
    }

    [Safe]
    public static BigInteger totalSupply()
    {
        AssertDedicatedContractMode();
        return ReadBigInteger(Storage.CurrentContext, PrefixTotalSupply);
    }

    [Safe]
    public static BigInteger balanceOf(UInt160 owner)
    {
        AssertDedicatedContractMode();
        if (!owner.IsValid)
        {
            throw new Exception("Invalid owner");
        }

        return ReadBigInteger(Balances(), (ByteString)owner);
    }

    [Safe]
    public static UInt160 ownerOf(ByteString tokenId)
    {
        AssertDedicatedContractMode();
        ByteString owner = TokenOwners().Get(tokenId);
        if (owner is null)
        {
            throw new Exception("Token not found");
        }

        return (UInt160)owner;
    }
}
