## 1. Proposed system-prompt additions

Generalized method rules, in priority order.

1. **Validate the base case before adding conditional complexity.** Implement the unfiltered version, measure it, and require every subsequent filter to demonstrably beat that baseline to be retained. Do not add a filter to explain a result that has not yet been understood.

2. **Treat sample size as a precondition, not a caveat.** Define a minimum event count below which results are not evaluated at all. If a configuration produces too few events, the next action is to locate and remove the suppressing condition — never to reinterpret the small sample.

3. **Fewer events is not an improvement.** Do not characterize a change as "cleaner" or "more selective" without a named metric that demonstrates it. Increasing selectivity while reducing count is a regression unless the survivors are shown to be materially better.

4. **Inspect a contiguous window spanning the first qualifying event before running any backtest, sweep, or parameter search** — not a single bar, and not after the metrics have already been produced.

5. **When logic has been restructured more than once, rewrite the component whole instead of continuing to patch it.** Incremental edits accumulate inconsistencies that are themselves a defect source, and after two restructurings the clean rewrite is cheaper than continued repair.

6. **Reconcile the configured cost model against the applied one before interpreting any performance figure.** If they disagree, resolve the discrepancy or explicitly mark the results unreliable.

7. **An isolated optimum in a parameter surface is not a finding.** Require stable behavior across neighboring values before naming any setting.

8. **Report negative and inconclusive outcomes as soon as they are established, and never respond to a null result by adding complexity.** If available evidence cannot resolve the question, that is the finding.

9. **Prefer the measurement that directly tests the hypothesis over inference from aggregate results.** When a distinction cannot be instrumented with what is available, state that limitation rather than reasoning around it.

## 2. Tooling issues

### Bugs

**`edit_script` can report success while leaving the file corrupted.** A range replacement applied its new content without removing the replaced span, producing duplicate declaration blocks (`lvlDir` declared twice, an input declared twice). Detection required a downstream `identifier already declared` error or manually reading the file back. The success response gave no indication that a write had been partially applied. This is the highest-impact defect encountered — it silently invalidates the artifact and every subsequent test result derived from it.

**Failure diagnostics point at the wrong problem.** Declaring an identifier twice surfaced as `Identifier 'x' has already been declared (39:4)` — reported at the *second* site with no indication that the duplication originated in a tool-applied edit, sending me to debug my own logic rather than the tool.

**`run_backtest` silently overrode the script's declared commission.** The strategy declared `commission_value=0.05`; the response reported `commissionPct: 0.1` with no warning. All P&L was therefore computed on a different cost basis than the one authored, with no signal that this had happened.

**`inspect_bar` mixes user variables with compiler scratch state.** Responses include `for12_x`, `for19_d`, `if10_pl`, `whl1_oi` — loop temporaries indistinguishable from meaningful series. Values are also unscoped, so an incidental name collision can be mistaken for a real variable.

**Missing and `na` variables are indistinguishable in `find_signal_bars`.** A query for a variable that was `na` on every bar returned `matches: [], total: 0` — identical output to a variable that was simply never true. I spent calls re-deriving which case applied.

**Querying a nonexistent variable returns a script compile error** (`minTouch is not defined`) rather than a "variable not found" response, conflating a caller mistake with a script defect.

### Feature requests

1. **Forward excursion diagnostics (highest value).** Report MFE/MAE and forward return over N bars for every signal, aggregated across signals. This separates "entry is wrong" from "exit is wrong" — a distinction I could not instrument at all in Pine, and had to approximate from realized P&L across very few trades. Its absence was the single largest constraint on the session.

2. **Condition funnel / gate attribution.** Given a compound boolean, report how many bars each conjunct eliminated, in order. This directly answers "why are there only four trades" instead of reconstructing it by manual `inspect_bar` calls.

3. **Windowed variable dumps.** Retrieve a variable across a contiguous bar range in one call, rather than one call per bar.

4. **Discoverable variable list.** An endpoint returning the script's exposed variable names, so inspection does not require guessing names in advance.

5. **Enriched trade records.** Per trade: exit reason (which of stop / target / trail / time fired), bars held, and entry distance to the reference level in ATR and R. I inferred exit reason by eyeballing price deltas in returned trades.

6. **Sample-size sufficiency flag** on backtest results. The harness reported identical structure for 4 trades and for 300, leaving sufficiency to my judgment — which I misjudged repeatedly.

7. **Script version history and rollback.** With no undo, a single corrupting edit can require reconstructing the prior state by reasoning; the clean rewrite recovered it here, but that is not a general safeguard.

8. **Multi-symbol and multi-timeframe validation in a single call.** Robustness checking required orchestrating many separate runs, which is exactly the friction that leads to checking fewer combinations than the question warrants.

9. **Rendered-chart access.** I could only reason about whether levels were visually sensible from raw OHLC and isolated candles, never confirming the plotted picture across a range of history.
