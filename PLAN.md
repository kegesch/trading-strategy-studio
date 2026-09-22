Plan: Trading Bot Studio (3-pane web app)
1. Product & Architecture
A single-page React app with a resizable 3-column layout:
┌─────────────────┬──────────────────────┬─────────────────────────┐
│   Vela chart    │    Monaco editor     │   LLM chat (streaming)  │
│  (left, ~40%)   │  auto-detect         │                         │
│  candles + pine │  PineScript / TS     │  ─ message list         │
│  + strategy     │  + syntax check      │  ─ input box + send     │
│  fills on chart │                      │  ─ "Apply" button        │
└─────────────────┴──────────────────────┴─────────┬───────────────┘
                                                   │
                                            Backtest panel
                                            (metrics, trades, equity curve)
- Left pane — Vela™ single chart (layout: false), PineEngine (web worker) registered for the pine language. Charts live OKX candles; Pine indicators/strategies overlay the candles; strategy fills paint as markers.
- Middle pane — Monaco editor, auto-detects //@version= → PineScript grammar (custom) vs bare code → TypeScript grammar. Live syntax-check by attempting new Indicator(source) from pinets; parse/transpile errors surface as inline diagnostics. Input controls from getInputsMeta() and strategy props from getPropsMeta() render as editable rows above the editor.
- Right pane — LLM chat + backtest results.
- Chat: OpenAI-compatible API (LLM_API_URL, LLM_API_KEY env vars, SSE streaming). LLM context includes: current script (line-numbered), chart context (symbol, tf, visible range, last OHLCV), last backtest summary. Replies render Markdown; fenced pine/ts code blocks get an Apply button → replace editor content, show diff, re-run backtest automatically.
- Backtest: standalone pinets run() against OKX candles; result panel shows full context.strategy report — equity, netprofit, win rate, max drawdown, Sharpe/Sortino, CAGR, buy&hold outperformance, open/closed trades table — plus an equity-curve mini-chart.
2. Data: OKX (custom provider)
No bundled OKX provider in Vela or PineTS, so I'll write one shared module:
- src/okx/fetch.ts — REST layer: GET /api/v5/market/candles?instId=X&bar=1H&limit=300&after=<ts> (public, no key), paginated via after; /api/v5/market/instruments for symbol list; normalize to neutral bars {time(open,ms), open, high, low, close, volume} sorted ascending.
- src/okx/ws.ts — OKX public WebSocket wss://ws-broker.okx.com/v5 (candles realtime topics), with REST-poll fallback on disconnect.
- src/okx/provider-vela.ts — Vela DataProvider: getBars(ticker, tf, range) (required; must tolerate overlapping from), listSymbols(), subscribe(ticker, tf, onBar), getSymbolInfo(). Tickers in OKX format (BTC-USDT).
- src/okx/provider-pinets.ts — PineTS BaseProvider subclass: _getMarketDataNative(tickerId, tf, limit, sDate?, eDate?), getSupportedTimeframes() → {'1','3','5','15','30','60','120','180','240','D','W'} (PineTS auto-aggregates unsupported tf).
- Registered as provider okx on the chart; bare symbols resolve via listSymbols.
3. State & Data Flow
- Single React store (small, hand-rolled or zustand) holding: scriptSource, symbol, timeframe, backtestResult, chatMessages, uiState.
- Edit → run loop: editor debounce (~500ms) → runBacktest() → results panel + update chart via chart.runScript(source).
- Chart wiring: new VelaWorkspace('#chart', { layout:false, symbol, timeframe, live:true, theme:'dark' }), registerEngine('pine', new PineWorkerEngine()), subscribe to script:run for live updates, runScript() for ad-hoc execution from the editor.
- Persistence: Vela persist: true (localStorage, chart state); scripts + chat in localStorage.
4. LLM Module
- src/llm/client.ts — thin OpenAI-compatible client (POST /v1/chat/completions, stream: true, SSE parse) behind an LlmClient interface. Model via LLM_MODEL env (default gpt-4o-compatible).
- src/llm/prompt.ts — system prompt: "You are a PineScript/TS trading-bot assistant. Always respond with reasoning + a complete code block when editing scripts."
- Chat history in the store; "New chat" button; copy-script button for manual use.
5. Implementation Tasks (small, incremental, in order)
Each task is independently verifiable and should be its own commit. Estimates are relative (S/M/L) — a new agent should complete one task at a time and verify before starting the next.
#	Task
1	Scaffold Vite + React 19 + TS + Tailwind; dark theme; 3-column resizable layout shell with empty pane placeholders
2	src/okx/fetch.ts — REST candles + instruments, normalization, pagination
3	src/okx/ws.ts — WebSocket live candles + poll fallback
4	src/okx/provider-vela.ts — Vela DataProvider
5	src/okx/provider-pinets.ts — PineTS BaseProvider
6	Wire Vela + PineWorkerEngine; add sample EMA indicator; subscribe to script:run
7	Monaco editor component, auto-detect Pine/TS, custom Pine grammar
8	Syntax-check on debounce: new Indicator(source) → Monaco diagnostics
9	Backtest engine: runBacktest() → context.strategy; metrics panel component
10	Equity curve mini-chart + trades table
11	src/llm/client.ts OpenAI-compatible streaming client (env-configured)
12	Chat pane: message list, streaming render, input box, copy script
13	"Apply" button on fenced code blocks → editor replace + diff + auto-run
14	Input/prop controls above editor from getInputsMeta()/getPropsMeta()
15	Persistence: Vela persist, script/chat in localStorage; restore on load
16	Polish: loading states, error toasts (bad script, fetch fail, LLM fail), empty states
17	Tests: OKX provider fixtures; backtest harness on 2 sample strategies (EMA cross, RSI); LLM client against a mock server
18	README.md + .env.example (LLM keys, OKX base URL optional) + final docs
Total estimate: ~L for a single focused dev, or ~1–2 days of incremental agent work if tasks are split as above.
6. Risks & Decisions
- Vela API is still stabilizing (v0.7.7) — pin exact versions in package.json; if an API breaks during build, check the source for the current signature rather than guessing.
- AGPL-3.0 on pinets + @luxalgo/vela-pinets — fine for personal use; if this becomes a public product you distribute, you must open-source the app. (Vela core is Apache-2.0.)
- OKX rate limits / WebSocket geo-restrictions — poll fallback is mandatory; keep REST calls batched.
- LLM can produce invalid Pine — syntax-check + "run failed" feedback loop is the safety net; don't auto-apply code that fails the Indicator check without user confirmation.
