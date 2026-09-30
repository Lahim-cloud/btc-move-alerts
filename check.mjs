const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const testMode = process.env.TEST_MODE === "true";
const THRESHOLD = 500;

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "btc-move-alerts/1.0" },
    signal: AbortSignal.timeout(15000),
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

async function getCandles30m() {
  const now = Date.now();
  const closed = (rows, tIndex, cIndex) =>
    rows
      .map((c) => ({ t: Number(c[tIndex]), close: Number(c[cIndex]) }))
      .sort((a, b) => a.t - b.t)
      .filter((c) => c.t + 1800e3 <= now + 60000);

  try {
    const raw = await getJson("https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=1800&limit=5");
    return closed(raw, 0, 4);
  } catch (err) {
    console.error(`coinbase candles failed (${err.message}), trying binance`);
    const raw = await getJson("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=30m&limit=5");
    return closed(raw, 0, 4);
  }
}

async function main() {
  if (testMode) {
    await sendTelegram("Test from your GitHub-cloud BTC watcher: it is live and will alert you on moves of $500 or more, 24/7. No PC needed.");
    console.log("test message sent");
    return;
  }

  const candles = await getCandles30m();
  if (candles.length < 2) throw new Error("not enough candle data");
  const prev = candles[candles.length - 2];
  const last = candles[candles.length - 1];
  const delta = last.close - prev.close;
  const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);

  if (Math.abs(delta) >= THRESHOLD) {
    const dir = delta > 0 ? "up" : "down";
    const lastS = last.close.toLocaleString("en-US", { maximumFractionDigits: 2 });
    const prevS = prev.close.toLocaleString("en-US", { maximumFractionDigits: 2 });
    await sendTelegram(
      `BTC ${dir} $${Math.abs(delta).toFixed(0)} in 30 min: $${prevS} -> $${lastS} (Coinbase BTC-USD, ${hhmm(last.t)}-${hhmm(last.t + 1800e3)} UTC).`
    );
    console.log(`ALERT ${dir} $${delta.toFixed(2)} (${prev.close} -> ${last.close})`);
  } else {
    console.log(`ok: 30m move $${delta.toFixed(2)} (${prev.close} -> ${last.close})`);
  }
}

main().catch((err) => {
  console.error("error:", err.message);
  process.exit(1);
});
