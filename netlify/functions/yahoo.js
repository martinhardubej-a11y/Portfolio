// Proxy na Yahoo Finance – prohlížeč nemůže Yahoo volat přímo kvůli CORS,
// proto požadavky přeposílá tato serverless funkce běžící na Netlify.
//
// ZÁMĚRNĚ JEDNODUCHÁ verze: jen ceny, grafy/historie a vyhledávání.
// Žádné cookie/crumb ani fundamenty – to dříve spouštělo blokaci "Too Many Requests".

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";

// Lehká cache odpovědí v paměti funkce – šetří volání Yahoo.
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

  const fetchJson = (url) => fetch(url, { headers: { "User-Agent": UA } });

  try {
    if (p.endpoint === "chart" && p.symbol) {
      const range = encodeURIComponent(p.range || "1d");
      const interval = encodeURIComponent(p.interval || "5m");
      const events = p.events ? `&events=${encodeURIComponent(p.events)}` : "";
      const pre = p.prepost === "1" ? "&includePrePost=true" : "";
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(p.symbol)}?range=${range}&interval=${interval}${events}${pre}`;
      const ckey = "chart:" + url;
      const maxAge = (p.range || "1d") === "1d" ? 20000 : 6 * 60 * 60 * 1000;
      const cached = cacheGet(ckey, maxAge);
      if (cached) return respond(200, cached);
      const res = await fetchJson(url);
      const body = await res.text();
      if (res.ok && body.startsWith("{")) { cacheSet(ckey, body); return respond(200, body); }
      // Při blokaci vrať poslední známou hodnotu, když ji máme
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

    return respond(400, JSON.stringify({ error: "Neplatný požadavek" }));
  } catch (e) {
    return respond(502, JSON.stringify({ error: String(e) }));
  }
};
