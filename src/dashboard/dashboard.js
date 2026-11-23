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
const FULL = { dateStyle: 'medium', timeStyle: 'short' };

const state = {
  index: [],
  names: {},
  // profiles | profile { id, tab, aId, bId, latest } | snapshot { id, snapId } | settings
  route: { name: 'profiles' },
  filter: null,
  diffLimit: PAGE,
  listTab: 'followers',
  query: '',
  limit: PAGE,
  profileQuery: '',
  profileSort: 'recent',
  pinned: [],
  armed: null, // a destructive button waiting for its confirming second click
};

// ---------------------------------------------------------------- data

async function refresh() {
  state.index = await ST.listSnapshots();
  state.names = await ST.getProfiles();
  ({ pinned: state.pinned } = await ST.getSettings());
}

async function load() {
  await refresh();
  const { route } = state;
  const snapshots = route.id ? snapshotsOf(route.id) : [];
  if (route.id && !snapshots.length) state.route = { name: 'profiles' };
  else if (route.name === 'snapshot' && !snapshots.some((m) => m.id === route.snapId)) state.route = { name: 'profile', id: route.id, tab: 'snapshots' };
  // Unless you picked the snapshots yourself, keep comparing the newest two.
  else if (route.name === 'profile' && route.latest) Object.assign(route, latestPair(route.id));
  render();
}

// Links from the popup: #profile/<id> or #profile/<id>/snapshots
async function openFromHash() {
  const [kind, id, tab] = location.hash.slice(1).split('/');
  if (kind !== 'profile' || !id) return;
  history.replaceState(null, '', location.pathname);
  await refresh();
  if (snapshotsOf(id).length) openProfile(id, tab === 'snapshots' ? 'snapshots' : 'changes');
}

const snapshotsOf = (id) => state.index.filter((m) => m.userId === id);

// One entry per scanned profile, most recently scanned first.
function profileList() {
  const byId = new Map();
  for (const meta of state.index) {
    if (!byId.has(meta.userId)) byId.set(meta.userId, { id: meta.userId, latest: meta, count: 0 });
    byId.get(meta.userId).count++;
  }
  return [...byId.values()];
}

function nameOf(id) {
  const stored = state.names[id];
  // Very old snapshots stored the account id in place of a username.
  const latest = state.index.find((m) => m.userId === id && m.username && m.username !== id);
  const username = stored?.username || latest?.username || null;
  return { username, fullName: stored?.fullName || latest?.fullName || '', label: username ? `@${username}` : `Account ${id}` };
}

function go(route) {
  Object.assign(state, { route, filter: null, diffLimit: PAGE, listTab: 'followers', query: '', limit: PAGE, armed: null });
  render();
  window.scrollTo({ top: 0 });
}

function latestPair(id) {
  const [newest, previous] = snapshotsOf(id);
  return { aId: previous?.id, bId: newest?.id };
}

function openProfile(id, tab = 'changes') {
  go({ name: 'profile', id, tab, latest: true, ...latestPair(id) });
}

// ---------------------------------------------------------------- layout

function render() {
  const { name } = state.route;
  $('nav-profiles').classList.toggle('active', name !== 'settings');
  $('nav-settings').classList.toggle('active', name === 'settings');
  renderMain();
}

let renderId = 0;
async function renderMain() {
  const id = ++renderId;
  const html = await mainHtml();
  if (id !== renderId) return; // a newer render started while this one was loading
  // Re-rendering replaces the page, so put the cursor back where it was (e.g. in a search box).
  const { id: focused, selectionStart } = document.activeElement ?? {};
  $('main').innerHTML = html;
  for (const input of document.querySelectorAll('#main [data-field]')) input.addEventListener('input', onSearch);
  const restore = focused && $(focused);
  if (restore && restore.closest('#main')) {
    restore.focus();
    if (typeof selectionStart === 'number') restore.setSelectionRange?.(selectionStart, selectionStart);
  }
}

function mainHtml() {
  switch (state.route.name) {
    case 'profile': return profileHtml();
    case 'snapshot': return snapshotHtml();
    case 'settings': return settingsHtml();
    default: return profilesHtml();
  }
}

const emptyState = (icon, title, text) => `<div class="empty"><div class="empty-ic">${I(icon, 26)}</div><h2>${esc(title)}</h2><p>${esc(text)}</p></div>`;
const callout = (text) => `<div class="callout">${I('alert', 16)}<div>${esc(text)}</div></div>`;

