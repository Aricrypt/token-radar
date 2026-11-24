// Token launch radar model.
//
// Reads the sealed DefiLlama snapshot and turns it into a ranked board of the
// protocols that record no token yet. The implied value of a protocol is what
// its token might be worth if it launched at the valuation its already-tokened
// peers trade at: the protocol's TVL times a market-cap/TVL multiple learned
// from those peers, adjusted for its seven-day TVL momentum and for how long
// it has run with no token recorded. Nothing here names a protocol: every
// number comes out of the snapshot's own figures.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Parse and lightly validate the sealed snapshot's JSON text. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (typeof raw.as_of !== 'string' || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: missing as_of, protocols or watchlist');
  }
  for (const p of raw.protocols) {
    if (typeof p.slug !== 'string' || typeof p.tvl_usd !== 'number') {
      throw new Error('snapshot: a protocol lacks a slug or a TVL');
    }
  }
  return raw;
}

const DAY_MS = 86_400_000;

/** Whole days between the day a protocol was listed and the snapshot's day; null when unlisted. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const from = Date.parse(`${listedAt}T00:00:00Z`);
  const to = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.max(0, Math.round((to - from) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** A protocol records no token when the snapshot carries neither a CoinGecko id nor a ticker for it. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * The snapshot README's own test for a wrapped, staked or bridged product of a
 * protocol whose token already trades (WBTC is Bitcoin on Ethereum, not a
 * launch waiting to happen), plus the versioned successors it leaves out.
 * Such a protocol records no token of its own, but it is not a launch radar's
 * subject either: the board sets it aside, with the already-tokened set.
 */
export function isProductOfTraded(p: SnapshotProtocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return true;
  if (VERSIONED_NAME.test(p.name)) return true;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return true;
  return EXCHANGE_PREFIXES.some((name) => p.name.startsWith(name));
}

/**
 * The valuation multiples the model uses, learned from the snapshot itself:
 * for every protocol whose token already trades (it has a market cap and a
 * TVL), the ratio of its market cap to its TVL. The board values a pre-token
 * protocol at its own TVL times the median ratio of its category, shrunk
 * toward the global median so a thin category cannot swing a rank on a
 * handful of names: a category with n comparables keeps weight n/(n+4).
 */
export interface Multiples {
  global: number;
  byCategory: Map<string, number>;
  comparables: number;
}

export function learnMultiples(snapshot: Snapshot): Multiples {
  const ratios: number[] = [];
  const perCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    ratios.push(ratio);
    if (p.category !== null) {
      const list = perCategory.get(p.category) ?? [];
      list.push(ratio);
      perCategory.set(p.category, list);
    }
  }
  const global = ratios.length > 0 ? median(ratios) : 0.2;
  const byCategory = new Map<string, number>();
  for (const [category, list] of perCategory) {
    if (list.length < 4) continue;
    const weight = list.length / (list.length + 4);
    byCategory.set(category, weight * median(list) + (1 - weight) * global);
  }
  return { global, byCategory, comparables: ratios.length };
}

/** The multiple a protocol is valued at: its category's shrunk median, else the global median. */
export function multipleFor(multiples: Multiples, category: string | null): number {
  if (category !== null) {
    const own = multiples.byCategory.get(category);
    if (own !== undefined) return own;
  }
  return multiples.global;
}

/** Seven-day TVL momentum: a protocol growing into a launch is worth more than one shrinking away. */
export function momentumFactor(change7d: number | null): number {
  if (change7d === null) return 1;
  return 1 + (clamp(change7d, -30, 50) / 100) * 0.5;
}

/** Years run with no token recorded earn a premium: the launch, when it comes, prices a longer record. */
export function ageFactor(age: number | null): number {
  if (age === null) return 1;
  return 1 + Math.min(age / 365, 5) * 0.04;
}

export interface Valuation {
  multiple: number;
  momentum: number;
  age: number;
  implied: number;
}

