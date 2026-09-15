// Etherscan 에 컨트랙트 소스 공개 검증
//   npm run verify:sepolia
const path = require("path");
const { execSync } = require("child_process");

const dep = require(path.join(__dirname, "..", "deployments", "sepolia.json"));
if (!/^0x[0-9a-fA-F]{40}$/.test(dep.address)) throw new Error("deployments/sepolia.json 주소가 올바르지 않습니다.");
execSync(`npx hardhat verify --network sepolia ${dep.address}`, {
  stdio: "inherit",
  cwd: path.join(__dirname, ".."),
});
