import fs from "node:fs";

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const testMode = process.env.TEST_MODE === "true";
const dryRun = process.env.DRY_RUN === "true";
const THRESHOLD = 500;
const STATE_FILE = "state.json";

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "btc-move-alerts/1.0" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function sendTelegram(text) {
  if (dryRun) {
    console.log(`[dry] ${text}`);
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => null);
  if (!data || !data.ok) throw new Error(`telegram send failed: ${JSON.stringify(data)}`);
}

async function getSpot() {
  const sources = [
    ["Kraken", async () => {
      const j = await getJson("https://api.kraken.com/0/public/Ticker?pair=XBTUSD");
      const v = Number((j.result?.XXBTZUSD || j.result?.XBTUSD)?.c?.[0]);
      if (v > 0) return v;
      throw new Error("unexpected kraken payload");
    }],
    ["Coinbase", async () => {
      const j = await getJson("https://api.coinbase.com/v2/prices/BTC-USD/spot");
      const v = Number(j.data?.amount);
      if (v > 0) return v;
      throw new Error("unexpected coinbase payload");
    }],
    ["CoinGecko", async () => {
      const j = await getJson("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd");
      const v = Number(j.bitcoin?.usd);
      if (v > 0) return v;
      throw new Error("unexpected coingecko payload");
    }],
  ];
  let lastErr = null;
  for (const [name, load] of sources) {
    try {
      return { price: await load(), source: name };
    } catch (err) {
      lastErr = err;
      console.error(`${name} failed: ${err.message}`);
    }
  }
  throw lastErr || new Error("no price source available");
}

function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return { anchor: Number(s.anchor), anchorTime: s.anchorTime || null };
  } catch {
    return null;
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

async function main() {
  if (testMode) {
    await sendTelegram("Test from your GitHub-cloud BTC watcher: it is live and will alert you on moves of $500 or more, 24/7. No PC needed.");
    console.log("test message sent");
    return;
  }

  const { price, source } = await getSpot();
  const now = new Date().toISOString();
  const state = readState();

  if (!state || !(state.anchor > 0)) {
    writeState({ anchor: price, anchorTime: now });
    console.log(`baseline saved: anchor $${price} (${source}) at ${now}`);
    return;
  }

  const delta = price - state.anchor;
  if (Math.abs(delta) >= THRESHOLD) {
    const dir = delta > 0 ? "up" : "down";
    const anchorS = state.anchor.toLocaleString("en-US", { maximumFractionDigits: 2 });
    const priceS = price.toLocaleString("en-US", { maximumFractionDigits: 2 });
    await sendTelegram(
      `BTC ${dir} $${Math.abs(delta).toFixed(0)} from the last alert price: $${anchorS} -> $${priceS} (${source} BTC/USD, ${now}).`
    );
    writeState({ anchor: price, anchorTime: now });
    console.log(`ALERT ${dir} $${delta.toFixed(2)} (anchor ${state.anchor} -> ${price}, ${source})`);
  } else {
    console.log(`ok: $${price} vs anchor $${state.anchor} (delta ${delta.toFixed(2)}, ${source})`);
  }
}

main().catch((err) => {
  console.error("error:", err.message);
  process.exit(1);
});
