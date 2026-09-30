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

async function fetchPath(sinceMs) {
  const now = Date.now();
  const spanMs = now - sinceMs;
  const sinceSec = Math.floor(sinceMs / 1000);
  let lastErr = null;

  try {
    const intervalMin = spanMs <= 55 * 3600e3 ? 5 : spanMs <= 30 * 24 * 3600e3 ? 60 : 1440;
    const j = await getJson(`https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=${intervalMin}&since=${sinceSec}`);
    const rows = j.result && (j.result.XXBTZUSD || j.result.XBTUSD);
    if (!Array.isArray(rows)) throw new Error("unexpected kraken payload");
    return {
      source: "Kraken",
      intervalMs: intervalMin * 60e3,
      points: rows.map((c) => ({ t: Number(c[0]) * 1000, high: Number(c[2]), low: Number(c[3]) })),
    };
  } catch (err) {
    lastErr = err;
    console.error(`kraken scan failed: ${err.message}`);
  }

  try {
    const from = Math.floor(sinceMs / 1000);
    const to = Math.floor(now / 1000);
    const j = await getJson(`https://api.coingecko.com/api/v3/coins/bitcoin/market_chart/range?vs_currency=usd&from=${from}&to=${to}`);
    if (!Array.isArray(j.prices)) throw new Error("unexpected coingecko payload");
    const intervalMs = spanMs > 90 * 24 * 3600e3 ? 24 * 3600e3 : spanMs > 24 * 3600e3 ? 3600e3 : 5 * 60e3;
    return {
      source: "CoinGecko",
      intervalMs,
      points: j.prices.map((p) => ({ t: Number(p[0]), high: Number(p[1]), low: Number(p[1]) })),
    };
  } catch (err) {
    lastErr = err;
    console.error(`coingecko scan failed: ${err.message}`);
  }

  throw lastErr || new Error("no scan source available");
}

function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const t = typeof s.anchorTime === "number" ? s.anchorTime : Date.parse(s.anchorTime);
    return { anchor: Number(s.anchor), anchorTime: Number.isFinite(t) ? t : null };
  } catch {
    return null;
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

const fmt = (n) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);

async function main() {
  if (testMode) {
    await sendTelegram("Test from your GitHub-cloud BTC watcher: it is live and will alert you on moves of $500 or more, 24/7. No PC needed.");
    console.log("test message sent");
    return;
  }

  const { price: spot, source: spotSource } = await getSpot();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const state = readState();

  if (!state || !(state.anchor > 0) || !(state.anchorTime > 0)) {
    writeState({ anchor: spot, anchorTime: now });
    console.log(`baseline saved: anchor $${spot} (${spotSource}) at ${nowIso}`);
    return;
  }

  let anchor = state.anchor;
  let anchorTime = state.anchorTime;
  let alerts = 0;

  try {
    const path = await fetchPath(anchorTime);
    const points = path.points.filter((p) => p.t >= anchorTime);
    for (const p of points) {
      if (alerts >= 20) break;
      if (p.high >= anchor + THRESHOLD) {
        const level = anchor + THRESHOLD;
        const win = `${hhmm(p.t)}-${hhmm(p.t + path.intervalMs)} UTC`;
        await sendTelegram(
          `BTC touched +$${THRESHOLD} from the last alert price: $${fmt(anchor)} -> $${fmt(level)} (high $${fmt(p.high)}, now $${fmt(spot)}) (${path.source} BTC/USD, ${win}).`
        );
        anchor = level;
        anchorTime = p.t + path.intervalMs;
        alerts++;
        continue;
      }
      if (p.low <= anchor - THRESHOLD) {
        const level = anchor - THRESHOLD;
        const win = `${hhmm(p.t)}-${hhmm(p.t + path.intervalMs)} UTC`;
        await sendTelegram(
          `BTC touched -$${THRESHOLD} from the last alert price: $${fmt(anchor)} -> $${fmt(level)} (low $${fmt(p.low)}, now $${fmt(spot)}) (${path.source} BTC/USD, ${win}).`
        );
        anchor = level;
        anchorTime = p.t + path.intervalMs;
        alerts++;
      }
    }

    if (alerts > 0) {
      writeState({ anchor, anchorTime });
      console.log(`ALERT x${alerts}, new anchor $${anchor} (${path.source}, ${points.length} points scanned)`);
    } else {
      console.log(`ok: no $${THRESHOLD} touch since ${new Date(state.anchorTime).toISOString()}; spot $${spot} vs anchor $${anchor} (${spotSource}, ${points.length} points scanned)`);
    }
  } catch (err) {
    console.error(`scan failed (${err.message}); falling back to spot check`);
    const delta = spot - anchor;
    if (Math.abs(delta) >= THRESHOLD) {
      const dir = delta > 0 ? "up" : "down";
      await sendTelegram(
        `BTC ${dir} $${Math.abs(delta).toFixed(0)} from the last alert price: $${fmt(anchor)} -> $${fmt(spot)} (${spotSource} BTC/USD, ${nowIso}).`
      );
      writeState({ anchor: spot, anchorTime: now });
      console.log(`ALERT (fallback) ${dir} $${delta.toFixed(2)}`);
    } else {
      console.log(`ok (fallback): $${spot} vs anchor $${anchor} (delta ${delta.toFixed(2)})`);
    }
  }
}

main().catch((err) => {
  console.error("error:", err.message);
  process.exit(1);
});
