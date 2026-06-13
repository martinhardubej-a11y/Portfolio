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

exports.handler = async (event) => {
  const p = event.queryStringParameters || {};

  const respond = (statusCode, body) => ({
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=10",
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
      const res = await fetchJson(url);
      return respond(res.status, await res.text());
    }

    if (p.endpoint === "search" && p.q) {
      const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(p.q)}&quotesCount=12&newsCount=0`;
      const res = await fetchJson(url);
      return respond(res.status, await res.text());
    }

    if (p.endpoint === "quoteSummary" && p.symbol) {
      const modules =
        p.modules ||
        "price,summaryDetail,defaultKeyStatistics,financialData,calendarEvents,earningsHistory,recommendationTrend";

      // Pokus 1: starý v10 host s cookie+crumb
      const cred = await getCredentials();
      const crumbQ = cred.crumb ? `&crumb=${encodeURIComponent(cred.crumb)}` : "";
      const headers = cred.cookie ? { "Cookie": cred.cookie } : {};

      for (const host of ["query2", "query1"]) {
        const url = `https://${host}.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(p.symbol)}?modules=${encodeURIComponent(modules)}${crumbQ}`;
        let res = await fetchJson(url, headers);
        if (res.ok) {
          const txt = await res.text();
          // Ověř, že to není chybová obálka
          if (!txt.includes('"quoteSummary":{"result":null')) return respond(200, txt);
        }
      }

      // Pokus 2 (záloha): nový endpoint quoteSummary přes k-v API bez crumb
      const alt = `https://query1.finance.yahoo.com/v6/finance/quoteSummary/${encodeURIComponent(p.symbol)}?modules=${encodeURIComponent(modules)}`;
      const resAlt = await fetchJson(alt, headers);
      return respond(resAlt.status, await resAlt.text());
    }

    return respond(400, JSON.stringify({ error: "Neplatný požadavek" }));
  } catch (e) {
    return respond(502, JSON.stringify({ error: String(e) }));
  }
};
