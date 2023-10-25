// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract AmbWrkCoin is Ownable,ERC20{
    mapping(address=>uint256) _EtherCollateral; //amount in ethers that can be send to the smart contract as collateral for the stable coin. Will only take ethers and not any other denominator

    constructor() Ownable(msg.sender) ERC20("AMBWrkToken", "AWT") {
       _mint(msg.sender, 1000000000); 
    }
    function BulkTransfer(uint8 initialCoin,address[] calldata accountsToIssueCoins) public onlyOwner{
        uint8 counter;
        uint256 addressLength=accountsToIssueCoins.length;

        //check if the owner of the smart contract has enough coin to sell
        if(balanceOf(owner()) < addressLength * initialCoin) {
            revert("Bulk Coin purchase cannot happen. Not enough coin supply");
        }
        for(counter=0;counter<addressLength;counter++){
            transfer(accountsToIssueCoins[counter],initialCoin);
        }
    }
}
