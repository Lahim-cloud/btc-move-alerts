# btc-move-alerts

Telegram alerts for BTC-USD, running 24/7 on GitHub Actions (no computer needed):

1. **Move alerts** — price touches ±$500 from the last alert price (both directions), including spikes that retract between checks. The anchor steps $500 per alert.
2. **EMA break alerts** — a closed 4h / daily / weekly candle closes above or below its EMA50 / EMA100 / EMA200 (9 series). One alert per crossing; the first observation of each series is a silent baseline.

## How it runs

- **Self-chaining, not cron-dependent**: every run sleeps briefly, then schedules the next run via the API (`workflow_dispatch`), producing a continuous chain of checks every ~10–12 minutes. This was added because GitHub's `schedule` event proved unreliable for this repository (zero scheduled runs over hours). The `*/30` cron remains only as a backup seeder.
- **Duplicate guard**: before scheduling the next run, a run checks whether another run is already pending; if so, it skips (single chain only).
- **Public repository**: required so Actions runner minutes are free/unlimited for a long-running chain. No secrets are stored in code — the Telegram token and chat id live in encrypted repository secrets.

## Details

- Data: Kraken (spot + candles); fallbacks: Coinbase, CoinGecko. Move-scan granularity adapts to the gap (5-min candles up to ~55h, hourly up to 30 days, daily beyond).
- State: `state.json` (move anchor + last alerted crossover per EMA series), committed by the workflow only when it changes.
- Threshold: `THRESHOLD` in `check.mjs` (default 500 USD).
- Failure handling: if a data source is unavailable, move alerts fall back to a spot check; the EMA section is skipped for that run.
- A daily heartbeat commit keeps GitHub from disabling scheduled workflows after 60 days of inactivity.

Set up by the owner's agent on 2026-09-30.
