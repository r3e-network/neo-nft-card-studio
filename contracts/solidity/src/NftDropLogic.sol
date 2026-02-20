// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./NftCheckInLogic.sol";

abstract contract NftDropLogic is NftCheckInLogic {
    function configureDrop(
        uint256 collectionId,
        bool enabled,
        uint256 startAt,
        uint256 endAt,
        uint256 perWalletLimit,
        bool whitelistRequired
    ) external collectionExists(collectionId) {
        Collection storage collection = _collections[collectionId];
        require(msg.sender == collection.owner, "No authorization");
        require(endAt == 0 || startAt == 0 || endAt > startAt, "Invalid drop window");

        _dropConfigs[collectionId] = DropConfig({
            enabled: enabled,
            startAt: startAt,
            endAt: endAt,
            perWalletLimit: perWalletLimit,
            whitelistRequired: whitelistRequired
        });

        emit DropConfigUpdated(collectionId, enabled, startAt, endAt, perWalletLimit, whitelistRequired);
    }

    function setDropWhitelist(uint256 collectionId, address account, uint256 allowance) external collectionExists(collectionId) {
        require(account != address(0), "Invalid account");
        Collection storage collection = _collections[collectionId];
        require(msg.sender == collection.owner, "No authorization");

        _dropWhitelistAllowance[collectionId][account] = allowance;
        emit DropWhitelistUpdated(collectionId, account, allowance);
    }

    function setDropWhitelistBatch(uint256 collectionId, address[] calldata accounts, uint256[] calldata allowances)
        external
        collectionExists(collectionId)
    {
        require(accounts.length == allowances.length, "Whitelist length mismatch");
        require(accounts.length <= 500, "Whitelist batch too large");

        Collection storage collection = _collections[collectionId];
        require(msg.sender == collection.owner, "No authorization");

        for (uint256 i = 0; i < accounts.length; i += 1) {
            address account = accounts[i];
            require(account != address(0), "Invalid account");
            _dropWhitelistAllowance[collectionId][account] = allowances[i];
            emit DropWhitelistUpdated(collectionId, account, allowances[i]);
        }
    }

    function claimDrop(uint256 collectionId, string calldata tokenUri, bytes calldata propertiesJson)
        external
        collectionExists(collectionId)
        returns (bytes32)
    {
        Collection storage collection = _collections[collectionId];
        DropConfig storage config = _dropConfigs[collectionId];
        require(config.enabled, "Drop is not enabled");
        require(!collection.paused, "Collection paused");
        require(_isDropWindowOpen(config), "Drop is not active");
        require(_hasCollectionSupplyRemaining(collection), "Collection sold out");

        uint256 claimed = _dropClaimedCount[collectionId][msg.sender];
        if (config.perWalletLimit > 0) {
            require(claimed < config.perWalletLimit, "Drop wallet limit reached");
        }
        if (config.whitelistRequired) {
            uint256 allowance = _dropWhitelistAllowance[collectionId][msg.sender];
            require(allowance > 0, "Drop whitelist entry not found");
            require(claimed < allowance, "Drop whitelist allowance exhausted");
        }

        uint256 nextClaimed = claimed + 1;
        _dropClaimedCount[collectionId][msg.sender] = nextClaimed;

        bytes32 tokenId = _mintCollectionToken(
            collectionId,
            msg.sender,
            tokenUri,
            propertiesJson,
            TOKEN_CLASS_MEMBERSHIP
        );
        emit DropClaimed(collectionId, msg.sender, tokenId, nextClaimed);
        return tokenId;
    }

    function getDropConfig(uint256 collectionId)
        external
        view
        collectionExists(collectionId)
        returns (bool enabled, uint256 startAt, uint256 endAt, uint256 perWalletLimit, bool whitelistRequired)
    {
        DropConfig storage config = _dropConfigs[collectionId];
        return (config.enabled, config.startAt, config.endAt, config.perWalletLimit, config.whitelistRequired);
    }

    function getDropWalletStats(uint256 collectionId, address account)
        external
        view
        collectionExists(collectionId)
        returns (uint256 claimed, uint256 whitelistAllowance, uint256 remaining, bool claimableNow)
    {
        require(account != address(0), "Invalid account");
        DropConfig storage config = _dropConfigs[collectionId];
        claimed = _dropClaimedCount[collectionId][account];
        whitelistAllowance = config.whitelistRequired ? _dropWhitelistAllowance[collectionId][account] : 0;
        remaining = _remainingDropClaims(collectionId, account);
        claimableNow = config.enabled
            && !(_collections[collectionId].paused)
            && _isDropWindowOpen(config)
            && remaining > 0;
    }

    function canClaimDrop(uint256 collectionId, address account) external view collectionExists(collectionId) returns (bool) {
        if (account == address(0)) {
            return false;
        }

        DropConfig storage config = _dropConfigs[collectionId];
        return config.enabled
            && !(_collections[collectionId].paused)
            && _isDropWindowOpen(config)
            && _remainingDropClaims(collectionId, account) > 0;
    }

    function _isDropWindowOpen(DropConfig storage config) internal view returns (bool) {
        if (!config.enabled) {
            return false;
        }

        if (config.startAt > 0 && block.timestamp < config.startAt) {
            return false;
        }

        if (config.endAt > 0 && block.timestamp > config.endAt) {
            return false;
        }

        return true;
    }

    function _remainingDropClaims(uint256 collectionId, address account) internal view returns (uint256) {
        Collection storage collection = _collections[collectionId];
        DropConfig storage config = _dropConfigs[collectionId];

        if (!config.enabled) {
            return 0;
        }

        bool hasFiniteCap = false;
        uint256 remaining = 0;
        if (collection.maxSupply > 0) {
            if (collection.minted >= collection.maxSupply) {
                return 0;
            }
            remaining = collection.maxSupply - collection.minted;
            hasFiniteCap = true;
        }

        uint256 claimed = _dropClaimedCount[collectionId][account];

        if (config.perWalletLimit > 0) {
            if (claimed >= config.perWalletLimit) {
                return 0;
            }

            uint256 walletRemaining = config.perWalletLimit - claimed;
            if (!hasFiniteCap || walletRemaining < remaining) {
                remaining = walletRemaining;
                hasFiniteCap = true;
            }
        }

        if (config.whitelistRequired) {
            uint256 allowance = _dropWhitelistAllowance[collectionId][account];
            if (allowance == 0 || claimed >= allowance) {
                return 0;
            }

            uint256 whitelistRemaining = allowance - claimed;
            if (!hasFiniteCap || whitelistRemaining < remaining) {
                remaining = whitelistRemaining;
                hasFiniteCap = true;
            }
        }

        if (!hasFiniteCap) {
            return type(uint256).max;
        }

        return remaining;
    }

    function _hasCollectionSupplyRemaining(Collection storage collection) internal view returns (bool) {
        return collection.maxSupply == 0 || collection.minted < collection.maxSupply;
    }
}
