import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

let ethAccountkey=process.env.ETH_PRIVATE_KEY + "";

const config: HardhatUserConfig = {
  solidity: "0.8.20",
  defaultNetwork: "ganachedev",
  networks:{
    ganachedev:{
      url: "http://127.0.0.1:8545"
    },
    besudev:{
      url: process.env.BESU_NODE1_ENDPOINT,
      accounts: {
        accounts: [ethAccountkey]
      }
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
};

export default config;

