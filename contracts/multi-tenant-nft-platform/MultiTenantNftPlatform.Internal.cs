using System;
using System.Numerics;
using Neo;
using Neo.SmartContract.Framework;
using Neo.SmartContract.Framework.Native;
using Neo.SmartContract.Framework.Services;

namespace NeoN3.MultiTenantNftPlatform;

public partial class MultiTenantNftPlatform
{
    private static StorageMap Collections()
    {
        return new StorageMap(Storage.CurrentContext, PrefixCollection);
    }

    private static StorageMap CollectionMintCounter()
    {
        return new StorageMap(Storage.CurrentContext, PrefixCollectionMintCounter);
    }

    private static StorageMap CollectionTokens()
    {
        return new StorageMap(Storage.CurrentContext, PrefixCollectionToken);
    }

    private static StorageMap CollectionOperators()
    {
        return new StorageMap(Storage.CurrentContext, PrefixCollectionOperator);
    }

    private static StorageMap Tokens()
    {
        return new StorageMap(Storage.CurrentContext, PrefixToken);
    }

    private static StorageMap TokenOwners()
    {
        return new StorageMap(Storage.CurrentContext, PrefixTokenOwner);
    }

    private static StorageMap Balances()
    {
        return new StorageMap(Storage.CurrentContext, PrefixOwnerBalance);
    }

    private static StorageMap OwnerTokens()
    {
        return new StorageMap(Storage.CurrentContext, PrefixOwnerToken);
    }

    private static StorageMap CollectionDropConfigs()
    {
        return new StorageMap(Storage.CurrentContext, PrefixCollectionDropConfig);
    }

    private static StorageMap CollectionDropWhitelist()
    {
        return new StorageMap(Storage.CurrentContext, PrefixCollectionDropWhitelist);
    }

    private static StorageMap CollectionDropWalletClaimed()
    {
        return new StorageMap(Storage.CurrentContext, PrefixCollectionDropWalletClaimed);
    }

    private static StorageMap CollectionCheckInPrograms()
    {
        return new StorageMap(Storage.CurrentContext, PrefixCollectionCheckInProgram);
    }

    private static StorageMap CollectionCheckInWalletStats()
    {
        return new StorageMap(Storage.CurrentContext, PrefixCollectionCheckInWalletStats);
    }

    private static StorageMap CollectionMembershipBalances()
    {
        return new StorageMap(Storage.CurrentContext, PrefixCollectionMembershipBalance);
    }

    private static StorageMap TokenClasses()
    {
        return new StorageMap(Storage.CurrentContext, PrefixTokenClass);
    }

    private static StorageMap DedicatedExtraDataStore()
    {
        return new StorageMap(Storage.CurrentContext, PrefixDedicatedExtraData);
    }

    private static void ValidateCollectionInputs(string name, string tokenSymbol, string description, string baseUri, BigInteger maxSupply, BigInteger royaltyBps)
    {
        if (name.Length == 0 || name.Length > 80)
        {
            throw new Exception("Invalid collection name");
        }

        if (tokenSymbol.Length == 0 || tokenSymbol.Length > 12)
        {
            throw new Exception("Invalid collection symbol");
        }

        if (description.Length > 512)
        {
            throw new Exception("Description too long");
        }

        if (baseUri.Length == 0 || baseUri.Length > 512)
        {
            throw new Exception("Invalid base URI");
        }

        if (maxSupply < 0)
        {
            throw new Exception("Invalid max supply");
        }

        if (royaltyBps < 0 || royaltyBps > 10000)
        {
            throw new Exception("Royalty out of range");
        }
    }

    private static UInt160 GetSenderChecked()
    {
        Transaction tx = Runtime.Transaction;
        UInt160 sender = tx.Sender;

        if (!Runtime.CheckWitness(sender))
        {
            throw new Exception("No witness");
        }

        return sender;
    }

    private static UInt160 GetContractOwner()
    {
        return (UInt160)Storage.Get(Storage.CurrentContext, PrefixContractOwner);
    }

