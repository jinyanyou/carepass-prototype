// 기관 마스터 자가 점검 — 하루 1회, 서버가 스스로 돈다
//
//   GET /api/registry-cron        (Vercel Cron 이 호출. vercel.json 의 crons 참고)
//
// 왜 버튼이 아니라 크론인가
//   등록 시점 조회는 **일회성 관문**이다. 초기 세팅이 끝나면 아무도 재등록을 하지 않으므로
//   그 뒤 폐업한 기관은 영영 확인되지 않는다. 사람이 눌러야만 점검된다면 같은 문제가 남는다.
//   그래서 서버가 스스로, 아무도 누르지 않아도 돈다.
//
// 무엇을 점검하나 — 가구 목록이 아니라 '기관 마스터'
//   크론에는 접속한 가구가 없다. 점검 대상은 **마스터에 이미 올라온 기관들**이다.
//   기관은 가구들이 공유하므로, 마스터 한 벌을 갱신하면 모든 가구가 그 결과를 본다.
//   그래서 가구가 1만이든 10만이든 **호출량은 기관 수에만 비례한다.**
//
// 예산을 두는 이유
//   심평원 Open API 는 일 10,000회다. 한 번에 다 돌지 않고 **가장 오래 확인되지 않은
//   기관부터** DAILY_BUDGET 만큼만 본다. 나머지는 다음 날로 밀린다. 기관 수가 늘어도
//   하루 호출량의 상한이 고정되고, 전체는 며칠 주기로 한 바퀴 돈다.
//
// 결제 경로가 아니다
//   실패해도 결제 판정에는 아무 영향이 없다. 그리고 이 크론이 통째로 멈춰도 앱은
//   안전한 쪽으로 떨어진다 — 신뢰에 유효기간이 있어 확인이 오래된 신뢰는 스스로 만료된다
//   (index.html TRUST_TTL_DAYS). 자동화는 '빨리 알기' 위한 것이고, 안전은 유효기간이 쥔다.
const { store } = require("./_lib");
const { loadMaster, saveMaster, refresh, stalestFirst, closedOf } = require("./_registry");

const DAILY_BUDGET = Number(process.env.REGISTRY_DAILY_BUDGET || 200);
const LOG_KEY = "carepass:registry:cron";

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  // Vercel Cron 은 CRON_SECRET 이 설정돼 있으면 Authorization: Bearer <secret> 을 붙여 보낸다.
  // 시크릿이 없으면(로컬·미설정) Vercel 환경에서만 막는다 — 로컬 개발에서는 그냥 돌 수 있게.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${secret}`) return res.status(401).json({ ok: false, reason: "unauthorized" });
  } else if (process.env.VERCEL) {
    return res.status(503).json({ ok: false, reason: "CRON_SECRET not configured" });
  }

  const key = process.env.HIRA_API_KEY;
  if (!key) return res.status(200).json({ ok: false, configured: false, reason: "no key" });

  const started = Date.now();
  const master = await loadMaster();
  const total = Object.keys(master).length;
  if (!total) {
    return res.status(200).json({ ok: true, configured: true, at: started, total: 0,
      checked: 0, called: 0, closed: [], note: "마스터가 비어 있습니다 — 기관이 등록되면 다음 회차부터 점검합니다" });
  }

  // 가장 오래 확인되지 않은 기관부터. force=true 로 '신선해서 건너뛰기'를 끄고
  // 예산만큼은 반드시 실제 조회한다 — 크론의 목적이 바로 그 갱신이다.
  const targets = stalestFirst(master, DAILY_BUDGET);
  const { results, called } = await refresh(master, targets, { key, budget: DAILY_BUDGET, force: true });
  await saveMaster(master);

  const closed = closedOf(results);
  const entry = {
    ts: started, ms: Date.now() - started,
    total, checked: targets.length, called, closed,
    budget: DAILY_BUDGET, by: "cron",
  };
  try { await store.push(LOG_KEY, entry, 90); } catch {}

  return res.status(200).json({
    ok: true, configured: true, at: started,
    total,                  // 마스터에 올라온 기관 수
    checked: targets.length, // 이번 회차에 본 수
    called,                  // 실제 심평원 호출 수 (= 예산 안)
    closed,                  // 폐업으로 확인된 기관 — 앱이 읽어가 신뢰를 해제한다
    remaining: Math.max(0, total - targets.length),
    persistent: store.persistent,
  });
};
