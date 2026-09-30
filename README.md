# btc-move-alerts

Sends a Telegram message when BTC-USD moves $500 or more away from the price of the last alert (both directions).

- Runs on GitHub Actions (`.github/workflows/check.yml`), every 30 minutes, 24/7 — no computer needed.
- Logic: an "anchor" price is stored in `state.json`. An alert fires when spot is ±$500 from the anchor, then the anchor is re-based to the price at the alert. Slow drifts that accumulate $500 are caught, and each $500 of travel produces one alert.
- Baseline: the first run just records the current price as the anchor.
- Data: Kraken spot (fallbacks: Coinbase, CoinGecko).
- Threshold: edit `THRESHOLD` in `check.mjs` (default 500 USD).
- Telegram: sent via the owner's bot; token and chat id live in repository secrets.
- A daily heartbeat commit keeps GitHub from disabling the schedule after 60 days of inactivity.

Set up by the owner's agent on 2026-09-30.
