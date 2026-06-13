// Proxy na Yahoo Finance – prohlížeč nemůže Yahoo volat přímo kvůli CORS,
// proto požadavky přeposílá tato serverless funkce běžící na Netlify.
//
// quoteSummary (P/E, doporučení, cílová cena, earnings…) navíc vyžaduje
// ověřovací cookie + "crumb" token. Funkce si je sama vyzvedne a cachuje.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// Cache cookie+crumb v paměti funkce (přežije mezi vyvoláními, dokud běží instance)
let CRED = { cookie: null, crumb: null, at: 0 };

async function getCredentials() {
  // Platnost ~30 min
  if (CRED.cookie && CRED.crumb && Date.now() - CRED.at < 30 * 60 * 1000) {
    return CRED;
  }
  // 1) Získej cookie z hlavní stránky
  const r1 = await fetch("https://fc.yahoo.com/", {
    headers: { "User-Agent": UA, "Accept": "text/html" },
    redirect: "manual",
  });
  let cookie = "";
  const sc = r1.headers.get("set-cookie");
  if (sc) cookie = sc.split(",").map(s => s.split(";")[0].trim()).join("; ");

  // Některé regiony vrací cookie přes getcrumb endpoint – zkus i consent-free cestu
  if (!cookie) {
    const r1b = await fetch("https://finance.yahoo.com/", {
      headers: { "User-Agent": UA },
    });
    const sc2 = r1b.headers.get("set-cookie");
    if (sc2) cookie = sc2.split(",").map(s => s.split(";")[0].trim()).join("; ");
  }

  // 2) Vyzvedni crumb pomocí cookie
  let crumb = "";
  const r2 = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, "Cookie": cookie, "Accept": "text/plain" },
  });
  if (r2.ok) crumb = (await r2.text()).trim();

  CRED = { cookie, crumb, at: Date.now() };
  return CRED;
}

async function fetchJson(url, extraHeaders) {
  const res = await fetch(url, { headers: { "User-Agent": UA, ...(extraHeaders || {}) } });
  return res;
}

// In-memory cache odpovědí (přežije mezi vyvoláními, dokud běží instance funkce).
// Šetří Yahoo a brání chybě "Too Many Requests".
const CACHE = new Map();
function cacheGet(key, maxAgeMs) {
  const e = CACHE.get(key);
  if (e && Date.now() - e.at < maxAgeMs) return e.body;
  return null;
}
function cacheSet(key, body) {
  CACHE.set(key, { body, at: Date.now() });
  if (CACHE.size > 200) CACHE.delete(CACHE.keys().next().value);
}

exports.handler = async (event) => {
  const p = event.queryStringParameters || {};

  const respond = (statusCode, body) => ({
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=20",
    },
    body,
  });

  try {
    if (p.endpoint === "chart" && p.symbol) {
      const range = encodeURIComponent(p.range || "1d");
      const interval = encodeURIComponent(p.interval || "5m");
      const events = p.events ? `&events=${encodeURIComponent(p.events)}` : "";
      const pre = p.prepost === "1" ? "&includePrePost=true" : "";
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(p.symbol)}?range=${range}&interval=${interval}${events}${pre}`;
      const ckey = "chart:" + url;
      // Krátká cache na živé kotace (1d), delší na historii
      const maxAge = (p.range || "1d") === "1d" ? 20000 : 6 * 60 * 60 * 1000;
      const cached = cacheGet(ckey, maxAge);
      if (cached) return respond(200, cached);
      const res = await fetchJson(url);
      const body = await res.text();
      if (res.ok && body.startsWith("{")) { cacheSet(ckey, body); return respond(200, body); }
      // Při blokaci (429) nebo chybě vrať poslední známou hodnotu, i starší
      const stale = cacheGet(ckey, Infinity);
      if (stale) return respond(200, stale);
      return respond(res.status, body);
    }

    if (p.endpoint === "search" && p.q) {
      const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(p.q)}&quotesCount=12&newsCount=0`;
      const ckey = "search:" + p.q.toLowerCase();
      const cached = cacheGet(ckey, 60 * 60 * 1000);
      if (cached) return respond(200, cached);
      const res = await fetchJson(url);
      const body = await res.text();
      if (res.ok && body.startsWith("{")) cacheSet(ckey, body);
      return respond(res.status, body);
    }

    if (p.endpoint === "quoteSummary" && p.symbol) {
      const modules =
        p.modules ||
        "price,summaryDetail,defaultKeyStatistics,financialData,calendarEvents,earningsHistory,recommendationTrend";

      const ckey = "summary:" + p.symbol + ":" + modules;
      // Fundamenty se mění zřídka – cache 6 hodin výrazně šetří volání
      const cached = cacheGet(ckey, 6 * 60 * 60 * 1000);
      if (cached) return respond(200, cached);

      const cred = await getCredentials();
      const crumbQ = cred.crumb ? `&crumb=${encodeURIComponent(cred.crumb)}` : "";
      const headers = cred.cookie ? { "Cookie": cred.cookie } : {};

      for (const host of ["query2", "query1"]) {
        const url = `https://${host}.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(p.symbol)}?modules=${encodeURIComponent(modules)}${crumbQ}`;
        let res = await fetchJson(url, headers);
        if (res.ok) {
          const txt = await res.text();
          if (txt.startsWith("{") && !txt.includes('"result":null')) {
            cacheSet(ckey, txt);
            return respond(200, txt);
          }
        }
      }

      const alt = `https://query1.finance.yahoo.com/v6/finance/quoteSummary/${encodeURIComponent(p.symbol)}?modules=${encodeURIComponent(modules)}`;
      const resAlt = await fetchJson(alt, headers);
      const bodyAlt = await resAlt.text();
      if (resAlt.ok && bodyAlt.startsWith("{")) cacheSet(ckey, bodyAlt);
      return respond(resAlt.status, bodyAlt);
    }

    return respond(400, JSON.stringify({ error: "Neplatný požadavek" }));
  } catch (e) {
    return respond(502, JSON.stringify({ error: String(e) }));
  }
};
