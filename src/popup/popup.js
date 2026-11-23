const ST = globalThis.FD_Storage;
const PR = globalThis.FD_Progress;
const I = globalThis.FD_Icons.icon;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n).toLocaleString();

const state = {
  view: 'loading', // loading | notab | reload | login | main
  tab: null,
  viewerId: null,
  page: null, // the profile open in the tab, or null
  pageError: null,
  index: [],
  profiles: {},
  pace: 'normal',
  scan: null,
  capture: null,
  error: null,
};

function ago(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const days = Math.floor(s / 86400);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(ts).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function scanVisible(s) {
  if (!s || (s.viewerId && s.viewerId !== state.viewerId)) return false;
  if (s.running) return ST.isAlive(s);
  return (s.done || s.error) && !s.dismissed && Date.now() - (s.updatedAt || 0) < 30 * 60 * 1000;
}

async function findInstagramTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs.find((t) => t.id === active?.id) ?? tabs.find((t) => t.windowId === active?.windowId) ?? tabs[0] ?? null;
}

async function command(msg) {
  const res = await chrome.tabs.sendMessage(state.tab.id, msg);
  if (!res?.ok) throw new Error(res?.error || 'Something went wrong.');
  return res;
}

async function focusTab() {
  await chrome.tabs.update(state.tab.id, { active: true });
  await chrome.windows.update(state.tab.windowId, { focused: true });
}

const dismissScan = () => chrome.storage.local.set({ scan_state: { ...state.scan, dismissed: true } });

// Reuses an open dashboard tab. The hash tells it which profile to show.
async function openDashboard(hash = '') {
  const base = chrome.runtime.getURL('src/dashboard/dashboard.html');
  const [open] = await chrome.runtime.getContexts({ contextTypes: ['TAB'] })
    .then((contexts) => contexts.filter((c) => c.documentUrl?.startsWith(base)));
  if (!open) return chrome.tabs.create({ url: base + hash });
  await chrome.tabs.update(open.tabId, { url: base + hash, active: true });
  await chrome.windows.update(open.windowId, { focused: true });
}

// ---------------------------------------------------------------- views

function messageView(icon, title, text, action, label) {
  return `<div class="state"><div class="state-ic">${I(icon, 24)}</div><h2>${title}</h2><p>${text}</p>
    ${action ? `<button class="btn" data-act="${action}">${label}</button>` : ''}</div>`;
}

// Clickable once the profile has snapshots: opens them in the dashboard.
function profileCard({ id, username, fullName, isPrivate, isVerified }) {
  const last = state.index.find((m) => m.userId === id);
  const name = fullName || state.profiles[id]?.fullName || `@${username}`;
  const sub = last
    ? `${fmt(last.followerCount)} followers · ${fmt(last.followingCount)} following · ${ago(last.takenAt)}`
    : 'No snapshots yet';
  const badges = `${isVerified ? I('verified', 14) : ''}${isPrivate ? I('lock', 13, 'ic-lock') : ''}`;
  const content = `<div class="avatar">${esc(username[0])}</div>
    <div class="acct-text">
      <div class="acct-name"><span>${esc(name)}</span>${badges}</div>
      <div class="acct-sub">@${esc(username)}</div>
      <div class="acct-sub">${esc(sub)}</div>
    </div>`;
  return last
    ? `<button class="acct linked" data-act="open-profile" data-value="${id}" title="See all snapshots">${content}<span class="chev">${I('chevron-right', 16)}</span></button>`
    : `<div class="acct">${content}</div>`;
}

// Seconds per page of 25, including the longer pause every 10 pages.
const SECONDS_PER_PAGE = { normal: 2.6, careful: 5.2 };

function scanEstimate({ followerCount, followingCount }) {
  if (followerCount == null || followingCount == null) return 'Fetches both lists for you. About a minute per 1,000 accounts.';
  const pages = Math.ceil(followerCount / 25) + Math.ceil(followingCount / 25);
  const minutes = Math.max(1, Math.round((pages * SECONDS_PER_PAGE[state.pace] + 5) / 60));
  return `Fetches both lists for you. About ${minutes} min for ${fmt(followerCount + followingCount)} accounts.`;
}

