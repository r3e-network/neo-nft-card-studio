// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./NftStorage.sol";

abstract contract NftCollectionLogic is NftStorage {
    function createCollection(
        string calldata name,
        string calldata tokenSymbol,
        string calldata description,
        string calldata baseUri,
        uint256 maxSupply,
        uint256 royaltyBps,
        bool transferable
    ) external returns (uint256) {
        require(bytes(name).length > 0 && bytes(name).length <= 80, "Invalid name");
        require(bytes(tokenSymbol).length > 0 && bytes(tokenSymbol).length <= 12, "Invalid symbol");
        require(bytes(description).length <= 512, "Description too long");
        require(bytes(baseUri).length > 0 && bytes(baseUri).length <= 512, "Invalid base URI");
        require(royaltyBps <= 10000, "Royalty out of range");
        require(_ownerDedicatedCollection[msg.sender] == 0, "Owner already has dedicated NFT collection");

        _collectionCounter += 1;
        uint256 collectionId = _collectionCounter;

        Collection memory collection = Collection({
            owner: msg.sender,
            name: name,
            symbol: tokenSymbol,
            description: description,
            baseUri: baseUri,
            maxSupply: maxSupply,
            minted: 0,
            royaltyBps: royaltyBps,
            transferable: transferable,
            paused: false,
            createdAt: block.timestamp
        });

        _collections[collectionId] = collection;
        _collectionMintCounter[collectionId] = 0;
        _ownerDedicatedCollection[msg.sender] = collectionId;

        _emitCollectionUpserted(collectionId, collection);
        return collectionId;
    }

    function getOwnerDedicatedCollection(address owner) external view returns (uint256) {
        require(owner != address(0), "Invalid owner");
        return _ownerDedicatedCollection[owner];
    }

    function hasOwnerDedicatedCollection(address owner) external view returns (bool) {
        require(owner != address(0), "Invalid owner");
        return _ownerDedicatedCollection[owner] != 0;
    }

    function updateCollection(
        uint256 collectionId,
        string calldata description,
        string calldata baseUri,
        uint256 royaltyBps,
        bool transferable,
        bool paused
    ) external collectionExists(collectionId) {
        Collection storage collection = _collections[collectionId];
        require(msg.sender == collection.owner, "No authorization");
        require(bytes(description).length <= 512, "Description too long");
        require(bytes(baseUri).length <= 512, "Base URI too long");
        require(royaltyBps <= 10000, "Royalty out of range");

        collection.description = description;
        collection.baseUri = baseUri;
        collection.royaltyBps = royaltyBps;
        collection.transferable = transferable;
        collection.paused = paused;

        _emitCollectionUpserted(collectionId, collection);
    }

    function setCollectionOperator(uint256 collectionId, address operator, bool enabled)
        external
        collectionExists(collectionId)
    {
        require(operator != address(0), "Invalid operator");

        Collection storage collection = _collections[collectionId];
        require(msg.sender == collection.owner, "No authorization");

        _collectionOperators[collectionId][operator] = enabled;
        emit CollectionOperatorUpdated(collectionId, operator, enabled);
    }

    function isCollectionOperator(uint256 collectionId, address operator) external view returns (bool) {
        return _collectionOperators[collectionId][operator];
    }

    function _emitCollectionUpserted(uint256 collectionId, Collection memory collection) internal {
        emit CollectionUpserted(
            collectionId,
            collection.owner,
            collection.name,
            collection.symbol,
            collection.description,
            collection.baseUri,
            collection.maxSupply,
            collection.minted,
            collection.royaltyBps,
            collection.transferable,
            collection.paused,
            collection.createdAt
        );
    }
}