/** implied value = TVL x category multiple x momentum factor x age factor, in whole dollars. */
export function valueOf(p: SnapshotProtocol, asOf: string, multiples: Multiples): Valuation {
  const multiple = multipleFor(multiples, p.category);
  const momentum = momentumFactor(p.change_7d);
  const age = ageFactor(ageDays(asOf, p.listed_at));
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * momentum * age));
  return { multiple, momentum, age, implied };
}

/** Whole dollars the way a reader scans them: $1,234,567. */
export function fmtUsd(n: number): string {
  return `$${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/** A gas price keeps its cents: $0.40 must not round into $0. */
export function fmtGas(n: number): string {
  return n < 10 ? `$${n.toFixed(2)}` : fmtUsd(n);
}

const L2_CHAINS = new Set(['Arbitrum', 'Base', 'Optimism', 'zkSync Era', 'Linea', 'Scroll', 'Mantle', 'Blast', 'Mode', 'Zora', 'Taiko', 'Fraxtal']);

/** A rough per-transaction gas budget in dollars for the chain a step runs on. */
export function gasFor(chain: string): number {
  if (chain === 'Ethereum') return 8;
  if (chain === 'Solana' || chain === 'Aptos' || chain === 'Sui') return 0.05;
  if (L2_CHAINS.has(chain)) return 0.4;
  if (chain === 'BSC' || chain === 'Polygon' || chain === 'Avalanche' || chain === 'Fantom') return 0.15;
  return 1;
}

/** Working capital a farmer rotates through one protocol, scaled to its size so the plan stays realistic. */
export function capitalFor(tvl: number): number {
  if (tvl >= 500_000_000) return 2500;
  if (tvl >= 100_000_000) return 1500;
  if (tvl >= 50_000_000) return 1000;
  if (tvl >= 10_000_000) return 500;
  return 250;
}

/** The core farming action for a category, written for the protocol it names. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = fmtUsd(capital);
  switch (p.category) {
    case 'Dexs':
      return `Trade on ${p.name} itself: route about ${c} of swaps a week through its pools on ${chain}, favouring the deepest pairs, so your address builds real volume history rather than one-off trades.`;
    case 'Lending':
      return `Supply about ${c} of a major asset (ETH or a large-cap stablecoin) into ${p.name} on ${chain} and keep it supplied; borrow at most 30% against it only if you can watch the health factor daily.`;
    case 'Liquid Staking':
    case 'Liquid Restaking':
      return `Stake about ${c} of ETH through ${p.name} on ${chain} and hold the receipt token in the same wallet; restake it only in one venue so the position stays easy to unwind.`;
    case 'Bridge':
    case 'Cross Chain Bridge':
    case 'Canonical Bridge':
      return `Bridge about ${c} through ${p.name} in both directions over the month, splitting it into at least four crossings of different sizes so the activity reads as use, not wash.`;
    case 'Yield':
      return `Deposit about ${c} into ${p.name}'s flagship vault on ${chain} and leave it compounding; add a second, smaller deposit a month later so the address shows a history, not a single touch.`;
    case 'Risk Curators':
    case 'Onchain Capital Allocator':
      return `Deposit about ${c} into one of ${p.name}'s curated vaults on ${chain} (a large-cap stablecoin or ETH vault, not the riskiest listing) and keep it there; a curator's users are the depositors its vaults serve, so a held deposit is the record that counts.`;
    case 'Yield Aggregator':
      return `Deposit about ${c} into ${p.name}'s main aggregation vault on ${chain} and let it route the funds; withdraw and redeposit once mid-run so the address shows an active depositor, not a forgotten one.`;
    case 'Basis Trading':
      return `Fund ${p.name}'s basis strategy with about ${c} on ${chain} and keep the position open through a full funding cycle; do not stack a second leveraged position on top of it.`;
    case 'Prediction Market':
      return `Trade ${p.name}'s markets with about ${c} in total stakes on ${chain}, spread over at least ten markets you actually have a view on, and hold some positions to settlement.`;
    case 'DEX Aggregator':
      return `Route your regular swaps through ${p.name} on ${chain}: about ${c} of volume a month in varied pairs and sizes, the way an ordinary trader uses an aggregator, not in one block.`;
    case 'Payments':
      return `Use ${p.name} for real payments on ${chain}: send about ${c} through it over the run in ordinary amounts, and keep the account active with a small payment most weeks.`;
    case 'Derivatives':
    case 'Perpetuals':
      return `Trade perpetuals on ${p.name} with about ${c} of margin on ${chain}: small, hedged positions opened and closed over several weeks, keeping total fees paid visible on the address.`;
    case 'CDP':
      return `Open a vault on ${p.name}: lock about ${c} of collateral on ${chain}, mint at most 40% of its value in the protocol's stablecoin, and keep the position open and healthy.`;
    case 'Farm':
      return `Provide about ${c} of liquidity to ${p.name}'s main farm pair on ${chain} and stake the LP position; rebalance monthly instead of chasing every new pool it lists.`;
    case 'Options':
      return `Buy and sell small options on ${p.name} with about ${c} of premium budget on ${chain}, spread across expiries, so the address accumulates a real trading record.`;
    case 'RWA':
      return `Onboard with ${p.name} and allocate about ${c} to its flagship real-world-asset product on ${chain}; complete any attestation it asks for so the account counts as an active user.`;
    case 'Launchpad':
      return `Register on ${p.name} and take part in its next two sales with about ${c} ready on ${chain}; complete every whitelist and task step it publishes for participants.`;
    case 'NFT Marketplace':
      return `Trade on ${p.name}: list and buy mid-priced items up to about ${c} in total on ${chain}, spread over several weeks, favouring collections with steady volume.`;
    case 'Gaming':
      return `Play ${p.name} as a real user: about ${c} into in-game assets on ${chain}, a few sessions a week, finishing the quests and seasons it runs for its players.`;
    case 'Insurance':
      return `Underwrite on ${p.name} with about ${c} in its main cover pool on ${chain}, or buy one real cover, and keep the position through a full cover period.`;
    default:
      return `Use ${p.name}'s core product on ${chain} with about ${c} of working capital, doing the action the protocol exists for (its main deposit, trade or stake flow) rather than idle transfers.`;
  }
}

