# btc-move-alerts

Telegram alerts for BTC-USD, checked every 30 minutes on GitHub Actions (24/7, no computer needed):

1. **Move alerts** — price touches ±$500 from the last alert price (both directions), including spikes that retract between checks. The anchor steps $500 per alert. Details in `check.mjs`.
2. **EMA break alerts** — a closed candle on the **4h / daily / weekly** timeframe closes above or below its **EMA50 / EMA100 / EMA200** (9 series). One alert per crossing; the first observation of each series is a silent baseline.

- Data: Kraken (spot + candles); fallbacks: Coinbase, CoinGecko. Move-scan granularity adapts to the gap (5-min candles up to ~55h, hourly up to 30 days, daily beyond).
- State: `state.json` (move anchor + last alerted crossover per EMA series), committed by the workflow only when it changes.
- Threshold: `THRESHOLD` in `check.mjs` (default 500 USD).
- Telegram: sent via the owner's bot; token and chat id live in repository secrets.
- Failure handling: if a data source is unavailable, move alerts fall back to a spot check; the EMA section is skipped for that run.
- A daily heartbeat commit keeps GitHub from disabling the schedule after 60 days of inactivity.

Set up by the owner's agent on 2026-09-30.
