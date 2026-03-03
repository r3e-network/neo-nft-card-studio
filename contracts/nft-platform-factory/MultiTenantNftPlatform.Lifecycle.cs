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

    [Safe]
    public static string symbol()
    {
        AssertPlatformContractMode();
        return "MNFTP";
    }

    [Safe]
    public static byte decimals()
    {
        AssertPlatformContractMode();
        return 0;
    }

    [Safe]
    public static BigInteger totalSupply()
    {
        AssertPlatformContractMode();
        return ReadBigInteger(Storage.CurrentContext, PrefixTotalSupply);
    }

    [Safe]
    public static BigInteger balanceOf(UInt160 owner)
    {
        AssertPlatformContractMode();
        if (!owner.IsValid)
        {
            throw new Exception("Invalid owner");
        }

        return ReadBigInteger(Balances(), (ByteString)owner);
    }

    [Safe]
    public static UInt160 ownerOf(ByteString tokenId)
    {
        AssertPlatformContractMode();
        ByteString owner = TokenOwners().Get(tokenId);
        if (owner is null)
        {
            throw new Exception("Token not found");
        }

        return (UInt160)owner;
    }

    [Safe]
    public static BigInteger getDeploymentFeeBalance()
    {
        AssertPlatformContractMode();
        return (BigInteger)Contract.Call(
            GAS.Hash,
            "balanceOf",
            CallFlags.ReadOnly,
            Runtime.ExecutingScriptHash
        );
    }

    public static void withdrawDeploymentFees(UInt160 to, BigInteger amount)
    {
        AssertDirectInvocation();
        AssertPlatformContractMode();
        if (!Runtime.CheckWitness(GetContractOwner()))
        {
            throw new Exception("No authorization");
        }

        if (!to.IsValid)
        {
            throw new Exception("Invalid destination");
        }

        if (amount <= 0)
        {
            throw new Exception("Invalid withdrawal amount");
        }

        bool transferred = (bool)Contract.Call(
            GAS.Hash,
            "transfer",
            CallFlags.All,
            Runtime.ExecutingScriptHash,
            to,
            amount,
            null
        );

        if (!transferred)
        {
            throw new Exception("GAS withdrawal failed");
        }
    }
}
