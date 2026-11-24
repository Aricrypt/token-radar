# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Aricrypt/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Aricrypt/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads the sealed DefiLlama snapshot (758 protocols at or above $5M TVL, fetched 2026-11-14), finds the protocols that record no token yet, and ranks them by an implied launch value derived from the snapshot's own figures — each protocol's TVL times the median market-cap/TVL multiple of its category's already-tokened peers (shrunk toward the global median of 0.2138), adjusted for its 7-day TVL momentum and for how long it has run with no token recorded. Wrapped, staked and bridged products of tokens that already trade (WBTC and its kin) are set aside with the already-tokened set: a wrapped bitcoin is bitcoin, not a launch. The board holds 198 protocols, covering all 40 of the snapshot's watchlist, and every row carries a five-step farm plan with budgets, gas costs and a weekly cadence. The dashboard is a static page (no network, no framework) with a sortable, filterable board and a detail view that shows the model's arithmetic for each protocol.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to>/snapshot.json
```

The program (Node 22, standard library only) writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory; open `dashboard/index.html` from there to use the radar.

---

<sub>Entered on [make.fun](https://make.fun/?ref=eksywzb3&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

