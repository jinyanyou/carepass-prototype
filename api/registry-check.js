// 신뢰 기관 점검 — 앱이 기관 마스터를 읽거나, 지금 당장 갱신시킨다
//
//   POST /api/registry-check   { names: [...], mode: "read" | "refresh" }
//
//   mode:"read"     기본값. **마스터에서 읽기만 한다.** 심평원 호출 0회 · 즉답.
//                   하루 1회 크론(api/registry-cron.js)이 갱신해 둔 결과를 그대로 본다.
//   mode:"refresh"  지금 당장 심평원에 다시 물어본다. 위임자가 '지금 점검'을 눌렀을 때만.
//
// 왜 기본이 read 인가
//   점검을 사람이 눌러야만 한다면, 등록 시점 조회와 똑같은 한계가 남는다(아무도 안 누른다).
//   그래서 **갱신은 크론이 하고, 앱은 읽기만** 한다. 읽기는 공짜라 화면을 열 때마다 해도 된다.
//
// 결제 경로가 아니다
//   실패해도 결제 판정에는 아무 영향이 없다. 신뢰 유효기간(TRUST_TTL_DAYS)이 뒤를 받친다.
const { store, session } = require("./_lib");
const { loadMaster, saveMaster, readMaster, refresh, closedOf } = require("./_registry");

const MAX_NAMES = 60;
const REFRESH_BUDGET = 40;

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, reason: "POST only" });

  const me = session(req);
  if (!me) return res.status(401).json({ ok: false, reason: "login required" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const mode = (body && body.mode) === "refresh" ? "refresh" : "read";
  const region = String((body && body.region) || "대구").trim();
  const names = [...new Set(
    ((body && body.names) || []).map((n) => String(n || "").trim()).filter((n) => n && n.length <= 40)
  )].slice(0, MAX_NAMES);

  if (!names.length) return res.status(400).json({ ok: false, reason: "names required" });

  const master = await loadMaster();

  // ── 읽기 — 심평원을 부르지 않는다. 누구나(가구 구성원) 호출할 수 있다.
  if (mode === "read") {
    const results = readMaster(master, names);
    return res.status(200).json({
      ok: true, mode: "read", at: Date.now(),
      checked: names.length, called: 0, cached: names.length,
      results, closed: closedOf(results),
      master_size: Object.keys(master).length,
    });
  }

  // ── 강제 갱신 — 심평원을 부른다. 위임자만. 대리인이 자기 신뢰를 되살리지 못하게 한다.
  if (me.role !== "delegator") return res.status(403).json({ ok: false, reason: "delegator only" });

  const key = process.env.HIRA_API_KEY;
  // 키가 없으면 '끈 상태'로 알린다. 앱은 아무것도 바꾸지 않는다.
  if (!key) return res.status(200).json({ ok: false, configured: false, reason: "no key" });

  const { results, called, cached } = await refresh(master, names, { key, region, budget: REFRESH_BUDGET });
  await saveMaster(master);

  const closed = closedOf(results);
  try {
    await store.push("carepass:registry:log",
      { ts: Date.now(), by: me.id, mode, checked: names.length, called, cached, closed }, 200);
  } catch {}

  return res.status(200).json({
    ok: true, mode: "refresh", configured: true, at: Date.now(),
    checked: names.length, called, cached,   // 호출량이 가구 수와 무관함을 보이는 숫자
    results, closed,
    master_size: Object.keys(master).length,
    persistent: store.persistent,
  });
};
