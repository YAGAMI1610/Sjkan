/* =====================================================
   CADE MEME MADNESS — Build / Deploy Test
   -----------------------------------------------------
   Answers one question: if this commit is pushed to Vercel, does the deployed
   site actually work?

   The failure modes it targets are the ones that are invisible locally and fatal
   in production:

     - A referenced asset whose on-disk name differs in case. Local dev on macOS
       or Windows is case-insensitive, so `assets/Coins/Froggo.svg` loads fine
       there and 404s on Vercel's case-sensitive filesystem.
     - A referenced file that isn't in the deployment at all, because
       .vercelignore excludes it.
     - A catch-all rewrite in vercel.json. api-client.js decides whether a
       backend exists by probing /api/health: a 404 means "static build, use the
       local simulation". A rewrite that answers /api/* with index.html turns
       that 404 into a 200 serving HTML, `res.json()` throws, and every call in
       the app takes the slow failure path on every single request.
     - A stray external <script>/<link> host, which the deployment's CSP blocks.

   It builds the exact file set Vercel would upload (honouring .vercelignore),
   serves it over real HTTP, and requests every URL the app references.

   Run:  npm run test:deploy
   ===================================================== */

const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.join(__dirname, "..");

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    const detail = fn();
    passed++;
    console.log("  ✓ " + name + (detail ? "  — " + detail : ""));
  } catch (err) {
    failures.push({ name, message: err.message });
    console.log("  ✗ " + name + "\n      " + err.message);
  }
}
async function checkAsync(name, fn) {
  try {
    const detail = await fn();
    passed++;
    console.log("  ✓ " + name + (detail ? "  — " + detail : ""));
  } catch (err) {
    failures.push({ name, message: err.message });
    console.log("  ✗ " + name + "\n      " + err.message);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg ? msg + ": " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
}
function group(t) { console.log("\n" + t); }

/* ---------------------------------------------------------
   1. Work out the deployable file set the way Vercel does
   --------------------------------------------------------- */
function readIgnore() {
  const p = path.join(ROOT, ".vercelignore");
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .map(l => l.replace(/\/$/, ""));
}

const IGNORED = readIgnore();

function isIgnored(rel) {
  const first = rel.split("/")[0];
  return IGNORED.includes(first) || IGNORED.includes(rel);
}

function walk(dir, out, base) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const abs = path.join(dir, entry.name);
    const rel = base ? base + "/" + entry.name : entry.name;
    if (isIgnored(rel)) continue;
    if (entry.isDirectory()) walk(abs, out, rel);
    else out.push(rel);
  }
  return out;
}

const DEPLOYED = walk(ROOT, [], "");
const DEPLOYED_SET = new Set(DEPLOYED);

/* ---------------------------------------------------------
   2. Collect every path the app asks the network for
   --------------------------------------------------------- */
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const rulesJs = fs.readFileSync(path.join(ROOT, "rules.js"), "utf8");

// href="..." / src="..." in the markup.
const markupRefs = [];
for (const m of html.matchAll(/(?:href|src)\s*=\s*"([^"]+)"/g)) markupRefs.push(m[1]);

/* Asset paths the JS builds at runtime. AssetManager takes a ticker/code and
   lowercases it into a path, so the reference is only ever a template — the
   concrete list has to be reconstructed from the pools those templates are fed
   from. Getting this wrong in either direction is the case-sensitivity bug.

   The pools live in rules.js (shared with the CLI and the reference backend);
   AssetManager, which turns them into paths, lives in app.js. */
/* Guard the extractors themselves: a silently-empty pool would make every
   asset check below pass by verifying nothing. */