    private static BigInteger ReadBigInteger(StorageContext context, byte[] key)
    {
        ByteString value = Storage.Get(context, key);
        return value is null ? 0 : (BigInteger)value;
    }

    private static BigInteger ReadBigInteger(StorageMap map, ByteString key)
    {
        ByteString value = map.Get(key);
        return value is null ? 0 : (BigInteger)value;
    }

    private static BigInteger ReadBigInteger(StorageMap map, string key)
    {
        ByteString value = map.Get(key);
        return value is null ? 0 : (BigInteger)value;
    }

    private static CollectionState GetCollectionState(ByteString collectionId)
    {
        ByteString serialized = Collections().Get(collectionId);
        if (serialized is null)
        {
            throw new Exception("Collection not found");
        }

        return (CollectionState)StdLib.Deserialize(serialized);
    }

    private static CollectionState GetCollectionStateOrDefault(ByteString collectionId)
    {
        ByteString serialized = Collections().Get(collectionId);
        if (serialized is null)
        {
            return new CollectionState();
        }

        return (CollectionState)StdLib.Deserialize(serialized);
    }

    private static void PutCollectionState(ByteString collectionId, CollectionState collection)
    {
        Collections().Put(collectionId, StdLib.Serialize(collection));
    }

    private static DropConfigState GetDropConfigState(ByteString collectionId)
    {
        ByteString serialized = CollectionDropConfigs().Get(collectionId);
        if (serialized is null)
        {
            return new DropConfigState
            {
                Enabled = false,
                StartAt = 0,
                EndAt = 0,
                PerWalletLimit = 0,
                WhitelistRequired = false,
            };
        }

        return (DropConfigState)StdLib.Deserialize(serialized);
    }

    private static void PutDropConfigState(ByteString collectionId, DropConfigState config)
    {
        CollectionDropConfigs().Put(collectionId, StdLib.Serialize(config));
    }

    private static CheckInProgramState GetCheckInProgramState(ByteString collectionId)
    {
        ByteString serialized = CollectionCheckInPrograms().Get(collectionId);
        if (serialized is null)
        {
            return new CheckInProgramState
            {
                Enabled = false,
                MembershipRequired = false,
                MembershipSoulbound = false,
                StartAt = 0,
                EndAt = 0,
                IntervalSeconds = 0,
                MaxCheckInsPerWallet = 0,
                MintProofNft = true,
            };
        }

        return (CheckInProgramState)StdLib.Deserialize(serialized);
    }

    private static void PutCheckInProgramState(ByteString collectionId, CheckInProgramState state)
    {
        CollectionCheckInPrograms().Put(collectionId, StdLib.Serialize(state));
    }

    private static CheckInWalletStatsState GetCheckInWalletStatsState(ByteString collectionId, UInt160 account)
    {
        ByteString serialized = CollectionCheckInWalletStats().Get(CheckInWalletStatsKey(collectionId, account));
        if (serialized is null)
        {
            return new CheckInWalletStatsState
            {
                CheckInCount = 0,
                LastCheckInAt = 0,
            };
        }

        return (CheckInWalletStatsState)StdLib.Deserialize(serialized);
    }

    private static void PutCheckInWalletStatsState(
        ByteString collectionId,
        UInt160 account,
        CheckInWalletStatsState state
    )
    {
        string key = CheckInWalletStatsKey(collectionId, account);
        if (state.CheckInCount <= 0 && state.LastCheckInAt <= 0)
        {
            CollectionCheckInWalletStats().Delete(key);
            return;
        }

        CollectionCheckInWalletStats().Put(key, StdLib.Serialize(state));
    }

    private static bool IsDedicatedContractMode()
    {
        return ReadBigInteger(Storage.CurrentContext, PrefixDedicatedContractMode) > 0;
    }

    private static UInt160 GetInitializerContract()
    {
        ByteString value = Storage.Get(Storage.CurrentContext, PrefixInitializerContract);
        if (value is null || value.Length == 0)
        {
            return UInt160.Zero;
        }

        return (UInt160)value;
    }

