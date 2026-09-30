# btc-move-alerts

Sends a Telegram message when BTC-USD moves $500 or more within a 30-minute window.

- Runs on GitHub Actions (`.github/workflows/check.yml`), every 30 minutes, 24/7 — no computer needed.
- Data: Coinbase BTC-USD 30-minute candles (Binance fallback).
- Telegram: sent via the owner's bot; token and chat id are stored as repository secrets.
- Threshold: edit `THRESHOLD` in `check.mjs` (default 500 USD).
- A daily heartbeat commit keeps GitHub from disabling the schedule after 60 days of inactivity.
- Set up by the owner's agent on 2026-09-30.
