// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./NftDropLogic.sol";

abstract contract NftQueryLogic is NftDropLogic {
    function tokensOf(address owner) external view returns (bytes32[] memory) {
        return _ownedTokens[owner];
    }

    function tokens() external view returns (bytes32[] memory) {
        return _allTokens;
    }

    function getCollectionTokens(uint256 collectionId) external view returns (bytes32[] memory) {
        return _collectionTokens[collectionId];
    }

    function getCollection(uint256 collectionId)
        external
        view
        collectionExists(collectionId)
        returns (
            uint256 id,
            address owner,
            string memory name,
            string memory tokenSymbol,
            string memory description,
            string memory baseUri,
            uint256 maxSupply,
            uint256 minted,
            uint256 royaltyBps,
            bool transferable,
            bool paused,
            uint256 createdAt
        )
    {
        Collection storage c = _collections[collectionId];
        return (
            collectionId,
            c.owner,
            c.name,
            c.symbol,
            c.description,
            c.baseUri,
            c.maxSupply,
            c.minted,
            c.royaltyBps,
            c.transferable,
            c.paused,
            c.createdAt
        );
    }

    function getToken(bytes32 tokenId)
        external
        view
        returns (
            bytes32 id,
            uint256 collectionId,
            address owner,
            string memory tokenUri,
            bytes memory propertiesJson,
            bool burned,
            uint256 mintedAt
        )
    {
        TokenState storage t = _tokens[tokenId];
        require(t.collectionId != 0, "Token not found");
        return (tokenId, t.collectionId, t.owner, t.uri, t.propertiesJson, t.burned, t.mintedAt);
    }

    function tokenURI(bytes32 tokenId) external view tokenExists(tokenId) returns (string memory) {
        return _tokens[tokenId].uri;
    }

    function properties(bytes32 tokenId) external view tokenExists(tokenId) returns (bytes memory) {
        return _tokens[tokenId].propertiesJson;
    }

    function getRoyalties(bytes32 tokenId) external view tokenExists(tokenId) returns (string memory) {
        TokenState storage token = _tokens[tokenId];
        Collection storage collection = _collections[token.collectionId];
        if (collection.royaltyBps == 0) {
            return "[]";
        }

        return string.concat(
            "[{\"address\":\"",
            _addressToString(collection.owner),
            "\",\"value\":",
            _uintToString(collection.royaltyBps),
            "}]"
        );
    }

    function royaltyInfo(bytes32 tokenId, address, uint256 salePrice)
        external
        view
        tokenExists(tokenId)
        returns (address receiver, uint256 royaltyAmount)
    {
        TokenState storage token = _tokens[tokenId];
        Collection storage collection = _collections[token.collectionId];
        receiver = collection.owner;
        royaltyAmount = (salePrice * collection.royaltyBps) / 10000;
    }

    function onNEP11Payment(address, uint256, bytes32, bytes calldata) external {
        revert("Receiving NEP-11 is not supported");
    }

    function onNEP17Payment(address, uint256, bytes calldata) external {
        revert("Receiving NEP-17 is not supported");
    }

    function _addressToString(address account) internal pure returns (string memory) {
        return _bytesToHexString(abi.encodePacked(account));
    }

    function _bytesToHexString(bytes memory data) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory output = new bytes(2 + data.length * 2);
        output[0] = "0";
        output[1] = "x";

        for (uint256 i = 0; i < data.length; i += 1) {
            output[2 + i * 2] = alphabet[uint8(data[i] >> 4)];
            output[3 + i * 2] = alphabet[uint8(data[i] & 0x0f)];
        }

        return string(output);
    }

}
