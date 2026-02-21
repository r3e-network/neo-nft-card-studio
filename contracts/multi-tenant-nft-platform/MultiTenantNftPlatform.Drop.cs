using System;
using System.Numerics;
using Neo;
using Neo.SmartContract.Framework;
using Neo.SmartContract.Framework.Attributes;
using Neo.SmartContract.Framework.Services;

namespace NeoN3.MultiTenantNftPlatform;

public partial class MultiTenantNftPlatform
{
    public static void configureDrop(
        ByteString collectionId,
        bool enabled,
        BigInteger startAt,
        BigInteger endAt,
        BigInteger perWalletLimit,
        bool whitelistRequired
    )
    {
        AssertDedicatedContractMode();
        collectionId = EnforceCollectionScope(collectionId);
        CollectionState collection = GetCollectionState(collectionId);
        AssertCollectionOwnerWitness(collection);

        if (startAt < 0 || endAt < 0)
        {
            throw new Exception("Drop time out of range");
        }

        if (endAt > 0 && startAt > 0 && endAt <= startAt)
        {
            throw new Exception("Drop end time must be greater than start time");
        }

        if (perWalletLimit < 0)
        {
            throw new Exception("Drop wallet limit out of range");
        }

        DropConfigState config = new DropConfigState
        {
            Enabled = enabled,
            StartAt = startAt,
            EndAt = endAt,
            PerWalletLimit = perWalletLimit,
            WhitelistRequired = whitelistRequired,
        };

        PutDropConfigState(collectionId, config);
        OnDropConfigUpdated(collectionId, enabled, startAt, endAt, perWalletLimit, whitelistRequired);
    }

    public static void setDropWhitelist(ByteString collectionId, UInt160 account, BigInteger allowance)
    {
        AssertDedicatedContractMode();
        collectionId = EnforceCollectionScope(collectionId);
        if (!account.IsValid)
        {
            throw new Exception("Invalid whitelist account");
        }

        if (allowance < 0)
        {
            throw new Exception("Invalid whitelist allowance");
        }

        CollectionState collection = GetCollectionState(collectionId);
        AssertCollectionOwnerWitness(collection);

        SetDropWhitelistAllowance(collectionId, account, allowance);
        OnDropWhitelistUpdated(collectionId, account, allowance);
    }

    public static void setDropWhitelistBatch(ByteString collectionId, UInt160[] accounts, BigInteger[] allowances)
    {
        AssertDedicatedContractMode();
        collectionId = EnforceCollectionScope(collectionId);
        if (accounts.Length != allowances.Length)
        {
            throw new Exception("Whitelist batch size mismatch");
        }

        if (accounts.Length > 500)
        {
            throw new Exception("Whitelist batch exceeds 500 entries");
        }

        CollectionState collection = GetCollectionState(collectionId);
        AssertCollectionOwnerWitness(collection);

        for (int i = 0; i < accounts.Length; i += 1)
        {
            UInt160 account = accounts[i];
            BigInteger allowance = allowances[i];

            if (!account.IsValid)
            {
                throw new Exception("Invalid whitelist account");
            }

            if (allowance < 0)
            {
                throw new Exception("Invalid whitelist allowance");
            }

            SetDropWhitelistAllowance(collectionId, account, allowance);
            OnDropWhitelistUpdated(collectionId, account, allowance);
        }
    }

    public static ByteString claimDrop(ByteString collectionId, string tokenUri, string propertiesJson)
    {
        AssertDedicatedContractMode();
        collectionId = EnforceCollectionScope(collectionId);
        UInt160 claimer = GetSenderChecked();
        CollectionState collection = GetCollectionState(collectionId);
        DropConfigState config = GetDropConfigState(collectionId);
        BigInteger claimedCount = GetDropWalletClaimedCount(collectionId, claimer);

        AssertDropClaimAllowed(collectionId, collection, config, claimer, claimedCount);

        ByteString tokenId = MintCore(collectionId, claimer, tokenUri, propertiesJson, TokenClassMembership);
        BigInteger nextClaimedCount = claimedCount + 1;
        SetDropWalletClaimedCount(collectionId, claimer, nextClaimedCount);

        OnDropClaimed(collectionId, claimer, tokenId, nextClaimedCount);
        return tokenId;
    }

    [Safe]
    public static object[] getDropConfig(ByteString collectionId)
    {
        AssertDedicatedContractMode();
        collectionId = EnforceCollectionScope(collectionId);
        GetCollectionState(collectionId);
        DropConfigState config = GetDropConfigState(collectionId);

        return
        [
            config.Enabled,
            config.StartAt,
            config.EndAt,
            config.PerWalletLimit,
            config.WhitelistRequired,
        ];
    }