function avatar(username, size = '') {
  let hash = 0;
  for (const c of username) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return `<div class="avatar ${size}" style="background:hsl(${hue} 70% 55% / .16);color:hsl(${hue} 55% 50%)">${esc(username[0])}</div>`;
}

function identity(user, sub) {
  return `${avatar(user.username)}
    <div class="who">
      <div class="handle"><span>${esc(user.username)}</span>${user.is_verified ? I('verified', 14) : ''}${user.is_private ? I('lock', 13, 'ic-lock') : ''}</div>
      ${sub ? `<div class="fullname">${sub}</div>` : ''}
    </div>`;
}

const profileLink = (username) => `<a class="open" href="https://www.instagram.com/${encodeURIComponent(username)}/" target="_blank" rel="noopener" title="Open on Instagram">${I('external', 15)}</a>`;

function deleteButton(key, label, confirm, disabled = false) {
  const armed = state.armed === key;
  return `<button class="btn danger ${armed ? 'armed' : ''}" data-act="delete" data-value="${key}" ${disabled ? 'disabled' : ''}>${I('trash', 15)} ${armed ? confirm : label}</button>`;
}

// ---------------------------------------------------------------- profiles (home)

const isPinned = (id) => state.pinned.includes(id);
const pinButton = (id, label = '') => `<button class="pin ${label ? 'btn secondary' : ''} ${isPinned(id) ? 'on' : ''}" data-act="pin" data-value="${id}"
  title="${isPinned(id) ? 'Unpin' : 'Pin to the top'}">${I('pin', 15)}${label ? (isPinned(id) ? ' Pinned' : ' Pin') : ''}</button>`;

const SORTS = {
  recent: ['Last scanned', (a, b) => b.latest.takenAt - a.latest.takenAt],
  name: ['Name', (a, b) => nameOf(a.id).label.localeCompare(nameOf(b.id).label)],
  followers: ['Most followers', (a, b) => b.latest.followerCount - a.latest.followerCount],
  snapshots: ['Most snapshots', (a, b) => b.count - a.count],
};

function profilesHtml() {
  const all = profileList();
  if (!all.length) {
    return emptyState('users', 'No profiles yet', 'Open any profile on instagram.com whose followers you can see (your own included), click the Follower Diff icon in the toolbar, and run a scan. Scanned profiles appear here.');
  }
  const query = state.profileQuery.trim().toLowerCase().replace(/^@/, '');
  const profiles = all
    .filter(({ id }) => !query || `${nameOf(id).username ?? ''} ${nameOf(id).fullName}`.toLowerCase().includes(query))
    .sort((a, b) => isPinned(b.id) - isPinned(a.id) || SORTS[state.profileSort][1](a, b));
  const sortOptions = Object.entries(SORTS).map(([key, [label]]) => `<option value="${key}" ${key === state.profileSort ? 'selected' : ''}>${label}</option>`).join('');
  return `
    <div class="page-head"><div><h1>Profiles</h1><div class="page-sub">${plural(all.length, 'profile')} · ${plural(state.index.length, 'snapshot')}</div></div></div>
    <div class="profile-tools">
      <label class="search">${I('search', 16)}<input id="profile-search" data-field="profileQuery" type="search" placeholder="Search profiles" value="${esc(state.profileQuery)}"></label>
      <select class="select" id="profile-sort" aria-label="Sort profiles">${sortOptions}</select>
    </div>
    ${profiles.length ? '' : '<div class="list-card"><div class="empty-row">No matches.</div></div>'}
    <div class="profile-grid">${profiles.map(({ id, latest, count }) => {
      const { username, fullName, label } = nameOf(id);
      return `<div class="profile-card" role="link" tabindex="0" data-act="profile" data-value="${id}">
        <div class="profile-card-head">
          <div class="acct-cell">${avatar(username || '?')}<div class="who">
            <div class="handle"><span>${esc(fullName || label)}</span></div>
            ${fullName ? `<div class="fullname">${esc(label)}</div>` : ''}
          </div></div>
          ${pinButton(id)}
        </div>
        <div class="profile-stats">
          <div><b>${fmt(latest.followerCount)}</b><span>followers</span></div>
          <div><b>${fmt(latest.followingCount)}</b><span>following</span></div>
        </div>
        <div class="profile-foot">${plural(count, 'snapshot')} · last ${esc(formatDate(latest.takenAt, DAY))}</div>
      </div>`;
    }).join('')}</div>`;
}

// ---------------------------------------------------------------- one profile

