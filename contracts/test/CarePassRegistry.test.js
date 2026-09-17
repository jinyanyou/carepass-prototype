const { expect } = require("chai");
const { ethers } = require("hardhat");
const { delegationKey, eventHash } = require("../scripts/hash");
const demo = require("../demo-events.json");
const certs = require("../institutions.json");

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

describe("CarePassRegistry · 의료기관 인증", function () {
  const live = certs.institutions.find((i) => i.status === "certified");
  const revoked = certs.institutions.find((i) => i.status === "revoked");

  async function deploy() {
    const [recorder, stranger] = await ethers.getSigners();
    const registry = await ethers.deployContract("CarePassRegistry");
    return { registry, recorder, stranger };
  }
  const certify = (registry, i) =>
    registry.certifyInstitution(i.instId, i.keyX, i.keyY, i.proofHash, i.name);

  it("요양기관 목록으로 확인된 기관에 인증을 발급하고 공개키를 공개한다", async function () {
    const { registry } = await deploy();
    await expect(certify(registry, live))
      .to.emit(registry, "InstitutionCertified")
      .withArgs(live.instId, live.keyX, live.keyY, live.proofHash, live.name);

    const key = await registry.institutionKey(live.instId);
    expect(key.keyX).to.equal(live.keyX);
    expect(key.keyY).to.equal(live.keyY);
    expect(key.issuedAt).to.be.greaterThan(0n);
    expect(key.revokedAt).to.equal(0n);
    expect(await registry.isCertified(live.instId)).to.equal(true);

    const inst = await registry.getInstitution(live.instId);
    expect(inst.name).to.equal(live.name);
    expect(inst.proofHash).to.equal(live.proofHash);
    expect(await registry.institutionCount()).to.equal(1n);
    expect(await registry.institutionIdAt(0)).to.equal(live.instId);
  });

  it("인증되지 않은 기관은 공개키가 비어 있다 (사칭 청구서를 검증할 키가 없음)", async function () {
    const { registry } = await deploy();
    const key = await registry.institutionKey(live.instId);
    expect(key.keyX).to.equal(ethers.ZeroHash);
    expect(key.issuedAt).to.equal(0n);
    expect(await registry.isCertified(live.instId)).to.equal(false);
  });

  it("인증 계정이 아니면 기관을 등록·취소할 수 없다", async function () {
    const { registry, stranger } = await deploy();
    await expect(
      registry.connect(stranger).certifyInstitution(live.instId, live.keyX, live.keyY, live.proofHash, live.name)
    ).to.be.revertedWithCustomError(registry, "NotRecorder");
    await certify(registry, live);
    await expect(
      registry.connect(stranger).revokeInstitution(live.instId, "임의 취소")
    ).to.be.revertedWithCustomError(registry, "NotRecorder");
  });

  it("빈 공개키·빈 근거 해시는 거부한다", async function () {
    const { registry } = await deploy();
    await expect(
      registry.certifyInstitution(live.instId, ethers.ZeroHash, live.keyY, live.proofHash, live.name)
    ).to.be.revertedWithCustomError(registry, "EmptyKey");
    await expect(
      registry.certifyInstitution(live.instId, live.keyX, live.keyY, ethers.ZeroHash, live.name)
    ).to.be.revertedWithCustomError(registry, "EmptyHash");
  });

  it("같은 기관을 두 번 인증할 수 없고, 취소 이력이 체인에 남는다", async function () {
    const { registry } = await deploy();
    await certify(registry, revoked);
    await expect(certify(registry, revoked)).to.be.revertedWithCustomError(registry, "AlreadyCertified");

    await expect(registry.revokeInstitution(revoked.instId, revoked.revokeReason))
      .to.emit(registry, "InstitutionRevoked")
      .withArgs(revoked.instId, revoked.revokeReason);

    expect(await registry.isCertified(revoked.instId)).to.equal(false);
    const key = await registry.institutionKey(revoked.instId);
    expect(key.revokedAt).to.be.greaterThan(0n);
    expect(key.keyX).to.equal(revoked.keyX); // 공개키는 남겨 과거 청구서를 검증할 수 있게 한다
    await expect(registry.revokeInstitution(revoked.instId, "두 번 취소")).to.be.revertedWithCustomError(
      registry,
      "NotCertified"
    );
  });

  it("인증된 적 없는 기관은 취소할 수 없다", async function () {
    const { registry } = await deploy();
    await expect(registry.revokeInstitution(live.instId, "없는 기관")).to.be.revertedWithCustomError(
      registry,
      "NotCertified"
    );
  });

  it("취소된 기관은 새 서명키로 다시 인증할 수 있다 (자격 회복·키 교체)", async function () {
    const { registry } = await deploy();
    await certify(registry, revoked);
    await registry.revokeInstitution(revoked.instId, revoked.revokeReason);

    const newX = ethers.keccak256(ethers.toUtf8Bytes("new-key-x"));
    const newY = ethers.keccak256(ethers.toUtf8Bytes("new-key-y"));
    await registry.certifyInstitution(revoked.instId, newX, newY, revoked.proofHash, revoked.name);

    const key = await registry.institutionKey(revoked.instId);
    expect(key.keyX).to.equal(newX);
    expect(key.revokedAt).to.equal(0n);
    expect(await registry.isCertified(revoked.instId)).to.equal(true);
    expect(await registry.institutionCount()).to.equal(1n); // 목록에 중복 등록되지 않는다
  });

  it("시연용 기관 서명키로 만든 청구서 서명을 공개키로 검증한다 (앱과 같은 P-256 ECDSA)", async function () {
    const { createPrivateKey, createPublicKey, sign, verify } = require("crypto");
    const invoice = { v: 1, invNo: "INV-TEST-0001", instId: live.instId, inst: live.name, cat: "hospital", amount: 120000 };
    const msg = Buffer.from(JSON.stringify(invoice), "utf8");

    const priv = createPrivateKey({ key: live.jwk, format: "jwk" });
    const sig = sign("sha256", msg, { key: priv, dsaEncoding: "ieee-p1363" }); // WebCrypto 와 같은 r||s 형식
    expect(sig.length).to.equal(64);

    // 온체인에 등록된 X·Y 만으로 공개키를 되살려 검증한다
    const b64u = (hex) => Buffer.from(hex.slice(2), "hex").toString("base64url");
    const pub = createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64u(live.keyX), y: b64u(live.keyY) }, format: "jwk" });
    expect(verify("sha256", msg, { key: pub, dsaEncoding: "ieee-p1363" }, sig)).to.equal(true);

    // 금액을 한 자리 고친 청구서는 같은 서명으로 검증되지 않는다
    const tampered = Buffer.from(JSON.stringify({ ...invoice, amount: 1200000 }), "utf8");
    expect(verify("sha256", tampered, { key: pub, dsaEncoding: "ieee-p1363" }, sig)).to.equal(false);

    // 사칭범이 같은 기관명으로 자기 키로 서명해도 등록 공개키로는 검증되지 않는다
    const { generateKeyPairSync } = require("crypto");
    const fake = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const fakeSig = sign("sha256", msg, { key: fake.privateKey, dsaEncoding: "ieee-p1363" });
    expect(verify("sha256", msg, { key: pub, dsaEncoding: "ieee-p1363" }, fakeSig)).to.equal(false);
  });
});
