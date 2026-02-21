using System;
using System.Numerics;
using Neo;
using Neo.SmartContract.Framework;
using Neo.SmartContract.Framework.Attributes;
using Neo.SmartContract.Framework.Services;

namespace NeoN3.MultiTenantNftPlatform;

public partial class MultiTenantNftPlatform
{
    public static void initializeDedicatedCollection(
        ByteString collectionId,
        UInt160 owner,
        string name,
        string tokenSymbol,
        string description,
        string baseUri,
        BigInteger maxSupply,
        BigInteger minted,
        BigInteger royaltyBps,
        bool transferable,
        bool paused,
        BigInteger createdAt
    )
    {
        if (IsDedicatedContractMode())
        {
            throw new Exception("Dedicated collection already initialized");
        }

        if (!owner.IsValid)
        {
            throw new Exception("Invalid owner");
        }

        UInt160 contractOwner = GetContractOwner();
        if (owner != contractOwner)
        {
            throw new Exception("Owner mismatch");
        }

        UInt160 initializerContract = GetInitializerContract();
        if (initializerContract != UInt160.Zero && Runtime.CallingScriptHash != initializerContract)
        {
            throw new Exception("No authorization");
        }

        ValidateCollectionInputs(name, tokenSymbol, description, baseUri, maxSupply, royaltyBps);

        if (minted < 0 || (maxSupply > 0 && minted > maxSupply))
        {
            throw new Exception("Invalid minted value");
        }

        if (createdAt < 0)
        {
            throw new Exception("Invalid createdAt");
        }

        if (collectionId is null || collectionId.Length == 0)
        {
            throw new Exception("Invalid collection id");
        }

        CollectionState existing = GetCollectionStateOrDefault(collectionId);
        if (existing.Owner is not null && existing.Owner.IsValid)
        {
            throw new Exception("Collection already exists");
        }

        CollectionState state = new CollectionState
        {
            Owner = owner,
            Name = name,
            Symbol = tokenSymbol,
            Description = description,
            BaseUri = baseUri,
            MaxSupply = maxSupply,
            Minted = minted,
            RoyaltyBps = royaltyBps,
            Transferable = transferable,
            Paused = paused,
            CreatedAt = createdAt,
        };

        PutCollectionState(collectionId, state);
        CollectionMintCounter().Put(collectionId, minted);
        SetDedicatedContractMode(collectionId);

        EmitCollectionUpserted(collectionId, state);
    }

    public static void updateCollection(ByteString collectionId, string description, string baseUri, BigInteger royaltyBps, bool transferable, bool paused)
    {
        collectionId = EnforceCollectionScope(collectionId);
        CollectionState state = GetCollectionState(collectionId);
        AssertCollectionOwnerWitness(state);

        if (description.Length > 512)
        {
            throw new Exception("Description too long");
        }

        if (baseUri.Length > 512)
        {
            throw new Exception("Base URI too long");
        }

        if (royaltyBps < 0 || royaltyBps > 10000)
        {
            throw new Exception("Royalty out of range");
        }

        state.Description = description;
        state.BaseUri = baseUri;
        state.RoyaltyBps = royaltyBps;
        state.Transferable = transferable;
        state.Paused = paused;

        PutCollectionState(collectionId, state);
        EmitCollectionUpserted(collectionId, state);
    }

    public static void setCollectionOperator(ByteString collectionId, UInt160 operatorAddress, bool enabled)
    {
        collectionId = EnforceCollectionScope(collectionId);
        if (!operatorAddress.IsValid)
        {
            throw new Exception("Invalid operator");
        }

        CollectionState state = GetCollectionState(collectionId);
        AssertCollectionOwnerWitness(state);

        string key = CollectionOperatorKey(collectionId, operatorAddress);
        if (enabled)
        {
            CollectionOperators().Put(key, 1);
        }
        else
        {
            CollectionOperators().Delete(key);
        }

        OnCollectionOperatorUpdated(collectionId, operatorAddress, enabled);
    }

    [Safe]
    public static bool isCollectionOperator(ByteString collectionId, UInt160 operatorAddress)
    {
        collectionId = EnforceCollectionScope(collectionId);
        string key = CollectionOperatorKey(collectionId, operatorAddress);
        return CollectionOperators().Get(key) is not null;
    }
}
