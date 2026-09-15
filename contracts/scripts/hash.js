// 프론트엔드(index.html)와 똑같은 규칙으로 해시를 만든다.
//  - 위임 ID:   SHA-256(위임 ID 문자열)
//  - 이벤트:    SHA-256(JSON.stringify(이벤트 원문))
const { createHash } = require("crypto");

const sha256Hex = (str) => "0x" + createHash("sha256").update(str, "utf8").digest("hex");
const delegationKey = (delegationId) => sha256Hex(delegationId);
const eventHash = (payload) => sha256Hex(JSON.stringify(payload));

module.exports = { sha256Hex, delegationKey, eventHash };
