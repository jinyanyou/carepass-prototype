// 가구 공유 감사 로그 조회 (상태 변경은 /api/state 가 기록한다)
//   GET /api/audit   세 계정이 같은 로그를 본다 — 누가 무엇을 했는지 함께 본다
const { session, store } = require("./_lib");
const LOG = "carepass:household:H1:log";

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const who = session(req);
  if (!who) return res.status(401).json({ error: "로그인이 필요합니다" });
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }
  const items = await store.list(LOG);
  return res.status(200).json({ count: items.length, persistent: store.persistent, items: items.slice(-100) });
};
