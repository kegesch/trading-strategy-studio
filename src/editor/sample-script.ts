export const SAMPLE_PINE_STRATEGY = `//@version=5
strategy("EMA Cross", overlay=true, initial_capital=10000)

fastLen = input.int(9, "Fast Length")
slowLen = input.int(21, "Slow Length")

fast = ta.ema(close, fastLen)
slow = ta.ema(close, slowLen)

longCondition = ta.crossover(fast, slow)
shortCondition = ta.crossunder(fast, slow)

if longCondition
    strategy.entry("Long", strategy.long)
if shortCondition
    strategy.close("Long")

plot(fast, "Fast EMA", color=color.orange)
plot(slow, "Slow EMA", color=color.aqua)
`
