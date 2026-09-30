# btc-move-alerts

Sends a Telegram message when BTC-USD touches $500 away from the price of the last alert (both directions) — including moves that spike and retract between checks.

- Runs on GitHub Actions (`.github/workflows/check.yml`), every 30 minutes, 24/7 — no computer needed.
- Logic: an "anchor" price is stored in `state.json`. Each run scans the price candles since the last alert point; if the price touched the anchor ±$500 at any point (even briefly), an alert fires and the anchor steps $500 in that direction. Further steps as the move continues produce further alerts; a full retrace can produce one in the opposite direction.
- Baseline: the first run just records the current price as the anchor.
- Scan granularity adapts to the gap: 5-minute candles up to ~55h, hourly up to 30 days, daily beyond.
- Data: Kraken (spot + candles); fallbacks: Coinbase, CoinGecko.
- Threshold: edit `THRESHOLD` in `check.mjs` (default 500 USD).
- Telegram: sent via the owner's bot; token and chat id live in repository secrets.
- If the scan source is unavailable, that run falls back to a plain spot-price check.
- A daily heartbeat commit keeps GitHub from disabling the schedule after 60 days of inactivity.

Set up by the owner's agent on 2026-09-30.
