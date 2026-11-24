// Token Launch Radar — the page's logic. Reads window.RADAR, which main.ts
// writes beside this page as ../data.js from the same board it hands in.
// No network, no framework: sorting, filtering and the detail view are all here.

const R = window.RADAR;
const $ = (id) => document.getElementById(id);

const fmtUsd = (n) => '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const fmtPct = (n) => (n === null ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%');
const fmtAge = (days) => {
  if (days === null) return '—';
  if (days < 365) return Math.round(days / 30) + ' mo';
  return (days / 365).toFixed(1) + ' yr';
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The snapshot's headline numbers, as stat cards.
$('stats').innerHTML = [
  [R.counts.pre_token, 'pre-token ranked'],
  [R.counts.watchlist, 'on the watchlist'],
  [R.counts.live, 'already tokened'],
  [R.counts.aside, 'wrapped / staked'],
  [R.as_of, 'snapshot date'],
]
  .map(([v, label]) => `<div class="stat"><b>${esc(v)}</b><span>${label}</span></div>`)
  .join('');

// The model, stated on the page the way the code runs it.
$('model-note').innerHTML =
  `<strong>How the radar values a launch:</strong> implied value = TVL &times; category multiple &times; momentum &times; tokenless age. ` +
  `The multiple is the median market-cap/TVL of the ${R.model.comparables} protocols in this snapshot whose token already trades ` +
  `(global median <code>${R.model.global_multiple}&times;</code>), learned per category and shrunk toward that median. ` +
  `Momentum scales with the 7-day TVL change (clamped at &minus;30%/+50%, half weight); age adds 4% per year run with no token recorded, up to five years. ` +
  `Protocols whose token already trades are kept off the board and listed apart, and so are wrapped, staked and bridged products of a token that ` +
  `already trades (${R.counts.aside} of them: a wrapped bitcoin is bitcoin, not a launch), so the board holds only protocols still waiting on a first token of their own.`;

// Filter options come from the data itself.
const categories = [...new Set(R.rows.map((r) => r.category).filter(Boolean))].sort();
$('f-category').innerHTML += categories.map((c) => `<option>${esc(c)}</option>`).join('');
const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
$('f-chain').innerHTML += chains.map((c) => `<option>${esc(c)}</option>`).join('');

const state = { sort: 'rank', dir: 1, selected: null };

/** The rows the current controls ask for: filtered, then sorted. */
function visibleRows() {
  const q = $('q').value.trim().toLowerCase();
  const cat = $('f-category').value;
  const chain = $('f-chain').value;
  const watchOnly = $('f-watch').checked;
  let rows = R.rows.filter((r) => {
    if (watchOnly && !r.watchlist) return false;
    if (cat && r.category !== cat) return false;
    if (chain && !r.chains.includes(chain)) return false;
    if (q && !r.name.toLowerCase().includes(q) && !r.slug.includes(q)) return false;
    return true;
  });
  const key = state.sort;
  rows = [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === null && bv === null) return a.rank - b.rank;
    if (av === null) return 1;
    if (bv === null) return -1;
    const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
    return state.dir * (cmp === 0 ? a.rank - b.rank : cmp);
  });
  return rows;
}

/** One board row, or the already-tokened comparison row when that view is on. */
function rowHtml(r) {
  const pctCls = r.change_7d === null ? 'flat' : r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : 'flat';
  return (
    `<tr data-slug="${esc(r.slug)}" class="${state.selected === r.slug ? 'selected' : ''}">` +
    `<td class="num">${r.rank}</td>` +
    `<td class="name"><b>${esc(r.name)}</b>${r.watchlist ? '<span class="pill">watchlist</span>' : ''}<span class="slug">${esc(r.slug)}</span></td>` +
    `<td>${esc(r.category ?? '—')}</td>` +
    `<td class="num">${fmtUsd(r.tvl_usd)}</td>` +
    `<td class="num ${pctCls}">${fmtPct(r.change_7d)}</td>` +
    `<td class="num">${fmtAge(r.age_days)}</td>` +
    `<td class="num">${fmtUsd(r.implied_value_usd)}</td></tr>`
  );
}

