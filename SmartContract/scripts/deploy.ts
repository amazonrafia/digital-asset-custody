import { ethers } from "hardhat";

async function main() {
  let awscoin=await ethers.deployContract("AmbWrkCoin");
  let addressObj=(await awscoin.waitForDeployment()).target;
  console.log(`Deployed Contract address is : ${addressObj}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
