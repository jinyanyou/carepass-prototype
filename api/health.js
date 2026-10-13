const { store } = require("./_lib");
module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    ok: true, service: "carepass", time: new Date().toISOString(),
    region: process.env.VERCEL_REGION || "local",
    storage: store.persistent ? "kv" : "memory",
    // 심평원 API 키가 들어와 있는지만 알린다 (키 값은 절대 내보내지 않는다)
    hira: !!process.env.HIRA_API_KEY,
  });
};
