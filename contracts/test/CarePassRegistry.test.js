const { expect } = require("chai");
const { ethers } = require("hardhat");
const { delegationKey, eventHash } = require("../scripts/hash");
const demo = require("../demo-events.json");

describe("CarePassRegistry", function () {
  async function deploy() {
    const [recorder, stranger] = await ethers.getSigners();
    const registry = await ethers.deployContract("CarePassRegistry");
    return { registry, recorder, stranger };
  }

  it("배포한 계정이 기록 계정(recorder)이 된다", async function () {
    const { registry, recorder } = await deploy();
    expect(await registry.recorder()).to.equal(recorder.address);
  });

  it("기록 계정은 이벤트 해시를 순서대로 기록하고 이벤트를 남긴다", async function () {
    const { registry } = await deploy();
    const id = delegationKey(demo.delegationId);

    for (const [i, ev] of demo.events.entries()) {
      await expect(registry.registerDelegation(id, eventHash(ev), ev.fn))
        .to.emit(registry, "DelegationLogged")
        .withArgs(id, eventHash(ev), ev.fn, i);
    }

    const history = await registry.getHistory(id);
    expect(history.length).to.equal(demo.events.length);
    history.forEach((rec, i) => {
      expect(rec.dataHash).to.equal(eventHash(demo.events[i]));
      expect(rec.fn).to.equal(demo.events[i].fn);
      expect(rec.ts).to.be.greaterThan(0n);
    });
    expect(await registry.historyCount(id)).to.equal(BigInt(demo.events.length));
  });

  it("기록 계정이 아니면 기록할 수 없다 (가짜 이력 삽입 차단)", async function () {
    const { registry, stranger } = await deploy();
    const id = delegationKey(demo.delegationId);
    await expect(
      registry.connect(stranger).registerDelegation(id, eventHash(demo.events[0]), "paymentApproved")
    ).to.be.revertedWithCustomError(registry, "NotRecorder");
  });

  it("빈 해시는 거부한다", async function () {
    const { registry } = await deploy();
    await expect(
      registry.registerDelegation(delegationKey(demo.delegationId), ethers.ZeroHash, "paymentApproved")
    ).to.be.revertedWithCustomError(registry, "EmptyHash");
  });

  it("원문이 한 글자라도 바뀌면 해시가 달라져 위·변조가 드러난다", async function () {
    const { registry } = await deploy();
    const id = delegationKey(demo.delegationId);
    const original = demo.events[1];
    await registry.registerDelegation(id, eventHash(original), original.fn);

    const tampered = { ...original, amount: original.amount * 10 };
    const [rec] = await registry.getHistory(id);
    expect(rec.dataHash).to.equal(eventHash(original));
    expect(rec.dataHash).to.not.equal(eventHash(tampered));
  });

  it("위임 ID별로 이력이 분리된다", async function () {
    const { registry } = await deploy();
    const a = delegationKey("DLG-A");
    const b = delegationKey("DLG-B");
    await registry.registerDelegation(a, eventHash({ n: 1 }), "delegationConfigured");
    expect(await registry.historyCount(a)).to.equal(1n);
    expect(await registry.historyCount(b)).to.equal(0n);
  });
});
