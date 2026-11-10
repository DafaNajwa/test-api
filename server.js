// Server kecil: menyimpan API key Gemini di sisi server, jadi tidak pernah sampai ke browser.
// Jalankan: node server.js  (butuh Node.js 18 atau lebih baru)
const http = require("http");
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");

// Baca .env sederhana (GEMINI_API_KEY=...)
try {
  for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch (_) {}

const KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 3000;
// Batas pemakaian: maksimal 20 pesan per menit untuk tiap pengunjung
const hits = new Map();
const tooMany = req => {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 60000);
  list.push(now); hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > 20;
};
const json = (res, code, msg) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { message: msg } }));
};

http.createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return fs.createReadStream(path.join(__dirname, "index.html")).pipe(res);
  }
  if (req.method === "POST" && req.url === "/api/chat") {
    if (tooMany(req)) return json(res, 429, "Terlalu banyak pesan. Tunggu semenit lalu coba lagi.");
    if (!KEY) return json(res, 500, "GEMINI_API_KEY belum diatur di server. Isi file .env lalu jalankan ulang server.");
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 12e6) return json(res, 413, "Permintaan terlalu besar.");
    }
    let data;
    try { data = JSON.parse(body); } catch (_) { return json(res, 400, "Format permintaan salah."); }
    const { model, ...payload } = data;
    if (!/^gemini-[\w.-]+$/.test(model || "")) return json(res, 400, "Nama model tidak valid.");
    try {
      const up = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
        body: JSON.stringify(payload),
      });
      res.writeHead(up.status, { "Content-Type": up.headers.get("content-type") || "application/json" });
      Readable.fromWeb(up.body).pipe(res);
    } catch (e) {
      json(res, 502, "Server tidak bisa menghubungi Gemini: " + e.message);
    }
    return;
  }
  res.writeHead(404); res.end("Tidak ditemukan");
}).listen(PORT, () => console.log(`Studio Persona jalan di http://localhost:${PORT}`));