// 건강보험심사평가원 요양기관 조회 프록시
//
//   GET /api/hira?name=대구의료원
//
// 왜 서버를 거치는가
//   ① 인증키를 브라우저에 내려보내지 않는다. 단일 HTML 에 serviceKey 를 박으면 공개 저장소와
//      배포본에 그대로 노출되고, 계정에 묶인 키라 도용되면 한도가 소진된다.
//   ② data.go.kr 는 브라우저 직접 호출(CORS)이 막히는 게 일반적이다.
//
// 왜 결제 판정에서는 부르지 않는가
//   결제는 즉답이어야 하고 공공 API 는 점검·장애가 잦다. 판정 경로에 외부 의존성을 넣으면
//   API 가 멈출 때 사칭 탐지가 통째로 멈춘다. 그래서 **기관을 등록할 때만** 부른다.
//   등록은 저빈도이고 1~2초 지연이 허용되며, 실패해도 앱은 내장 스냅샷으로 그대로 동작한다.
const { store } = require("./_lib");

const HOSP = process.env.HIRA_HOSP_URL || "https://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList";
const PHARM = process.env.HIRA_PHARM_URL || "https://apis.data.go.kr/B551182/pharmacyInfoService/getParmacyBasisList";
const TTL_MS = 24 * 3600 * 1000;      // 기관 정보는 자주 바뀌지 않는다
const TIMEOUT_MS = 4000;              // 등록 화면에서 더 기다리게 하지 않는다
const RATE_MAX = 60;                  // 분당 호출 상한 — 우리 일일 한도(1만)를 지킨다
const cache = new Map();              // name → { at, body }
const hits = [];                      // 호출 시각 (레이트 리밋)

// 공공데이터포털 키는 Encoding/Decoding 두 형태로 발급된다.
// 이미 퍼센트 인코딩된 키를 다시 인코딩하면 인증이 깨지므로 '%' 유무로 가른다.
const encKey = (k) => (k.includes("%") ? k : encodeURIComponent(k));

// 응답이 XML 이라 item 블록만 떼어 쓴다. 의존성을 더하지 않으려고 파서를 쓰지 않는다.
const tag = (xml, t) => {
  const m = xml.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`));
  return m ? m[1].trim() : "";
};
function parseItems(xml) {
  const out = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml))) {
    const b = m[1];
    const name = tag(b, "yadmNm");
    if (!name) continue;
    out.push({
      name,
      type: tag(b, "clCdNm") || null,
      addr: tag(b, "addr") || null,
      tel: tag(b, "telno") || null,
      ykiho: tag(b, "ykiho") || null,
      estbDd: tag(b, "estbDd") || null,
    });
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
    if (!r.ok) return { ok: false, reason: `http ${r.status}` };
    // 포털은 인증 실패도 200 + XML 로 돌려준다
    const code = tag(text, "resultCode");
    if (code && code !== "00") return { ok: false, reason: `${code} ${tag(text, "resultMsg") || ""}`.trim() };
    if (/SERVICE_KEY_IS_NOT_REGISTERED|SERVICE ERROR|LIMITED NUMBER/i.test(text))
      return { ok: false, reason: "key/quota" };
    return { ok: true, items: parseItems(text) };
  } catch (e) {
    return { ok: false, reason: e.name === "AbortError" ? "timeout" : String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const key = process.env.HIRA_API_KEY;
  const name = String((req.query && req.query.name) || "").trim();

  // 키가 없으면 '끈 상태'로 조용히 알린다. 앱은 이 응답을 보고 내장 스냅샷만 쓴다.
  if (!key) return res.status(200).json({ ok: false, configured: false, reason: "no key" });
  if (!name) return res.status(400).json({ ok: false, configured: true, reason: "name required" });
  if (name.length > 40) return res.status(400).json({ ok: false, configured: true, reason: "name too long" });

  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < TTL_MS) return res.status(200).json({ ...hit.body, cached: true });

  const now = Date.now();
  while (hits.length && now - hits[0] > 60000) hits.shift();
  if (hits.length >= RATE_MAX)
    return res.status(200).json({ ok: false, configured: true, reason: "rate limited" });
  hits.push(now);

  // 병원 목록에 없으면 약국 목록도 본다 — 약국은 별도 서비스다
  let r = await callOnce(HOSP, key, name);
  if (r.ok && !r.items.length) {
    const p = await callOnce(PHARM, key, name);
    if (p.ok && p.items.length) r = p;
  }
  if (!r.ok) return res.status(200).json({ ok: false, configured: true, reason: r.reason });

  const body = { ok: true, configured: true, source: "hira-api", name, items: r.items };
  cache.set(name, { at: Date.now(), body });
  // 조회 기록만 남긴다 (기관명·건수). 개인정보가 아니다.
  try { await store.push("carepass:hira:log", { ts: Date.now(), name, n: r.items.length }, 200); } catch {}
  return res.status(200).json(body);
};
