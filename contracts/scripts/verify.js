// Etherscan 에 컨트랙트 소스 공개 검증
//   npm run verify:sepolia
const path = require("path");
const { execFileSync } = require("child_process");

const dep = require(path.join(__dirname, "..", "deployments", "sepolia.json"));
execFileSync("npx", ["hardhat", "verify", "--network", "sepolia", dep.address], {
  stdio: "inherit",
  shell: process.platform === "win32",
  cwd: path.join(__dirname, ".."),
});
