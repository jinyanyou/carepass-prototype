require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ quiet: true });

const { SEPOLIA_RPC_URL, ETHERSCAN_API_KEY } = process.env;
// MetaMask에서 복사한 키는 0x가 없으므로 붙여 준다
const rawKey = (process.env.PRIVATE_KEY || "").trim();
const PRIVATE_KEY = rawKey && (rawKey.startsWith("0x") ? rawKey : "0x" + rawKey);

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    sepolia: {
      url: SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 11155111,
    },
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY || "",
  },
  sourcify: { enabled: false },
};
