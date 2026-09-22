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

1. Scaffold Vite + React + TS + Tailwind, 3-col resizable layout
2. `src/okx/fetch.ts` REST candles + instruments + normalization
3. `src/okx/ws.ts` WebSocket live candles + poll fallback
4. `src/okx/provider-vela.ts` Vela DataProvider
5. `src/okx/provider-pinets.ts` PineTS BaseProvider
6. Wire Vela + PineWorkerEngine; sample EMA indicator on chart
7. Monaco editor, auto-detect, custom Pine grammar
8. Syntax-check: `new Indicator(source)` → Monaco diagnostics
9. Backtest engine: `runBacktest()` → metrics panel
10. Equity curve mini-chart + trades table
11. `src/llm/client.ts` OpenAI-compatible streaming client
12. Chat pane: streaming render, input, copy script
13. "Apply" button on fenced code blocks → editor replace + diff + re-run
14. Input/prop controls from `getInputsMeta()` / `getPropsMeta()`
15. Persistence: Vela `persist` + localStorage for script/chat
16. Polish: loading states, error toasts, empty states
17. Tests: OKX provider fixtures, backtest harness (2 sample strategies), mock LLM
18. README.md + .env.example

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
