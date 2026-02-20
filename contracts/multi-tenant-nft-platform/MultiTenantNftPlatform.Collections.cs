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
    public static ByteString createCollection(string name, string tokenSymbol, string description, string baseUri, BigInteger maxSupply, BigInteger royaltyBps, bool transferable)
    {
        AssertPlatformContractMode();
        ValidateCollectionInputs(name, tokenSymbol, description, baseUri, maxSupply, royaltyBps);

        UInt160 sender = GetSenderChecked();
        ByteString ownerBoundCollectionId = GetOwnerDedicatedCollectionId(sender);
        if (ownerBoundCollectionId is not null)
        {
            throw new Exception("Owner already has a dedicated NFT collection");
        }

        BigInteger counter = ReadBigInteger(Storage.CurrentContext, PrefixCollectionIdCounter) + 1;
        Storage.Put(Storage.CurrentContext, PrefixCollectionIdCounter, counter);

        ByteString collectionId = counter.ToString();

        CollectionState state = new CollectionState
        {
            Owner = sender,
            Name = name,
            Symbol = tokenSymbol,
            Description = description,
            BaseUri = baseUri,
            MaxSupply = maxSupply,
            Minted = 0,
            RoyaltyBps = royaltyBps,
            Transferable = transferable,
            Paused = false,
            CreatedAt = Runtime.Time,
        };

        PutCollectionState(collectionId, state);
        CollectionMintCounter().Put(collectionId, 0);
        SetOwnerDedicatedCollectionId(sender, collectionId);

        EmitCollectionUpserted(collectionId, state);
        return collectionId;
    }

    public static object[] createCollectionAndDeployFromTemplate(
        string name,
        string tokenSymbol,
        string description,
        string baseUri,
        BigInteger maxSupply,
        BigInteger royaltyBps,
        bool transferable,
        object extraData
    )
    {
        AssertPlatformContractMode();
        UInt160 sender = GetSenderChecked();
        ByteString existingCollectionId = GetOwnerDedicatedCollectionId(sender);
        if (existingCollectionId is not null)
        {
            throw new Exception("Owner already has a dedicated NFT contract");
        }

        ByteString collectionId = createCollection(name, tokenSymbol, description, baseUri, maxSupply, royaltyBps, transferable);
        UInt160 collectionContract = deployCollectionContractFromTemplate(collectionId, extraData);

        return [collectionId, collectionContract];
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

    public static void setCollectionContractTemplate(ByteString nefFile, string manifest)
    {
        AssertPlatformContractMode();
        if (!Runtime.CheckWitness(GetContractOwner()))
        {
            throw new Exception("No authorization");
        }

        if (nefFile.Length == 0)
        {
            throw new Exception("Empty template NEF");
        }

        if (manifest.Length == 0)
        {
            throw new Exception("Empty template manifest");
        }

        PutCollectionContractTemplate(nefFile, manifest);
    }

    public static void clearCollectionContractTemplate()
    {
        AssertPlatformContractMode();
        if (!Runtime.CheckWitness(GetContractOwner()))
        {
            throw new Exception("No authorization");
        }

        DeleteCollectionContractTemplate();
    }

    [Safe]
    public static bool hasCollectionContractTemplate()
    {
        if (IsDedicatedContractMode())
        {
            return false;
        }

        return HasCollectionContractTemplateStored();
    }

    [Safe]
    public static object[] getCollectionContractTemplateDigest()
    {
        if (IsDedicatedContractMode())
        {
            return [false];
        }

        if (!HasCollectionContractTemplateStored())
        {
            return [false];
        }

        ByteString nefFile = GetCollectionContractTemplateNef();
        string manifest = GetCollectionContractTemplateManifest();
        ByteString manifestBytes = manifest;

        return
        [
            true,
            CryptoLib.Sha256(nefFile),
            CryptoLib.Sha256(manifestBytes),
            nefFile.Length,
            manifestBytes.Length,
        ];
    }

    public static UInt160 deployCollectionContractFromTemplate(ByteString collectionId, object extraData)
    {
        AssertPlatformContractMode();
        CollectionState state = GetCollectionState(collectionId);
        AssertCollectionOwnerWitness(state);

        ByteString ownerBoundCollectionId = GetOwnerDedicatedCollectionId(state.Owner);
        if (ownerBoundCollectionId is not null && (string)ownerBoundCollectionId != (string)collectionId)
        {
            throw new Exception("Owner already bound to another dedicated NFT contract");
        }

        if (CollectionContracts().Get(collectionId) is not null)
        {
            throw new Exception("Collection contract already deployed");
        }

        ByteString templateNef = GetCollectionContractTemplateNef();
        string templateManifest = GetCollectionContractTemplateManifest();

        object[] deployData =
        [
            collectionId,
            state.Owner,
            state.Name,
            state.Symbol,
            state.Description,
            state.BaseUri,
            state.MaxSupply,
            state.Minted,
            state.RoyaltyBps,
            state.Transferable,
            state.Paused,
            state.CreatedAt,
            extraData,
        ];

        Contract deployed = ContractManagement.Deploy(templateNef, templateManifest, deployData);
        CollectionContracts().Put(collectionId, deployed.Hash);
        SetOwnerDedicatedCollectionId(state.Owner, collectionId);

        OnCollectionContractDeployed(collectionId, state.Owner, deployed.Hash);
        return deployed.Hash;
    }

    [Safe]
    public static UInt160 getCollectionContract(ByteString collectionId)
    {
        collectionId = EnforceCollectionScope(collectionId);
        ByteString hash = CollectionContracts().Get(collectionId);
        if (hash is null)
        {
            return UInt160.Zero;
        }

        return (UInt160)hash;
    }

    [Safe]
    public static bool hasCollectionContract(ByteString collectionId)
    {
        collectionId = EnforceCollectionScope(collectionId);
        return CollectionContracts().Get(collectionId) is not null;
    }

    [Safe]
    public static ByteString getOwnerDedicatedCollection(UInt160 owner)
    {
        if (!owner.IsValid)
        {
            throw new Exception("Invalid owner");
        }

        ByteString collectionId = GetOwnerDedicatedCollectionId(owner);
        if (collectionId is null)
        {
            return "";
        }

        return collectionId;
    }

    [Safe]
    public static UInt160 getOwnerDedicatedCollectionContract(UInt160 owner)
    {
        if (!owner.IsValid)
        {
            throw new Exception("Invalid owner");
        }

        ByteString collectionId = GetOwnerDedicatedCollectionId(owner);
        if (collectionId is null)
        {
            return UInt160.Zero;
        }

        ByteString contractHash = CollectionContracts().Get(collectionId);
        if (contractHash is null)
        {
            return UInt160.Zero;
        }

        return (UInt160)contractHash;
    }

    [Safe]
    public static bool hasOwnerDedicatedCollectionContract(UInt160 owner)
    {
        if (!owner.IsValid)
        {
            throw new Exception("Invalid owner");
        }

        ByteString collectionId = GetOwnerDedicatedCollectionId(owner);
        if (collectionId is null)
        {
            return false;
        }

        return CollectionContracts().Get(collectionId) is not null;
    }
}
