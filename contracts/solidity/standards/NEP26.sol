// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface INEP26Receiver {
    function onNEP11Payment(address from, uint256 amount, bytes32 tokenId, bytes calldata data) external;
}