    [Safe]
    public static object[] getDropWalletStats(ByteString collectionId, UInt160 account)
    {
        AssertDedicatedContractMode();
        collectionId = EnforceCollectionScope(collectionId);
        if (!account.IsValid)
        {
            throw new Exception("Invalid account");
        }

        CollectionState collection = GetCollectionState(collectionId);
        DropConfigState config = GetDropConfigState(collectionId);
        BigInteger claimedCount = GetDropWalletClaimedCount(collectionId, account);
        BigInteger whitelistAllowance = config.WhitelistRequired ? GetDropWhitelistAllowance(collectionId, account) : -1;
        BigInteger remaining = GetDropRemainingClaims(collection, config, claimedCount, whitelistAllowance);
        bool claimableNow = config.Enabled && IsDropClaimWindowOpen(config) && !collection.Paused && remaining > 0;

        return
        [
            claimedCount,
            whitelistAllowance,
            remaining,
            claimableNow,
        ];
    }

    [Safe]
    public static bool canClaimDrop(ByteString collectionId, UInt160 account)
    {
        AssertDedicatedContractMode();
        collectionId = EnforceCollectionScope(collectionId);
        if (!account.IsValid)
        {
            throw new Exception("Invalid account");
        }

        CollectionState collection = GetCollectionState(collectionId);
        DropConfigState config = GetDropConfigState(collectionId);
        BigInteger claimedCount = GetDropWalletClaimedCount(collectionId, account);
        BigInteger whitelistAllowance = config.WhitelistRequired ? GetDropWhitelistAllowance(collectionId, account) : -1;
        BigInteger remaining = GetDropRemainingClaims(collection, config, claimedCount, whitelistAllowance);

        return config.Enabled && IsDropClaimWindowOpen(config) && !collection.Paused && remaining > 0;
    }

    private static void AssertDropClaimAllowed(
        ByteString collectionId,
        CollectionState collection,
        DropConfigState config,
        UInt160 claimer,
        BigInteger claimedCount
    )
    {
        if (!config.Enabled)
        {
            throw new Exception("Drop is not enabled");
        }

        if (collection.Paused)
        {
            throw new Exception("Collection paused");
        }

        if (!IsDropClaimWindowOpen(config))
        {
            throw new Exception("Drop is not active");
        }

        if (collection.MaxSupply > 0 && collection.Minted >= collection.MaxSupply)
        {
            throw new Exception("Collection sold out");
        }

        if (config.PerWalletLimit > 0 && claimedCount >= config.PerWalletLimit)
        {
            throw new Exception("Drop wallet limit reached");
        }

        if (config.WhitelistRequired)
        {
            BigInteger whitelistAllowance = GetDropWhitelistAllowance(collectionId, claimer);
            if (whitelistAllowance <= 0)
            {
                throw new Exception("Drop whitelist entry not found");
            }

            if (claimedCount >= whitelistAllowance)
            {
                throw new Exception("Drop whitelist allowance exhausted");
            }
        }
    }

    private static bool IsDropClaimWindowOpen(DropConfigState config)
    {
        if (!config.Enabled)
        {
            return false;
        }

        BigInteger now = Runtime.Time;
        if (config.StartAt > 0 && now < config.StartAt)
        {
            return false;
        }

        if (config.EndAt > 0 && now > config.EndAt)
        {
            return false;
        }

        return true;
    }

    private static BigInteger GetDropRemainingClaims(
        CollectionState collection,
        DropConfigState config,
        BigInteger claimedCount,
        BigInteger whitelistAllowance
    )
    {
        BigInteger remaining = BigInteger.Pow(2, 63) - 1;

        if (collection.MaxSupply > 0)
        {
            BigInteger supplyRemaining = collection.MaxSupply - collection.Minted;
            if (supplyRemaining < 0)
            {
                supplyRemaining = 0;
            }
            remaining = supplyRemaining;
        }

        if (config.PerWalletLimit > 0)
        {
            BigInteger walletRemaining = config.PerWalletLimit - claimedCount;
            if (walletRemaining < 0)
            {
                walletRemaining = 0;
            }
            if (walletRemaining < remaining)
            {
                remaining = walletRemaining;
            }
        }

        if (config.WhitelistRequired)
        {
            if (whitelistAllowance <= 0)
            {
                return 0;
            }

            BigInteger whitelistRemaining = whitelistAllowance - claimedCount;
            if (whitelistRemaining < 0)
            {
                whitelistRemaining = 0;
            }
            if (whitelistRemaining < remaining)
            {
                remaining = whitelistRemaining;
            }
        }

        return remaining;
    }

}
