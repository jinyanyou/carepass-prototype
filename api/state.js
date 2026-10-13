// 가구 공유 상태 — 세 계정이 같은 위임 하나를 본다
//   GET  /api/state            현재 상태 (rev 포함)
//   GET  /api/state?since=12   rev가 12보다 크면 상태를, 아니면 {changed:false} 만 (폴링용)
//   POST /api/state            { action, payload } → 역할 검사 후 적용, rev 증가
//   DELETE /api/state          가구 초기화 (위임자만)
//
// 역할 검사를 서버에서 한다는 점이 핵심이다.
// 대리인은 결제를 '요청'만 할 수 있고 승인할 수 없다. 보호자는 결제 권한이 아예 없다.
// 클라이언트를 고쳐도 서버가 막는다.
const { session, store, sha256, rid } = require("./_lib");

const KEY = "carepass:household:H1";
const LOG = "carepass:household:H1:log";

const INIT = () => ({
  rev: 0,
  updatedAt: new Date().toISOString(),
  pool: { cap: 3000000, balance: 3000000 },
  protectionFloor: 500000,
  alloc: {
    hospital: { key: "hospital", nm: "병원비 결제", allowed: true, perTx: 300000, cap: 1000000, spent: 0 },
    utility: { key: "utility", nm: "공과금 결제", allowed: true, perTx: 200000, cap: 600000, spent: 0, auto: true },
    cash: { key: "cash", nm: "현금 송금", allowed: false, perTx: 0, cap: 0, spent: 0 },
  },
  consent: { signed: false, ts: null, docHash: null, sigHash: null, witness: null },
  requests: [],
  alerts: [],
  suspectDelegate: false,
  revoked: false,
  pendingRaise: null,   // { cat, from, to, until } — 냉각기간 중인 한도 상향
});

// action → 허용 역할
const ALLOW = {
  setup: ["delegator"],
  consent: ["delegator"],
  consentRevoke: ["delegator"],
  request: ["delegate"],
  decide: ["delegator"],
  revoke: ["delegator"],
  restore: ["delegator"],
  objection: ["guardian"],
  ack: ["guardian"],
  sos: ["delegator"],
  raise: ["delegate"],        // 한도 상향은 대리인이 '요청'하고 냉각기간을 거친다
  raiseCancel: ["delegator", "delegate"],
};

// 냉각기간 길이 — 시연은 60초. 환경변수로 줄이면 테스트에서 기다리지 않아도 된다.
const RAISE_COOLDOWN_MS = Number(process.env.CP_RAISE_MS) || 60000;

// 냉각기간이 끝난 상향은 '읽는 시점에' 반영한다 (서버리스라 타이머를 둘 수 없다)
function settleRaise(st) {
  const r = st.pendingRaise;
  if (!r || Date.now() < r.until) return false;
  if (st.alloc[r.cat]) st.alloc[r.cat].perTx = r.to;
  st.pendingRaise = null;
  return true;
}

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v, n = 80) => String(v == null ? "" : v).slice(0, n);

