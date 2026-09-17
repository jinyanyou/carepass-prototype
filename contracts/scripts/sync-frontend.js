// demo-events.json · institutions.json · deployments/<network>.json 을
// index.html 의 ONCHAIN / CERT 블록에 써 넣는다.
//   node scripts/sync-frontend.js [network]   (기본: sepolia, 배포 파일이 없으면 ONCHAIN=null)
const fs = require("fs");
const path = require("path");

const network = process.argv[2] || "sepolia";
const root = path.join(__dirname, "..", "..");
const htmlPath = path.join(root, "index.html");
const demo = require("../demo-events.json");
const certs = require("../institutions.json");
const depPath = path.join(__dirname, "..", "deployments", `${network}.json`);
const dep = fs.existsSync(depPath) ? JSON.parse(fs.readFileSync(depPath, "utf8")) : null;

const rpc = {
  // 키 없이 쓸 수 있고 JSON-RPC 배치를 받는 공개 노드 (2026-09-17 확인)
  sepolia: ["https://ethereum-sepolia-rpc.publicnode.com", "https://sepolia.gateway.tenderly.co"],
  localhost: ["http://127.0.0.1:8545"],
}[network] || [];

const onchain = dep && {
  network: dep.network,
  chainId: dep.chainId,
  address: dep.address,
  recorder: dep.recorder,
  deployTx: dep.deployTx,
  deployBlock: dep.deployBlock,
  delegationKey: dep.delegationKey,
  explorer: dep.network === "sepolia" ? "https://sepolia.etherscan.io" : null,
  rpc,
  events: dep.events,
  institutions: dep.institutions || [],
};

/* 기관 인증 — 온체인 등록 내용(공개키·근거 해시)과 시연용 서명키를 함께 내려보낸다.
   jwk.d(개인키)는 "병원 단말이 청구서에 서명"하는 과정을 브라우저에서 재현하기 위한 데모 키. */
const txOf = (instId, k) => {
  const rec = (dep && dep.institutions || []).find((x) => x.instId === instId);
  return rec ? rec[k] || null : null;
};
const cert = {
  curve: certs.curve,
  source: certs.source,
  basis: certs.basis,
  note: certs.note,
  institutions: certs.institutions.map((i) => ({
    name: i.name, type: i.type, gu: i.gu, addr: i.addr, tel: i.tel, fictional: i.fictional,
    status: i.status, revokeReason: i.revokeReason,
    instId: i.instId, proof: i.proof, proofHash: i.proofHash,
    keyX: i.keyX, keyY: i.keyY, jwk: i.jwk,
    certifyTx: txOf(i.instId, "certifyTx"), certifyBlock: txOf(i.instId, "certifyBlock"),
    revokeTx: txOf(i.instId, "revokeTx"), revokeBlock: txOf(i.instId, "revokeBlock"),
  })),
};

const BEGIN = "/* ONCHAIN:BEGIN — contracts/scripts/sync-frontend.js 가 자동 생성. 직접 고치지 마세요 */";
const END = "/* ONCHAIN:END */";
const block = `${BEGIN}
const DEMO_EVENTS=${JSON.stringify(demo)};
const ONCHAIN=${JSON.stringify(onchain)};
const CERT=${JSON.stringify(cert)};
${END}`;

let html = fs.readFileSync(htmlPath, "utf8");
const i = html.indexOf(BEGIN);
const j = html.indexOf(END);
if (i < 0 || j < 0) throw new Error("index.html 에서 ONCHAIN 블록 표시를 찾지 못했습니다.");
html = html.slice(0, i) + block + html.slice(j + END.length);
fs.writeFileSync(htmlPath, html);
console.log(`index.html ← ${dep ? `${network} ${dep.address}` : "ONCHAIN=null (배포 전)"} · 기관 인증 ${cert.institutions.length}곳`);
