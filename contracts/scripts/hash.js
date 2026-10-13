// 프론트엔드(index.html)와 똑같은 규칙으로 해시를 만든다.
//  - 위임 ID:   SHA-256("위임 ID|위임별 salt")
//    salt 없이 ID만 해시하면 'DLG-연도-월일' 형식의 후보가 수천 개뿐이라
//    해시를 전수 대입으로 되돌릴 수 있다. 공개 체인이므로 salt는 필수다.
//    salt는 오프체인(은행)에 보관하고 체인에는 올리지 않는다.
//  - 이벤트:    SHA-256(JSON.stringify(이벤트 원문))
//  - 기관 ID:   SHA-256("기관명|종별|구군")            (공백 제거한 기관명)
//  - 인증 근거: SHA-256(JSON.stringify(요양기관 목록 행))
const { createHash } = require("crypto");

const sha256Hex = (str) => "0x" + createHash("sha256").update(str, "utf8").digest("hex");
const delegationKey = (delegationId, salt = "") =>
  sha256Hex(salt ? `${delegationId}|${salt}` : delegationId);
const eventHash = (payload) => sha256Hex(JSON.stringify(payload));

const normName = (s) => String(s || "").replace(/\s+/g, "");
const instKey = (name, type, gu) => sha256Hex(`${normName(name)}|${type}|${gu}`);
const proofHash = (proof) => sha256Hex(JSON.stringify(proof));

module.exports = { sha256Hex, delegationKey, eventHash, normName, instKey, proofHash };