function profileHead(id) {
  const { username, fullName, label } = nameOf(id);
  const count = snapshotsOf(id).length;
  return `<button class="back" data-act="nav-profiles">${I('arrow-left', 15)} Profiles</button>
    <div class="profile-head">
      ${avatar(username || '?', 'lg')}
      <div class="grow"><h1>${esc(fullName || label)}</h1><div class="page-sub">${fullName ? `${esc(label)} · ` : ''}${plural(count, 'snapshot')}</div></div>
      <div class="actions">
        ${pinButton(id, 'Pin')}
        ${username ? `<a class="btn secondary" href="https://www.instagram.com/${encodeURIComponent(username)}/" target="_blank" rel="noopener">${I('external', 15)} Instagram</a>` : ''}
        ${deleteButton(`profile:${id}`, 'Delete', 'Click again to delete')}
      </div>
    </div>`;
}

async function profileHtml() {
  const { id, tab } = state.route;
  const snapshots = snapshotsOf(id);
  const tabButton = (key, text) => `<button class="${tab === key ? 'on' : ''}" data-act="tab" data-value="${key}">${text}</button>`;
  const body = tab === 'snapshots' ? snapshotListHtml(snapshots) : await changesHtml(snapshots);
  return `${profileHead(id)}
    <div class="tabbar"><div class="seg">${tabButton('changes', 'Changes')}${tabButton('snapshots', `Snapshots · ${snapshots.length}`)}</div></div>
    ${body}`;
}

// The first trash click turns delete mode on (all bins light up); then each click deletes.
function snapshotListHtml(snapshots) {
  const deleting = state.armed === 'rows';
  return `${deleting ? '<p class="list-hint">Delete mode: each bin deletes its snapshot right away.</p>' : ''}
    <div class="list-card">${snapshots.map((m) => `
    <div class="snap-row">
      <button class="bin ${deleting ? 'on' : ''}" data-act="delete-row" data-value="${m.id}" title="${deleting ? 'Delete this snapshot' : 'Delete snapshots'}">${I('trash', 15)}</button>
      <button class="snap-open" data-act="snapshot" data-value="${m.id}">
        <span><b>${esc(formatDate(m.takenAt, FULL))}</b> <span class="muted">· ${m.method === 'auto' ? 'Automatic' : 'Manual'}</span>
          ${m.complete === false ? `<span class="snap-warn" title="Fewer accounts than Instagram's counter">${I('alert', 13)}</span>` : ''}</span>
        <span class="muted">${fmt(m.followerCount)} followers</span>
        <span class="muted">${fmt(m.followingCount)} following</span>
        ${I('chevron-right', 16)}
      </button>
    </div>`).join('')}</div>`;
}