function optionsView(page) {
  const option = (act, icon, title, desc, disabled = false) => `
    <button class="option" data-act="${act}" ${disabled ? 'disabled' : ''}>
      <span class="option-ic">${I(icon, 18)}</span>
      <span class="option-body"><span class="option-title">${title}</span><span class="option-desc">${desc}</span></span>
      <span class="chev">${I('chevron-right', 16)}</span>
    </button>`;
  const tooLarge = `Too large: over ${fmt(ST.MAX_LIST)} followers or following.`;
  return `
    <div class="section-label">New snapshot</div>
    <div class="options">
      ${option('auto', 'refresh', 'Automatic scan', page.tooLarge ? tooLarge : scanEstimate(page), page.tooLarge)}
      ${option('manual', 'pointer', 'Manual capture', page.tooLarge ? tooLarge : 'You scroll the lists on Instagram, the extension only listens.', page.tooLarge)}
    </div>`;
}

function captureView() {
  const c = state.capture;
  const kind = c.step === 'following' ? 'following' : 'followers';
  const label = kind === 'followers' ? 'Followers' : 'Following';
  const count = c[kind].length;
  const total = kind === 'followers' ? c.profile.followerCount : c.profile.followingCount;

  let hint = '<div class="hint">Keep scrolling until the list stops loading.</div>';
  if (ST.isComplete(count, total)) hint = `<div class="hint ok">${I('check-circle', 15)} Looks complete</div>`;
  else if (count === 0) hint = `<div class="hint">Open the ${label} list on Instagram and scroll to the very bottom. The number on the toolbar icon goes up as accounts load. Come back here when it stops.</div>`;

  const next = kind === 'followers'
    ? `<button class="btn" data-act="step-following" ${c.followers.length ? '' : 'disabled'}>Next: Following ${I('arrow-right', 15)}</button>`
    : `<button class="btn" data-act="save" ${c.following.length ? '' : 'disabled'}>Save snapshot</button>`;
  const step = (name, text) => `<button class="${kind === name ? 'on' : ''}" data-act="step-${name}">${text} <span class="n">${c[name].length || ''}</span></button>`;

  const stale = Date.now() - c.startedAt > 30 * 60 * 1000
    ? `<div class="note">Started ${ago(c.startedAt)}. The lists may have changed since then; for an exact snapshot, discard and start over.</div>`
    : '';

  return profileCard(c.profile) + `<div class="card">
      <div class="seg">${step('followers', '1 · Followers')}${step('following', '2 · Following')}</div>
      <div class="big"><b>${fmt(count)}</b><span>${total != null ? `of ${fmt(total)} ` : ''}${label.toLowerCase()} captured</span></div>
      ${total ? `<div class="bar"><div class="fill" style="width:${Math.min(100, (count / total) * 100).toFixed(1)}%"></div></div>` : ''}
      ${hint}
      ${stale}
      <button class="link" data-act="open-${kind}">Open @${esc(c.profile.username)}'s ${label} list ${I('arrow-right', 14)}</button>
      <div class="row">
        <button class="btn icon secondary" data-act="discard" title="Discard this capture">${I('trash', 16)}</button>
        ${next}
      </div>
    </div>`;
}

function scanView() {
  const s = state.scan;
  const target = s.profile ? profileCard(s.profile) : '';
  if (s.running) {
    return target + `<div class="card">
        <div class="card-head">Scanning</div>
        ${PR.render(s)}
        ${s.note ? `<div class="note">${esc(s.note)}</div>` : ''}
        <div class="row"><button class="btn secondary" data-act="cancel">Cancel</button></div>
      </div>
      <p class="hint">You can close this popup. The scan keeps running in the Instagram tab.</p>`;
  }
  if (s.error) {
    return target + `<div class="card">
        <div class="card-head bad">${I('alert', 16)} Scan stopped</div>
        <p>${esc(s.error)}</p>
        <div class="row"><button class="btn secondary" data-act="dismiss">Dismiss</button></div>
      </div>`;
  }
  return target + `<div class="card">
      <div class="card-head good">${I('check-circle', 18)} Snapshot saved</div>
      <p>${fmt(s.followers || 0)} followers · ${fmt(s.following || 0)} following</p>
      <div class="row">
        <button class="btn secondary" data-act="dismiss">Done</button>
        <button class="btn" data-act="dashboard">View changes ${I('arrow-right', 15)}</button>
      </div>
    </div>`;
}

function pageView() {
  if (state.pageError) {
    return messageView('alert', 'Couldn\'t load this profile', esc(state.pageError), 'retry', 'Try again');
  }
  const page = state.page;
  if (!page) {
    return messageView('users', 'Open a profile', 'Go to any Instagram profile whose followers you can see, including your own, then open this menu again.');
  }
  if (!page.canView) {
    return profileCard(page) + `<div class="card">
        <div class="card-head">${I('lock', 16)} Private account</div>
        <p>You can only scan @${esc(page.username)} if you follow them.</p>
      </div>`;
  }
  return profileCard(page) + optionsView(page);
}

