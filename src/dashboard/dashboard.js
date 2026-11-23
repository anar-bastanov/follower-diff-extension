const ST = globalThis.FD_Storage;
const DF = globalThis.FD_Diff;
const THEME = globalThis.FD_Theme;
const I = globalThis.FD_Icons.icon;
const $ = (id) => document.getElementById(id);

const REPO_URL = 'https://github.com/anar-bastanov/follower-diff-extension';
const PAGE = 200;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n).toLocaleString();
const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const formatDate = (ts, options) => new Date(ts).toLocaleString(undefined, options);
const DAY = { dateStyle: 'medium' };
const TIME = { timeStyle: 'short' };
const FULL = { dateStyle: 'medium', timeStyle: 'short' };

const state = {
  index: [],
  accounts: {},
  accountId: null,
  route: { name: 'changes' }, // changes { aId, bId } | snapshot { id } | settings
  filter: null,
  diffLimit: PAGE,
  tab: 'followers',
  query: '',
  limit: PAGE,
  armed: null, // a destructive button waiting for its confirming second click
};

// ---------------------------------------------------------------- data

const accountSnapshots = () => state.index.filter((m) => m.userId === state.accountId);
const accountName = (id) => state.accounts[id]?.username || state.index.find((m) => m.userId === id)?.username || id;

async function loggedInUserId() {
  const tabs = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
  for (const tab of tabs) {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'ping' }).catch(() => null);
    if (res?.userId) return res.userId;
  }
  return null;
}

async function load(first = false) {
  state.index = await ST.listSnapshots();
  state.accounts = await ST.getAccounts();
  const ids = [...new Set(state.index.map((m) => m.userId))];
  if (first) {
    const current = await loggedInUserId();
    if (ids.includes(current)) state.accountId = current;
  }
  if (!ids.includes(state.accountId)) state.accountId = ids[0] ?? null;

  const select = $('account');
  select.hidden = ids.length < 2;
  select.innerHTML = ids.map((id) => `<option value="${esc(id)}" ${id === state.accountId ? 'selected' : ''}>@${esc(accountName(id))}</option>`).join('');

  const list = accountSnapshots();
  const exists = (id) => list.some((m) => m.id === id);
  const { route } = state;
  if (route.name === 'snapshot' && !exists(route.id)) state.route = { name: 'changes' };
  if (state.route.name === 'changes' && !(exists(route.aId) && exists(route.bId))) {
    state.route = { name: 'changes', aId: list[1]?.id, bId: list[0]?.id };
  }
  render();
}

