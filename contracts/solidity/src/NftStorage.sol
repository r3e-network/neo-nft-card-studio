// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "standards/NEP26.sol";

abstract contract NftStorage {
    struct Collection {
        address owner;
        string name;
        string symbol;
        string description;
        string baseUri;
        uint256 maxSupply;
        uint256 minted;
        uint256 royaltyBps;
        bool transferable;
        bool paused;
        uint256 createdAt;
    }

    struct TokenState {
        uint256 collectionId;
        address owner;
        string uri;
        bytes propertiesJson;
        bool burned;
        uint256 mintedAt;
    }

    struct DropConfig {
        bool enabled;
        uint256 startAt;
        uint256 endAt;
        uint256 perWalletLimit;
        bool whitelistRequired;
    }

    struct CheckInProgram {
        bool enabled;
        bool membershipRequired;
        bool membershipSoulbound;
        uint256 startAt;
        uint256 endAt;
        uint256 intervalSeconds;
        uint256 maxCheckInsPerWallet;
        bool mintProofNft;
    }

    struct CheckInWalletStats {
        uint256 checkInCount;
        uint256 lastCheckInAt;
    }

    uint8 internal constant TOKEN_CLASS_STANDARD = 0;
    uint8 internal constant TOKEN_CLASS_MEMBERSHIP = 1;
    uint8 internal constant TOKEN_CLASS_CHECKIN_PROOF = 2;

    string internal constant _SYMBOL = "MNFTS";

    uint256 internal _collectionCounter;
    uint256 internal _totalSupply;

    mapping(uint256 => Collection) internal _collections;
    mapping(uint256 => uint256) internal _collectionMintCounter;
    mapping(uint256 => mapping(address => bool)) internal _collectionOperators;
    mapping(address => uint256) internal _ownerDedicatedCollection;

    mapping(bytes32 => TokenState) internal _tokens;
    mapping(bytes32 => address) internal _tokenOwners;
    mapping(address => uint256) internal _balances;

    bytes32[] internal _allTokens;
    mapping(bytes32 => uint256) internal _allTokenIndex;

    mapping(address => bytes32[]) internal _ownedTokens;
    mapping(bytes32 => uint256) internal _ownedTokenIndex;

    mapping(uint256 => bytes32[]) internal _collectionTokens;
    mapping(uint256 => DropConfig) internal _dropConfigs;
    mapping(uint256 => mapping(address => uint256)) internal _dropWhitelistAllowance;
    mapping(uint256 => mapping(address => uint256)) internal _dropClaimedCount;
    mapping(bytes32 => uint8) internal _tokenClass;
    mapping(uint256 => mapping(address => uint256)) internal _collectionMembershipBalance;
    mapping(uint256 => CheckInProgram) internal _checkInPrograms;
    mapping(uint256 => mapping(address => CheckInWalletStats)) internal _checkInWalletStats;

    event Transfer(address indexed from, address indexed to, uint256 amount, bytes32 tokenId);
    event CollectionUpserted(
        uint256 indexed collectionId,
        address indexed owner,
        string name,
        string symbol,
        string description,
        string baseUri,
        uint256 maxSupply,
        uint256 minted,
        uint256 royaltyBps,
        bool transferable,
        bool paused,
        uint256 createdAt
    );
    event TokenUpserted(
        bytes32 indexed tokenId,
        uint256 indexed collectionId,
        address indexed owner,
        string tokenUri,
        bytes propertiesJson,
        bool burned,
        uint256 mintedAt
    );
    event CollectionOperatorUpdated(uint256 indexed collectionId, address indexed operator, bool enabled);
    event DropConfigUpdated(
        uint256 indexed collectionId,
        bool enabled,
        uint256 startAt,
        uint256 endAt,
        uint256 perWalletLimit,
        bool whitelistRequired
    );
    event DropWhitelistUpdated(uint256 indexed collectionId, address indexed account, uint256 allowance);
    event DropClaimed(uint256 indexed collectionId, address indexed claimer, bytes32 indexed tokenId, uint256 claimedCount);
    event CheckInProgramUpdated(
        uint256 indexed collectionId,
        bool enabled,
        bool membershipRequired,
        bool membershipSoulbound,
        uint256 startAt,
        uint256 endAt,
        uint256 intervalSeconds,
        uint256 maxCheckInsPerWallet,
        bool mintProofNft
    );
    event CheckedIn(
        uint256 indexed collectionId,
        address indexed account,
        uint256 checkInCount,
        uint256 checkedAt,
        bytes32 proofTokenId
    );

    modifier collectionExists(uint256 collectionId) {
        require(_collections[collectionId].owner != address(0), "Collection not found");
        _;
    }

    modifier tokenExists(bytes32 tokenId) {
        require(_tokenOwners[tokenId] != address(0), "Token not found");
        _;
    }

    function symbol() external pure returns (string memory) {
        return _SYMBOL;
    }

    function decimals() external pure returns (uint8) {
        return 0;
    }

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address owner) external view returns (uint256) {
        require(owner != address(0), "Invalid owner");
        return _balances[owner];
    }

    function ownerOf(bytes32 tokenId) public view tokenExists(tokenId) returns (address) {
        return _tokenOwners[tokenId];
    }
}
