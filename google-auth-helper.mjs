// scripts/desktop-auth.ts
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";

// src/pairing.ts
var FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
var FULL_SCOPE = "https://www.googleapis.com/auth/drive";
var PREFIX = "AIDSYNC1.";
var ITERATIONS = 6e5;
var AAD = new TextEncoder().encode("obsidian-ai-drive-sync:pair:v1");
function encode(d) {
  return btoa(String.fromCharCode(...d)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function validateCredentials(value) {
  const c = value;
  if (!c || typeof c.clientId !== "string" || !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(c.clientId) || typeof c.clientSecret !== "string" || !c.clientSecret || c.clientSecret.length > 512 || typeof c.refreshToken !== "string" || !c.refreshToken || c.refreshToken.length > 8192 || ![FILE_SCOPE, FULL_SCOPE].includes(c.scope)) throw Error("Google\u63A5\u7D9A\u8A2D\u5B9A\u304C\u4E0D\u6B63\u3067\u3059\u3002Windows\u3067\u4F5C\u6210\u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
  return { clientId: c.clientId, clientSecret: c.clientSecret, refreshToken: c.refreshToken, scope: c.scope };
}
async function key(code, salt) {
  const c = code.replace(/[\s-]/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(c)) throw Error("\u89E3\u9664\u30B3\u30FC\u30C9\u304C\u4E0D\u6B63\u3067\u3059\u3002");
  const m = await crypto.subtle.importKey("raw", new TextEncoder().encode(c), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, m, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function seal(credentials) {
  const c = validateCredentials(credentials), salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const code = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  const expiresAt = Date.now() + 6e5;
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, await key(code, salt), new TextEncoder().encode(JSON.stringify({ credentials: c, expiresAt })));
  const e = { v: 1, salt: encode(salt), iv: encode(iv), data: encode(new Uint8Array(data)) };
  return { token: PREFIX + encode(new TextEncoder().encode(JSON.stringify(e))), code: code.match(/.{4}/g).join("-"), expiresAt };
}

// src/model.ts
function random() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
}

// scripts/desktop-auth.ts
async function readJson(req) {
  if (!req.headers["content-type"]?.startsWith("application/json")) throw Error("JSON\u5F62\u5F0F\u304C\u5FC5\u8981\u3067\u3059\u3002");
  const buffers = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 32768) throw Error("\u8A2D\u5B9A\u304C\u5927\u304D\u3059\u304E\u307E\u3059\u3002");
    buffers.push(chunk);
  }
  return JSON.parse(Buffer.concat(buffers).toString("utf8"));
}
function reply(res, status, value, html = false, nonce = "") {
  res.writeHead(status, { "Content-Type": html ? "text/html; charset=utf-8" : "application/json; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'` });
  res.end(html ? String(value) : JSON.stringify(value));
}
async function createHelper(options = {}) {
  const googleFetch = options.googleFetch ?? fetch, nonce = random(), prefix = "/setup/" + random();
  let origin = "", pending;
  let pairing, busy = false, notice = "Google Cloud\u3067\u4F5C\u6210\u3057\u305F\u30C7\u30B9\u30AF\u30C8\u30C3\u30D7\u30A2\u30D7\u30EA\u306E\u30AF\u30E9\u30A4\u30A2\u30F3\u30C8ID\u3068\u30B7\u30FC\u30AF\u30EC\u30C3\u30C8\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002JSON\u30D5\u30A1\u30A4\u30EB\u304B\u3089\u3082\u8AAD\u307F\u8FBC\u3081\u307E\u3059\u3002";
  let closed = false;
  const server = createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host) {
        reply(res, 403, { error: "Host\u304C\u4E0D\u6B63\u3067\u3059\u3002" });
        return;
      }
      const u = new URL(req.url ?? "/", origin);
      if (req.method === "GET" && u.pathname === prefix) {
        reply(res, 200, page(prefix, nonce), true, nonce);
        return;
      }
      if (req.method === "GET" && u.pathname === prefix + "/state") {
        if (pairing && pairing.expiresAt < Date.now()) {
          pairing = void 0;
          notice = "\u63A5\u7D9A\u8A2D\u5B9A\u306E10\u5206\u306E\u671F\u9650\u304C\u5207\u308C\u307E\u3057\u305F\u3002\u8A8D\u8A3C\u3092\u3084\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
        }
        reply(res, 200, { notice, busy, pairing });
        return;
      }
      if (req.method === "POST" && u.pathname === prefix + "/authorize") {
        if (req.headers.origin !== origin) {
          reply(res, 403, { error: "\u5225\u30B5\u30A4\u30C8\u304B\u3089\u306E\u64CD\u4F5C\u3092\u62D2\u5426\u3057\u307E\u3057\u305F\u3002" });
          return;
        }
        if (busy) {
          reply(res, 409, { error: "\u8A8D\u8A3C\u51E6\u7406\u4E2D\u3067\u3059\u3002" });
          return;
        }
        const b = await readJson(req), installed = b.credentials?.installed;
        if (!installed || typeof installed.client_id !== "string" || typeof installed.client_secret !== "string") throw Error("Google Cloud\u306E\u300C\u30C7\u30B9\u30AF\u30C8\u30C3\u30D7\u30A2\u30D7\u30EA\u300D\u306EJSON\u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
        const scope = b.scope ?? FULL_SCOPE;
        validateCredentials({ clientId: installed.client_id, clientSecret: installed.client_secret, refreshToken: "validation-only", scope });
        const verifier = random(), digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
        const challenge = Buffer.from(digest).toString("base64url");
        pending = { clientId: installed.client_id, clientSecret: installed.client_secret, scope, verifier, state: random(), expires: Date.now() + 6e5 };
        pairing = void 0;
        const q = new URLSearchParams({ client_id: pending.clientId, redirect_uri: origin + "/callback", response_type: "code", scope, state: pending.state, code_challenge: challenge, code_challenge_method: "S256", access_type: "offline", prompt: "consent" });
        notice = "Google\u306E\u753B\u9762\u3067\u8A8D\u8A3C\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u3053\u306E\u753B\u9762\u306F\u958B\u3044\u305F\u307E\u307E\u306B\u3057\u307E\u3059\u3002";
        reply(res, 200, { url: "https://accounts.google.com/o/oauth2/v2/auth?" + q });
        return;
      }
      if (req.method === "GET" && u.pathname === "/callback") {
        const p = pending;
        if (!p || p.expires < Date.now() || u.searchParams.get("state") !== p.state || busy) {
          reply(res, 400, { error: "\u8A8D\u8A3C\u306E\u671F\u9650\u5207\u308C\u3001\u307E\u305F\u306F\u4E0D\u6B63\u306Astate\u3067\u3059\u3002\u6700\u521D\u304B\u3089\u3084\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002" });
          return;
        }
        pending = void 0;
        busy = true;
        try {
          const code = u.searchParams.get("code");
          if (u.searchParams.has("error") || !code || code.length > 8192) throw Error("Google\u3067\u8A8D\u8A3C\u304C\u53D6\u308A\u6D88\u3055\u308C\u307E\u3057\u305F\u3002");
          const r = await googleFetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: p.clientId, client_secret: p.clientSecret, redirect_uri: origin + "/callback", code_verifier: p.verifier }), signal: AbortSignal.timeout(2e4) });
          if (!r.ok) throw Error("Google\u3067\u8A8D\u8A3C\u30B3\u30FC\u30C9\u306E\u4EA4\u63DB\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002\u8A2D\u5B9A\u3092\u78BA\u8A8D\u3057\u3001\u518D\u8A8D\u8A3C\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
          const t = await r.json();
          if (!t.refresh_token) throw Error("\u66F4\u65B0\u7528\u30C8\u30FC\u30AF\u30F3\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3002Google\u5074\u306E\u540C\u610F\u8A2D\u5B9A\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
          if (!t.scope?.split(" ").includes(p.scope)) throw Error("\u5FC5\u8981\u306ADrive\u6A29\u9650\u304C\u8A31\u53EF\u3055\u308C\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
          pairing = await seal({ clientId: p.clientId, clientSecret: p.clientSecret, refreshToken: t.refresh_token, scope: p.scope });
          notice = "\u8A8D\u8A3C\u3067\u304D\u307E\u3057\u305F\u300210\u5206\u4EE5\u5185\u306B\u63A5\u7D9A\u8A2D\u5B9A\u3092iPhone\u3078\u53D6\u308A\u8FBC\u3093\u3067\u304F\u3060\u3055\u3044\u3002";
          reply(res, 200, `<!doctype html><meta charset="utf-8"><title>\u8A8D\u8A3C\u5B8C\u4E86</title><p>\u8A8D\u8A3C\u3067\u304D\u307E\u3057\u305F\u3002</p><a href="${prefix}">\u63A5\u7D9A\u8A2D\u5B9A\u3068\u89E3\u9664\u30B3\u30FC\u30C9\u3092\u8868\u793A\u3059\u308B</a>`, true, nonce);
        } catch (e) {
          notice = e instanceof Error && e.message.startsWith("Google") ? e.message : "\u8A8D\u8A3C\u3092\u5B8C\u4E86\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u5143\u306E\u753B\u9762\u304B\u3089\u3084\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
          reply(res, 400, { error: notice });
        } finally {
          busy = false;
        }
        return;
      }
      reply(res, 404, { error: "\u30DA\u30FC\u30B8\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002\u30BF\u30FC\u30DF\u30CA\u30EB\u306B\u8868\u793A\u3055\u308C\u305FURL\u3092\u958B\u3044\u3066\u304F\u3060\u3055\u3044\u3002" });
    } catch {
      reply(res, 400, { error: "\u8A2D\u5B9A\u3092\u8AAD\u307F\u53D6\u308C\u307E\u305B\u3093\u3002Google Cloud\u306E\u30C7\u30B9\u30AF\u30C8\u30C3\u30D7\u30A2\u30D7\u30EA\u7528JSON\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002" });
    }
  });
  server.requestTimeout = 3e4;
  server.headersTimeout = 15e3;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("\u30ED\u30FC\u30AB\u30EB\u30B5\u30FC\u30D0\u30FC\u3092\u8D77\u52D5\u3067\u304D\u307E\u305B\u3093\u3002");
  origin = "http://127.0.0.1:" + address.port;
  const close = () => {
    if (closed) return;
    closed = true;
    pending = void 0;
    pairing = void 0;
    clearTimeout(timer);
    server.closeAllConnections();
    server.close();
  };
  const timer = setTimeout(close, options.timeoutMs ?? 20 * 6e4);
  timer.unref();
  return { url: origin + prefix, origin, close };
}
function page(prefix, nonce) {
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Drive Sync \u63A5\u7D9A\u6E96\u5099</title>
<style>body{font:16px system-ui;max-width:760px;margin:36px auto;padding:0 20px;line-height:1.7}label{display:block;margin-top:20px}textarea{width:100%;min-height:110px;box-sizing:border-box}button{padding:10px 18px;margin:12px 8px 12px 0}code{overflow-wrap:anywhere}#result{border:1px solid #999;padding:16px}small{display:block}</style>
<h1>Drive Sync \u63A5\u7D9A\u6E96\u5099</h1><p>\u3053\u306E\u753B\u9762\u306FWindows\u4E0A\u3060\u3051\u3067\u52D5\u304D\u307E\u3059\u3002\u5916\u90E8\u30B5\u30FC\u30D0\u30FC\u30FB\u8AB2\u91D1\u30B5\u30FC\u30D3\u30B9\u306F\u4F7F\u3044\u307E\u305B\u3093\u3002\u901A\u4FE1\u5148\u306FGoogle\u8A8D\u8A3C\u3060\u3051\u3067\u3059\u300220\u5206\u5F8C\u306B\u81EA\u52D5\u7D42\u4E86\u3057\u307E\u3059\u3002</p>
<h2>\u2460 Google Cloud\u306E\u30C7\u30B9\u30AF\u30C8\u30C3\u30D7\u30A2\u30D7\u30EA\u8A8D\u8A3C\u60C5\u5831</h2>
<label>\u30AF\u30E9\u30A4\u30A2\u30F3\u30C8ID<input id="client-id" type="text" autocomplete="off" spellcheck="false" placeholder="\u2026apps.googleusercontent.com" style="display:block;width:100%;box-sizing:border-box"></label>
<label>\u30AF\u30E9\u30A4\u30A2\u30F3\u30C8\u30B7\u30FC\u30AF\u30EC\u30C3\u30C8<input id="client-secret" type="password" autocomplete="off" spellcheck="false" style="display:block;width:100%;box-sizing:border-box"></label>
<small>\u30E1\u30E2\u3057\u305F\u30B7\u30FC\u30AF\u30EC\u30C3\u30C8\u306F\u3053\u3053\u306B\u8CBC\u308A\u4ED8\u3051\u3066\u304F\u3060\u3055\u3044\u3002Windows\u5185\u306E\u4E00\u6642\u30B5\u30FC\u30D0\u30FC\u3068Google\u8A8D\u8A3C\u4EE5\u5916\u3078\u9001\u4FE1\u3057\u307E\u305B\u3093\u3002\u30D5\u30A1\u30A4\u30EB\u3084\u30ED\u30B0\u306B\u3082\u4FDD\u5B58\u3057\u307E\u305B\u3093\u3002</small>
<label>JSON\u304B\u3089\u8AAD\u307F\u8FBC\u3080\u5834\u5408\u306F\u3053\u3061\u3089\uFF08\u4EFB\u610F\uFF09<input id="file" type="file" accept=".json,application/json"></label>
<small>JSON\u3092\u9078\u3093\u3060\u5834\u5408\u306F\u3001\u305D\u306E\u5185\u5BB9\u3092\u512A\u5148\u3057\u307E\u3059\u3002\u624B\u5165\u529B\u3057\u305F\u5024\u306F\u4F7F\u3044\u307E\u305B\u3093\u3002</small>
<label>\u2461 Drive\u306E\u6A29\u9650<select id="scope"><option value="${FULL_SCOPE}">\u63A8\u5968\uFF1AWindows\u3067\u65B0\u898F\u4F5C\u6210\u3057\u305F\u30CE\u30FC\u30C8\u3082\u53CC\u65B9\u5411\u540C\u671F\uFF08Drive\u5168\u4F53\u306E\u8AAD\u307F\u66F8\u304D\uFF09</option><option value="${FILE_SCOPE}">\u5236\u9650\u4ED8\u304D\uFF1A\u3053\u306E\u30A2\u30D7\u30EA\u306E\u30D5\u30A1\u30A4\u30EB\u306E\u307F\uFF08Windows\u65B0\u898F\u30CE\u30FC\u30C8\u306F\u53D6\u5F97\u4E0D\u53EF\uFF09</option></select></label>
<small>Windows\u3067\u65B0\u898F\u4F5C\u6210\u3057\u305F\u30D5\u30A1\u30A4\u30EB\u3092\u53D6\u5F97\u30FB\u66F4\u65B0\u3059\u308B\u305F\u3081\u3001\u63A8\u5968\u8A2D\u5B9A\u306FDrive\u5168\u4F53\u306E\u8AAD\u307F\u66F8\u304D\u6A29\u9650\u3092\u8981\u6C42\u3057\u307E\u3059\u3002Google\u306E\u540C\u610F\u753B\u9762\u3067\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u6A29\u9650\u81EA\u4F53\u306F\u30D5\u30A9\u30EB\u30C0\u9650\u5B9A\u3067\u306F\u306A\u304F\u3001\u6F0F\u6D29\u6642\u306E\u5F71\u97FF\u7BC4\u56F2\u304C\u5E83\u304C\u308A\u307E\u3059\u3002\u5B9F\u969B\u306E\u540C\u671F\u51E6\u7406\u306F\u6307\u5B9A\u30D5\u30A9\u30EB\u30C0\u5185\u3060\u3051\u3067\u884C\u3044\u3001\u81EA\u52D5\u524A\u9664\u306F\u3057\u307E\u305B\u3093\u3002\u65E2\u5B58\u30E6\u30FC\u30B6\u30FC\u3082\u518D\u8A8D\u8A3C\u3057\u3001iPhone\u30FBiPad\u3078\u65B0\u3057\u3044\u63A5\u7D9A\u8A2D\u5B9A\u3092\u53D6\u308A\u8FBC\u3080\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059\u3002</small>
<button id="authorize">\u2462 Google\u306E\u8A8D\u8A3C\u753B\u9762\u3092\u958B\u304F</button><p id="status" role="status"></p>
<section id="result" hidden><h2>\u2463 iPhone\u3078\u6E21\u3059\u63A5\u7D9A\u8A2D\u5B9A</h2><p>\u4E0B\u306E\u63A5\u7D9A\u8A2D\u5B9A\u3092iPhone\u3078\u30B3\u30D4\u30FC\u3057\u3001Obsidian\u306EDrive Sync\u8A2D\u5B9A\u3078\u8CBC\u308A\u4ED8\u3051\u307E\u3059\u3002\u89E3\u9664\u30B3\u30FC\u30C9\u306F\u5225\u306B\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u4E21\u65B9\u3092\u4E00\u7DD2\u306B\u5171\u6709\u3057\u306A\u3044\u3067\u304F\u3060\u3055\u3044\u3002</p>
<textarea id="token" readonly aria-label="\u6697\u53F7\u5316\u3057\u305F\u63A5\u7D9A\u8A2D\u5B9A"></textarea><button id="copy">\u63A5\u7D9A\u8A2D\u5B9A\u3092\u30B3\u30D4\u30FC</button><p>\u89E3\u9664\u30B3\u30FC\u30C9\uFF1A<code id="code"></code></p><p id="expiry"></p><p>\u6697\u53F7\u5316\u3055\u308C\u3066\u3044\u3066\u3082\u8A8D\u8A3C\u60C5\u5831\u3067\u3059\u3002\u30C1\u30E3\u30C3\u30C8\u3078\u8CBC\u3089\u305A\u3001\u53D6\u8FBC\u5F8C\u306F\u30B3\u30D4\u30FC\u5C65\u6B74\u3084\u8EE2\u9001\u7528\u30E1\u30E2\u3092\u6574\u7406\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u671F\u9650\u5185\u306E\u518D\u53D6\u8FBC\u306F\u53EF\u80FD\u3067\u3059\u3002\u4F7F\u3044\u6368\u3066\u3092\u30B5\u30FC\u30D0\u30FC\u3067\u5F37\u5236\u3059\u308B\u4ED5\u7D44\u307F\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002</p></section>
<script nonce="${nonce}">
const base=${JSON.stringify(prefix)};
const el=id=>document.getElementById(id);
el('authorize').onclick=async()=>{const b=el('authorize');b.disabled=true;try{
  const f=el('file').files[0];let credentials;
  if(f){if(f.size>32768)throw Error('32KB\u4EE5\u4E0B\u306E\u30AF\u30E9\u30A4\u30A2\u30F3\u30C8JSON\u3092\u9078\u3093\u3067\u304F\u3060\u3055\u3044\u3002');credentials=JSON.parse(await f.text());}
  else{const client_id=el('client-id').value.trim(),client_secret=el('client-secret').value.trim();if(!client_id||!client_secret)throw Error('\u30AF\u30E9\u30A4\u30A2\u30F3\u30C8ID\u3068\u30B7\u30FC\u30AF\u30EC\u30C3\u30C8\u3092\u4E21\u65B9\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002');credentials={installed:{client_id,client_secret}};}
  const r=await fetch(base+'/authorize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credentials,scope:el('scope').value})});const j=await r.json();if(!r.ok)throw Error(j.error);
  el('file').value='';el('client-secret').value='';window.location.assign(j.url);
}catch(e){el('status').textContent=e.message;}finally{b.disabled=false;}};
// Opening Google in the same tab avoids blocked popups. Use Back after its callback page.
el('copy').onclick=async()=>{try{await navigator.clipboard.writeText(el('token').value);}catch{el('token').focus();el('token').select();}};
async function refresh(){try{const r=await fetch(base+'/state');const j=await r.json();el('status').textContent=j.notice;el('result').hidden=!j.pairing;if(j.pairing){el('token').value=j.pairing.token;el('code').textContent=j.pairing.code;el('expiry').textContent='\u53D6\u8FBC\u671F\u9650\uFF1A'+new Date(j.pairing.expiresAt).toLocaleTimeString();}else{el('token').value='';el('code').textContent='';}}catch{el('status').textContent='\u30ED\u30FC\u30AB\u30EB\u8A8D\u8A3C\u30C4\u30FC\u30EB\u304C\u7D42\u4E86\u3057\u307E\u3057\u305F\u3002\u5FC5\u8981\u306A\u3089\u3082\u3046\u4E00\u5EA6\u8D77\u52D5\u3057\u3066\u304F\u3060\u3055\u3044\u3002';el('result').hidden=true;el('token').value='';el('code').textContent='';}}
refresh();setInterval(refresh,2000);
</script></html>`;
}
async function main() {
  const helper = await createHelper();
  console.log("Drive Sync \u63A5\u7D9A\u6E96\u5099\uFF08\u8A8D\u8A3C\u60C5\u5831\u306F\u4FDD\u5B58\u30FB\u30ED\u30B0\u51FA\u529B\u3057\u307E\u305B\u3093\uFF09");
  console.log(helper.url);
  if (!process.argv.includes("--no-open")) {
    const command = process.platform === "win32" ? "rundll32.exe" : process.platform === "darwin" ? "open" : "xdg-open";
    const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", helper.url] : [helper.url];
    execFile(command, args, { windowsHide: true }, () => {
    });
  }
  process.once("SIGINT", () => {
    helper.close();
    process.exitCode = 0;
  });
  process.once("SIGTERM", () => helper.close());
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) void main().catch(() => {
  console.error("\u8A8D\u8A3C\u30C4\u30FC\u30EB\u3092\u8D77\u52D5\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
  process.exitCode = 1;
});
export {
  createHelper
};
