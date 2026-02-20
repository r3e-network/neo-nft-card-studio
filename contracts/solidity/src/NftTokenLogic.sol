// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./NftCollectionLogic.sol";

abstract contract NftTokenLogic is NftCollectionLogic {
    function mint(uint256 collectionId, address to, string calldata tokenUri, bytes calldata propertiesJson)
        external
        collectionExists(collectionId)
        returns (bytes32)
    {
        require(to != address(0), "Invalid recipient");

        Collection storage collection = _collections[collectionId];
        require(
            msg.sender == collection.owner || _collectionOperators[collectionId][msg.sender],
            "No authorization to mint"
        );
        return _mintCollectionToken(collectionId, to, tokenUri, propertiesJson, TOKEN_CLASS_MEMBERSHIP);
    }

    function burn(bytes32 tokenId) external tokenExists(tokenId) {
        TokenState storage token = _tokens[tokenId];
        require(!token.burned, "Token already burned");

        Collection storage collection = _collections[token.collectionId];
        bool canBurn =
            msg.sender == token.owner || msg.sender == collection.owner || _collectionOperators[token.collectionId][msg.sender];
        require(canBurn, "No authorization to burn");

        address previousOwner = token.owner;
        uint8 tokenClass = _tokenClass[tokenId];

        token.burned = true;
        _tokenOwners[tokenId] = address(0);

        if (tokenClass == TOKEN_CLASS_MEMBERSHIP && _collectionMembershipBalance[token.collectionId][previousOwner] > 0) {
            _collectionMembershipBalance[token.collectionId][previousOwner] -= 1;
        }

        if (_balances[previousOwner] > 0) {
            _balances[previousOwner] -= 1;
        }
        if (_totalSupply > 0) {
            _totalSupply -= 1;
        }

        _removeOwnerToken(previousOwner, tokenId);
        _removeGlobalToken(tokenId);

        _emitTokenUpserted(tokenId, token);
        emit Transfer(previousOwner, address(0), 1, tokenId);
    }

    function transfer(address to, bytes32 tokenId, bytes calldata data) external tokenExists(tokenId) returns (bool) {
        require(to != address(0), "Invalid recipient");

        TokenState storage token = _tokens[tokenId];
        require(!token.burned, "Token already burned");

        Collection storage collection = _collections[token.collectionId];
        require(!collection.paused, "Collection paused");
        require(collection.transferable, "Collection does not allow transfer");
        uint8 tokenClass = _tokenClass[tokenId];
        if (tokenClass == TOKEN_CLASS_MEMBERSHIP && _checkInPrograms[token.collectionId].membershipSoulbound) {
            revert("Membership token is soulbound");
        }

        address from = token.owner;
        require(msg.sender == from, "No authorization");

        if (from == to) {
            return true;
        }

        if (tokenClass == TOKEN_CLASS_MEMBERSHIP) {
            if (_collectionMembershipBalance[token.collectionId][from] > 0) {
                _collectionMembershipBalance[token.collectionId][from] -= 1;
            }
            _collectionMembershipBalance[token.collectionId][to] += 1;
        }

        _removeOwnerToken(from, tokenId);
        _addOwnerToken(to, tokenId);

        if (_balances[from] > 0) {
            _balances[from] -= 1;
        }
        _balances[to] += 1;

        token.owner = to;
        _tokenOwners[tokenId] = to;

        _emitTokenUpserted(tokenId, token);
        emit Transfer(from, to, 1, tokenId);

        if (to.code.length > 0) {
            try INEP26Receiver(to).onNEP11Payment(from, 1, tokenId, data) {
                // recipient callback succeeded
            } catch {
                revert("Invalid NEP-11 receiver");
            }
        }

        return true;
    }

    function _mintCollectionToken(
        uint256 collectionId,
        address to,
        string memory tokenUri,
        bytes memory propertiesJson,
        uint8 tokenClass
    )
        internal
        returns (bytes32)
    {
        Collection storage collection = _collections[collectionId];
        require(!collection.paused, "Collection paused");
        require(collection.maxSupply == 0 || collection.minted < collection.maxSupply, "Collection sold out");
        require(tokenClass <= TOKEN_CLASS_CHECKIN_PROOF, "Invalid token class");

        _collectionMintCounter[collectionId] += 1;
        uint256 serial = _collectionMintCounter[collectionId];
        bytes32 tokenId = keccak256(abi.encodePacked(collectionId, serial));
        require(_tokenOwners[tokenId] == address(0), "Token already exists");

        string memory effectiveTokenUri = bytes(tokenUri).length == 0
            ? string.concat(collection.baseUri, _uintToString(serial))
            : tokenUri;
        bytes memory effectiveProperties = propertiesJson.length == 0
            ? bytes(
                string.concat(
                    "{\"name\":\"",
                    collection.name,
                    " No.",
                    _leftPadSerial(serial, collection.maxSupply),
                    "\"}"
                )
            )
            : propertiesJson;

        require(bytes(effectiveTokenUri).length <= 512, "Invalid token URI");
        require(effectiveProperties.length <= 4096, "Properties too large");

        TokenState memory token = TokenState({
            collectionId: collectionId,
            owner: to,
            uri: effectiveTokenUri,
            propertiesJson: effectiveProperties,
            burned: false,
            mintedAt: block.timestamp
        });

        _tokens[tokenId] = token;
        _tokenClass[tokenId] = tokenClass;
        _tokenOwners[tokenId] = to;
        _balances[to] += 1;
        _totalSupply += 1;
        collection.minted += 1;

        if (tokenClass == TOKEN_CLASS_MEMBERSHIP) {
            _collectionMembershipBalance[collectionId][to] += 1;
        }

        _addOwnerToken(to, tokenId);
        _addGlobalToken(tokenId);
        _collectionTokens[collectionId].push(tokenId);

        _emitCollectionUpserted(collectionId, collection);
        _emitTokenUpserted(tokenId, token);
        emit Transfer(address(0), to, 1, tokenId);

        if (to.code.length > 0) {
            try INEP26Receiver(to).onNEP11Payment(address(0), 1, tokenId, "") {
                // recipient callback succeeded
            } catch {
                revert("Invalid NEP-11 receiver");
            }
        }

        return tokenId;
    }

    function _leftPadSerial(uint256 serial, uint256 maxSupply) internal pure returns (string memory) {
        uint256 width = _serialWidth(maxSupply);
        bytes memory serialBytes = bytes(_uintToString(serial));
        if (serialBytes.length >= width) {
            return string(serialBytes);
        }

        bytes memory output = new bytes(width);
        uint256 pad = width - serialBytes.length;
        for (uint256 i = 0; i < pad; i += 1) {
            output[i] = bytes1(uint8(48));
        }
        for (uint256 i = 0; i < serialBytes.length; i += 1) {
            output[pad + i] = serialBytes[i];
        }
        return string(output);
    }

    function _serialWidth(uint256 maxSupply) internal pure returns (uint256) {
        if (maxSupply >= 100000) {
            return 5;
        }
        if (maxSupply >= 10000) {
            return 4;
        }
        if (maxSupply >= 1000) {
            return 3;
        }
        if (maxSupply >= 100) {
            return 2;
        }
        return 1;
    }

    function _uintToString(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }

        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits += 1;
            temp /= 10;
        }

        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }

        return string(buffer);
    }

    function _emitTokenUpserted(bytes32 tokenId, TokenState memory token) internal {
        emit TokenUpserted(
            tokenId,
            token.collectionId,
            token.owner,
            token.uri,
            token.propertiesJson,
            token.burned,
            token.mintedAt
        );
    }

    function _addOwnerToken(address owner, bytes32 tokenId) internal {
        _ownedTokenIndex[tokenId] = _ownedTokens[owner].length;
        _ownedTokens[owner].push(tokenId);
    }

    function _removeOwnerToken(address owner, bytes32 tokenId) internal {
        uint256 lastIndex = _ownedTokens[owner].length - 1;
        uint256 index = _ownedTokenIndex[tokenId];

        if (index != lastIndex) {
            bytes32 lastTokenId = _ownedTokens[owner][lastIndex];
            _ownedTokens[owner][index] = lastTokenId;
            _ownedTokenIndex[lastTokenId] = index;
        }

        _ownedTokens[owner].pop();
        delete _ownedTokenIndex[tokenId];
    }

    function _addGlobalToken(bytes32 tokenId) internal {
        _allTokenIndex[tokenId] = _allTokens.length;
        _allTokens.push(tokenId);
    }

    function _removeGlobalToken(bytes32 tokenId) internal {
        uint256 lastIndex = _allTokens.length - 1;
        uint256 index = _allTokenIndex[tokenId];

        if (index != lastIndex) {
            bytes32 lastTokenId = _allTokens[lastIndex];
            _allTokens[index] = lastTokenId;
            _allTokenIndex[lastTokenId] = index;
        }

        _allTokens.pop();
        delete _allTokenIndex[tokenId];
    }
}