function go(route) {
  state.route = route;
  state.filter = null;
  state.diffLimit = PAGE;
  state.tab = 'followers';
  state.query = '';
  state.limit = PAGE;
  state.armed = null;
  render();
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------- layout

function render() {
  renderSide();
  renderMain();
}

function renderSide() {
  const { route } = state;
  $('nav-changes').classList.toggle('active', route.name === 'changes');
  $('nav-settings').classList.toggle('active', route.name === 'settings');
  $('snap-list').innerHTML = accountSnapshots().map((m) => {
    const active = route.name === 'snapshot' && route.id === m.id;
    const warn = m.complete === false ? `<span class="snap-warn" title="Fewer accounts than Instagram's counter">${I('alert', 13)}</span>` : '';
    return `<li><button class="snap-item ${active ? 'active' : ''}" data-act="snapshot" data-value="${m.id}">
      <span class="snap-date">${esc(formatDate(m.takenAt, DAY))}</span>
      <span class="snap-counts">${fmt(m.followerCount)}<br>${fmt(m.followingCount)}</span>
      <span class="snap-meta">${esc(formatDate(m.takenAt, TIME))} · ${m.method === 'auto' ? 'Auto' : 'Manual'} ${warn}</span>
    </button></li>`;
  }).join('') || '<li class="snap-meta" style="padding:0 12px">None yet</li>';
}

let renderId = 0;
async function renderMain() {
  const id = ++renderId;
  const html = await mainHtml();
  if (id !== renderId) return; // a newer render started while this one was loading
  $('main').innerHTML = html;
  const search = $('search');
  if (search) search.addEventListener('input', onSearch);
}

async function mainHtml() {
  if (state.route.name === 'settings') return settingsHtml();
  const list = accountSnapshots();
  if (!list.length) {
    return emptyState('users', 'No snapshots yet', 'Open instagram.com, click the Follower Diff icon in the toolbar, and run an automatic scan or a manual capture. Your snapshots will appear here.');
  }
  if (state.route.name === 'snapshot') return snapshotHtml();
  if (list.length < 2) {
    return emptyState('compare', 'One snapshot so far', 'Changes show up once you have two snapshots to compare. Take another one later. In the meantime you can browse the one you have from the sidebar.');
  }
  return changesHtml();
}

const emptyState = (icon, title, text) => `<div class="empty"><div class="empty-ic">${I(icon, 26)}</div><h2>${esc(title)}</h2><p>${esc(text)}</p></div>`;
const callout = (text) => `<div class="callout">${I('alert', 16)}<div>${esc(text)}</div></div>`;

function avatar(username) {
  let hash = 0;
  for (const c of username) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return `<div class="avatar" style="background:hsl(${hue} 70% 55% / .16);color:hsl(${hue} 55% 50%)">${esc(username[0])}</div>`;
}

function identity(user, sub) {
  return `${avatar(user.username)}
    <div class="who">
      <div class="handle"><span>${esc(user.username)}</span>${user.is_verified ? I('verified', 14) : ''}${user.is_private ? I('lock', 13, 'ic-lock') : ''}</div>
      ${sub ? `<div class="fullname">${sub}</div>` : ''}
    </div>`;
}

const profileLink = (username) => `<a class="open" href="https://www.instagram.com/${encodeURIComponent(username)}/" target="_blank" rel="noopener" title="Open on Instagram">${I('external', 15)}</a>`;

// ---------------------------------------------------------------- changes

async function changesHtml() {
  const list = accountSnapshots();
  let a = await ST.getSnapshot(state.route.aId);
  let b = await ST.getSnapshot(state.route.bId);
  if (!a || !b) return '';
  if (a.takenAt > b.takenAt) [a, b] = [b, a];
  const d = DF.diff(a, b);
  const incomplete = list.some((m) => (m.id === a.id || m.id === b.id) && m.complete === false);

  const { filter } = state;
  const rows = !filter ? d.rows
    : filter.col === 'r' ? d.rows.filter((r) => r.renamedFrom)
    : d.rows.filter((r) => r[filter.col] === filter.v);
  const visible = rows.slice(0, state.diffLimit);

  const chip = (col, v, n) => {
    const on = filter?.col === col && filter.v === v;
    const tone = n ? (v > 0 ? 'good' : 'bad') : '';
    return `<button class="chip ${tone} ${on ? 'on' : ''}" data-act="filter" data-value="${col}:${v}" ${n ? 'title="Show only these"' : 'disabled'}>${v > 0 ? '+' : '−'}${fmt(n)}</button>`;
  };
  const summary = (label, col, s) => `<div class="delta-item">
      <span class="delta-label">${label}</span>
      <span class="delta-value">${fmt(s.from)}<span class="arrow">${I('arrow-right', 16)}</span>${fmt(s.to)}</span>
      <span class="chips">${chip(col, 1, s.added)}${chip(col, -1, s.removed)}</span>
    </div>`;
  const options = (selected) => list.map((m) => `<option value="${m.id}" ${m.id === selected ? 'selected' : ''}>${esc(formatDate(m.takenAt, FULL))}</option>`).join('');
  const filterLabel = !filter ? ''
    : filter.col === 'r' ? 'changed username'
    : `${filter.v > 0 ? 'added to' : 'removed from'} ${filter.col === 'f' ? 'your followers' : 'your following'}`;

  const days = Math.round((b.takenAt - a.takenAt) / 86400000);
  const span = days < 1 ? 'Same day' : days === 1 ? '1 day apart' : `${days} days apart`;

  const table = d.rows.length ? `
    <div class="list-card">
      <div class="diff-tools">
        ${filter
          ? `<span class="filter-pill">Only ${esc(filterLabel)} <button class="x" data-act="filter" data-value="clear" title="Clear filter">${I('x', 13)}</button></span>`
          : `<span class="muted">${plural(d.rows.length, 'account')} changed</span>`}
        <span class="legend"><span class="cell add">+1</span> added <span class="cell rem">−1</span> removed <span class="cell same">${I('check', 13)}</span> unchanged, yes <span class="cell none">–</span> unchanged, no</span>
      </div>
      <div class="diff-scroll"><div class="diff">
        <div class="diff-row diff-head"><span>Account</span><span>Follows you</span><span>You follow</span><span></span></div>
        ${visible.map(diffRow).join('')}
      </div></div>
      ${rows.length > visible.length ? `<button class="section-more" data-act="more-rows">Show ${fmt(Math.min(PAGE, rows.length - visible.length))} more</button>` : ''}
    </div>`
    : `<div class="list-card">${emptyState('check-circle', 'Nothing changed', 'Same followers and same following in both snapshots.')}</div>`;

  return `
    <div class="page-head">
      <div><h1>Changes</h1><div class="page-sub">${span} · ${esc(formatDate(a.takenAt, FULL))} → ${esc(formatDate(b.takenAt, FULL))}</div></div>
      <div class="range">
        <select class="select" id="sel-a" aria-label="Older snapshot">${options(a.id)}</select>
        ${I('arrow-right', 16)}
        <select class="select" id="sel-b" aria-label="Newer snapshot">${options(b.id)}</select>
      </div>
    </div>
    <div class="delta">
      ${summary('Followers', 'f', d.followers)}
      ${summary('Following', 'g', d.following)}
      ${d.renamed ? `<div class="delta-item"><span class="delta-label">Renamed</span><span class="delta-value">${fmt(d.renamed)}</span>
        <span class="chips"><button class="chip ${filter?.col === 'r' ? 'on' : ''}" data-act="filter" data-value="r:0">show</button></span></div>` : ''}
    </div>
    ${a.id === b.id ? callout('Both sides are the same snapshot. Pick two different ones.') : ''}
    ${incomplete ? callout('One of these snapshots looks incomplete: it has noticeably fewer accounts than Instagram\'s counter. Some removals may only be missing from that snapshot.') : ''}
    ${table}`;
}

function cell(delta, now) {
  if (delta > 0) return '<span class="cell add" title="Added">+1</span>';
  if (delta < 0) return '<span class="cell rem" title="Removed">−1</span>';
  return now ? `<span class="cell same" title="Unchanged: yes">${I('check', 13)}</span>` : '<span class="cell none" title="Unchanged: no">–</span>';
}

function diffRow(row) {
  const sub = row.renamedFrom ? `<span class="renamed">${I('pencil', 12)} was @${esc(row.renamedFrom)}</span>` : esc(row.full_name);
  return `<div class="diff-row">
    <div class="acct-cell">${identity(row, sub)}</div>
    ${cell(row.f, row.fNow)}
    ${cell(row.g, row.gNow)}
    ${profileLink(row.username)}
  </div>`;
}

// ---------------------------------------------------------------- one snapshot

async function snapshotHtml() {
  const s = await ST.getSnapshot(state.route.id);
  if (!s) return '';
  const lists = {
    followers: { label: 'Followers', users: s.followers },
    following: { label: 'Following', users: s.following },
    nfb: { label: 'Don\'t follow you back', users: DF.notFollowingBack(s), note: 'You follow them, they don\'t follow you.' },
    fans: { label: 'You don\'t follow back', users: DF.fans(s), note: 'They follow you, you don\'t follow them.' },
  };
  const current = lists[state.tab] ?? lists.followers;
  const query = state.query.trim().toLowerCase().replace(/^@/, '');
  const matches = query
    ? current.users.filter((u) => u.username.toLowerCase().includes(query) || (u.full_name || '').toLowerCase().includes(query))
    : current.users;
  const visible = matches.slice(0, state.limit);

  const counter = [];
  if (s.expectedFollowers != null && s.expectedFollowers !== s.followers.length) counter.push(`${fmt(s.expectedFollowers)} followers`);
  if (s.expectedFollowing != null && s.expectedFollowing !== s.following.length) counter.push(`${fmt(s.expectedFollowing)} following`);
  const armed = state.armed === s.id;

  return `
    <div class="page-head">
      <div>
        <h1>${esc(formatDate(s.takenAt, FULL))}</h1>
        <div class="page-sub">${s.method === 'auto' ? 'Automatic scan' : 'Manual capture'} · @${esc(accountName(s.userId))}${counter.length ? ` · Instagram's counter said ${esc(counter.join(' and '))}` : ''}</div>
      </div>
      <button class="btn danger ${armed ? 'armed' : ''}" data-act="delete" data-value="${s.id}">${I('trash', 15)} ${armed ? 'Click again to delete' : 'Delete'}</button>
    </div>
    <div class="tiles">
      ${Object.entries(lists).map(([key, l]) => `<button class="tile ${l === current ? 'active' : ''}" data-act="tab" data-value="${key}">
        <span class="tile-n">${fmt(l.users.length)}</span><span class="tile-l">${esc(l.label)}</span></button>`).join('')}
    </div>
    <div class="list-card">
      <div class="list-tools">
        <label class="search">${I('search', 16)}<input id="search" type="search" placeholder="Search ${esc(current.label.toLowerCase())}" value="${esc(state.query)}"></label>
      </div>
      ${current.note ? `<div class="list-note">${esc(current.note)}</div>` : ''}
      <ul class="users">${visible.map((u) => `<li class="user">${identity(u, esc(u.full_name))}${profileLink(u.username)}</li>`).join('') || `<li class="empty-row">${query ? 'No matches.' : 'Nobody here.'}</li>`}</ul>
      ${matches.length > visible.length ? `<button class="section-more" data-act="more-users">Show ${fmt(Math.min(PAGE * 2, matches.length - visible.length))} more</button>` : ''}
    </div>`;
}

async function onSearch(e) {
  const position = e.target.selectionStart;
  state.query = e.target.value;
  state.limit = PAGE;
  await renderMain();
  const search = $('search');
  search?.focus();
  search?.setSelectionRange(position, position);
}

// ---------------------------------------------------------------- settings

async function settingsHtml() {
  const { theme, accent } = THEME.read();
  const { pace } = await ST.getSettings();
  const bytes = await ST.bytesInUse();
  const size = bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  const account = state.accountId;
  const accountCount = accountSnapshots().length;
  const deleteButton = (key, label, confirm, disabled) => `<button class="btn danger ${state.armed === key ? 'armed' : ''}" data-act="delete-${key}" ${disabled ? 'disabled' : ''}>${I('trash', 15)} ${state.armed === key ? confirm : label}</button>`;

  const segmented = (act, value, choices) => `<div class="seg">${choices.map(([v, label]) =>
    `<button class="${v === value ? 'on' : ''}" data-act="${act}" data-value="${v}">${label}</button>`).join('')}</div>`;
  const setting = (title, desc, control) => `<div class="setting">
      <div class="setting-text"><div class="setting-title">${title}</div>${desc ? `<div class="setting-desc">${desc}</div>` : ''}</div>
      ${control}
    </div>`;
  const swatches = `<div class="swatches">${Object.entries(THEME.ACCENTS).map(([name, [color]]) =>
    `<button class="swatch ${name === accent ? 'on' : ''}" style="--swatch:${color}" data-act="accent" data-value="${name}" title="${name}" aria-label="${name}"></button>`).join('')}</div>`;

  return `
    <div class="page-head"><div><h1>Settings</h1></div></div>
    <div class="settings">
      <section class="list-card">
        <h2 class="group-title">Appearance</h2>
        ${setting('Theme', '', segmented('theme', theme, [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]))}
        ${setting('Accent color', '', swatches)}
      </section>
      <section class="list-card">
        <h2 class="group-title">Scanning</h2>
        ${setting('Pace', 'Careful waits about twice as long between pages. Slower, but gentler on Instagram\'s rate limits.', segmented('pace', pace, [['normal', 'Normal'], ['careful', 'Careful']]))}
      </section>
      <section class="list-card">
        <h2 class="group-title">Data</h2>
        ${account ? setting(`@${esc(accountName(account))}`, `${plural(accountCount, 'snapshot')} of this account. Other accounts are not touched.`,
          deleteButton('account', 'Delete this account', 'Click again to delete', !accountCount)) : ''}
        ${setting('Everything', `${plural(state.index.length, 'snapshot')} · ${size}, stored only in this browser. Your settings are kept.`,
          deleteButton('all', 'Delete all data', 'Click again to delete everything', !state.index.length))}
      </section>
      <section class="list-card">
        <h2 class="group-title">About</h2>
        <div class="setting">
          <div class="about">${I('logo', 40)}<div>
            <div class="setting-title">Follower Diff <span class="muted">v${esc(chrome.runtime.getManifest().version)}</span></div>
            <div class="setting-desc">Made by Anar Bastanov</div>
          </div></div>
          <a class="btn secondary" href="${REPO_URL}" target="_blank" rel="noopener">${I('external', 15)} GitHub</a>
        </div>
      </section>
    </div>`;
}

// ---------------------------------------------------------------- toast

let toastTimer = null;
function toast(text, kind = 'info') {
  const el = $('toast');
  clearTimeout(toastTimer);
  const icon = kind === 'busy' ? '<span class="spin"></span>' : I(kind === 'error' ? 'alert' : 'check-circle', 16);
  el.innerHTML = `${icon}<span>${esc(text)}</span>`;
  el.classList.toggle('error', kind === 'error');
  requestAnimationFrame(() => el.classList.add('show'));
  if (kind !== 'busy') toastTimer = setTimeout(() => el.classList.remove('show'), 5000);
}

function showScan(s) {
  if (!s || s.dismissed) return;
  if (ST.isAlive(s)) {
    const counts = { followers: s.followers, following: s.following };
    toast(s.stage in counts ? `Scanning ${s.stage} · ${fmt(counts[s.stage] ?? 0)}` : 'Scanning…', 'busy');
  } else if (s.error) toast(s.error, 'error');
  else if (s.done) toast('New snapshot saved.');
  else $('toast').classList.remove('show');
}

// ---------------------------------------------------------------- events

function arm(key) {
  state.armed = key;
  setTimeout(() => {
    if (state.armed !== key) return;
    state.armed = null;
    renderMain();
  }, 4000);
  renderMain();
}

const actions = {
  'nav-changes': () => {
    const [newest, previous] = accountSnapshots();
    go({ name: 'changes', aId: previous?.id, bId: newest?.id });
  },
  'nav-settings': () => go({ name: 'settings' }),
  snapshot: (id) => go({ name: 'snapshot', id }),
  tab: (tab) => { Object.assign(state, { tab, query: '', limit: PAGE }); renderMain(); },
  'more-users': () => { state.limit += PAGE * 2; renderMain(); },
  'more-rows': () => { state.diffLimit += PAGE; renderMain(); },
  filter: (value) => {
    const [col, v] = value.split(':');
    const same = state.filter?.col === col && state.filter.v === Number(v);
    state.filter = col === 'clear' || same ? null : { col, v: Number(v) };
    state.diffLimit = PAGE;
    renderMain();
  },
  delete: async (id) => {
    if (state.armed !== id) return arm(id);
    state.armed = null;
    await ST.deleteSnapshot(id);
    toast('Snapshot deleted.');
  },
  'delete-account': async () => {
    if (state.armed !== 'account') return arm('account');
    state.armed = null;
    await ST.deleteAccount(state.accountId);
    toast('Account data deleted.');
  },
  'delete-all': async () => {
    if (state.armed !== 'all') return arm('all');
    state.armed = null;
    await ST.deleteAll();
    toast('All data deleted.');
  },
  theme: (theme) => { THEME.set({ theme }); renderMain(); },
  accent: (accent) => { THEME.set({ accent }); renderMain(); },
  pace: async (pace) => { await ST.setSettings({ pace }); renderMain(); },
};

document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-act]');
  actions[target?.dataset.act]?.(target.dataset.value);
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'sel-a' || e.target.id === 'sel-b') {
    go({ name: 'changes', aId: $('sel-a').value, bId: $('sel-b').value });
  } else if (e.target.id === 'account') {
    state.accountId = e.target.value;
    state.route = { name: 'changes' };
    load();
  }
});

$('btn-export').addEventListener('click', async () => {
  const blob = new Blob([JSON.stringify(await ST.exportAll())], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `follower-diff-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
});