async function changesHtml(snapshots) {
  if (snapshots.length < 2) {
    return `<div class="list-card">${emptyState('compare', 'One snapshot so far', 'Changes show up once this profile has two snapshots. Scan it again some time later.')}</div>`;
  }
  let a = await ST.getSnapshot(state.route.aId);
  let b = await ST.getSnapshot(state.route.bId);
  if (!a || !b) return '';
  if (a.takenAt > b.takenAt) [a, b] = [b, a];
  const d = DF.diff(a, b);
  const incomplete = snapshots.some((m) => (m.id === a.id || m.id === b.id) && m.complete === false);

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
  const options = (selected) => snapshots.map((m) => `<option value="${m.id}" ${m.id === selected ? 'selected' : ''}>${esc(formatDate(m.takenAt, FULL))}</option>`).join('');
  const filterLabel = !filter ? ''
    : filter.col === 'r' ? 'changed username'
    : `${filter.v > 0 ? 'added to' : 'removed from'} ${filter.col === 'f' ? 'followers' : 'following'}`;

  const table = d.rows.length ? `
    <div class="list-card">
      <div class="diff-tools">
        ${filter
          ? `<span class="filter-pill">Only ${esc(filterLabel)} <button class="x" data-act="filter" data-value="clear" title="Clear filter">${I('x', 13)}</button></span>`
          : `<span class="muted">${plural(d.rows.length, 'account')} changed</span>`}
        <span class="legend"><span class="cell add">+1</span> added <span class="cell rem">−1</span> removed <span class="cell same">${I('check', 13)}</span> unchanged, yes <span class="cell none">–</span> unchanged, no</span>
      </div>
      <div class="diff-scroll"><div class="diff">
        <div class="diff-row diff-head"><span>Account</span><span>Follower</span><span>Following</span><span></span></div>
        ${visible.map(diffRow).join('')}
      </div></div>
      ${rows.length > visible.length ? `<button class="section-more" data-act="more-rows">Show ${fmt(Math.min(PAGE, rows.length - visible.length))} more</button>` : ''}
    </div>`
    : `<div class="list-card">${emptyState('check-circle', 'Nothing changed', 'Same followers and same following in both snapshots.')}</div>`;

  return `
    <div class="range compare-range">
      <select class="select" id="sel-a" aria-label="Older snapshot">${options(a.id)}</select>
      ${I('arrow-right', 16)}
      <select class="select" id="sel-b" aria-label="Newer snapshot">${options(b.id)}</select>
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
  const { id, snapId } = state.route;
  const s = await ST.getSnapshot(snapId);
  if (!s) return '';
  const lists = {
    followers: { label: 'Followers', users: s.followers },
    following: { label: 'Following', users: s.following },
    nfb: { label: 'Don\'t follow back', users: DF.notFollowingBack(s), note: 'Followed by this profile, but not following it back.' },
    fans: { label: 'Not followed back', users: DF.fans(s), note: 'Following this profile, but not followed back by it.' },
  };
  const current = lists[state.listTab] ?? lists.followers;
  const query = state.query.trim().toLowerCase().replace(/^@/, '');
  const matches = query
    ? current.users.filter((u) => u.username.toLowerCase().includes(query) || (u.full_name || '').toLowerCase().includes(query))
    : current.users;
  const visible = matches.slice(0, state.limit);

  const counter = [];
  if (s.expectedFollowers != null && s.expectedFollowers !== s.followers.length) counter.push(`${fmt(s.expectedFollowers)} followers`);
  if (s.expectedFollowing != null && s.expectedFollowing !== s.following.length) counter.push(`${fmt(s.expectedFollowing)} following`);

  return `
    <button class="back" data-act="profile" data-value="${id}" data-tab="snapshots">${I('arrow-left', 15)} ${esc(nameOf(id).label)}</button>
    <div class="page-head">
      <div>
        <h1>${esc(formatDate(s.takenAt, FULL))}</h1>
        <div class="page-sub">${s.method === 'auto' ? 'Automatic scan' : 'Manual capture'}${counter.length ? ` · Instagram's counter said ${esc(counter.join(' and '))}` : ''}</div>
      </div>
      ${deleteButton(`snapshot:${s.id}`, 'Delete', 'Click again to delete')}
    </div>
    <div class="tiles">
      ${Object.entries(lists).map(([key, l]) => `<button class="tile ${l === current ? 'active' : ''}" data-act="list" data-value="${key}">
        <span class="tile-n">${fmt(l.users.length)}</span><span class="tile-l">${esc(l.label)}</span></button>`).join('')}
    </div>
    <div class="list-card">
      <div class="list-tools">
        <label class="search">${I('search', 16)}<input id="search" data-field="query" type="search" placeholder="Search ${esc(current.label.toLowerCase())}" value="${esc(state.query)}"></label>
      </div>
      ${current.note ? `<div class="list-note">${esc(current.note)}</div>` : ''}
      <ul class="users">${visible.map((u) => `<li class="user">${identity(u, esc(u.full_name))}${profileLink(u.username)}</li>`).join('') || `<li class="empty-row">${query ? 'No matches.' : 'Nobody here.'}</li>`}</ul>
      ${matches.length > visible.length ? `<button class="section-more" data-act="more-users">Show ${fmt(Math.min(PAGE * 2, matches.length - visible.length))} more</button>` : ''}
    </div>`;
}

function onSearch(e) {
  state[e.target.dataset.field] = e.target.value;
  state.limit = PAGE;
  renderMain();
}

// ---------------------------------------------------------------- settings

async function settingsHtml() {
  const { theme, accent } = THEME.read();
  const { pace } = await ST.getSettings();
  const bytes = await ST.bytesInUse();
  const size = bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

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
        ${setting('Stored in this browser', `${plural(profileList().length, 'profile')} · ${plural(state.index.length, 'snapshot')} · ${size}. To delete one profile, open it and press Delete. Settings are kept.`,
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

// Timers keep running in background tabs while animation frames don't, so the toast is shown
// directly and its hide timer only starts once the page is visible.
let toastTimer = null;
function toast(text, kind = 'info') {
  const el = $('toast');
  clearTimeout(toastTimer);
  const icon = kind === 'busy' ? '<span class="spin"></span>' : I(kind === 'error' ? 'alert' : 'check-circle', 16);
  el.innerHTML = `${icon}<span>${esc(text)}</span>`;
  el.classList.toggle('error', kind === 'error');
  el.classList.add('show');
  if (kind !== 'busy') whenVisible(() => { toastTimer = setTimeout(() => el.classList.remove('show'), 5000); });
}

function whenVisible(fn) {
  if (!document.hidden) return fn();
  document.addEventListener('visibilitychange', function wait() {
    if (document.hidden) return;
    document.removeEventListener('visibilitychange', wait);
    fn();
  });
}

function showScan(s) {
  if (!s || s.dismissed) return;
  const who = s.profile?.username ? ` @${s.profile.username}` : '';
  if (ST.isAlive(s)) {
    const n = s.stage === 'following' ? s.following : s.followers;
    toast(`Scanning${who} · ${s.stage} ${fmt(n ?? 0)}`, 'busy');
  } else if (s.error) toast(s.error, 'error');
  else if (s.done) toast(`New snapshot of${who || ' a profile'} saved.`);
  else $('toast').classList.remove('show');
}

// ---------------------------------------------------------------- events

let armToken = 0;
function arm(key, ms = 4000) {
  state.armed = key;
  const token = ++armToken;
  setTimeout(() => {
    if (token !== armToken || state.armed !== key) return;
    state.armed = null;
    renderMain();
  }, ms);
  renderMain();
}

async function remove(key) {
  if (state.armed !== key) return arm(key);
  state.armed = null;
  const [kind, id] = key.split(':');
  if (kind === 'all') {
    await ST.deleteAll();
    toast('All data deleted.');
  } else if (kind === 'profile') {
    await ST.deleteProfile(id);
    go({ name: 'profiles' });
    toast('Profile deleted.');
  } else {
    await ST.deleteSnapshot(id);
    toast('Snapshot deleted.');
  }
}

const actions = {
  'nav-profiles': () => go({ name: 'profiles' }),
  'nav-settings': () => go({ name: 'settings' }),
  profile: (id, target) => openProfile(id, target.dataset.tab),
  snapshot: (snapId) => go({ name: 'snapshot', id: state.route.id, snapId }),
  tab: (tab) => openProfile(state.route.id, tab),
  list: (listTab) => { Object.assign(state, { listTab, query: '', limit: PAGE }); renderMain(); },
  'more-users': () => { state.limit += PAGE * 2; renderMain(); },
  'more-rows': () => { state.diffLimit += PAGE; renderMain(); },
  filter: (value) => {
    const [col, v] = value.split(':');
    const same = state.filter?.col === col && state.filter.v === Number(v);
    state.filter = col === 'clear' || same ? null : { col, v: Number(v) };
    state.diffLimit = PAGE;
    renderMain();
  },
  delete: (key) => remove(key),
  'delete-row': async (snapId) => {
    const deleting = state.armed === 'rows';
    arm('rows', 10000); // stays on while you keep deleting
    if (deleting) await ST.deleteSnapshot(snapId);
  },
  pin: async (id) => { await ST.togglePin(id); },
  theme: (theme) => { THEME.set({ theme }); renderMain(); },
  accent: (accent) => { THEME.set({ accent }); renderMain(); },
  pace: async (pace) => { await ST.setSettings({ pace }); renderMain(); },
};

document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-act]');
  actions[target?.dataset.act]?.(target.dataset.value, target);
});

// Profile cards are not buttons (they contain one), so make them keyboard-friendly.
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="link"][data-act]')) {
    e.preventDefault();
    e.target.click();
  }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'sel-a' || e.target.id === 'sel-b') {
    go({ ...state.route, latest: false, aId: $('sel-a').value, bId: $('sel-b').value });
  } else if (e.target.id === 'profile-sort') {
    state.profileSort = e.target.value;
    renderMain();
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
  if (changes.snapshots_index || changes.profiles || changes.settings) {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(load, 300);
  }
});

$('logo').innerHTML = I('logo', 26);
$('btn-export').innerHTML = `${I('download', 16)}<span class="label">Export</span>`;
$('btn-import').innerHTML = `${I('upload', 16)}<span class="label">Import</span>`;
$('nav-profiles').innerHTML = `${I('users', 18)} Profiles`;
$('nav-settings').innerHTML = `${I('sliders', 18)} Settings`;

load().then(openFromHash);
window.addEventListener('hashchange', openFromHash);
chrome.storage.local.get('scan_state').then(({ scan_state: s }) => { if (ST.isAlive(s)) showScan(s); });
