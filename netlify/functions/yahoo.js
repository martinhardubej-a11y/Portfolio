// Proxy na Yahoo Finance – prohlížeč nemůže Yahoo volat přímo kvůli CORS,
// proto požadavky přeposílá tato serverless funkce běžící na Netlify.

exports.handler = async (event) => {
  const p = event.queryStringParameters || {};
  let url;

  if (p.endpoint === "chart" && p.symbol) {
    const range = encodeURIComponent(p.range || "1d");
    const interval = encodeURIComponent(p.interval || "5m");
    const events = p.events ? `&events=${encodeURIComponent(p.events)}` : "";
    url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(p.symbol)}?range=${range}&interval=${interval}${events}`;
  } else if (p.endpoint === "search" && p.q) {
    url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(p.q)}&quotesCount=12&newsCount=0`;
  } else {
    return { statusCode: 400, body: JSON.stringify({ error: "Neplatný požadavek" }) };
  }

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      },
    });
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