$('btn-import').addEventListener('click', () => $('file-import').click());
$('file-import').addEventListener('change', async (e) => {
  const [file] = e.target.files;
  e.target.value = '';
  if (!file) return;
  try {
    const count = await ST.importAll(JSON.parse(await file.text()));
    toast(count ? `Imported ${plural(count, 'snapshot')}.` : 'No valid snapshots found in that file.', count ? 'info' : 'error');
  } catch (err) {
    toast(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message, 'error');
  }
});

let reloadTimer = null;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.scan_state) showScan(changes.scan_state.newValue);
  const { route } = state;
  const viewed = Object.keys(changes).some((key) => key === `snap_${route.id}` || key === `snap_${route.aId}` || key === `snap_${route.bId}`);
  if (changes.snapshots_index || changes.accounts || viewed || (route.name === 'settings' && changes.settings)) {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(load, 300);
  }
});

$('logo').innerHTML = I('logo', 26);
$('btn-export').innerHTML = `${I('download', 16)}<span class="label">Export</span>`;
$('btn-import').innerHTML = `${I('upload', 16)}<span class="label">Import</span>`;
$('nav-changes').innerHTML = `${I('compare', 18)} Changes`;
$('nav-settings').innerHTML = `${I('sliders', 18)} Settings`;

load(true);
chrome.storage.local.get('scan_state').then(({ scan_state: s }) => { if (ST.isAlive(s)) showScan(s); });
