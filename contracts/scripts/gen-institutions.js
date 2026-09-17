// 시연용 의료기관 서명키(ECDSA P-256)를 만들고 institutions.json 을 새로 쓴다.
//   node scripts/gen-institutions.js
//
// 한 번 만들면 다시 실행하지 않는다 — 키가 바뀌면 온체인에 등록된 공개키와 어긋나
// 재배포가 필요해진다. 이 키들은 "병원 단말"을 브라우저에서 흉내내기 위한 시연용이며
// 보호하는 자산이 없다. 실서비스에서는 기관 단말의 보안영역(HSM/Secure Enclave)에 둔다.
const fs = require("fs");
const path = require("path");
const { generateKeyPairSync } = require("crypto");
const { instKey, proofHash } = require("./hash");
const medical = require("../../data/daegu-medical.json");

/* 인증 근거 원문 — index.html 의 Cert.proof() 와 키 순서까지 같아야 한다 */
function proofOf(src, name, type, gu, addr, tel) {
  return { src, basis: medical.basis, name, type, gu, addr, tel };
}

/* 요양기관 목록에서 기관명으로 한 곳을 찾아 인증 근거를 만든다 */
function fromMedical(name) {
  const rows = medical.rows.filter((r) => r[0].replace(/\s+/g, "") === name.replace(/\s+/g, ""));
  if (rows.length !== 1) throw new Error(`요양기관 목록에서 "${name}" 을 하나로 특정하지 못했습니다 (${rows.length}건)`);
  const [nm, ti, gi, addr, tel] = rows[0];
  const type = medical.types[ti];
  const gu = medical.gus[gi];
  return { name: nm, type, gu, addr, tel, proof: proofOf(medical.source, nm, type, gu, addr, tel) };
}

/* 인증 취소(폐업·자격정지) 이력을 보여 주기 위한 가상 기관 — 실제 상호를 쓰지 않는다 */
function fictional(name, type) {
  const gu = "시연용";
  const addr = "—";
  const tel = "—";
  return {
    name,
    type,
    gu,
    addr,
    tel,
    fictional: true,
    proof: proofOf("시연용 가상 기관 (인증 취소 이력 시연)", name, type, gu, addr, tel),
  };
}

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" }); // {kty,crv,x,y,d}
  const b64uToHex = (s) => "0x" + Buffer.from(s, "base64url").toString("hex");
  return { jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }, keyX: b64uToHex(jwk.x), keyY: b64uToHex(jwk.y) };
}

const PLAN = [
  { ...fromMedical("대구의료원"), status: "certified" },
  { ...fromMedical("경북대학교병원"), status: "certified" },
  { ...fictional("○○재활요양병원", "요양병원"), status: "revoked", revokeReason: "폐업 신고 · 요양기관 자격 정지" },
];

const institutions = PLAN.map((it) => {
  const { jwk, keyX, keyY } = keypair();
  return {
    name: it.name,
    type: it.type,
    gu: it.gu,
    addr: it.addr,
    tel: it.tel,
    fictional: !!it.fictional,
    status: it.status,
    revokeReason: it.revokeReason || null,
    instId: instKey(it.name, it.type, it.gu),
    proof: it.proof,
    proofHash: proofHash(it.proof),
    keyX,
    keyY,
    jwk,
  };
});

const out = {
  note:
    "시연용 의료기관 서명키(ECDSA P-256). 브라우저에서 '병원 단말이 청구서에 전자서명'하는 과정을 " +
    "실제 WebCrypto로 보여 주기 위한 데모 키이며 보호하는 자산이 없습니다. " +
    "실서비스에서는 기관 단말의 보안영역(HSM/Secure Enclave)에 보관하고 앱에 내려보내지 않습니다.",
  curve: "P-256 (ECDSA, SHA-256)",
  source: medical.source,
  basis: medical.basis,
  generatedAt: new Date().toISOString(),
  institutions,
};

const file = path.join(__dirname, "..", "institutions.json");
fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.log(`saved ${path.relative(process.cwd(), file)}`);
for (const i of institutions) console.log(`  ${i.status.padEnd(9)} ${i.name} (${i.type} · ${i.gu}) ${i.instId.slice(0, 12)}…`);
