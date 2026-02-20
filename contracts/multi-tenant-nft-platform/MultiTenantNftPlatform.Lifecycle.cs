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
        Storage.Put(Storage.CurrentContext, PrefixCollectionIdCounter, 0);

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
    public static string symbol() => "MNFTP";

    [Safe]
    public static byte decimals() => 0;

    [Safe]
    public static BigInteger totalSupply()
    {
        return ReadBigInteger(Storage.CurrentContext, PrefixTotalSupply);
    }

    [Safe]
    public static BigInteger balanceOf(UInt160 owner)
    {
        if (!owner.IsValid)
        {
            throw new Exception("Invalid owner");
        }

        return ReadBigInteger(Balances(), (ByteString)owner);
    }

    [Safe]
    public static UInt160 ownerOf(ByteString tokenId)
    {
        ByteString owner = TokenOwners().Get(tokenId);
        if (owner is null)
        {
            throw new Exception("Token not found");
        }

        return (UInt160)owner;
    }
}