function render() {
  const liveView = $('f-view-live').checked;
  if (liveView) {
    const liveHtml = R.live.map(
      (r, i) =>
        `<tr><td class="num">${i + 1}</td><td class="name"><b>${esc(r.name)}</b><span class="slug">${esc(r.slug)}</span></td>` +
        `<td>${esc(r.category ?? '—')}</td><td class="num">${fmtUsd(r.tvl_usd)}</td><td class="num flat">trades</td>` +
        `<td class="num">—</td><td class="num">${fmtUsd(r.mcap_usd)} mcap</td></tr>`,
    );
    const asideHtml = R.aside.map(
      (r, i) =>
        `<tr><td class="num">${R.live.length + i + 1}</td><td class="name"><b>${esc(r.name)}</b><span class="slug">${esc(r.slug)}</span></td>` +
        `<td>${esc(r.category ?? '—')}</td><td class="num">${fmtUsd(r.tvl_usd)}</td><td class="num flat">product of a traded token</td>` +
        `<td class="num">—</td><td class="num flat">set aside</td></tr>`,
    );
    $('rows').innerHTML = liveHtml.concat(asideHtml).join('');
    $('count').textContent =
      `${R.live.length} protocols whose token already trades, plus ${R.aside.length} wrapped, staked or bridged products of one — the comparison set, not the board`;
    return;
  }
  const rows = visibleRows();
  $('rows').innerHTML = rows.length ? rows.map(rowHtml).join('') : '<tr><td colspan="7" class="empty">No protocol matches those filters.</td></tr>';
  $('count').textContent = `${rows.length} of ${R.rows.length} protocols shown`;
  for (const tr of document.querySelectorAll('#rows tr[data-slug]')) {
    tr.addEventListener('click', () => showDetail(tr.getAttribute('data-slug')));
  }
}

/** The detail view: the model's arithmetic for one protocol, then its farm plan. */
function showDetail(slug) {
  const r = R.rows.find((row) => row.slug === slug);
  if (!r) return;
  state.selected = slug;
  const el = $('detail');
  el.hidden = false;
  el.innerHTML =
    `<button class="close" id="d-close">close</button>` +
    `<h2>#${r.rank} ${esc(r.name)}${r.watchlist ? '<span class="pill">watchlist</span>' : ''}</h2>` +
    `<p class="meta"><b>${esc(r.category ?? 'Uncategorised')}</b> · chains: ${r.chains.map(esc).join(', ') || '—'} · ` +
    `listed ${r.listed_at ?? '—'} (${fmtAge(r.age_days)} with no token recorded) · 7d TVL ${fmtPct(r.change_7d)}</p>` +
    `<div class="calc">${fmtUsd(r.tvl_usd)} TVL <span class="op">&times;</span> ${r.multiple}&times; category multiple ` +
    `<span class="op">&times;</span> ${r.momentum} momentum <span class="op">&times;</span> ${r.age_factor} age ` +
    `<span class="op">=</span> <span class="res">${fmtUsd(r.implied_value_usd)} implied value</span></div>` +
    `<h3>Farm plan — before a launch</h3>` +
    `<ol class="steps">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
  $('d-close').addEventListener('click', () => {
    el.hidden = true;
    state.selected = null;
    render();
  });
  render();
  el.scrollIntoView({ block: 'nearest' });
}

// Controls: header clicks sort (same column again flips direction), inputs re-render.
for (const th of document.querySelectorAll('#board thead th[data-sort]')) {
  th.addEventListener('click', () => {
    const key = th.getAttribute('data-sort');
    if (state.sort === key) state.dir *= -1;
    else {
      state.sort = key;
      state.dir = key === 'name' || key === 'category' ? 1 : -1;
    }
    if (key === 'rank') state.dir = 1;
    render();
  });
}
for (const id of ['q', 'f-category', 'f-chain', 'f-watch', 'f-view-live']) {
  $(id).addEventListener('input', render);
  $(id).addEventListener('change', render);
}

$('foot').textContent =
  `Source: ${R.source}. A protocol is described as recording no token when the snapshot carries no token for it; ` +
  `implied values are this radar's own model, not a prediction that a token will be issued.`;
render();


