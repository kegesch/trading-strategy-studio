# Trading Bot Studio

3-pane web app: Vela chart | PineScript/TS editor | LLM chat + backtest.
OKX market data. OpenAI-compatible LLM API.

## Plan (see PLAN.md)

- **Stack:** Vite + React 19 + TS + Tailwind
- **Chart:** `@luxalgo/vela` (single chart) + `@luxalgo/vela-pinets` (worker engine)
- **Backtest:** `pinets` standalone runtime; full `context.strategy` report
- **Editor:** Monaco, auto-detect PineScript (`//@version=`) / TypeScript
- **Chat:** OpenAI-compatible streaming API, env vars `LLM_API_URL` / `LLM_API_KEY` / `LLM_MODEL`
- **Data:** Custom OKX provider — see `src/okx/`

## Tasks (work in order, one commit per task)

Core app (v0) — done:
scaffold, OKX REST/WS + Vela/PineTS providers, chart wiring, Monaco editor
+ Pine grammar + syntax diagnostics, backtest engine + metrics/equity/trades,
LLM streaming client, chat agent with tool calling, input controls,
persistence, polish, tests, docs.

### v0.1 — Backtest trust
1. Realistic fills in backtest: fees, slippage, spread (OKX taker/maker tiers)
2. Walk-forward / out-of-sample evaluation mode; report IS vs OOS metrics
3. Parameter sweep UI + robustness metrics (stability across windows/symbols/TFs)
4. Batch backtests: multi-symbol / multi-timeframe queue

### v0.2 — Data depth
5. OKX historical candle downloader (REST pagination, local cache/parquet)
6. Funding rates + open interest ingestion; expose to Pine/TS scripts
7. Order-book snapshot / depth metrics feed

### v0.3 — Paper trading bridge
8. Live forward-test mode: run strategy against OKX WS, simulated fills, position/notify panel
9. Agent tool `get_paper_state` / `place_paper_order` so the agent can supervise paper runs

### v0.4 — Live trading
10. OKX demo-trading execution (API keys, order placement, position management)
11. Risk layer: max position size, max drawdown kill-switch, manual kill button
12. Alerting: telegram/webhook notifications on signal/fill/drawdown

### v0.5 — Product/retention
13. Strategy library: save/load/share versioned scripts, import/export
14. Run history: store every agent run + backtest + script diff; timeline UI
15. Multi-chart workspace, watchlists, saved layouts

## Agent improvement ideas (backlog)

- **Self-critique loop:** after backtest, agent reviews its own results (drawdown, trade count, OOS decay) and iterates without user prompting
- **Multi-variant generation:** agent produces 2–3 strategy variants, backtests all, presents a ranked comparison instead of one shot
- **Overfit detection:** agent must justify params on out-of-sample data before declaring success; reject strategies that only work in-sample
- **Structured tool results:** return metrics as compact typed JSON (not raw dumps) to cut tokens and improve reasoning
- **Parallel tool calls:** let the model emit multiple tool calls per turn (already supported by API) and run independent backtests concurrently
- **Better edit tools:** diff preview + agent-side syntax error retry loop with diagnostics fed back automatically
- **Market context injection:** auto-attach recent candles summary + ATR/vol regime to the system context so strategies fit current conditions
- **Memory:** per-symbol strategy notes and past failed approaches persisted so the agent doesn't repeat them
- **Cost/latency:** cache identical backtest runs (hash of script+params+data range) to avoid recompute
- **Trading knowledge injection:** curated `knowledge/` folder with strategy archetype docs (breakout, mean-reversion, momentum, funding-carry, vol-regime) + a validation checklist (min trade count, no look-ahead, drawdown sanity). Agent retrieves relevant pattern before writing (tool `get_strategy_patterns` or auto-injection). Keep it retrievable/structured — no giant knowledge dump in the system prompt. Measure: library-based strategies vs freeform on the same data.

## Conventions

- Dark theme throughout; Vela `theme: 'dark'`.
- Read ticker/timeframe from function args, never stashed state (Vela provider pitfall).
- One task = one commit, verified before next.
- Pin exact library versions (Vela API still evolving).

## Key API references

- Vela: https://docs.luxalgo.com/vela
- Vela API ref: https://docs.luxalgo.com/vela/user/api-reference
- Vela workspace: https://docs.luxalgo.com/vela/user/workspace
- Adding data provider: https://docs.luxalgo.com/vela/contributing/adding-a-data-provider
- PineTS: https://docs.luxalgo.com/developers/pinets
- PineTS init: https://docs.luxalgo.com/developers/pinets/initialization-and-usage
- PineTS strategy: https://docs.luxalgo.com/developers/pinets/strategy
- OKX v5 REST: https://www.okx.com/docs-v5/en/