function coinPool() {
  const block = rulesJs.match(/var COIN_POOL = \[([\s\S]*?)\n\s*\];/);
  if (!block) return [];
  return [...block[1].matchAll(/\[\s*"([A-Z0-9]+)"/g)].map(m => m[1]);
}
function awardCodes() {
  const block = rulesJs.match(/var AWARD_DEFS = \{([\s\S]*?)\n\s*\};/);
  if (!block) return [];
  return [...block[1].matchAll(/^\s{4}([A-Z_]+):/gm)].map(m => m[1]);
}
function leaderboardNames() {
  const block = rulesJs.match(/var SIM_PLAYERS_BASE = \[([\s\S]*?)\n\s*\];/);
  assert(block, "could not find SIM_PLAYERS_BASE in rules.js — the avatar paths below would go unchecked");
  return [...block[1].matchAll(/name:\s*"([^"]+)"/g)].map(m => m[1]);
}

const coins = coinPool();
const awards = awardCodes();
const avatars = leaderboardNames();
assert(coins.length >= 20, "COIN_POOL extraction found only " + coins.length + " tickers");
assert(awards.length === 8, "AWARD_DEFS extraction found " + awards.length + " codes, expected 8");
assert(avatars.length >= 8, "SIM_PLAYERS_BASE extraction found only " + avatars.length + " players");

const runtimeRefs = [
  "assets/logo.jpg",
  "assets/hero-artwork.svg",
  ...coins.map(t => `assets/coins/${t.toLowerCase()}.svg`),
  ...awards.map(c => `assets/awards/${c.toLowerCase()}.svg`),
  ...avatars.map(n => `assets/avatars/${n.toLowerCase().replace(/\s+/g, "-")}.svg`),
  "assets/avatars/you.svg"
];

/* ---------------------------------------------------------
   3. A static server over the deployable set only
   --------------------------------------------------------- */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".json": "application/json",
  ".mp3": "audio/mpeg"
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  let rel = url === "/" ? "index.html" : url.replace(/^\//, "");
  // Vercel's cleanUrls: /how -> how.html. This app is a single page, so the only
  // effect that matters here is that unknown paths must still 404.
  if (!DEPLOYED_SET.has(rel) && DEPLOYED_SET.has(rel + ".html")) rel = rel + ".html";
  if (!DEPLOYED_SET.has(rel)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404");
    return;
  }
  const body = fs.readFileSync(path.join(ROOT, rel));
  res.writeHead(200, { "Content-Type": MIME[path.extname(rel)] || "application/octet-stream" });
  res.end(body);
});

