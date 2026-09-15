// demo-events.json 과 deployments/<network>.json 을 index.html 의 ONCHAIN 블록에 써 넣는다.
//   node scripts/sync-frontend.js [network]   (기본: sepolia, 배포 파일이 없으면 ONCHAIN=null)
const fs = require("fs");
const path = require("path");

const network = process.argv[2] || "sepolia";
const root = path.join(__dirname, "..", "..");
const htmlPath = path.join(root, "index.html");
const demo = require("../demo-events.json");
const depPath = path.join(__dirname, "..", "deployments", `${network}.json`);
const dep = fs.existsSync(depPath) ? JSON.parse(fs.readFileSync(depPath, "utf8")) : null;

const rpc = {
  sepolia: ["https://ethereum-sepolia-rpc.publicnode.com", "https://sepolia.drpc.org"],
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
};

const BEGIN = "/* ONCHAIN:BEGIN — contracts/scripts/sync-frontend.js 가 자동 생성. 직접 고치지 마세요 */";
const END = "/* ONCHAIN:END */";
const block = `${BEGIN}
const DEMO_EVENTS=${JSON.stringify(demo)};
const ONCHAIN=${JSON.stringify(onchain)};
${END}`;

let html = fs.readFileSync(htmlPath, "utf8");
const i = html.indexOf(BEGIN);
const j = html.indexOf(END);
if (i < 0 || j < 0) throw new Error("index.html 에서 ONCHAIN 블록 표시를 찾지 못했습니다.");
html = html.slice(0, i) + block + html.slice(j + END.length);
fs.writeFileSync(htmlPath, html);
console.log(`index.html ← ${dep ? `${network} ${dep.address}` : "ONCHAIN=null (배포 전)"}`);
