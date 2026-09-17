// 컨트랙트 배포 → 의료기관 인증 발급/취소 → 시연 초기 이벤트 기록 → deployments/<network>.json 저장
//   npx hardhat run scripts/deploy-and-seed.js --network sepolia
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");
const { delegationKey, eventHash } = require("./hash");
const demo = require("../demo-events.json");
const certs = require("../institutions.json");

const CONFIRMATIONS = network.name === "hardhat" || network.name === "localhost" ? 1 : 2;

async function main() {
  const [recorder] = await ethers.getSigners();
  if (!recorder) throw new Error("PRIVATE_KEY가 .env에 없습니다.");
  const balance = await ethers.provider.getBalance(recorder.address);
  console.log(`network  ${network.name}`);
  console.log(`recorder ${recorder.address} (잔액 ${ethers.formatEther(balance)} ETH)`);

  const registry = await ethers.deployContract("CarePassRegistry");
  const deployTx = registry.deploymentTransaction();
  await deployTx.wait(CONFIRMATIONS);
  const address = await registry.getAddress();
  const deployReceipt = await ethers.provider.getTransactionReceipt(deployTx.hash);
  console.log(`deployed ${address} (block ${deployReceipt.blockNumber})`);

  // ① 의료기관 인증 — 요양기관 목록으로 실재가 확인된 기관에 발급, 취소분은 이어서 폐기
  const institutions = [];
  for (const inst of certs.institutions) {
    const tx = await registry.certifyInstitution(inst.instId, inst.keyX, inst.keyY, inst.proofHash, inst.name);
    const receipt = await tx.wait(CONFIRMATIONS);
    console.log(`certified ${inst.name} ${inst.instId.slice(0, 12)}… → tx ${tx.hash} (block ${receipt.blockNumber})`);
    const rec = { name: inst.name, instId: inst.instId, status: "certified", certifyTx: tx.hash, certifyBlock: receipt.blockNumber };
    if (inst.status === "revoked") {
      const rtx = await registry.revokeInstitution(inst.instId, inst.revokeReason || "인증 취소");
      const rrec = await rtx.wait(CONFIRMATIONS);
      console.log(`revoked   ${inst.name} → tx ${rtx.hash} (block ${rrec.blockNumber})`);
      Object.assign(rec, { status: "revoked", revokeReason: inst.revokeReason, revokeTx: rtx.hash, revokeBlock: rrec.blockNumber });
    }
    institutions.push(rec);
  }

  // ② 위임·결제 이력
  const id = delegationKey(demo.delegationId);
  const events = [];
  for (const ev of demo.events) {
    const dataHash = eventHash(ev);
    const tx = await registry.registerDelegation(id, dataHash, ev.fn);
    const receipt = await tx.wait(CONFIRMATIONS);
    console.log(`recorded ${ev.fn} ${dataHash} → tx ${tx.hash} (block ${receipt.blockNumber})`);
    events.push({ fn: ev.fn, dataHash, txHash: tx.hash, block: receipt.blockNumber });
  }

  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    address,
    recorder: recorder.address,
    deployTx: deployTx.hash,
    deployBlock: deployReceipt.blockNumber,
    delegationId: demo.delegationId,
    delegationKey: id,
    institutions,
    events,
    deployedAt: new Date().toISOString(),
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${network.name}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(`saved    ${path.relative(process.cwd(), file)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