/**
 * Five concrete steps to farm one protocol before a launch: set up on its main
 * chain, do its core action with a sized budget, keep a weekly cadence, spread
 * across its other chains, and track the signals that precede a token. Costs
 * and times are stated in every plan; gas figures follow the chain's tier.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chains = p.chains.length > 0 ? p.chains : ['Ethereum'];
  const main = chains[0]!;
  const capital = capitalFor(p.tvl_usd);
  const gas = gasFor(main);
  const weeks = age !== null && age > 730 ? 12 : 8;
  const perWeekMin = p.category === 'Gaming' ? 90 : 45;
  const weeklyGas = gas * 6;
  const totalCost = weeklyGas * weeks;
  const steps: string[] = [];

  steps.push(
    `Set up: use one wallet you control on ${main} and fund it with ${fmtUsd(capital)} plus about ${fmtUsd(gas * 10)} for gas (roughly ${fmtGas(gas)} a transaction there); ${p.name} counts ${chains.length} chain${chains.length === 1 ? '' : 's'} in its TVL and ${main} is its home chain.`,
  );
  steps.push(coreAction(p, capital, main));
  steps.push(
    `Keep a cadence: about ${perWeekMin} minutes a week for ${weeks} weeks, repeating the core action in varied sizes; budget roughly ${fmtUsd(weeklyGas)} a week in gas on ${main}, about ${fmtUsd(totalCost)} over the whole run, and never bridge in and out in the same hour.`,
  );
  if (chains.length > 1) {
    const second = chains[1]!;
    steps.push(
      `Spread: from week 3, repeat the same action on ${second} with a quarter of the capital, so the address is active on 2 of ${p.name}'s ${chains.length} chains; gas there runs about ${fmtGas(gasFor(second))} a transaction.`,
    );
  } else {
    steps.push(
      `Deepen: from week 3, add a second position type on ${main} (a second pool, market or vault of ${p.name}) with a quarter of the capital, so the address shows breadth inside the one chain it runs on.`,
    );
  }
  const listed = p.listed_at === null ? 'an unlisted start' : `listed since ${p.listed_at}`;
  steps.push(
    `Track: ${p.name} records no token yet (${listed}, ${fmtUsd(p.tvl_usd)} TVL in the snapshot); watch its governance forum and official feed monthly for points, snapshot or token votes, keep your own log of dates and amounts, and stop adding capital if a token is announced with a snapshot already taken.`,
  );
  return steps;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

/** One protocol as the dashboard shows it: the board row plus the model's working. */
export interface RadarRow extends BoardRow {
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  multiple: number;
  momentum: number;
  age_factor: number;
  watchlist: boolean;
}