    private static ByteString GetDedicatedCollectionId()
    {
        ByteString collectionId = Storage.Get(Storage.CurrentContext, PrefixDedicatedCollectionId);
        return collectionId ?? "";
    }

    private static void SetDedicatedContractMode(ByteString collectionId)
    {
        if (collectionId is null || collectionId.Length == 0)
        {
            throw new Exception("Invalid dedicated collection id");
        }

        Storage.Put(Storage.CurrentContext, PrefixDedicatedContractMode, 1);
        Storage.Put(Storage.CurrentContext, PrefixDedicatedCollectionId, collectionId);
    }

    private static void AssertDedicatedContractMode()
    {
        if (!IsDedicatedContractMode())
        {
            throw new Exception("Operation only available in dedicated NFT contract mode");
        }
    }

    private static void AssertDirectInvocation()
    {
        if (Runtime.CallingScriptHash != Runtime.EntryScriptHash)
        {
            throw new Exception("Contract-to-contract invocation is not allowed for this method");
        }
    }

    private static ByteString EnforceCollectionScope(ByteString collectionId)
    {
        if (collectionId is null || collectionId.Length == 0)
        {
            throw new Exception("Invalid collection id");
        }

        if (!IsDedicatedContractMode())
        {
            return collectionId;
        }

        ByteString dedicatedCollectionId = GetDedicatedCollectionId();
        if (dedicatedCollectionId is null || dedicatedCollectionId.Length == 0)
        {
            throw new Exception("Dedicated NFT contract is not initialized");
        }

        if ((string)collectionId != (string)dedicatedCollectionId)
        {
            throw new Exception("Collection id not bound to this dedicated NFT contract");
        }

        return dedicatedCollectionId;
    }

    private static void AssertTokenWithinScope(ByteString tokenId, TokenState token)
    {
        if (!IsDedicatedContractMode())
        {
            return;
        }

        ByteString dedicatedCollectionId = GetDedicatedCollectionId();
        if (dedicatedCollectionId is null || dedicatedCollectionId.Length == 0)
        {
            throw new Exception("Dedicated NFT contract is not initialized");
        }

        if ((string)token.CollectionId != (string)dedicatedCollectionId)
        {
            throw new Exception("Token is outside dedicated NFT contract scope: " + (string)tokenId);
        }
    }

