// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./src/NftQueryLogic.sol";

/// @title Neo NFT Membership Cards (Solidity / neo-solidity)
/// @notice Batch membership card / benefit card / check-in NFT issuance for Neo N3.
/// @custom:neo.manifest.supportedstandards ["NEP-11","NEP-24"]
contract MultiTenantNftPlatform is NftQueryLogic {}