/** A protocol whose token already trades, set aside so the board never mixes the two kinds. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

/** A protocol that records no token but is a wrapped, staked or bridged product of one that trades. */
export interface AsideRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: { comparables: number; global_multiple: number; note: string };
  rows: RadarRow[];
  live: LiveRow[];
  aside: AsideRow[];
  counts: { protocols: number; pre_token: number; watchlist: number; live: number; aside: number };
}

/**
 * Build the board: every protocol that records no token, valued by the model
 * and ranked by implied value (ties by TVL, then slug, so two runs agree byte
 * for byte). Protocols whose token already trades are returned apart, as the
 * comparison set the multiples were learned from.
 */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const multiples = learnMultiples(snapshot);
  const watch = new Set(snapshot.watchlist);
  const scored: { p: SnapshotProtocol; v: Valuation }[] = [];
  const live: LiveRow[] = [];
  const aside: AsideRow[] = [];
  for (const p of snapshot.protocols) {
    if (recordsNoToken(p) && !isProductOfTraded(p)) {
      scored.push({ p, v: valueOf(p, snapshot.as_of, multiples) });
    } else if (recordsNoToken(p)) {
      aside.push({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd });
    } else if (p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0) {
      live.push({
        slug: p.slug,
        name: p.name,
        category: p.category,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd,
        ratio: Math.round((p.mcap_usd / p.tvl_usd) * 10000) / 10000,
      });
    }
  }
  scored.sort((a, b) => b.v.implied - a.v.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  live.sort((a, b) => b.mcap_usd - a.mcap_usd || (a.slug < b.slug ? -1 : 1));
  aside.sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));

  const rows: RadarRow[] = scored.map(({ p, v }, i) => ({
    slug: p.slug,
    name: p.name,
    rank: i + 1,
    implied_value_usd: v.implied,
    farm_steps: farmSteps(p, ageDays(snapshot.as_of, p.listed_at)),
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    age_days: ageDays(snapshot.as_of, p.listed_at),
    multiple: Math.round(v.multiple * 10000) / 10000,
    momentum: Math.round(v.momentum * 10000) / 10000,
    age_factor: Math.round(v.age * 10000) / 10000,
    watchlist: watch.has(p.slug),
  }));
  const board: BoardRow[] = rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
  }));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: {
      comparables: multiples.comparables,
      global_multiple: Math.round(multiples.global * 10000) / 10000,
      note: 'Implied value = TVL x category median market-cap/TVL multiple (shrunk to the global median) x 7-day momentum factor x tokenless-age factor.',
    },
    rows,
    live,
    aside,
    counts: {
      protocols: snapshot.protocols.length,
      pre_token: rows.length,
      watchlist: snapshot.watchlist.length,
      live: live.length,
      aside: aside.length,
    },
  };
  return { board, radar };
}

/** The gate's shape, checked before anything is written: null when the board is fit to hand in. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  for (const slug of snapshot.watchlist) {
    if (!slugs.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  let previous = Number.POSITIVE_INFINITY;
  let distinct = false;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `row ${row.slug} carries rank ${row.rank}, expected ${i + 1}`;
    if (row.implied_value_usd > previous) return `implied value rises at rank ${row.rank}`;
    if (row.implied_value_usd !== board[0]!.implied_value_usd) distinct = true;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${row.slug} holds ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `a farm step of ${row.slug} is ${len} characters, outside 20..600`;
    }
  }
  if (!distinct) return 'every implied value is the same: the board ranks nothing';
  return null;
}

/** The dashboard's data as a script the page loads beside itself: window.RADAR = {...}. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}




