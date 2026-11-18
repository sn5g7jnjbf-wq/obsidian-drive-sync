"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key2 of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key2) && key2 !== except)
        __defProp(to, key2, { get: () => from[key2], enumerable: !(desc = __getOwnPropDesc(from, key2)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => DriveSync
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");

// src/http.ts
var import_obsidian = require("obsidian");
var HttpError = class extends Error {
  constructor(status) {
    super(`\u901A\u4FE1\u30A8\u30E9\u30FC (${status})\u3002\u8A2D\u5B9A\u30FB\u6A29\u9650\u30FB\u63A5\u7D9A\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002`);
    this.status = status;
  }
};
var wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function http(req, retry = true) {
  for (let n = 0; ; n++) {
    let r;
    try {
      r = await (0, import_obsidian.requestUrl)({ ...req, throw: false });
    } catch {
      throw new Error("\u30CD\u30C3\u30C8\u30EF\u30FC\u30AF\u306B\u63A5\u7D9A\u3067\u304D\u307E\u305B\u3093\u3002\u6B21\u56DE\u540C\u671F\u3067\u518D\u8A66\u884C\u3057\u307E\u3059\u3002");
    }
    let rate = false;
    if (r.status === 403) {
      try {
        rate = r.json.error?.errors?.some((e) => ["rateLimitExceeded", "userRateLimitExceeded"].includes(e.reason));
      } catch {
      }
    }
    if (retry && n < 4 && (r.status === 429 || r.status >= 500 || rate)) {
      const raw = r.headers["retry-after"];
      const seconds = raw ? Number(raw) : NaN;
      const requested = Number.isFinite(seconds) ? seconds * 1e3 : raw ? Date.parse(raw) - Date.now() : 0;
      const ms = Math.max(requested || 0, 1e3 * 2 ** n + Math.random() * 500);
      if (ms > 3e4) throw new Error("API\u306E\u5F85\u6A5F\u6642\u9593\u304C\u9577\u3044\u305F\u3081\u4E2D\u65AD\u3057\u307E\u3057\u305F\u3002\u5F8C\u3067\u518D\u540C\u671F\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
      await wait(ms);
      continue;
    }
    if (r.status >= 400) throw new HttpError(r.status);
    return r;
  }
}

// src/pairing.ts
var FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
var FULL_SCOPE = "https://www.googleapis.com/auth/drive";
var PREFIX = "AIDSYNC1.";
var ITERATIONS = 6e5;
var AAD = new TextEncoder().encode("obsidian-ai-drive-sync:pair:v1");
function decode(s, max) {
  if (typeof s !== "string" || !s || s.length > max || !/^[-_A-Za-z0-9]+$/.test(s)) throw Error("\u63A5\u7D9A\u8A2D\u5B9A\u306E\u5F62\u5F0F\u304C\u4E0D\u6B63\u3067\u3059\u3002");
  return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
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
async function unseal(token, code) {
  const t = token.trim();
  if (!t.startsWith(PREFIX) || t.length > 32768) throw Error("\u63A5\u7D9A\u8A2D\u5B9A\u306E\u5F62\u5F0F\u304C\u4E0D\u6B63\u3067\u3059\u3002");
  let p;
  try {
    const e = JSON.parse(new TextDecoder().decode(decode(t.slice(PREFIX.length), 32768)));
    if (e.v !== 1) throw Error("version");
    const salt = decode(e.salt, 64), iv = decode(e.iv, 32), data = decode(e.data, 24e3);
    if (salt.length !== 16 || iv.length !== 12) throw Error("format");
    const d = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: AAD }, await key(code, salt), data);
    p = JSON.parse(new TextDecoder().decode(d));
  } catch {
    throw Error("\u63A5\u7D9A\u8A2D\u5B9A\u307E\u305F\u306F\u89E3\u9664\u30B3\u30FC\u30C9\u304C\u9055\u3044\u307E\u3059\u3002Windows\u3067\u4F5C\u6210\u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
  }
  if (!Number.isFinite(p.expiresAt) || p.expiresAt < Date.now() || p.expiresAt > Date.now() + 66e4) throw Error("\u63A5\u7D9A\u8A2D\u5B9A\u306E\u6709\u52B9\u671F\u9650\u304C\u5207\u308C\u3066\u3044\u307E\u3059\u3002Windows\u3067\u4F5C\u6210\u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
  return validateCredentials(p.credentials);
}

// src/auth.ts
var Auth = class {
  constructor(app, settings) {
    this.app = app;
    this.settings = settings;
  }
  access = "";
  expires = 0;
  refreshing;
  generation = 0;
  credentials() {
    const id = this.settings().secretId;
    if (!id) return null;
    const value = this.app.secretStorage.getSecret(id);
    if (!value) return null;
    try {
      return validateCredentials(JSON.parse(value));
    } catch {
      return null;
    }
  }
  get connected() {
    return !!this.credentials();
  }
  get scope() {
    return this.credentials()?.scope ?? "";
  }
  async exchange(c) {
    return http({ url: "https://oauth2.googleapis.com/token", method: "POST", contentType: "application/x-www-form-urlencoded", body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: "refresh_token" }).toString() });
  }
  async importSetup(token, code) {
    const c = await unseal(token, code), generation = this.generation;
    const r = await this.exchange(c);
    if (generation !== this.generation) throw Error("\u63A5\u7D9A\u8A2D\u5B9A\u304C\u5909\u66F4\u3055\u308C\u307E\u3057\u305F\u3002");
    if (typeof r.json.access_token !== "string" || !r.json.access_token) throw Error("Google\u3078\u306E\u63A5\u7D9A\u78BA\u8A8D\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002");
    const expires = Number(r.json.expires_in);
    if (!Number.isFinite(expires) || expires <= 0) throw Error("Google\u306E\u6709\u52B9\u671F\u9650\u304C\u4E0D\u6B63\u3067\u3059\u3002");
    if (r.json.refresh_token) c.refreshToken = r.json.refresh_token;
    validateCredentials(c);
    this.generation++;
    this.app.secretStorage.setSecret(this.settings().secretId, JSON.stringify(c));
    this.access = r.json.access_token;
    this.expires = Date.now() + expires * 1e3 - 6e4;
  }
  async token() {
    if (this.access && Date.now() < this.expires) return this.access;
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.refresh();
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = void 0;
    }
  }
  async refresh() {
    const c = this.credentials(), generation = this.generation;
    if (!c) throw Error("Windows\u3067Google\u8A8D\u8A3C\u3057\u3001\u63A5\u7D9A\u8A2D\u5B9A\u3092\u53D6\u308A\u8FBC\u3093\u3067\u304F\u3060\u3055\u3044\u3002");
    const r = await this.exchange(c);
    if (generation !== this.generation) throw Error("\u63A5\u7D9A\u8A2D\u5B9A\u304C\u5909\u66F4\u3055\u308C\u307E\u3057\u305F\u3002\u518D\u540C\u671F\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    if (typeof r.json.access_token !== "string" || !r.json.access_token) throw Error("Google\u63A5\u7D9A\u3092\u66F4\u65B0\u3067\u304D\u307E\u305B\u3093\u3002\u518D\u8A8D\u8A3C\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    if (r.json.refresh_token) {
      c.refreshToken = r.json.refresh_token;
      validateCredentials(c);
      this.app.secretStorage.setSecret(this.settings().secretId, JSON.stringify(c));
    }
    this.access = r.json.access_token;
    this.expires = Date.now() + (Number(r.json.expires_in) || 3600) * 1e3 - 6e4;
    return this.access;
  }
  invalidate() {
    this.access = "";
    this.expires = 0;
  }
  async disconnect() {
    const c = this.credentials();
    this.generation++;
    this.invalidate();
    this.app.secretStorage.setSecret(this.settings().secretId, "");
    if (c) await http({ url: "https://oauth2.googleapis.com/revoke", method: "POST", contentType: "application/x-www-form-urlencoded", body: new URLSearchParams({ token: c.refreshToken }).toString() }, false);
  }
};

// src/model.ts
var defaults = { root: "", auto: false, minutes: 1, startup: false, delay: 1, maxMB: 1, backupConfirmed: false, secretId: "" };
function loadSettings(value) {
  const v = value && typeof value === "object" ? value : {};
  const s = { ...defaults };
  for (const k of ["auto", "startup", "backupConfirmed"]) if (typeof v[k] === "boolean") s[k] = v[k];
  for (const [k, min, max, integer] of [["minutes", 1, 10080, true], ["delay", 0, 3600, true], ["maxMB", 0.01, 100, false]]) {
    const n = v[k];
    if (typeof n === "number" && Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n))) s[k] = n;
  }
  if (typeof v.root === "string" && v.root.length <= 256) s.root = v.root.trim();
  if (typeof v.secretId === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v.secretId)) s.secretId = v.secretId;
  return s;
}
var emptyState = (root = "") => ({ root, base: /* @__PURE__ */ Object.create(null), conflicts: /* @__PURE__ */ Object.create(null), history: [] });
async function hash(data) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), (b) => b.toString(16).padStart(2, "0")).join("");
}
function random() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
}
function safePath(path) {
  return path.length > 0 && path.length <= 220 && path.split("/").every((p) => !!p && !p.startsWith(".") && p !== "AI Drive Sync" && !/[\\<>:"|?*\u0000-\u001f]/.test(p) && !/[. ]$/.test(p) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));
}
function validatePaths(paths) {
  const seen = /* @__PURE__ */ new Set();
  for (const p of paths) {
    if (!safePath(p)) throw new Error("\u4E92\u63DB\u6027\u306E\u306A\u3044\u30D1\u30B9\u3092\u691C\u51FA\u3057\u307E\u3057\u305F\u3002\u540D\u524D\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    const key2 = p.normalize("NFC").toLowerCase();
    if (seen.has(key2)) throw new Error("\u540C\u540D\u307E\u305F\u306F\u5927\u5C0F\u6587\u5B57\u30FBUnicode\u306E\u885D\u7A81\u304C\u3042\u308A\u307E\u3059\u3002\u540C\u671F\u3092\u505C\u6B62\u3057\u307E\u3057\u305F\u3002");
    seen.add(key2);
  }
  for (const p of paths) {
    const parts = p.split("/");
    parts.pop();
    while (parts.length) {
      if (seen.has(parts.join("/").normalize("NFC").toLowerCase())) throw new Error("\u30D5\u30A1\u30A4\u30EB\u3068\u30D5\u30A9\u30EB\u30C0\u306E\u885D\u7A81\u304C\u3042\u308A\u307E\u3059\u3002");
      parts.pop();
    }
  }
}

// src/drive.ts
var API = "https://www.googleapis.com/drive/v3/files";
var FOLDER = "application/vnd.google-apps.folder";
var fields = "id,name,mimeType,version,size,trashed";
var escape = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
var Drive = class {
  constructor(auth, root) {
    this.auth = auth;
    this.root = root;
    this.folders.set("", root);
  }
  folders = /* @__PURE__ */ new Map();
  async request(req, retry = true) {
    for (let n = 0; ; n++) {
      try {
        return await http({ ...req, headers: { ...req.headers, Authorization: "Bearer " + await this.auth.token() } }, retry);
      } catch (e) {
        if (e instanceof HttpError && e.status === 401 && n === 0) {
          this.auth.invalidate();
          continue;
        }
        throw e;
      }
    }
  }
  async children(parent) {
    const result = [];
    let page = "";
    do {
      const q = new URLSearchParams({ q: `'${escape(parent)}' in parents and trashed = false`, fields: `nextPageToken,files(${fields})`, pageSize: "1000" });
      if (page) q.set("pageToken", page);
      const r = await this.request({ url: API + "?" + q });
      result.push(...r.json.files);
      page = r.json.nextPageToken ?? "";
    } while (page);
    return result;
  }
  async roots() {
    const result = [];
    let page = "";
    do {
      const q = new URLSearchParams({ q: `mimeType = '${FOLDER}' and trashed = false and 'me' in owners`, fields: "nextPageToken,files(id,name)", pageSize: "1000" });
      if (page) q.set("pageToken", page);
      const r = await this.request({ url: API + "?" + q });
      result.push(...r.json.files);
      page = r.json.nextPageToken ?? "";
    } while (page);
    return result;
  }
  async createRoot(name) {
    const r = await this.request({ url: API, method: "POST", contentType: "application/json", body: JSON.stringify({ name, mimeType: FOLDER }) }, false);
    return r.json.id;
  }
  async list() {
    const root = await this.request({ url: API + "/" + encodeURIComponent(this.root) + "?fields=mimeType,trashed" });
    if (root.json.mimeType !== FOLDER || root.json.trashed) throw new Error("\u540C\u671F\u5148\u304C\u6709\u52B9\u306A\u901A\u5E38\u30D5\u30A9\u30EB\u30C0\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002");
    const result = [];
    this.folders = /* @__PURE__ */ new Map([["", this.root]]);
    const visited = /* @__PURE__ */ new Set();
    const walk = async (id, prefix) => {
      if (visited.has(id)) throw new Error("Drive\u30D5\u30A9\u30EB\u30C0\u306E\u5FAA\u74B0\u3092\u691C\u51FA\u3057\u307E\u3057\u305F\u3002");
      visited.add(id);
      const siblings = await this.children(id), names = /* @__PURE__ */ new Set();
      for (const f of siblings) {
        if (f.name.startsWith(".") || f.name === "AI Drive Sync") continue;
        const path = prefix + f.name;
        if (!safePath(path)) throw new Error("Drive\u306B\u4E92\u63DB\u6027\u306E\u306A\u3044\u30D5\u30A1\u30A4\u30EB\u540D\u304C\u3042\u308A\u307E\u3059\u3002");
        const key2 = f.name.normalize("NFC").toLowerCase();
        if (names.has(key2)) throw new Error("Drive\u306B\u91CD\u8907\u540D\u304C\u3042\u308A\u307E\u3059\u3002\u540C\u671F\u3092\u505C\u6B62\u3057\u307E\u3057\u305F\u3002");
        names.add(key2);
        if (f.mimeType === FOLDER) {
          this.folders.set(path, f.id);
          await walk(f.id, path + "/");
        } else if (f.mimeType.startsWith("application/vnd.google-apps.")) throw new Error("Google Docs\u5F62\u5F0F\u30FB\u30B7\u30E7\u30FC\u30C8\u30AB\u30C3\u30C8\u306F\u5C02\u7528\u540C\u671F\u30D5\u30A9\u30EB\u30C0\u304B\u3089\u79FB\u52D5\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
        else {
          const size = Number(f.size);
          if (!Number.isFinite(size) || size < 0) throw new Error("Drive\u30D5\u30A1\u30A4\u30EB\u5BB9\u91CF\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3002");
          result.push({ path, id: f.id, version: f.version, size });
        }
      }
    };
    await walk(this.root, "");
    return result;
  }
  async fresh(file) {
    const r = await this.request({ url: API + "/" + encodeURIComponent(file.id) + "?fields=" + fields });
    if (r.json.trashed) throw new Error("Drive\u30D5\u30A1\u30A4\u30EB\u304C\u524A\u9664\u3055\u308C\u307E\u3057\u305F\u3002");
    return { ...file, version: r.json.version, size: Number(r.json.size), etag: r.headers.etag ?? r.headers.ETag };
  }
  async read(file) {
    return (await this.request({ url: API + "/" + encodeURIComponent(file.id) + "?alt=media" })).arrayBuffer;
  }
  async generateId() {
    return (await this.request({ url: API + "/generateIds?count=1&space=drive&type=files" })).json.ids[0];
  }
  async parent(path) {
    const parts = path.split("/");
    parts.pop();
    let prefix = "", id = this.root;
    for (const part of parts) {
      prefix = prefix ? prefix + "/" + part : part;
      const cached = this.folders.get(prefix);
      if (cached) {
        id = cached;
        continue;
      }
      const matches = (await this.children(id)).filter((f) => f.name === part);
      if (matches.length > 1 || matches.length === 1 && matches[0].mimeType !== FOLDER) throw new Error("\u30D5\u30A9\u30EB\u30C0\u540D\u304C\u885D\u7A81\u3057\u307E\u3057\u305F\u3002");
      if (matches[0]) id = matches[0].id;
      else id = (await this.request({ url: API, method: "POST", contentType: "application/json", body: JSON.stringify({ name: part, mimeType: FOLDER, parents: [id] }) }, false)).json.id;
      this.folders.set(prefix, id);
    }
    return id;
  }
  async put(path, data, id, existing) {
    const headers = {};
    if (existing) {
      if (!existing.etag) throw new Error("Drive\u306EETag\u304C\u5F97\u3089\u308C\u306A\u3044\u305F\u3081\u5B89\u5168\u306B\u4E0A\u66F8\u304D\u3067\u304D\u307E\u305B\u3093\u3002");
      headers["If-Match"] = existing.etag;
    }
    if (existing) {
      const r2 = await this.request({ url: "https://www.googleapis.com/upload/drive/v3/files/" + encodeURIComponent(id) + "?uploadType=media&fields=" + fields, method: "PATCH", contentType: path.toLowerCase().endsWith(".md") ? "text/markdown" : "application/octet-stream", headers, body: data }, false);
      return { path, id: r2.json.id, version: r2.json.version, size: Number(r2.json.size ?? data.byteLength) };
    }
    const metadata = { id, name: path.split("/").pop(), parents: [await this.parent(path)] };
    const mime = path.toLowerCase().endsWith(".md") ? "text/markdown" : "application/octet-stream";
    headers["X-Upload-Content-Type"] = mime;
    headers["X-Upload-Content-Length"] = String(data.byteLength);
    const start = await this.request({ url: "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=" + fields, method: "POST", contentType: "application/json", headers, body: JSON.stringify(metadata) }, false);
    const location = start.headers.location ?? start.headers.Location;
    if (!location || new URL(location).origin !== "https://www.googleapis.com") throw new Error("\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u5148\u304C\u4E0D\u6B63\u3067\u3059\u3002");
    const r = await this.request({ url: location, method: "PUT", contentType: mime, body: data }, false);
    return { path, id: r.json.id, version: r.json.version, size: Number(r.json.size ?? data.byteLength) };
  }
};

// src/engine.ts
var Engine = class {
  constructor(local, drive, state, save) {
    this.local = local;
    this.drive = drive;
    this.state = state;
    this.save = save;
    state.base = Object.assign(/* @__PURE__ */ Object.create(null), state.base);
    state.conflicts = Object.assign(/* @__PURE__ */ Object.create(null), state.conflicts);
  }
  running = false;
  stopped = false;
  excluded = [];
  held = [];
  localPaths = [];
  remotePaths = [];
  uploaded = 0;
  downloaded = 0;
  async run(limit) {
    if (this.running || this.stopped) return false;
    if (!Number.isFinite(limit) || limit <= 0) throw new Error("\u5BB9\u91CF\u4E0A\u9650\u306E\u8A2D\u5B9A\u304C\u4E0D\u6B63\u3067\u3059\u3002");
    this.running = true;
    try {
      this.excluded = [];
      this.held = [];
      this.localPaths = [];
      this.remotePaths = [];
      this.uploaded = 0;
      this.downloaded = 0;
      const locals = await this.local.list(), remotes = await this.drive.list();
      this.localPaths = locals.map((x) => x.path);
      this.remotePaths = remotes.map((x) => x.path);
      validatePaths(locals.map((x) => x.path));
      validatePaths(remotes.map((x) => x.path));
      validatePaths([.../* @__PURE__ */ new Set([...locals.map((x) => x.path), ...remotes.map((x) => x.path)])]);
      const lm = new Map(locals.map((x) => [x.path, x])), rm = new Map(remotes.map((x) => [x.path, x]));
      for (const path of /* @__PURE__ */ new Set([...lm.keys(), ...rm.keys(), ...Object.keys(this.state.base)])) {
        if (this.stopped) return false;
        const l = lm.get(path), r = rm.get(path), b = this.state.base[path];
        if (l && l.size >= limit || r && r.size >= limit) {
          this.excluded.push(path);
          continue;
        }
        if (b && (!l || !r)) {
          this.held.push(path + "\uFF08\u7247\u5074\u3067\u524A\u9664\u30FB\u79FB\u52D5\uFF09");
          continue;
        }
        const data = l ? await this.local.read(path) : void 0;
        if (l && !data) {
          this.held.push(path);
          continue;
        }
        if (data && data.byteLength >= limit) {
          this.excluded.push(path);
          continue;
        }
        const lh = data ? await hash(data) : void 0;
        if (data && r) {
          if (b && b.remoteId === r.id && b.hash === lh && b.version === r.version) continue;
          const rd = await this.drive.read(r), latest = await this.drive.fresh(r);
          if (latest.version !== r.version) throw new Error("Drive\u3067\u540C\u671F\u4E2D\u306E\u7DE8\u96C6\u3092\u691C\u51FA\u3057\u307E\u3057\u305F\u3002\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
          if (rd.byteLength >= limit) {
            this.excluded.push(path);
            continue;
          }
          const rh = await hash(rd);
          if (lh === rh) {
            await this.commit(path, lh, latest);
            continue;
          }
          if (b && b.remoteId === r.id && b.version === r.version && lh !== b.hash) {
            await this.intent(path, "upload", r.id);
            await this.local.archive(path, rd, "history");
            const updated = await this.drive.put(path, data, r.id, latest);
            this.uploaded++;
            await this.commit(path, lh, updated);
          } else if (b && b.remoteId === r.id && lh === b.hash && path.toLowerCase().endsWith(".md")) {
            await this.intent(path, "download", r.id);
            await this.local.archive(path, data, "history");
            if (await this.local.replace(path, rd, lh)) {
              this.downloaded++;
              await this.commit(path, rh, latest);
            } else this.held.push(path + "\uFF08\u540C\u671F\u4E2D\u306B\u7DE8\u96C6\uFF09");
          } else {
            const old = this.state.conflicts[path];
            if (old?.localHash === lh && old.version === r.version) continue;
            await this.intent(path, "conflict", r.id);
            const copy = await this.local.archive(path, rd, "conflicts");
            this.state.conflicts[path] = { path, copy, localHash: lh, version: r.version, at: Date.now() };
            this.record(path, "\u7AF6\u5408\u30B3\u30D4\u30FC\u4F5C\u6210");
            delete this.state.journal;
            await this.save();
          }
        } else if (data) {
          const pending = this.state.journal;
          const id = pending?.path === path && pending.kind === "create" && pending.id ? pending.id : await this.drive.generateId();
          await this.intent(path, "create", id);
          const uploaded = await this.drive.put(path, data, id);
          this.uploaded++;
          await this.commit(path, lh, uploaded);
        } else if (r) {
          const rd = await this.drive.read(r), latest = await this.drive.fresh(r);
          if (latest.version !== r.version) throw new Error("Drive\u3067\u540C\u671F\u4E2D\u306E\u7DE8\u96C6\u3092\u691C\u51FA\u3057\u307E\u3057\u305F\u3002");
          if (rd.byteLength >= limit) {
            this.excluded.push(path);
            continue;
          }
          await this.intent(path, "create-local", r.id);
          await this.local.create(path, rd);
          this.downloaded++;
          await this.commit(path, await hash(rd), latest);
        }
      }
      this.state.last = Date.now();
      await this.save();
      return true;
    } finally {
      this.running = false;
    }
  }
  async intent(path, kind, id) {
    this.state.journal = { path, kind, id, at: Date.now() };
    await this.save();
  }
  record(path, action) {
    this.state.history.push({ path, action, at: Date.now() });
    this.state.history = this.state.history.slice(-1e3);
  }
  async commit(path, h, r) {
    this.state.base[path] = { hash: h, remoteId: r.id, version: r.version };
    delete this.state.conflicts[path];
    delete this.state.journal;
    this.record(path, "\u57FA\u6E96\u66F4\u65B0");
    await this.save();
  }
};

// src/local.ts
var import_obsidian2 = require("obsidian");
var Local = class {
  constructor(app) {
    this.app = app;
  }
  async list() {
    return this.app.vault.getFiles().filter((f) => !f.path.split("/").some((p) => p.startsWith(".") || p === "AI Drive Sync")).map((f) => ({ path: f.path, size: f.stat.size }));
  }
  async read(path) {
    const f = this.app.vault.getAbstractFileByPath(path);
    return f instanceof import_obsidian2.TFile ? this.app.vault.readBinary(f) : void 0;
  }
  async parents(path) {
    const parts = path.split("/");
    parts.pop();
    let p = "";
    for (const part of parts) {
      p = p ? p + "/" + part : part;
      if (!this.app.vault.getAbstractFileByPath(p)) await this.app.vault.createFolder(p);
    }
  }
  async create(path, data) {
    await this.parents(path);
    await this.app.vault.createBinary(path, data);
  }
  async replace(path, data, expectedHash) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof import_obsidian2.TFile) || !path.toLowerCase().endsWith(".md")) return false;
    const original = await this.app.vault.read(f);
    if (await hash(new TextEncoder().encode(original).buffer) !== expectedHash) return false;
    const next = new TextDecoder("utf-8", { fatal: true }).decode(data);
    let changed = false;
    await this.app.vault.process(f, (current) => {
      if (current !== original) return current;
      changed = true;
      return next;
    });
    return changed;
  }
  async archive(path, data, category) {
    const dest = `AI Drive Sync/${category}/${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}-${random().slice(0, 10)}/${path}`;
    await this.create(dest, data);
    return dest;
  }
};

// src/main.ts
var DriveSync = class extends import_obsidian3.Plugin {
  settings = { ...defaults };
  state = emptyState();
  auth;
  engine;
  status = "\u672A\u540C\u671F";
  ready = false;
  unloaded = false;
  authBusy = false;
  timer;
  startupTimer;
  saveQueue = Promise.resolve();
  syncing = false;
  startupPending = false;
  async onload() {
    const saved = await this.loadData();
    this.settings = loadSettings(saved?.settings);
    this.state = saved?.state ?? emptyState();
    if (!this.settings.secretId) this.settings.secretId = "ai-drive-" + random().slice(0, 24);
    if (!this.app.secretStorage) {
      new import_obsidian3.Notice("Drive Sync\u306B\u306FObsidian 1.11.4\u4EE5\u4E0A\u304C\u5FC5\u8981\u3067\u3059\u3002");
      return;
    }
    this.auth = new Auth(this.app, () => this.settings);
    await this.persist();
    this.addSettingTab(new SyncSettings(this.app, this));
    this.addCommand({ id: "sync", name: "\u4ECA\u3059\u3050\u540C\u671F", callback: () => void this.sync() });
    this.addRibbonIcon("refresh-cw", "Google Drive\u3068\u540C\u671F", () => void this.sync());
    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.visibilityState === "visible") {
        this.schedule();
        if (this.settings.auto) void this.sync();
      }
    });
    this.app.workspace.onLayoutReady(() => {
      this.ready = true;
      this.schedule();
      this.startupPending = this.settings.startup;
      this.startup();
    });
  }
  persist() {
    const snapshot = JSON.parse(JSON.stringify({ settings: this.settings, state: this.state }));
    const next = this.saveQueue.catch(() => {
    }).then(() => this.saveData(snapshot));
    this.saveQueue = next;
    return next;
  }
  schedule() {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = void 0;
    if (this.settings.auto && !this.unloaded) this.timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void this.sync();
    }, Math.max(1, this.settings.minutes) * 6e4);
  }
  startup() {
    if (!this.startupPending || !this.ready || !this.auth.connected || !this.settings.root || this.unloaded) return;
    this.startupPending = false;
    this.startupTimer = window.setTimeout(() => {
      this.startupTimer = void 0;
      void this.sync();
    }, Math.max(0, this.settings.delay) * 1e3);
  }
  cancelStartup() {
    this.startupPending = false;
    if (this.startupTimer) window.clearTimeout(this.startupTimer);
    this.startupTimer = void 0;
  }
  async sync() {
    if (this.syncing || this.authBusy || this.unloaded) return;
    if (!this.ready || !this.auth.connected || !this.settings.root || !this.settings.backupConfirmed) {
      this.status = "\u63A5\u7D9A\u30FB\u540C\u671F\u5148\u30FB\u30D0\u30C3\u30AF\u30A2\u30C3\u30D7\u78BA\u8A8D\u304C\u5FC5\u8981\u3067\u3059";
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      this.status = "\u30AA\u30D5\u30E9\u30A4\u30F3\uFF1A\u6B21\u56DE\u540C\u671F\u3067\u518D\u8A66\u884C";
      return;
    }
    this.syncing = true;
    this.status = "\u540C\u671F\u4E2D\u2026";
    try {
      if (this.state.root !== this.settings.root) {
        this.state = emptyState(this.settings.root);
        await this.persist();
      }
      this.engine = new Engine(new Local(this.app), new Drive(this.auth, this.settings.root), this.state, () => this.persist());
      const done = await this.engine.run(this.settings.maxMB * 1024 * 1024);
      this.status = done ? `\u540C\u671F\u5B8C\u4E86\uFF08Drive\u691C\u51FA ${this.engine.remotePaths.length}\u3001\u53D6\u5F97 ${this.engine.downloaded}\u3001\u9001\u4FE1 ${this.engine.uploaded}\u3001\u9664\u5916 ${this.engine.excluded.length}\u3001\u4FDD\u7559 ${this.engine.held.length}\u3001\u7AF6\u5408 ${Object.keys(this.state.conflicts).length}\uFF09` : "\u540C\u671F\u3092\u505C\u6B62\u3057\u307E\u3057\u305F";
      if (done && this.auth.scope === FILE_SCOPE) this.status += " \u26A0 \u5236\u9650\u4ED8\u304D\u6A29\u9650\uFF1AWindows\u3067\u65B0\u898F\u4F5C\u6210\u3057\u305F\u30D5\u30A1\u30A4\u30EB\u306F\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3002Windows\u306E\u8A8D\u8A3C\u30C4\u30FC\u30EB\u3067\u63A8\u5968\u6A29\u9650\u3092\u9078\u3073\u3001\u63A5\u7D9A\u8A2D\u5B9A\u3092\u53D6\u308A\u8FBC\u307F\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
    } catch (e) {
      this.status = e instanceof Error ? e.message : "\u540C\u671F\u30A8\u30E9\u30FC";
      new import_obsidian3.Notice(this.status);
    } finally {
      this.syncing = false;
    }
  }
  get busy() {
    return this.syncing || this.authBusy;
  }
  onunload() {
    this.unloaded = true;
    if (this.engine) this.engine.stopped = true;
    if (this.timer) window.clearInterval(this.timer);
    if (this.startupTimer) window.clearTimeout(this.startupTimer);
  }
};
var SyncSettings = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const c = this.containerEl, p = this.plugin, s = p.settings;
    c.empty();
    c.createEl("h2", { text: "Drive Sync\uFF08\u5B9F\u9A13\u7248\uFF09" });
    c.createEl("p", { text: "\u6700\u521D\u306F\u30C6\u30B9\u30C8\u4FDD\u7BA1\u5EAB\u3067\u691C\u8A3C\u3057\u3066\u304F\u3060\u3055\u3044\u3002iCloud\u3068\u306E\u4E8C\u91CD\u540C\u671F\u306F\u907F\u3051\u3066\u304F\u3060\u3055\u3044\u3002\u8A2D\u5B9A\u5909\u66F4\u306F\u540C\u671F\u505C\u6B62\u4E2D\u306B\u884C\u3063\u3066\u304F\u3060\u3055\u3044\u3002" });
    const action = (name, label, fn) => new import_obsidian3.Setting(c).setName(name).addButton((b) => b.setButtonText(label).setDisabled(p.busy).onClick(async () => {
      if (p.busy) return;
      b.setDisabled(true);
      try {
        await fn();
      } catch (e) {
        new import_obsidian3.Notice(e instanceof Error ? e.message : "\u64CD\u4F5C\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002");
      } finally {
        this.display();
      }
    }));
    const text = (name, value, save, desc = "") => new import_obsidian3.Setting(c).setName(name).setDesc(desc).addText((t) => t.setValue(value).setDisabled(p.busy).onChange(async (v) => {
      if (p.busy) return;
      save(v.trim());
      await p.persist();
    }));
    new import_obsidian3.Setting(c).setName("Google\u30A2\u30AB\u30A6\u30F3\u30C8").setDesc(p.auth.connected ? "\u63A5\u7D9A\u6E08\u307F\uFF08Google\u3078\u76F4\u63A5\u63A5\u7D9A\uFF09" : "\u672A\u63A5\u7D9A\u3002Windows\u3067\u540C\u68B1\u306Egoogle-auth-helper.mjs\u3092\u5B9F\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    action("Google\u63A5\u7D9A\u30FB\u518D\u8A8D\u8A3C", "Windows\u306E\u63A5\u7D9A\u8A2D\u5B9A\u3092\u53D6\u308A\u8FBC\u3080", async () => {
      new ImportSetup(this.app, p, () => this.display()).open();
    });
    if (p.auth.connected) new import_obsidian3.Setting(c).setName("\u8A31\u53EF\u3057\u305FDrive\u6A29\u9650").setDesc(p.auth.scope === FILE_SCOPE ? "\u26A0 \u518D\u8A8D\u8A3C\u304C\u5FC5\u8981\uFF1AWindows\u3067\u65B0\u898F\u4F5C\u6210\u3057\u305F\u30CE\u30FC\u30C8\u306F\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3002\u6700\u65B0\u7248\u306EWindows\u8A8D\u8A3C\u30C4\u30FC\u30EB\u3067\u300C\u63A8\u5968\u300D\u3092\u9078\u3073\u3001\u65B0\u3057\u3044\u63A5\u7D9A\u8A2D\u5B9A\u3092\u53D6\u308A\u8FBC\u3093\u3067\u304F\u3060\u3055\u3044\u3002\u63A5\u7D9A\u89E3\u9664\u30FB\u540C\u671F\u5148\u306E\u4F5C\u308A\u76F4\u3057\u306F\u4E0D\u8981\u3067\u3059\u3002" : "Windows\u65B0\u898F\u30D5\u30A1\u30A4\u30EB\u5BFE\u5FDC\uFF1ADrive\u5168\u4F53\u306E\u8AAD\u307F\u66F8\u304D\u6A29\u9650\u3002\u540C\u671F\u51E6\u7406\u306F\u9078\u3093\u3060\u30D5\u30A9\u30EB\u30C0\u5185\u306E\u307F\u3067\u3059\u3002");
    action("Google\u30A2\u30AB\u30A6\u30F3\u30C8\u63A5\u7D9A\u89E3\u9664", "\u89E3\u9664\u30FBGoogle\u306E\u8A31\u53EF\u3092\u5931\u52B9", async () => {
      p.authBusy = true;
      try {
        await p.auth.disconnect();
        p.status = "\u63A5\u7D9A\u89E3\u9664\u6E08\u307F";
      } finally {
        p.authBusy = false;
      }
    });
    action("\u540C\u671F\u5148\u30D5\u30A9\u30EB\u30C0\u4E00\u89A7", "\u53D6\u5F97", async () => {
      const folders = await new Drive(p.auth, s.root).roots();
      this.folderOptions = folders;
    });
    if (this.folderOptions) new import_obsidian3.Setting(c).setName("\u540C\u671F\u5148\u30D5\u30A9\u30EB\u30C0\u9078\u629E").addDropdown((d) => {
      d.addOption("", "\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044");
      for (const f of this.folderOptions) d.addOption(f.id, f.name + " [" + f.id + "]");
      d.setValue(s.root).setDisabled(p.busy).onChange(async (id) => {
        if (id && !p.busy) {
          s.root = id;
          await p.persist();
          p.startup();
        }
      });
    });
    action("\u65B0\u3057\u3044\u5C02\u7528\u30D5\u30A9\u30EB\u30C0", "Drive Sync Vault\u3092\u4F5C\u6210", async () => {
      s.root = await new Drive(p.auth, "").createRoot("Drive Sync Vault");
      await p.persist();
    });
    text("\u540C\u671F\u5148\u30D5\u30A9\u30EB\u30C0ID", s.root, (v) => {
      s.root = v;
    }, "drive.file\u3067\u306F\u30A2\u30AF\u30BB\u30B9\u3092\u8A31\u53EF\u3055\u308C\u305F\u30D5\u30A9\u30EB\u30C0\u306E\u307F\u3002\u5207\u66FF\u6642\u306F\u540C\u671F\u57FA\u6E96\u304C\u30EA\u30BB\u30C3\u30C8\u3055\u308C\u307E\u3059\u3002");
    const toggle = (name, key2, desc = "") => new import_obsidian3.Setting(c).setName(name).setDesc(desc).addToggle((t) => t.setValue(s[key2]).setDisabled(p.busy).onChange(async (v) => {
      if (p.busy) return;
      s[key2] = v;
      await p.persist();
      p.schedule();
      if (key2 === "startup" && !v) {
        this.plugin.cancelStartup();
      }
    }));
    toggle("\u30D0\u30C3\u30AF\u30A2\u30C3\u30D7\u3092\u4F5C\u6210\u6E08\u307F", "backupConfirmed", "\u5B9F\u4FDD\u7BA1\u5EAB\u3068\u306F\u5225\u306E\u30B3\u30D4\u30FC\u3092\u4FDD\u5B58\u3057\u3066\u304B\u3089ON\u306B\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    toggle("\u81EA\u52D5\u540C\u671F", "auto", "Obsidian\u5B9F\u884C\u4E2D\u306E\u307F\u3002iOS\u30D0\u30C3\u30AF\u30B0\u30E9\u30A6\u30F3\u30C9\u3067\u306E\u5B9A\u523B\u5B9F\u884C\u306F\u4FDD\u8A3C\u3055\u308C\u307E\u305B\u3093\u3002");
    const number = (name, key2, min, max, integer) => new import_obsidian3.Setting(c).setName(name).addText((t) => t.setValue(String(s[key2])).setDisabled(p.busy).onChange(async (v) => {
      const n = Number(v);
      if (!p.busy && v.trim() && Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n))) {
        s[key2] = n;
        await p.persist();
        p.schedule();
      }
    }));
    number("\u540C\u671F\u9593\u9694\uFF08\u5206\uFF09", "minutes", 1, 10080, true);
    toggle("\u8D77\u52D5\u6642\u306B\u540C\u671F", "startup");
    number("\u8D77\u52D5\u5F8C\u306E\u5F85\u6A5F\u6642\u9593\uFF08\u79D2\uFF09", "delay", 0, 3600, true);
    number("\u30D5\u30A1\u30A4\u30EB\u5BB9\u91CF\u4E0A\u9650\uFF08MB\u30FB\u4EE5\u4E0A\u3092\u9664\u5916\uFF09", "maxMB", 0.01, 100, false);
    action("\u624B\u52D5\u540C\u671F", "\u4ECA\u3059\u3050\u540C\u671F", async () => p.sync());
    new import_obsidian3.Setting(c).setName("\u6700\u7D42\u540C\u671F\u65E5\u6642").setDesc(p.state.last ? new Date(p.state.last).toLocaleString() : "\u672A\u5B9F\u884C");
    new import_obsidian3.Setting(c).setName("\u540C\u671F\u72B6\u6CC1\u30FB\u30A8\u30E9\u30FC").setDesc(p.status);
    action("\u8868\u793A\u3092\u66F4\u65B0", "\u66F4\u65B0", async () => {
    });
    const list = (title, items) => {
      c.createEl("h3", { text: title });
      const ul = c.createEl("ul");
      for (const item of items.length ? items : ["\u306A\u3057"]) ul.createEl("li", { text: item });
    };
    list("\u9664\u5916\u30D5\u30A1\u30A4\u30EB\uFF08\u76F4\u8FD1\u5B9F\u884C\uFF09", p.engine?.excluded ?? []);
    list("\u4FDD\u7559\u30D5\u30A1\u30A4\u30EB\uFF08\u76F4\u8FD1\u5B9F\u884C\uFF09", p.engine?.held ?? []);
    list("Drive\u3067\u691C\u51FA\u3057\u305F\u30D5\u30A1\u30A4\u30EB\uFF08\u76F4\u8FD1\u5B9F\u884C\u30FB\u6700\u5927100\u4EF6\uFF09", p.engine?.remotePaths.slice(0, 100) ?? []);
    list("\u540C\u671F\u958B\u59CB\u6642\u306E\u30ED\u30FC\u30AB\u30EB\u30D5\u30A1\u30A4\u30EB\uFF08\u6700\u5927100\u4EF6\uFF09", p.engine?.localPaths.slice(0, 100) ?? []);
    list("\u7AF6\u5408\u30D5\u30A1\u30A4\u30EB", Object.values(p.state.conflicts).map((x) => x.path + " \u2192 " + x.copy));
    c.createEl("p", { text: "\u7AF6\u5408\u306E\u539F\u672C\u306F\u4E21\u5074\u306B\u6B8B\u308A\u307E\u3059\u3002\u5185\u5BB9\u3092\u6BD4\u8F03\u3057\u624B\u52D5\u3067\u540C\u3058\u5185\u5BB9\u306B\u3059\u308B\u3068\u6B21\u56DE\u306B\u89E3\u6D88\u3057\u307E\u3059\u3002\u5C65\u6B74\u306F\u4FDD\u7BA1\u5EAB\u5185 AI Drive Sync/history \u306B\u4FDD\u5B58\u3057\u307E\u3059\u3002" });
  }
  folderOptions;
};
var ImportSetup = class extends import_obsidian3.Modal {
  constructor(app, plugin, refresh) {
    super(app);
    this.plugin = plugin;
    this.refresh = refresh;
  }
  setupToken = "";
  code = "";
  disposed = false;
  onOpen() {
    this.contentEl.createEl("h2", { text: "Windows\u306E\u63A5\u7D9A\u8A2D\u5B9A\u3092\u53D6\u308A\u8FBC\u3080" });
    this.contentEl.createEl("p", { text: "Windows\u306E\u8A8D\u8A3C\u30C4\u30FC\u30EB\u306B\u8868\u793A\u3055\u308C\u305F\u63A5\u7D9A\u8A2D\u5B9A\u3068\u89E3\u9664\u30B3\u30FC\u30C9\u3092\u5165\u529B\u3057\u307E\u3059\u300210\u5206\u4EE5\u5185\u306B\u53D6\u308A\u8FBC\u3093\u3067\u304F\u3060\u3055\u3044\u3002\u8A8D\u8A3C\u60C5\u5831\u3092\u30C1\u30E3\u30C3\u30C8\u306B\u306F\u8CBC\u3089\u306A\u3044\u3067\u304F\u3060\u3055\u3044\u3002" });
    new import_obsidian3.Setting(this.contentEl).setName("\u6697\u53F7\u5316\u3057\u305F\u63A5\u7D9A\u8A2D\u5B9A").addTextArea((t) => {
      t.inputEl.rows = 5;
      t.inputEl.spellcheck = false;
      t.inputEl.autocomplete = "off";
      t.onChange((v) => this.setupToken = v);
    });
    new import_obsidian3.Setting(this.contentEl).setName("\u89E3\u9664\u30B3\u30FC\u30C9\uFF0832\u6841\uFF09").addText((t) => {
      t.inputEl.type = "password";
      t.inputEl.autocomplete = "off";
      t.onChange((v) => this.code = v);
    });
    new import_obsidian3.Setting(this.contentEl).addButton((b) => b.setButtonText("Google\u63A5\u7D9A\u3092\u78BA\u8A8D\u3057\u3066\u53D6\u308A\u8FBC\u3080").setCta().onClick(async () => {
      const p = this.plugin;
      if (p.busy) return;
      p.authBusy = true;
      b.setDisabled(true);
      try {
        await p.auth.importSetup(this.setupToken, this.code);
        p.status = "Google\u30A2\u30AB\u30A6\u30F3\u30C8\u63A5\u7D9A\u6E08\u307F";
        p.startup();
        new import_obsidian3.Notice(p.status);
        this.close();
      } catch (e) {
        new import_obsidian3.Notice(e instanceof Error ? e.message : "\u63A5\u7D9A\u8A2D\u5B9A\u3092\u53D6\u308A\u8FBC\u3081\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
      } finally {
        p.authBusy = false;
        this.refresh();
        if (!this.disposed) b.setDisabled(false);
      }
    }));
  }
  onClose() {
    this.disposed = true;
    this.setupToken = "";
    this.code = "";
    this.contentEl.empty();
  }
};