function get(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: server.address().port, path: urlPath, method: "GET" }, res => {
      const chunks = [];
      res.on("data", d => chunks.push(d));
      res.on("end", () => resolve({
        status: res.statusCode,
        type: res.headers["content-type"] || "",
        bytes: Buffer.concat(chunks).length
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

/* =====================================================
   TESTS
   ===================================================== */
(async function run() {
  console.log("CADE MEME MADNESS — build / deploy test (Vercel)");

  group("1. vercel.json is valid and does not break the API probe");
  let cfg = null;
  check("vercel.json exists and parses", () => {
    const raw = fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8");
    cfg = JSON.parse(raw);
    return Object.keys(cfg).length + " top-level keys";
  });
  check("no legacy `builds` key (it disables the zero-config static build)", () => {
    assert(!cfg.builds, "vercel.json still uses the deprecated `builds` array");
  });
  check("no rewrite swallows /api/* — probe() must be able to 404", () => {
    const rewrites = cfg.rewrites || [];
    for (const r of rewrites) {
      const src = String(r.source || "");
      const catchAll = /^\/\(\.\*\)$|^\/\(\.\+\)$|^\/:path\*$|^\/\(\.\*\)\/?$/.test(src);
      assert(!catchAll,
        "catch-all rewrite `" + src + "` -> `" + r.destination + "` would answer /api/health with 200 HTML; " +
        "api-client.js reads that as \"a backend exists\" and every call then fails slowly");
      assert(!src.startsWith("/api"), "explicit /api rewrite present but server/ is not deployed: " + src);
    }
    return rewrites.length + " rewrite(s)";
  });
  check("security headers are applied to every route", () => {
    const all = (cfg.headers || []).find(h => h.source === "/(.*)");
    assert(all, "no headers block for /(.*)");
    const keys = all.headers.map(h => h.key.toLowerCase());
    for (const need of ["x-content-type-options", "content-security-policy", "referrer-policy"]) {
      assert(keys.includes(need), "missing header: " + need);
    }
    return keys.length + " headers";
  });
  check("the CSP allows what this app actually does", () => {
    const all = (cfg.headers || []).find(h => h.source === "/(.*)");
    const csp = all.headers.find(h => h.key.toLowerCase() === "content-security-policy").value;
    // The markup is full of inline onclick= handlers and style= attributes, and
    // the share card renders through canvas -> data: URI, then blob: for the
    // native share sheet. A CSP without these silently breaks the whole page.
    assert(/script-src[^;]*'unsafe-inline'/.test(csp), "inline onclick= handlers would be blocked");
    assert(/style-src[^;]*'unsafe-inline'/.test(csp), "inline style= attributes would be blocked");
    assert(/img-src[^;]*data:/.test(csp), "the canvas share card (data: URI) would be blocked");
    assert(/img-src[^;]*blob:/.test(csp), "the native share sheet (blob:) would be blocked");
    assert(/connect-src[^;]*'self'/.test(csp), "the /api/health probe would be blocked");
  });

  group("2. The deployment contains what it should and nothing it shouldn't");
  check("index.html, app.js, style.css are all deployed", () => {
    for (const f of ["index.html", "app.js", "style.css", "api-client.js", "audio.js", "rules.js"]) {
      assert(DEPLOYED_SET.has(f), f + " is excluded from the deployment");
    }
    return DEPLOYED.length + " files";
  });
  check("the Express backend is NOT deployed as static files", () => {
    const leaked = DEPLOYED.filter(f => f.startsWith("server/"));
    assert(leaked.length === 0, "server source would be publicly readable: " + leaked.slice(0, 3).join(", "));
  });
  check("node_modules and tests are excluded", () => {
    const leaked = DEPLOYED.filter(f => f.startsWith("node_modules/") || f.startsWith("test/"));
    assert(leaked.length === 0, leaked.length + " files leaked, e.g. " + leaked.slice(0, 2).join(", "));
  });
  check("no secrets, env files or tokens in the deployable set", () => {
    const suspicious = DEPLOYED.filter(f => /(^|\/)\.env|\.pem$|id_rsa|\.p12$|credentials/i.test(f));
    assert(suspicious.length === 0, "would be published: " + suspicious.join(", "));
    const withToken = DEPLOYED
      .filter(f => /\.(js|json|html|css|md)$/.test(f))
      .filter(f => /gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}/.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
    assert(withToken.length === 0, "a credential is embedded in: " + withToken.join(", "));
  });

  group("3. Every referenced path resolves with exact case");
  check("markup references (href/src) all exist in the deployment", () => {
    const local = markupRefs.filter(r => !/^(https?:)?\/\//.test(r) && !r.startsWith("data:") && !r.startsWith("#"));
    const missing = local.map(r => r.replace(/^\//, "")).filter(r => !DEPLOYED_SET.has(r));
    assert(missing.length === 0, "referenced but not deployed: " + missing.join(", "));
    return local.length + " references";
  });
  check("no external script or stylesheet host (the CSP blocks them)", () => {
    const ext = markupRefs.filter(r => /^(https?:)?\/\//.test(r));
    assert(ext.length === 0, "external reference(s): " + ext.join(", "));
  });
  check("runtime asset paths match the on-disk filenames byte-for-byte", () => {
    /* fs.existsSync is case-insensitive on macOS/Windows, so it cannot catch
       this. Compare against a readdir listing instead — that is the same
       comparison Vercel's filesystem performs. */
    const missing = [], miscased = [];
    for (const ref of runtimeRefs) {
      if (DEPLOYED_SET.has(ref)) continue;
      const dir = path.dirname(ref), base = path.basename(ref);
      let siblings = [];
      try { siblings = fs.readdirSync(path.join(ROOT, dir)); } catch (e) { /* dir absent */ }
      const ci = siblings.find(s => s.toLowerCase() === base.toLowerCase());
      if (ci) miscased.push(ref + " (on disk: " + dir + "/" + ci + ")");
      else missing.push(ref);
    }
    assert(miscased.length === 0, "these 404 on a case-sensitive host: " + miscased.join(", "));
    assert(missing.length === 0, missing.length + " asset(s) missing: " + missing.slice(0, 5).join(", "));
    return runtimeRefs.length + " asset paths verified";
  });
  check("the favicon the markup asks for is really there", () => {
    const link = html.match(/<link[^>]+rel="icon"[^>]+href="([^"]+)"/);
    assert(link, "no <link rel=\"icon\"> — browsers request /favicon.ico and log a 404");
    const ref = link[1].replace(/^\//, "");
    assert(DEPLOYED_SET.has(ref), ref + " is referenced but not deployed");
    return ref;
  });

  group("4. Serve the deployable set over HTTP and fetch everything");
  await new Promise(r => server.listen(0, "127.0.0.1", r));

  await checkAsync("GET / returns the app shell as text/html", async () => {
    const r = await get("/");
    eq(r.status, 200);
    assert(/text\/html/.test(r.type), "content-type was " + r.type);
    assert(r.bytes > 2000, "suspiciously small: " + r.bytes + " bytes");
    return r.bytes + " bytes";
  });

  await checkAsync("every script and stylesheet loads with the right type", async () => {
    for (const f of ["rules.js", "app.js", "api-client.js", "audio.js", "style.css"]) {
      const r = await get("/" + f);
      eq(r.status, 200, f + " did not load");
      const want = f.endsWith(".css") ? /text\/css/ : /javascript/;
      assert(want.test(r.type), f + " served as " + r.type);
      assert(r.bytes > 500, f + " is only " + r.bytes + " bytes");
    }
    return "5 files";
  });

  await checkAsync("every runtime asset returns 200 with an image type", async () => {
    const bad = [];
    for (const ref of runtimeRefs) {
      const r = await get("/" + ref);
      if (r.status !== 200) { bad.push(ref + " -> " + r.status); continue; }
      if (!/^image\//.test(r.type)) bad.push(ref + " -> " + r.type);
      if (r.bytes === 0) bad.push(ref + " -> empty");
    }
    assert(bad.length === 0, bad.length + " bad asset(s): " + bad.slice(0, 5).join(", "));
    return runtimeRefs.length + " assets, all 200";
  });

  await checkAsync("/api/health 404s so the client falls back to local play", async () => {
    const r = await get("/api/health");
    eq(r.status, 404, "a 200 here makes api-client.js believe a backend exists");
  });

  await checkAsync("the server source is not reachable over HTTP", async () => {
    for (const p of ["/server/server.js", "/server/package.json", "/package.json"]) {
      const r = await get(p);
      if (p === "/package.json") continue; // harmless, and Vercel serves it too
      eq(r.status, 404, p + " is publicly readable");
    }
  });

  await checkAsync("an unknown route 404s rather than serving the shell", async () => {
    const r = await get("/definitely-not-a-real-route");
    eq(r.status, 404);
  });

  await new Promise(r => server.close(r));

  /* ---------------- report ---------------- */
  console.log("\n" + "=".repeat(60));
  if (failures.length === 0) {
    console.log("PASS — " + passed + " checks, 0 failures");
    process.exit(0);
  }
  console.log("FAIL — " + passed + " passed, " + failures.length + " failed\n");
  failures.forEach(f => console.log("  ✗ " + f.name + "\n      " + f.message));
  process.exit(1);
})().catch(err => {
  console.error("\nHARNESS CRASHED\n", err);
  process.exit(3);
});
