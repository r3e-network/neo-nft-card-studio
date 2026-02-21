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
    public static bool transfer(UInt160 to, ByteString tokenId, object data)
    {
        AssertDirectInvocation();
        AssertDedicatedContractMode();
        if (!to.IsValid)
        {
            throw new Exception("Invalid destination");
        }

        TokenState token = GetTokenState(tokenId);
        AssertTokenWithinScope(tokenId, token);
        if (token.Burned)
        {
            throw new Exception("Token already burned");
        }

        CollectionState collection = GetCollectionState(token.CollectionId);
        if (collection.Paused)
        {
            throw new Exception("Collection paused");
        }

        if (!collection.Transferable)
        {
            throw new Exception("Collection does not allow transfer");
        }

        BigInteger tokenClass = GetTokenClassValue(tokenId);
        if (tokenClass == TokenClassMembership && IsMembershipSoulbound(token.CollectionId))
        {
            throw new Exception("Membership token is soulbound");
        }

        UInt160 from = token.Owner;
        if (!Runtime.CheckWitness(from))
        {
            return false;
        }

        if (from == to)
        {
            return true;
        }

        if (tokenClass == TokenClassMembership)
        {
            DecreaseCollectionMembershipBalance(token.CollectionId, from);
            IncreaseCollectionMembershipBalance(token.CollectionId, to);
        }

        RemoveOwnerTokenIndex(from, tokenId);
        AddOwnerTokenIndex(to, tokenId);

        BigInteger fromBalance = ReadBigInteger(Balances(), (ByteString)from);
        if (fromBalance > 0)
        {
            Balances().Put(from, fromBalance - 1);
        }

        BigInteger toBalance = ReadBigInteger(Balances(), (ByteString)to);
        Balances().Put(to, toBalance + 1);

        token.Owner = to;
        PutTokenState(tokenId, token);
        TokenOwners().Put(tokenId, to);

        EmitTokenUpserted(tokenId, token);
        PostTransfer(from, to, tokenId, data);

        return true;
    }

    public static ByteString mint(ByteString collectionId, UInt160 to, string tokenUri, string propertiesJson)
    {
        AssertDirectInvocation();
        AssertDedicatedContractMode();
        collectionId = EnforceCollectionScope(collectionId);
        if (!to.IsValid)
        {
            throw new Exception("Invalid recipient");
        }

        CollectionState collection = GetCollectionState(collectionId);
        UInt160 sender = GetSenderChecked();

        if (!CanManageCollection(collectionId, collection, sender))
        {
            throw new Exception("No authorization to mint");
        }

        return MintCore(collectionId, to, tokenUri, propertiesJson, TokenClassMembership);
    }

    private static ByteString MintCore(
        ByteString collectionId,
        UInt160 to,
        string tokenUri,
        string propertiesJson,
        BigInteger tokenClass
    )
    {
        collectionId = EnforceCollectionScope(collectionId);
        CollectionState collection = GetCollectionState(collectionId);
        if (collection.Paused)
        {
            throw new Exception("Collection paused");
        }

        if (!IsTokenClassValid(tokenClass))
        {
            throw new Exception("Invalid token class");
        }

        if (collection.MaxSupply > 0 && collection.Minted >= collection.MaxSupply)
        {
            throw new Exception("Collection sold out");
        }

        BigInteger serial = ReadBigInteger(CollectionMintCounter(), collectionId) + 1;
        CollectionMintCounter().Put(collectionId, serial);

        if (tokenUri.Length == 0)
        {
            tokenUri = collection.BaseUri + serial.ToString();
        }

        if (propertiesJson.Length == 0 || propertiesJson == "{}")
        {
            propertiesJson = BuildDefaultPropertiesJson(collection.Name, serial, collection.MaxSupply);
        }

        if (tokenUri.Length > 512)
        {
            throw new Exception("Invalid token URI");
        }

        if (propertiesJson.Length > 4096)
        {
            throw new Exception("Properties JSON too long");
        }

        string tokenIdText = ((string)collectionId) + ":" + serial;
        ByteString tokenId = tokenIdText;

        TokenState token = new TokenState
        {
            CollectionId = collectionId,
            Owner = to,
            Uri = tokenUri,
            PropertiesJson = propertiesJson,
            Burned = false,
            MintedAt = Runtime.Time,
        };

        PutTokenState(tokenId, token);
        SetTokenClass(tokenId, tokenClass);
        TokenOwners().Put(tokenId, to);
        AddOwnerTokenIndex(to, tokenId);

        if (tokenClass == TokenClassMembership)
        {
            IncreaseCollectionMembershipBalance(collectionId, to);
        }

        string collectionTokenKey = CollectionTokenKey(collectionId, tokenId);
        CollectionTokens().Put(collectionTokenKey, 1);

        collection.Minted += 1;
        PutCollectionState(collectionId, collection);

        BigInteger total = ReadBigInteger(Storage.CurrentContext, PrefixTotalSupply);
        Storage.Put(Storage.CurrentContext, PrefixTotalSupply, total + 1);

        BigInteger recipientBalance = ReadBigInteger(Balances(), (ByteString)to);
        Balances().Put(to, recipientBalance + 1);

        EmitCollectionUpserted(collectionId, collection);
        EmitTokenUpserted(tokenId, token);
        PostTransfer(null, to, tokenId, null);

        return tokenId;
    }


    public static void burn(ByteString tokenId)
    {
        AssertDirectInvocation();
        AssertDedicatedContractMode();
        TokenState token = GetTokenState(tokenId);
        AssertTokenWithinScope(tokenId, token);
        if (token.Burned)
        {
            throw new Exception("Token already burned");
        }

        CollectionState collection = GetCollectionState(token.CollectionId);
        UInt160 sender = GetSenderChecked();

        bool canBurn = sender == token.Owner || CanManageCollection(token.CollectionId, collection, sender);
        if (!canBurn)
        {
            throw new Exception("No authorization to burn");
        }

        UInt160 previousOwner = token.Owner;

        token.Burned = true;
        PutTokenState(tokenId, token);
        TokenOwners().Delete(tokenId);
        RemoveOwnerTokenIndex(previousOwner, tokenId);

        BigInteger tokenClass = GetTokenClassValue(tokenId);
        if (tokenClass == TokenClassMembership)
        {
            DecreaseCollectionMembershipBalance(token.CollectionId, previousOwner);
        }

        BigInteger ownerBalance = ReadBigInteger(Balances(), (ByteString)previousOwner);
        if (ownerBalance > 0)
        {
            Balances().Put(previousOwner, ownerBalance - 1);
        }

        BigInteger total = ReadBigInteger(Storage.CurrentContext, PrefixTotalSupply);
        if (total > 0)
        {
            Storage.Put(Storage.CurrentContext, PrefixTotalSupply, total - 1);
        }

        EmitTokenUpserted(tokenId, token);
        PostTransfer(previousOwner, null, tokenId, null);
    }

    [Safe]
    public static Iterator tokensOf(UInt160 owner)
    {
        AssertDedicatedContractMode();
        if (!owner.IsValid)
        {
            throw new Exception("Invalid owner");
        }

        return OwnerTokens().Find(owner.ToString() + "|", FindOptions.KeysOnly | FindOptions.RemovePrefix);
    }

    [Safe]
    public static Iterator tokens()
    {
        AssertDedicatedContractMode();
        return TokenOwners().Find("", FindOptions.KeysOnly);
    }

    [Safe]
    public static string tokenURI(ByteString tokenId)
    {
        AssertDedicatedContractMode();
        TokenState token = GetTokenState(tokenId);
        AssertTokenWithinScope(tokenId, token);
        return token.Uri;
    }

    [Safe]
    public static Map<string, object> properties(ByteString tokenId)
    {
        AssertDedicatedContractMode();
        TokenState token = GetTokenState(tokenId);
        AssertTokenWithinScope(tokenId, token);
        CollectionState collection = GetCollectionState(token.CollectionId);

        Map<string, object> result = new Map<string, object>();
        result["tokenId"] = tokenId;
        result["collectionId"] = token.CollectionId;
        result["name"] = collection.Name + " #" + (string)tokenId;
        result["description"] = collection.Description;
        result["image"] = token.Uri;
        result["tokenURI"] = token.Uri;
        result["propertiesJson"] = token.PropertiesJson;
        result["tokenClass"] = GetTokenClassValue(tokenId);

        return result;
    }

    [Safe]
    public static string getRoyalties(ByteString tokenId)
    {
        AssertDedicatedContractMode();
        TokenState token = GetTokenState(tokenId);
        AssertTokenWithinScope(tokenId, token);
        CollectionState collection = GetCollectionState(token.CollectionId);

        if (collection.RoyaltyBps <= 0)
        {
            return "[]";
        }

        string recipient = collection.Owner.ToString();
        string bps = collection.RoyaltyBps.ToString();
        return "[{\"address\":\"" + recipient + "\",\"value\":" + bps + "}]";
    }

    [Safe]
    public static object[] royaltyInfo(ByteString tokenId, UInt160 _royaltyToken, BigInteger salePrice)
    {
        AssertDedicatedContractMode();
        TokenState token = GetTokenState(tokenId);
        AssertTokenWithinScope(tokenId, token);
        CollectionState collection = GetCollectionState(token.CollectionId);

        if (collection.RoyaltyBps <= 0 || salePrice <= 0)
        {
            return new object[0];
        }

        BigInteger royaltyAmount = salePrice * collection.RoyaltyBps / 10000;
        if (royaltyAmount <= 0)
        {
            return new object[0];
        }

        return new object[]
        {
            new object[]
            {
                collection.Owner,
                royaltyAmount,
            },
        };
    }

    public static void onNEP11Payment(UInt160 _from, BigInteger _amount, ByteString _tokenId, object _data)
    {
        AssertDedicatedContractMode();
        throw new Exception("Receiving NEP-11 is not supported");
    }

}