    private static void TryInitializeCollectionFromDeployData(object data)
    {
        if (data is null)
        {
            return;
        }

        try
        {
            object[] values = (object[])data;
            int offset = values.Length == 13 ? 1 : 0;
            if (values.Length < offset + 12)
            {
                return;
            }

            ByteString collectionId = (ByteString)values[offset];
            if (collectionId is null || collectionId.Length == 0)
            {
                return;
            }

            UInt160 owner = (UInt160)values[offset + 1];
            if (!owner.IsValid)
            {
                return;
            }

            string name = (string)values[offset + 2];
            string tokenSymbol = (string)values[offset + 3];
            string description = (string)values[offset + 4];
            string baseUri = (string)values[offset + 5];
            BigInteger maxSupply = (BigInteger)values[offset + 6];
            BigInteger minted = (BigInteger)values[offset + 7];
            BigInteger royaltyBps = (BigInteger)values[offset + 8];
            bool transferable = (bool)values[offset + 9];
            bool paused = (bool)values[offset + 10];
            BigInteger createdAt = (BigInteger)values[offset + 11];

            ValidateCollectionInputs(name, tokenSymbol, description, baseUri, maxSupply, royaltyBps);
            if (minted < 0 || (maxSupply > 0 && minted > maxSupply))
            {
                return;
            }

            if (createdAt < 0)
            {
                return;
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
            CollectionMintCounter().Put(collectionId, state.Minted);
            SetDedicatedContractMode(collectionId);
            Storage.Put(Storage.CurrentContext, PrefixContractOwner, state.Owner);
            EmitCollectionUpserted(collectionId, state);
        }
        catch
        {
            return;
        }
    }

    private static TokenState GetTokenState(ByteString tokenId)
    {
        ByteString serialized = Tokens().Get(tokenId);
        if (serialized is null)
        {
            throw new Exception("Token not found");
        }

        return (TokenState)StdLib.Deserialize(serialized);
    }

    private static void PutTokenState(ByteString tokenId, TokenState token)
    {
        Tokens().Put(tokenId, StdLib.Serialize(token));
    }

    private static string CollectionOperatorKey(ByteString collectionId, UInt160 operatorAddress)
    {
        return ((string)collectionId) + "|" + operatorAddress.ToString();
    }

    private static string OwnerTokenKey(UInt160 owner, ByteString tokenId)
    {
        return owner.ToString() + "|" + ((string)tokenId);
    }

    private static string CollectionTokenKey(ByteString collectionId, ByteString tokenId)
    {
        return ((string)collectionId) + "|" + ((string)tokenId);
    }

    private static string DropWhitelistKey(ByteString collectionId, UInt160 account)
    {
        return ((string)collectionId) + "|" + account.ToString();
    }

    private static string DropWalletClaimedKey(ByteString collectionId, UInt160 account)
    {
        return ((string)collectionId) + "|" + account.ToString();
    }

    private static string CheckInWalletStatsKey(ByteString collectionId, UInt160 account)
    {
        return ((string)collectionId) + "|" + account.ToString();
    }

    private static string MembershipBalanceKey(ByteString collectionId, UInt160 account)
    {
        return ((string)collectionId) + "|" + account.ToString();
    }

    private static BigInteger GetDropWhitelistAllowance(ByteString collectionId, UInt160 account)
    {
        return ReadBigInteger(CollectionDropWhitelist(), DropWhitelistKey(collectionId, account));
    }

    private static void SetDropWhitelistAllowance(ByteString collectionId, UInt160 account, BigInteger allowance)
    {
        string key = DropWhitelistKey(collectionId, account);
        if (allowance <= 0)
        {
            CollectionDropWhitelist().Delete(key);
            return;
        }

        CollectionDropWhitelist().Put(key, allowance);
    }

    private static BigInteger GetDropWalletClaimedCount(ByteString collectionId, UInt160 account)
    {
        return ReadBigInteger(CollectionDropWalletClaimed(), DropWalletClaimedKey(collectionId, account));
    }

    private static void SetDropWalletClaimedCount(ByteString collectionId, UInt160 account, BigInteger claimedCount)
    {
        string key = DropWalletClaimedKey(collectionId, account);
        if (claimedCount <= 0)
        {
            CollectionDropWalletClaimed().Delete(key);
            return;
        }

        CollectionDropWalletClaimed().Put(key, claimedCount);
    }

    private static BigInteger GetTokenClassValue(ByteString tokenId)
    {
        return ReadBigInteger(TokenClasses(), tokenId);
    }

    private static void SetTokenClass(ByteString tokenId, BigInteger tokenClass)
    {
        if (tokenClass <= TokenClassStandard)
        {
            TokenClasses().Delete(tokenId);
            return;
        }

        TokenClasses().Put(tokenId, tokenClass);
    }

    private static object GetDedicatedExtraData(ByteString collectionId)
    {
        ByteString serialized = DedicatedExtraDataStore().Get(collectionId);
        if (serialized is null || serialized.Length == 0)
        {
            return null;
        }

        return StdLib.Deserialize(serialized);
    }

    private static void SetDedicatedExtraData(ByteString collectionId, object extraData)
    {
        if (extraData is null)
        {
            DedicatedExtraDataStore().Delete(collectionId);
            return;
        }

        DedicatedExtraDataStore().Put(collectionId, StdLib.Serialize(extraData));
    }

    private static BigInteger GetCollectionMembershipBalance(ByteString collectionId, UInt160 account)
    {
        return ReadBigInteger(CollectionMembershipBalances(), MembershipBalanceKey(collectionId, account));
    }

    private static void IncreaseCollectionMembershipBalance(ByteString collectionId, UInt160 account)
    {
        string key = MembershipBalanceKey(collectionId, account);
        BigInteger current = ReadBigInteger(CollectionMembershipBalances(), key);
        CollectionMembershipBalances().Put(key, current + 1);
    }

    private static void DecreaseCollectionMembershipBalance(ByteString collectionId, UInt160 account)
    {
        string key = MembershipBalanceKey(collectionId, account);
        BigInteger current = ReadBigInteger(CollectionMembershipBalances(), key);
        if (current <= 1)
        {
            CollectionMembershipBalances().Delete(key);
            return;
        }

        CollectionMembershipBalances().Put(key, current - 1);
    }

    private static bool IsTokenClassValid(BigInteger tokenClass)
    {
        return tokenClass >= TokenClassStandard && tokenClass <= TokenClassCheckInProof;
    }

    private static bool IsMembershipSoulbound(ByteString collectionId)
    {
        CheckInProgramState program = GetCheckInProgramState(collectionId);
        return program.MembershipSoulbound;
    }

    private static void AddOwnerTokenIndex(UInt160 owner, ByteString tokenId)
    {
        OwnerTokens().Put(OwnerTokenKey(owner, tokenId), 1);
    }

    private static void RemoveOwnerTokenIndex(UInt160 owner, ByteString tokenId)
    {
        OwnerTokens().Delete(OwnerTokenKey(owner, tokenId));
    }

    private static bool CanManageCollection(ByteString collectionId, CollectionState collection, UInt160 sender)
    {
        if (sender == collection.Owner)
        {
            return true;
        }

        string operatorKey = CollectionOperatorKey(collectionId, sender);
        return CollectionOperators().Get(operatorKey) is not null;
    }

    private static void AssertCollectionOwnerWitness(CollectionState collection)
    {
        if (!Runtime.CheckWitness(collection.Owner))
        {
            throw new Exception("No authorization");
        }
    }

    private static void EmitCollectionUpserted(ByteString collectionId, CollectionState collection)
    {
        OnCollectionUpserted(
            collectionId,
            collection.Owner,
            collection.Name,
            collection.Symbol,
            collection.Description,
            collection.BaseUri,
            collection.MaxSupply,
            collection.Minted,
            collection.RoyaltyBps,
            collection.Transferable,
            collection.Paused,
            collection.CreatedAt
        );
    }

    private static void EmitTokenUpserted(ByteString tokenId, TokenState token)
    {
        OnTokenUpserted(
            tokenId,
            token.CollectionId,
            token.Owner,
            token.Uri,
            token.PropertiesJson,
            token.Burned,
            token.MintedAt
        );
    }

    private static void PostTransfer(UInt160 from, UInt160 to, ByteString tokenId, object data)
    {
        OnTransfer(from, to, 1, tokenId);
        if (to is null)
        {
            return;
        }

        Contract targetContract = ContractManagement.GetContract(to);
        if (targetContract is null)
        {
            return;
        }

        Contract.Call(to, "onNEP11Payment", CallFlags.All, from, 1, tokenId, data);
    }

    private static string EscapeJsonString(string value)
    {
        string escaped = value.Replace("\\", "\\\\");
        escaped = escaped.Replace("\"", "\\\"");
        escaped = escaped.Replace("\n", "\\n");
        escaped = escaped.Replace("\r", "\\r");
        return escaped;
    }

    private static string BuildDefaultTokenName(string collectionName, BigInteger serial, BigInteger maxSupply)
    {
        string serialText = serial.ToString();
        int width = 1;

        if (maxSupply >= 100000)
        {
            width = 5;
        }
        else if (maxSupply >= 10000)
        {
            width = 4;
        }
        else if (maxSupply >= 1000)
        {
            width = 3;
        }
        else if (maxSupply >= 100)
        {
            width = 2;
        }

        while (serialText.Length < width)
        {
            serialText = "0" + serialText;
        }

        return collectionName + " No." + serialText;
    }

    private static string BuildDefaultPropertiesJson(string collectionName, BigInteger serial, BigInteger maxSupply)
    {
        string title = EscapeJsonString(BuildDefaultTokenName(collectionName, serial, maxSupply));
        return "{\"name\":\"" + title + "\"}";
    }
}