const SETUP_VIEWS = {
  notab: ['globe', 'Open Instagram first', 'Follower Diff works inside an instagram.com tab, using the session you are already logged in with.', 'open-ig', 'Open instagram.com'],
  reload: ['refresh', 'Reload Instagram', 'The extension was just installed or updated, so the Instagram tab needs a refresh before it can connect.', 'reload', 'Reload the tab'],
  login: ['log-in', 'Log in to Instagram', 'You don\'t seem to be logged in on instagram.com in this browser.', 'focus', 'Go to Instagram'],
};

function render() {
  const app = $('app');
  if (state.view === 'loading') app.innerHTML = '';
  else if (SETUP_VIEWS[state.view]) app.innerHTML = messageView(...SETUP_VIEWS[state.view]);
  else {
    const body = state.capture ? captureView() : scanVisible(state.scan) ? scanView() : pageView();
    app.innerHTML = body + (state.error ? `<div class="error-line">${esc(state.error)}</div>` : '');
  }
}

// ---------------------------------------------------------------- data

async function loadData() {
  state.index = await ST.listSnapshots();
  state.profiles = await ST.getProfiles();
  ({ pace: state.pace } = await ST.getSettings());
}

function setCapture(capture) {
  state.capture = capture?.scannedBy === state.viewerId ? capture : null;
}

async function loadPage() {
  state.page = null;
  state.pageError = null;
  try {
    ({ profile: state.page } = await command({ type: 'getProfile' }));
  } catch (err) {
    state.pageError = err.message;
  }
}

async function init() {
  const stored = await chrome.storage.local.get(['scan_state', 'manual_buffer']);
  state.scan = stored.scan_state ?? null;

  state.tab = await findInstagramTab();
  if (!state.tab) state.view = 'notab';
  else {
    const res = await chrome.tabs.sendMessage(state.tab.id, { type: 'ping' }).catch(() => null);
    if (!res) state.view = 'reload';
    else if (!res.userId) state.view = 'login';
    else {
      state.viewerId = res.userId;
      setCapture(stored.manual_buffer);
      await Promise.all([loadData(), loadPage()]);
      state.view = 'main';
    }
  }
  render();
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || state.view !== 'main') return;
  if (changes.scan_state) state.scan = changes.scan_state.newValue ?? null;
  if (changes.manual_buffer) setCapture(changes.manual_buffer.newValue);
  if (changes.snapshots_index || changes.profiles) await loadData();
  render();
});

// ---------------------------------------------------------------- actions

const actions = {
  'open-ig': async () => { await chrome.tabs.create({ url: 'https://www.instagram.com/' }); window.close(); },
  reload: async () => { await chrome.tabs.reload(state.tab.id); window.close(); },
  focus: async () => { await focusTab(); window.close(); },
  retry: async () => { await loadPage(); render(); },
  dashboard: async () => {
    if (state.scan && !state.scan.running) await dismissScan();
    await openDashboard(state.scan?.profile ? `#profile/${state.scan.profile.id}` : '');
  },
  'open-profile': (id) => openDashboard(`#profile/${id}/snapshots`),
  dismiss: dismissScan,
  auto: () => command({ type: 'startAuto', profileId: state.page?.id }),
  manual: () => command({ type: 'startManual', profileId: state.page?.id }),
  cancel: () => command({ type: 'cancel' }),
  discard: () => command({ type: 'discardManual' }),
  save: () => command({ type: 'saveManual' }),
  'step-followers': () => command({ type: 'manualStep', step: 'followers' }),
  'step-following': () => command({ type: 'manualStep', step: 'following' }),
  // Send first: focusing the tab can close the popup, and a page navigation can drop the reply.
  'open-followers': () => { command({ type: 'openList', kind: 'followers' }).catch(() => {}); return focusTab(); },
  'open-following': () => { command({ type: 'openList', kind: 'following' }).catch(() => {}); return focusTab(); },
};

document.addEventListener('click', async (e) => {
  const target = e.target.closest('[data-act]');
  const action = actions[target?.dataset.act];
  if (!action) return;
  state.error = null;
  try {
    await action(target.dataset.value);
  } catch (err) {
    const lost = /Receiving end does not exist|Could not establish connection/i.test(err.message);
    state.error = lost ? 'Lost contact with the Instagram tab. Reload it and try again.' : err.message;
    render();
  }
});

$('logo').innerHTML = I('logo', 24);
$('btn-dashboard').innerHTML = I('history', 18);
$('btn-dashboard').addEventListener('click', () => openDashboard());
const style = document.createElement('style');
style.textContent = PR.css;
document.head.append(style);

init();
