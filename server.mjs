// Tiny local server: serves ./public and proxies /api/chat to your LLM endpoint.
// The API key stays on this machine (read from .env or the environment) and is never sent to the browser.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env loader (no dependencies)
try {
  for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const KEY = process.env.PSU_API_KEY || "";
const BASE = (process.env.PSU_BASE_URL || "https://ai.psu.blue/v1").replace(/\/+$/, "");
const MODEL = process.env.PSU_MODEL || "PSU-LLM2/psu-qwen";
const PORT = Number(process.env.PORT || 5174);
const HOST = process.env.HOST || "127.0.0.1";                     // set HOST=0.0.0.0 on a hosting platform
const REQUIRE_AUTH = process.env.REQUIRE_AUTH === "1";            // set to 1 when the site is public
const SB_URL = (process.env.SUPABASE_URL || "https://pjhzjlzdvnklzkomzyac.supabase.co").replace(/\/+$/, "");
const SB_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_6Qho04kZRu-GOFT705V2ZA_IpzioMaF";
const ALLOWED = (process.env.ALLOWED_EMAILS || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

// Verify the caller's Supabase session before spending the LLM key. Cached for 60s per token.
const authCache = new Map();
async function authorised(req) {
  if (!REQUIRE_AUTH) return true;
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return false;
  const tok = h.slice(7), hit = authCache.get(tok);
  if (hit && hit.exp > Date.now()) return hit.ok;
  let ok = false;
  try {
    const r = await fetch(SB_URL + "/auth/v1/user", { headers: { apikey: SB_KEY, Authorization: "Bearer " + tok } });
    if (r.ok) { const u = await r.json(); ok = ALLOWED.length === 0 || ALLOWED.includes(String(u.email || "").toLowerCase()); }
  } catch {}
  authCache.set(tok, { ok, exp: Date.now() + 60_000 });
  if (authCache.size > 500) authCache.clear();
  return ok;
}
// Simple per-IP rate limit: 20 chat requests per minute
const hits = new Map();
function limited(ip) { const now = Date.now(), a = (hits.get(ip) || []).filter((t) => now - t < 60_000); a.push(now); hits.set(ip, a); return a.length > 20; }

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > 2_000_000) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ configured: Boolean(KEY), model: MODEL, base: BASE, requireAuth: REQUIRE_AUTH }));
    return;
  }

  if (url.pathname === "/api/chat" && req.method === "POST") {
    if (!(await authorised(req))) { res.writeHead(401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Sign in required" })); return; }
    if (limited(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?")) { res.writeHead(429, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Too many requests" })); return; }
    if (!KEY) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "PSU_API_KEY is not set in .env" })); return; }
    try {
      const body = JSON.parse(await readBody(req));
      const payload = { model: MODEL, messages: body.messages || [], stream: true, max_tokens: body.max_tokens || 8000, temperature: body.temperature ?? 0.4 };
      const ac = new AbortController();
      res.on("close", () => ac.abort());
      const upstream = await fetch(BASE + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY },
        body: JSON.stringify(payload),
        signal: ac.signal,
      });
      res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") || "text/event-stream", "Cache-Control": "no-cache" });
      if (!upstream.body) { res.end(); return; }
      for await (const chunk of upstream.body) res.write(chunk);
      res.end();
    } catch (e) {
      if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e && e.message || e) }));
    }
    return;
  }

  // static files
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const file = path.normalize(path.join(root, "public", rel));
  if (!file.startsWith(path.join(root, "public"))) { res.writeHead(403); res.end("Forbidden"); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log("Journal running at http://localhost:" + PORT + "  (AI " + (KEY ? "configured" : "NOT configured") + ", model " + MODEL + ")");
});
