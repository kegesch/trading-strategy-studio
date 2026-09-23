# Trading Bot Studio

3-pane web app for building, testing and backtesting Pine Script strategies on OKX
market data — with an LLM agent that can inspect the chart, edit the script and run
backtests itself.

```
┌────────────────────┬──────────────────────┬───────────────────────┐
│ Vela chart         │ Monaco editor        │ LLM chat (agent)      │
│ OKX candles + live │ PineScript           │ tools: market data,   │
│ + script overlays  │                      │ script, backtest      │
│                    │ Inputs · Save        ├───────────────────────┤
│                    │ (Ctrl+S applies)     │ Backtest: metrics,    │
│                    │                      │ equity curve, trades  │
└────────────────────┴──────────────────────┴───────────────────────┘
```

## Stack

- **Vite + React 19 + TypeScript + Tailwind 4**
- **Chart:** `@luxalgo/vela` / `@luxalgo/vela/workspace` (single-chart mode)
- **Pine engine:** `@luxalgo/vela-pinets` (worker) for on-chart scripts;
  standalone `pinets` runtime for backtests
- **Editor:** Monaco (bundled locally, custom Pine grammar, Pine auto-detect)
- **Data:** custom OKX provider (`src/okx/`) — REST candles/instruments + WS live
- **LLM:** OpenAI-compatible streaming API with native function/tool calling

## Setup

```bash
npm install
cp .env.example .env    # then edit
npm run dev
```

### Environment variables

| Variable            | Purpose                                                    |
| ------------------- | ---------------------------------------------------------- |
| `VITE_OKX_BASE_URL` | OKX REST base (default `https://www.okx.com/api/v5`)       |
| `VITE_LLM_API_URL`  | OpenAI-compatible base URL (e.g. `https://api.openai.com/v1`) |
| `VITE_LLM_API_KEY`  | API key (omit for local/unauth endpoints)                  |
| `VITE_LLM_MODEL`    | Model id (must support tool calling for the agent)         |

The chat pane shows a notice when the LLM vars are missing; everything else works
without them.

## Scripts

| Command           | What it does                            |
| ----------------- | --------------------------------------- |
| `npm run dev`     | Dev server                              |
| `npm run build`   | Type-check + production build           |
| `npm run lint`    | oxlint                                  |
| `npm test`        | Vitest unit tests                       |

## Usage

1. The chart loads OKX `BTC-USDT` 1h with an EMA 20 sample indicator.
2. Edit the Pine script in the middle pane. **Ctrl+S** (or *Save · apply to chart*)
   runs it on the chart — first time it adds, afterwards it updates in place. A
   broken edit leaves the last good script running.
3. Pine `input.*` parameters appear in the **Inputs** bar above the editor and
   update the chart live.
4. **Run backtest** in the bottom-right pane tests the script over the chart's
   symbol/timeframe and reports metrics, an equity curve and the trades table.
5. **Chat pane** drives an agent with these tools:
   - `get_chart_state`, `get_market_data` — read the chart / OKX candles
    - `read_script`, `edit_script` — line-numbered read / line-range or exact-string edit of the editor (edits are syntax-checked; clean ones apply to chart by default)
   - `run_backtest` — run a strategy and return metrics + trades

   Ask e.g. *"Build a volatility breakout strategy on the current chart and backtest
   it, then tune the parameters to improve Sharpe."* Code blocks in replies also have
   an **Apply → editor** button.

Script, chat and the Vela workspace state persist in `localStorage`.

## Architecture

```
src/
  okx/         fetch.ts (REST) · ws.ts (live, reconnect+poll fallback)
               provider-vela.ts (Vela DataProvider) · provider-pinets.ts (pinets BaseProvider)
  vela/        ChartPane.tsx — workspace, okx provider, pine worker engine, load state
  editor/      EditorPane.tsx · pine-language.ts (Monarch) · detect-language.ts
               InputControls.tsx (Pine input schema → controls)
  backtest/    runBacktest.ts (pinets) · BacktestPane.tsx (metrics, curve, trades)
  llm/         client.ts — SSE streaming + tool-call accumulation
  agent/       tools.ts — tool schemas + executors bridging chart/editor/backtest
  chat/        ChatPane.tsx — agent loop (stream → tools → repeat)
  studio/      store.ts (chart↔editor bridge, external store) · persistence.ts
```

### Notes / known issues

- **pinets `initial_capital` bug:** declaring `initial_capital=` on a `strategy()`
  (or setting it as a prop) makes the runtime register zero trades. `runBacktest()`
  strips the argument as a workaround and falls back to the default capital.
- Pine conditions should be written inline (`if ta.crossover(a, b)`) rather than
  assigned to a variable first — the latter can evaluate stale per bar.
- The chart and backtest engine are independent: the backtest always uses the
  editor's current script text and the chart's symbol/timeframe.

## Roadmap

`PLAN.md` tracks the original task list. Remaining: OKX WS edge-case hardening,
richer agent tools (drawings, multi-symbol scans), and server-side workspace
persistence.
