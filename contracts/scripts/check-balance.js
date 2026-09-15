// 배포 전 점검: 기록 계정 주소·잔액·체인 확인
const { ethers, network } = require("hardhat");

async function main() {
  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("PRIVATE_KEY가 .env에 없습니다.");
  const bal = await ethers.provider.getBalance(signer.address);
  const { chainId } = await ethers.provider.getNetwork();
  console.log(`network ${network.name} (chainId ${chainId})`);
  console.log(`address ${signer.address}`);
  console.log(`balance ${ethers.formatEther(bal)} ETH`);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
