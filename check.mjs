const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const testMode = process.env.TEST_MODE === "true";
const THRESHOLD = 500;
const HALF_HOUR = 1800e3;

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "btc-move-alerts/1.0" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function sendTelegram(text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => null);
  if (!data || !data.ok) throw new Error(`telegram send failed: ${JSON.stringify(data)}`);
}

function lastTwoClosed(points) {
  const now = Date.now();
  const closed = points
    .map((c) => ({ t: Number(c.t), close: Number(c.close) }))
    .sort((a, b) => a.t - b.t)
    .filter((c) => c.t + HALF_HOUR <= now + 60000);
  if (closed.length < 2) throw new Error("not enough closed candles");
  return { prev: closed[closed.length - 2], last: closed[closed.length - 1], spanMs: HALF_HOUR };
}

const sources = [
  {
    name: "Kraken",
    async get() {
      const raw = await getJson("https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=30");
      const rows = raw.result && (raw.result.XXBTZUSD || raw.result.XBTUSD);
      if (!Array.isArray(rows)) throw new Error("unexpected kraken payload");
      return lastTwoClosed(rows.map((c) => ({ t: Number(c[0]) * 1000, close: Number(c[4]) })));
    },
  },
  {
    name: "CoinGecko",
    async get() {
      const raw = await getJson("https://api.coingecko.com/api/v3/coins/bitcoin/ohlc?vs_currency=usd&days=1");
      if (!Array.isArray(raw)) throw new Error("unexpected coingecko payload");
      return lastTwoClosed(raw.map((c) => ({ t: Number(c[0]), close: Number(c[4]) })));
    },
  },
  {
    name: "Coinbase 15m",
    async get() {
      const raw = await getJson("https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=900");
      if (!Array.isArray(raw)) throw new Error("unexpected coinbase payload");
      const now = Date.now();
      const closed = raw
        .map((c) => ({ t: Number(c[0]) * 1000, close: Number(c[4]) }))
        .sort((a, b) => a.t - b.t)
        .filter((c) => c.t + 900e3 <= now + 60000);
      if (closed.length < 3) throw new Error("not enough closed 15m candles");
      return { prev: closed[closed.length - 3], last: closed[closed.length - 1], spanMs: 900e3 };
    },
  },
];

async function main() {
  if (testMode) {
    await sendTelegram("Test from your GitHub-cloud BTC watcher: it is live and will alert you on moves of $500 or more, 24/7. No PC needed.");
    console.log("test message sent");
    return;
  }

  let picked = null;
  let lastErr = null;
  for (const source of sources) {
    try {
      const result = await source.get();
      picked = { ...result, source: source.name };
      break;
    } catch (err) {
      lastErr = err;
      console.error(`${source.name} failed: ${err.message}`);
    }
  }
  if (!picked) throw lastErr || new Error("no data source available");

  const delta = picked.last.close - picked.prev.close;
  const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);
  const p = picked.prev.close.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const l = picked.last.close.toLocaleString("en-US", { maximumFractionDigits: 2 });

  if (Math.abs(delta) >= THRESHOLD) {
    const dir = delta > 0 ? "up" : "down";
    await sendTelegram(
      `BTC ${dir} $${Math.abs(delta).toFixed(0)} in 30 min: $${p} -> $${l} (${picked.source} BTC/USD, window ending ${hhmm(picked.last.t + picked.spanMs)} UTC).`
    );
    console.log(`ALERT ${dir} $${delta.toFixed(2)} (${picked.prev.close} -> ${picked.last.close}, ${picked.source})`);
  } else {
    console.log(`ok: 30m move $${delta.toFixed(2)} (${picked.prev.close} -> ${picked.last.close}, ${picked.source})`);
  }
}

main().catch((err) => {
  console.error("error:", err.message);
  process.exit(1);
});
