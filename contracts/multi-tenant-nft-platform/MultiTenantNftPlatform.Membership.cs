using System;
using System.Numerics;
using Neo;
using Neo.SmartContract.Framework;
using Neo.SmartContract.Framework.Attributes;
using Neo.SmartContract.Framework.Services;

namespace NeoN3.MultiTenantNftPlatform;

public partial class MultiTenantNftPlatform
{
    public static void configureCheckInProgram(
        ByteString collectionId,
        bool enabled,
        bool membershipRequired,
        bool membershipSoulbound,
        BigInteger startAt,
        BigInteger endAt,
        BigInteger intervalSeconds,
        BigInteger maxCheckInsPerWallet,
        bool mintProofNft
    )
    {
        AssertDedicatedContractMode();
        collectionId = EnforceCollectionScope(collectionId);
        CollectionState collection = GetCollectionState(collectionId);
        AssertCollectionOwnerWitness(collection);

        if (startAt < 0 || endAt < 0 || intervalSeconds < 0 || maxCheckInsPerWallet < 0)
        {
            throw new Exception("Check-in program values out of range");
        }

        if (endAt > 0 && startAt > 0 && endAt <= startAt)
        {
            throw new Exception("Check-in end time must be greater than start time");
        }

        CheckInProgramState state = new CheckInProgramState
        {
            Enabled = enabled,
            MembershipRequired = membershipRequired,
            MembershipSoulbound = membershipSoulbound,
            StartAt = startAt,
            EndAt = endAt,
            IntervalSeconds = intervalSeconds,
            MaxCheckInsPerWallet = maxCheckInsPerWallet,
            MintProofNft = mintProofNft,
        };

        PutCheckInProgramState(collectionId, state);
        OnCheckInProgramUpdated(
            collectionId,
            enabled,
            membershipRequired,
            membershipSoulbound,
            startAt,
            endAt,
            intervalSeconds,
            maxCheckInsPerWallet,
            mintProofNft
        );
    }

    public static object[] checkIn(ByteString collectionId, string tokenUri, string propertiesJson)
    {
        AssertDedicatedContractMode();
        collectionId = EnforceCollectionScope(collectionId);
        UInt160 account = GetSenderChecked();
        CollectionState collection = GetCollectionState(collectionId);
        CheckInProgramState program = GetCheckInProgramState(collectionId);
        CheckInWalletStatsState walletStats = GetCheckInWalletStatsState(collectionId, account);

        AssertCheckInAllowed(collectionId, collection, program, account, walletStats);

        BigInteger checkedAt = Runtime.Time;
        walletStats.CheckInCount += 1;
        walletStats.LastCheckInAt = checkedAt;
        PutCheckInWalletStatsState(collectionId, account, walletStats);

        ByteString proofTokenId = "";
        if (program.MintProofNft)
        {
            proofTokenId = MintCore(collectionId, account, tokenUri, propertiesJson, TokenClassCheckInProof);
        }

        OnCheckedIn(collectionId, account, walletStats.CheckInCount, checkedAt, proofTokenId);

        return
        [
            proofTokenId,
            walletStats.CheckInCount,
            checkedAt,
        ];
    }

    [Safe]
    public static object[] getCheckInProgram(ByteString collectionId)
    {
        AssertDedicatedContractMode();
        collectionId = EnforceCollectionScope(collectionId);
        GetCollectionState(collectionId);
        CheckInProgramState state = GetCheckInProgramState(collectionId);

        return
        [
            state.Enabled,
            state.MembershipRequired,
            state.MembershipSoulbound,
            state.StartAt,
            state.EndAt,
            state.IntervalSeconds,
            state.MaxCheckInsPerWallet,
            state.MintProofNft,
        ];
    }

    private static void AssertCheckInAllowed(
        ByteString collectionId,
        CollectionState collection,
        CheckInProgramState program,
        UInt160 account,
        CheckInWalletStatsState walletStats
    )
    {
        if (!program.Enabled)
        {
            throw new Exception("Check-in is not enabled");
        }

        if (collection.Paused)
        {
            throw new Exception("Collection paused");
        }

        if (!IsCheckInWindowOpen(program))
        {
            throw new Exception("Check-in is not active");
        }

        if (program.MembershipRequired)
        {
            BigInteger membershipBalance = GetCollectionMembershipBalance(collectionId, account);
            if (membershipBalance <= 0)
            {
                throw new Exception("Membership token required for check-in");
            }
        }

        if (program.MaxCheckInsPerWallet > 0 && walletStats.CheckInCount >= program.MaxCheckInsPerWallet)
        {
            throw new Exception("Check-in limit reached");
        }

        if (program.IntervalSeconds > 0 && walletStats.LastCheckInAt > 0)
        {
            BigInteger nextAvailableAt = walletStats.LastCheckInAt + program.IntervalSeconds;
            if (Runtime.Time < nextAvailableAt)
            {
                throw new Exception("Check-in cooldown not reached");
            }
        }
    }

    private static bool IsCheckInWindowOpen(CheckInProgramState program)
    {
        if (!program.Enabled)
        {
            return false;
        }

        BigInteger now = Runtime.Time;
        if (program.StartAt > 0 && now < program.StartAt)
        {
            return false;
        }

        if (program.EndAt > 0 && now > program.EndAt)
        {
            return false;
        }

        return true;
    }
}