function apply(st, action, p, who) {
  switch (action) {
    case "setup": {
      if (p.poolCap != null) st.pool.cap = Math.max(0, num(p.poolCap));
      if (p.protectionFloor != null) st.protectionFloor = Math.max(0, num(p.protectionFloor));
      st.pool.balance = Math.min(st.pool.balance, st.pool.cap);
      if (p.alloc && typeof p.alloc === "object") {
        for (const k of Object.keys(st.alloc)) {
          const a = p.alloc[k];
          if (!a) continue;
          st.alloc[k].allowed = !!a.allowed;
          st.alloc[k].perTx = Math.max(0, num(a.perTx, st.alloc[k].perTx));
          st.alloc[k].cap = Math.max(0, num(a.cap, st.alloc[k].cap));
        }
      }
      return "위임 설정 변경";
    }
    case "consent":
      st.consent = {
        signed: true, ts: Date.now(),
        docHash: str(p.docHash, 66), sigHash: str(p.sigHash, 66),
        witness: str(p.witness, 40),
      };
      return "위임장 직접 서명";
    case "consentRevoke":
      st.consent = { signed: false, ts: null, docHash: null, sigHash: null, witness: null };
      return "위임장 동의 철회";
    case "request": {
      if (st.revoked) throw new Error("위임이 정지된 상태입니다");
      if (!st.consent.signed) throw new Error("위임장 서명 전에는 결제를 요청할 수 없습니다");
      const cat = str(p.cat, 20);
      if (!st.alloc[cat]) throw new Error("알 수 없는 항목입니다");
      if (!st.alloc[cat].allowed) throw new Error("위임자가 차단한 항목입니다");
      const req = {
        id: rid("REQ"), cat, amount: Math.max(0, num(p.amount)),
        merchant: str(p.merchant), status: str(p.status, 12) || "pending",
        v: {
          level: str(p.level, 10) || "normal",
          action: str(p.action, 10) || "approve",
          say: str(p.say, 400),
          reasons: Array.isArray(p.reasons) ? p.reasons.slice(0, 8).map((r) => str(r, 200)) : [],
          z: num(p.z, 0),
        },
        ts: Date.now(), by: who.account,
      };
      st.requests.unshift(req);
      st.requests = st.requests.slice(0, 50);
      if (p.alert) {
        st.alerts.unshift({
          id: rid("ALT"), kind: str(p.alert.kind, 12) || "caution",
          title: str(p.alert.title, 60), msg: str(p.alert.msg, 300),
          reqId: req.id, amount: req.amount, merchant: req.merchant,
          ts: Date.now(), state: "new", silent: !!st.suspectDelegate,
        });
        st.alerts = st.alerts.slice(0, 50);
      }
      return `결제 요청 ${req.amount.toLocaleString()}원 · ${req.merchant}`;
    }
    case "decide": {
      const r = st.requests.find((x) => x.id === p.id);
      if (!r) throw new Error("요청을 찾을 수 없습니다");
      if (r.status === "approved" || r.status === "rejected") throw new Error("이미 처리된 요청입니다");
      if (p.ok) {
        if (r.amount > st.pool.balance) throw new Error("위임 풀 잔액이 부족합니다");
        r.status = "approved";
        r.decided = "위임자 승인";
        st.pool.balance -= r.amount;
        st.alloc[r.cat].spent += r.amount;
      } else {
        r.status = "rejected";
        r.decided = "거부: " + str(p.reason, 40);
      }
      return `${p.ok ? "승인" : "거부"} ${r.amount.toLocaleString()}원`;
    }
    case "raise": {
      if (!st.alloc[p.cat]) throw new Error("알 수 없는 항목입니다");
      const to = Math.max(0, num(p.to));
      if (to <= st.alloc[p.cat].perTx) throw new Error("현재 한도보다 큰 금액이어야 합니다");
      st.pendingRaise = { cat: str(p.cat, 20), from: st.alloc[p.cat].perTx, to,
                          until: Date.now() + RAISE_COOLDOWN_MS };
      return `한도 상향 요청 ${st.alloc[p.cat].perTx.toLocaleString()}→${to.toLocaleString()} · 냉각기간 ${Math.round(RAISE_COOLDOWN_MS/1000)}초`;
    }
    case "raiseCancel":
      if (!st.pendingRaise) throw new Error("진행 중인 상향 요청이 없습니다");
      st.pendingRaise = null;
      return "냉각기간 중 상향 취소";
    case "revoke":
      st.revoked = true;
      return "위임 정지 · VC 폐기";
    case "restore":
      st.revoked = false;
      return "위임 재개";
    case "objection": {
      const a = st.alerts.find((x) => x.id === p.id);
      if (!a) throw new Error("알림을 찾을 수 없습니다");
      a.state = "objected";
      a.reason = str(p.reason, 60);
      const r = st.requests.find((x) => x.id === a.reqId);
      if (r && (r.status === "pending" || r.status === "hold")) {
        r.status = "hold";
        r.objected = a.reason;
      } else if (r && r.status === "approved") {
        st.suspectDelegate = true;
      }
      return `보호자 이의제기 · ${a.reason}`;
    }
    case "ack": {
      const a = st.alerts.find((x) => x.id === p.id);
      if (!a) throw new Error("알림을 찾을 수 없습니다");
      a.state = "ok";
      return "보호자 확인 · 이상 없음";
    }
    case "sos":
      st.suspectDelegate = true;
      st.alerts.unshift({
        id: rid("ALT"), kind: "sos", title: "은닉 SOS 접수",
        msg: "보호자에게만 전달된 비공개 알림입니다.", reqId: str(p.id, 20),
        amount: num(p.amount), merchant: str(p.merchant), ts: Date.now(),
        state: "new", silent: true,
      });
      return "은닉 SOS · 지정기관 비공개 통보";
    default:
      throw new Error("알 수 없는 action");
  }
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const who = session(req);
  if (!who) return res.status(401).json({ error: "로그인이 필요합니다" });

  let st = (await store.get(KEY)) || INIT();
  if (settleRaise(st)) {           // 냉각기간이 지났으면 먼저 반영하고 저장한다
    st.rev += 1;
    st.updatedAt = new Date().toISOString();
    await store.set(KEY, st);
  }

  if (req.method === "GET") {
    const since = Number(new URL(req.url, "http://x").searchParams.get("since"));
    if (Number.isFinite(since) && since >= st.rev) {
      return res.status(200).json({ changed: false, rev: st.rev });
    }
    return res.status(200).json({ changed: true, state: st, persistent: store.persistent, me: who.account });
  }

  if (req.method === "POST") {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const action = String(b.action || "");
    const allow = ALLOW[action];
    if (!allow) return res.status(400).json({ error: "알 수 없는 action: " + action });
    if (!allow.includes(who.account)) {
      // 역할 검사는 서버에서 한다 — 클라이언트를 고쳐도 통과하지 못한다
      return res.status(403).json({
        error: `${who.label}은(는) '${action}' 권한이 없습니다`,
        allowed: allow,
      });
    }
    let note;
    try {
      note = apply(st, action, b.payload || {}, who);
    } catch (e) {
      return res.status(409).json({ error: String(e.message || e) });
    }
    st.rev += 1;
    st.updatedAt = new Date().toISOString();
    await store.set(KEY, st);
    const prev = (await store.list(LOG)).slice(-1)[0];
    const entry = {
      seq: st.rev, action, note, by: who.account, nm: who.nm,
      receivedAt: new Date().toISOString(),
    };
    entry.chain = sha256((prev ? prev.chain : "0".repeat(64)) + JSON.stringify(entry));
    await store.push(LOG, entry);
    return res.status(200).json({ ok: true, rev: st.rev, state: st, entry });
  }

  if (req.method === "DELETE") {
    if (who.account !== "delegator") return res.status(403).json({ error: "위임자만 초기화할 수 있습니다" });
    await store.del(KEY);
    await store.del(LOG);
    return res.status(200).json({ ok: true, state: INIT() });
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  return res.status(405).json({ error: "method not allowed" });
};
