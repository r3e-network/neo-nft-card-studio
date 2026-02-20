// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./NftTokenLogic.sol";

abstract contract NftCheckInLogic is NftTokenLogic {
    function configureCheckInProgram(
        uint256 collectionId,
        bool enabled,
        bool membershipRequired,
        bool membershipSoulbound,
        uint256 startAt,
        uint256 endAt,
        uint256 intervalSeconds,
        uint256 maxCheckInsPerWallet,
        bool mintProofNft
    ) external collectionExists(collectionId) {
        Collection storage collection = _collections[collectionId];
        require(msg.sender == collection.owner, "No authorization");
        require(endAt == 0 || startAt == 0 || endAt > startAt, "Invalid check-in window");

        _checkInPrograms[collectionId] = CheckInProgram({
            enabled: enabled,
            membershipRequired: membershipRequired,
            membershipSoulbound: membershipSoulbound,
            startAt: startAt,
            endAt: endAt,
            intervalSeconds: intervalSeconds,
            maxCheckInsPerWallet: maxCheckInsPerWallet,
            mintProofNft: mintProofNft
        });

        emit CheckInProgramUpdated(
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

    function checkIn(uint256 collectionId, string calldata tokenUri, bytes calldata propertiesJson)
        external
        collectionExists(collectionId)
        returns (bytes32 proofTokenId, uint256 checkInCount, uint256 checkedAt)
    {
        Collection storage collection = _collections[collectionId];
        CheckInProgram storage program = _checkInPrograms[collectionId];
        CheckInWalletStats storage stats = _checkInWalletStats[collectionId][msg.sender];

        require(program.enabled, "Check-in is not enabled");
        require(!collection.paused, "Collection paused");
        require(_isCheckInWindowOpen(program), "Check-in is not active");

        if (program.membershipRequired) {
            require(_collectionMembershipBalance[collectionId][msg.sender] > 0, "Membership token required for check-in");
        }

        if (program.maxCheckInsPerWallet > 0) {
            require(stats.checkInCount < program.maxCheckInsPerWallet, "Check-in limit reached");
        }

        if (program.intervalSeconds > 0 && stats.lastCheckInAt > 0) {
            require(block.timestamp >= stats.lastCheckInAt + program.intervalSeconds, "Check-in cooldown not reached");
        }

        checkedAt = block.timestamp;
        stats.checkInCount += 1;
        stats.lastCheckInAt = checkedAt;
        checkInCount = stats.checkInCount;

        if (program.mintProofNft) {
            proofTokenId = _mintCollectionToken(
                collectionId,
                msg.sender,
                tokenUri,
                propertiesJson,
                TOKEN_CLASS_CHECKIN_PROOF
            );
        }

        emit CheckedIn(collectionId, msg.sender, checkInCount, checkedAt, proofTokenId);
    }

    function getCheckInProgram(uint256 collectionId)
        external
        view
        collectionExists(collectionId)
        returns (
            bool enabled,
            bool membershipRequired,
            bool membershipSoulbound,
            uint256 startAt,
            uint256 endAt,
            uint256 intervalSeconds,
            uint256 maxCheckInsPerWallet,
            bool mintProofNft
        )
    {
        CheckInProgram storage program = _checkInPrograms[collectionId];
        return (
            program.enabled,
            program.membershipRequired,
            program.membershipSoulbound,
            program.startAt,
            program.endAt,
            program.intervalSeconds,
            program.maxCheckInsPerWallet,
            program.mintProofNft
        );
    }

    function getCheckInWalletStats(uint256 collectionId, address account)
        external
        view
        collectionExists(collectionId)
        returns (uint256 checkInCount, uint256 lastCheckInAt, uint256 remainingCheckIns, bool checkInNow)
    {
        require(account != address(0), "Invalid account");

        CheckInProgram storage program = _checkInPrograms[collectionId];
        CheckInWalletStats storage stats = _checkInWalletStats[collectionId][account];

        checkInCount = stats.checkInCount;
        lastCheckInAt = stats.lastCheckInAt;

        if (program.maxCheckInsPerWallet == 0) {
            remainingCheckIns = type(uint256).max;
        } else if (stats.checkInCount >= program.maxCheckInsPerWallet) {
            remainingCheckIns = 0;
        } else {
            remainingCheckIns = program.maxCheckInsPerWallet - stats.checkInCount;
        }

        checkInNow = _canCheckIn(collectionId, account);
    }

    function canCheckIn(uint256 collectionId, address account) external view collectionExists(collectionId) returns (bool) {
        if (account == address(0)) {
            return false;
        }

        return _canCheckIn(collectionId, account);
    }

    function getMembershipStatus(uint256 collectionId, address account)
        external
        view
        collectionExists(collectionId)
        returns (uint256 membershipBalance, bool isMember, bool membershipRequired, bool membershipSoulbound)
    {
        require(account != address(0), "Invalid account");

        CheckInProgram storage program = _checkInPrograms[collectionId];
        membershipBalance = _collectionMembershipBalance[collectionId][account];
        isMember = membershipBalance > 0;
        membershipRequired = program.membershipRequired;
        membershipSoulbound = program.membershipSoulbound;
    }

    function getTokenClass(bytes32 tokenId) external view returns (uint8) {
        require(_tokens[tokenId].collectionId != 0, "Token not found");
        return _tokenClass[tokenId];
    }

    function _canCheckIn(uint256 collectionId, address account) internal view returns (bool) {
        Collection storage collection = _collections[collectionId];
        CheckInProgram storage program = _checkInPrograms[collectionId];
        CheckInWalletStats storage stats = _checkInWalletStats[collectionId][account];

        if (!program.enabled || collection.paused || !_isCheckInWindowOpen(program)) {
            return false;
        }

        if (program.membershipRequired && _collectionMembershipBalance[collectionId][account] == 0) {
            return false;
        }

        if (program.maxCheckInsPerWallet > 0 && stats.checkInCount >= program.maxCheckInsPerWallet) {
            return false;
        }

        if (program.intervalSeconds > 0 && stats.lastCheckInAt > 0 && block.timestamp < stats.lastCheckInAt + program.intervalSeconds) {
            return false;
        }

        return true;
    }

    function _isCheckInWindowOpen(CheckInProgram storage program) internal view returns (bool) {
        if (!program.enabled) {
            return false;
        }

        if (program.startAt > 0 && block.timestamp < program.startAt) {
            return false;
        }

        if (program.endAt > 0 && block.timestamp > program.endAt) {
            return false;
        }

        return true;
    }
}
