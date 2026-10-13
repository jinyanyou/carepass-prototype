const { store } = require("./_lib");
module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    ok: true, service: "carepass", time: new Date().toISOString(),
    region: process.env.VERCEL_REGION || "local",
    storage: store.persistent ? "kv" : "memory",
  });
};
