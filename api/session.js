// 로그인 / 세션 조회 / 로그아웃
//   GET    /api/session   현재 세션
//   POST   /api/session   { id, password } → 세션 발급
//   DELETE /api/session   로그아웃
const { checkPassword, pub, makeToken, session, setCookie, COOKIE, ACCOUNTS } = require("./_lib");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    const me = session(req);
    return res.status(200).json(me ? { signedIn: true, ...pub(me) } : { signedIn: false });
  }

  if (req.method === "POST") {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    // 아이디+비밀번호. 계정 키(delegator 등)로도 받아 주되 비밀번호는 반드시 확인한다.
    const id = String(b.id || (ACCOUNTS[b.account] && ACCOUNTS[b.account].id) || "").trim().toLowerCase();
    const acc = checkPassword(id, b.password == null ? "" : b.password);
    if (!acc) {
      // 아이디가 틀렸는지 비밀번호가 틀렸는지 구분해서 알려 주지 않는다
      return res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다" });
    }
    setCookie(res, COOKIE, makeToken(acc.role), 7 * 24 * 3600);
    return res.status(200).json({ signedIn: true, ...pub(acc) });
  }

  if (req.method === "DELETE") {
    setCookie(res, COOKIE, "", 0);
    return res.status(200).json({ signedIn: false });
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  return res.status(405).json({ error: "method not allowed" });
};
