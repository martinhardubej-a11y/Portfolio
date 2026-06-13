// Proxy na Yahoo Finance – prohlížeč nemůže Yahoo volat přímo kvůli CORS,
// proto požadavky přeposílá tato serverless funkce běžící na Netlify.

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";

exports.handler = async (event) => {
  const p = event.queryStringParameters || {};
  let url;

  if (p.endpoint === "chart" && p.symbol) {
    const range = encodeURIComponent(p.range || "1d");
    const interval = encodeURIComponent(p.interval || "5m");
    const events = p.events ? `&events=${encodeURIComponent(p.events)}` : "";
    const pre = p.prepost === "1" ? "&includePrePost=true" : "";
    url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(p.symbol)}?range=${range}&interval=${interval}${events}${pre}`;
  } else if (p.endpoint === "search" && p.q) {
    url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(p.q)}&quotesCount=12&newsCount=0`;
  } else if (p.endpoint === "quoteSummary" && p.symbol) {
    // Detailní fundamenty: P/E, 52t rozpětí, doporučení, earnings, pre/post cena
    const modules =
      p.modules ||
      "price,summaryDetail,defaultKeyStatistics,financialData,calendarEvents,earningsHistory,recommendationTrend";
    url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(p.symbol)}?modules=${encodeURIComponent(modules)}`;
  } else {
    return { statusCode: 400, body: JSON.stringify({ error: "Neplatný požadavek" }) };
  }

  try {
    let res = await fetch(url, { headers: { "User-Agent": UA } });
    // quoteSummary občas vyžaduje crumb/cookie; při 401/403 zkus záložní host
    if (!res.ok && p.endpoint === "quoteSummary") {
      const alt = url.replace("query1", "query2");
      res = await fetch(alt, { headers: { "User-Agent": UA } });
    }
    const body = await res.text();
    return {
      statusCode: res.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=10",
      },
      body,
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: String(e) }) };
  }
};
