using System;
using System.ComponentModel;
using System.Numerics;
using Neo;
using Neo.SmartContract.Framework;
using Neo.SmartContract.Framework.Attributes;

namespace NeoN3.MultiTenantNftPlatform;

[ManifestExtra("Author", "R3E Network")]
[ManifestExtra("Email", "jimmy@r3e.network")]
[DisplayName("MultiTenantNftTemplate")]
[ManifestExtra("Description", "Neo NFT dedicated template contract (NEP-11/NEP-24)")]
[ManifestExtra("ContractRole", "Template")]
[SupportedStandards("NEP-11", "NEP-24")]
[ContractPermission("*", "*")]
public partial class MultiTenantNftPlatform : SmartContract
{
    [DisplayName("Transfer")]
    public static event Action<UInt160, UInt160, BigInteger, ByteString> OnTransfer;

    [DisplayName("CollectionUpserted")]
    public static event Action<ByteString, UInt160, string, string, string, string, BigInteger, BigInteger, BigInteger, bool, bool, BigInteger> OnCollectionUpserted;

    [DisplayName("TokenUpserted")]
    public static event Action<ByteString, ByteString, UInt160, string, string, bool, BigInteger> OnTokenUpserted;

    [DisplayName("CollectionOperatorUpdated")]
    public static event Action<ByteString, UInt160, bool> OnCollectionOperatorUpdated;

    [DisplayName("DropConfigUpdated")]
    public static event Action<ByteString, bool, BigInteger, BigInteger, BigInteger, bool> OnDropConfigUpdated;

    [DisplayName("DropWhitelistUpdated")]
    public static event Action<ByteString, UInt160, BigInteger> OnDropWhitelistUpdated;

    [DisplayName("DropClaimed")]
    public static event Action<ByteString, UInt160, ByteString, BigInteger> OnDropClaimed;

    [DisplayName("CheckInProgramUpdated")]
    public static event Action<ByteString, bool, bool, bool, BigInteger, BigInteger, BigInteger, BigInteger, bool> OnCheckInProgramUpdated;

    [DisplayName("CheckedIn")]
    public static event Action<ByteString, UInt160, BigInteger, BigInteger, ByteString> OnCheckedIn;

    private static readonly byte[] PrefixContractOwner = [0x00];
    private static readonly byte[] PrefixTotalSupply = [0x01];
    private static readonly byte[] PrefixDedicatedContractMode = [0x03];
    private static readonly byte[] PrefixDedicatedCollectionId = [0x04];
    private static readonly byte[] PrefixInitializerContract = [0x05];
    private static readonly byte[] PrefixCollection = [0x10];
    private static readonly byte[] PrefixCollectionMintCounter = [0x11];
    private static readonly byte[] PrefixCollectionToken = [0x12];
    private static readonly byte[] PrefixCollectionOperator = [0x13];
    private static readonly byte[] PrefixCollectionDropConfig = [0x18];
    private static readonly byte[] PrefixCollectionDropWhitelist = [0x19];
    private static readonly byte[] PrefixCollectionDropWalletClaimed = [0x1A];
    private static readonly byte[] PrefixCollectionCheckInProgram = [0x1B];
    private static readonly byte[] PrefixCollectionCheckInWalletStats = [0x1C];
    private static readonly byte[] PrefixCollectionMembershipBalance = [0x1D];
    private static readonly byte[] PrefixToken = [0x20];
    private static readonly byte[] PrefixTokenOwner = [0x21];
    private static readonly byte[] PrefixOwnerBalance = [0x22];
    private static readonly byte[] PrefixOwnerToken = [0x23];
    private static readonly byte[] PrefixTokenClass = [0x24];
    private static readonly byte[] PrefixDedicatedExtraData = [0x25];

    private static readonly BigInteger TokenClassStandard = 0;
    private static readonly BigInteger TokenClassMembership = 1;
    private static readonly BigInteger TokenClassCheckInProof = 2;

    public struct CollectionState
    {
        public UInt160 Owner;
        public string Name;
        public string Symbol;
        public string Description;
        public string BaseUri;
        public BigInteger MaxSupply;
        public BigInteger Minted;
        public BigInteger RoyaltyBps;
        public bool Transferable;
        public bool Paused;
        public BigInteger CreatedAt;
    }

    public struct TokenState
    {
        public ByteString CollectionId;
        public UInt160 Owner;
        public string Uri;
        public string PropertiesJson;
        public bool Burned;
        public BigInteger MintedAt;
    }

    public struct DropConfigState
    {
        public bool Enabled;
        public BigInteger StartAt;
        public BigInteger EndAt;
        public BigInteger PerWalletLimit;
        public bool WhitelistRequired;
    }

    public struct CheckInProgramState
    {
        public bool Enabled;
        public bool MembershipRequired;
        public bool MembershipSoulbound;
        public BigInteger StartAt;
        public BigInteger EndAt;
        public BigInteger IntervalSeconds;
        public BigInteger MaxCheckInsPerWallet;
        public bool MintProofNft;
    }

    public struct CheckInWalletStatsState
    {
        public BigInteger CheckInCount;
        public BigInteger LastCheckInAt;
    }
}
