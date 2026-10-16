// 기관 마스터 — 요양기관이 아직 살아 있는지에 대한 '한 벌짜리' 기록
//
// 왜 한 벌인가
//   가구마다 조회하면 1만 가구 × 신뢰 기관 수만큼 호출이 터진다. 그런데 가구가 다니는
//   병원은 서로 겹친다. 그래서 서버가 **기관 단위로** 마스터를 들고 갱신하고, 가구는
//   읽기만 한다. 10가구가 같은 병원을 신뢰해도 심평원 호출은 1회다.
//   → 호출량이 **가구 수가 아니라 기관 수**에 비례한다.
//
// 누가 갱신하나
//   ① 하루 1회 크론 (api/registry-cron.js) — 오래된 것부터 예산 안에서
//   ② 위임자가 '지금 점검'을 누를 때 (api/registry-check.js)
//   읽기는 둘 다 공짜다. 결제 경로에서는 어느 쪽도 부르지 않는다.
const { store } = require("./_lib");

const MASTER_KEY = "carepass:registry:master";
const FRESH_MS = 24 * 3600 * 1000;   // 이 안에 확인된 기록은 재사용한다
const TIMEOUT_MS = 4000;

const HOSP = process.env.HIRA_HOSP_URL || "https://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList";
const PHARM = process.env.HIRA_PHARM_URL || "https://apis.data.go.kr/B551182/pharmacyInfoService/getParmacyBasisList";

const encKey = (k) => (k.includes("%") ? k : encodeURIComponent(k));
const tag = (xml, t) => {
  const m = xml.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`));
  return m ? m[1].trim() : "";
};
const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();

function parseItems(xml) {
  const out = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml))) {
    const name = tag(m[1], "yadmNm");
    if (name) out.push({ name, type: tag(m[1], "clCdNm") || null, addr: tag(m[1], "addr") || null });
  }
  return out;
}

async function callOnce(base, key, name) {
  const url =
    `${base}?serviceKey=${encKey(key)}&pageNo=1&numOfRows=10&_type=xml` +
    `&yadmNm=${encodeURIComponent(name)}`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    const text = await r.text();
    if (!r.ok) return { ok: false };
    const code = tag(text, "resultCode");
    if (code && code !== "00") return { ok: false };
    if (/SERVICE_KEY_IS_NOT_REGISTERED|SERVICE ERROR|LIMITED NUMBER/i.test(text)) return { ok: false };
    return { ok: true, items: parseItems(text) };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(t);
  }
}

// 기관 하나의 실재 여부.
// 조회 자체가 실패하면 'unknown' — **폐업으로 단정하지 않는다.**
// (API 장애를 폐업으로 읽으면 멀쩡한 병원의 신뢰가 무더기로 풀린다)
async function probe(key, name, region) {
  let r = await callOnce(HOSP, key, name);
  if (r.ok && !r.items.length) {
    const p = await callOnce(PHARM, key, name);
    if (p.ok && p.items.length) r = p;
  }
  if (!r.ok) return { status: "unknown" };
  const items = region ? r.items.filter((i) => (i.addr || "").includes(region)) : r.items;
  const hit = items.find((i) => norm(i.name) === norm(name));
  return hit ? { status: "live", type: hit.type || null } : { status: "closed" };
}

const loadMaster = () => store.get(MASTER_KEY).catch(() => null).then((m) => m || {});
const saveMaster = (m) => store.set(MASTER_KEY, m).catch(() => {});

/** 마스터에서 읽기만 한다. 심평원을 부르지 않으므로 호출량 0 · 즉답. */
function readMaster(master, names) {
  const now = Date.now();
  const results = {};
  for (const name of names) {
    const rec = master[name];
    results[name] = rec
      ? { status: rec.status, at: rec.at, stale: now - rec.at >= FRESH_MS, from: "master" }
      : { status: "unknown", at: null, stale: true, from: "none" };
  }
  return results;
}

/**
 * 주어진 기관들을 갱신한다. 마스터에 신선한 기록이 있으면 재사용(=호출 안 함).
 * budget 으로 한 번에 나가는 심평원 호출 수를 묶는다.
 */
async function refresh(master, names, { key, region = "대구", budget = 40, force = false } = {}) {
  const now = Date.now();
  let called = 0, cached = 0;
  const results = {};
  for (const name of names) {
    const rec = master[name];
    if (!force && rec && now - rec.at < FRESH_MS) {
      results[name] = { status: rec.status, at: rec.at, from: "master" };
      cached++;
      continue;
    }
    if (called >= budget) {                       // 예산 소진 — 남은 건 다음 차례로 미룬다
      results[name] = rec
        ? { status: rec.status, at: rec.at, from: "master", deferred: true }
        : { status: "unknown", at: null, from: "none", deferred: true };
      continue;
    }
    const p = await probe(key, name, region);
    called++;
    // 'unknown'(조회 실패)은 마스터에 적지 않는다 — 다음 점검에서 다시 시도한다
    if (p.status !== "unknown") master[name] = { status: p.status, type: p.type || null, at: now };
    results[name] = { status: p.status, at: now, from: "hira" };
  }
  return { results, called, cached };
}

/** 오래 확인되지 않은 순서. 크론이 예산 안에서 무엇부터 볼지 정하는 데 쓴다. */
function stalestFirst(master, limit) {
  return Object.keys(master)
    .sort((a, b) => (master[a].at || 0) - (master[b].at || 0))
    .slice(0, limit);
}

const closedOf = (results) => Object.keys(results).filter((n) => results[n].status === "closed");

module.exports = { MASTER_KEY, FRESH_MS, loadMaster, saveMaster, readMaster, refresh, stalestFirst, closedOf, norm };
