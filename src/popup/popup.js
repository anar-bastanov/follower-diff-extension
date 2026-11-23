const ST = globalThis.FD_Storage;
const PR = globalThis.FD_Progress;
const I = globalThis.FD_Icons.icon;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n).toLocaleString();

const state = {
  view: 'loading', // loading | notab | reload | login | main
  tab: null,
  userId: null,
  username: null,
  last: null,
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
  if (!s || (s.userId && s.userId !== state.userId)) return false;
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
const openDashboard = () => chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/dashboard.html') });

// ---------------------------------------------------------------- views

function messageView(icon, title, text, action, label) {
  return `<div class="state"><div class="state-ic">${I(icon, 24)}</div><h2>${title}</h2><p>${text}</p>
    <button class="btn" data-act="${action}">${label}</button></div>`;
}

function accountView() {
  const name = state.username ? `@${state.username}` : 'Your account';
  const sub = state.last
    ? `${fmt(state.last.followerCount)} followers · ${fmt(state.last.followingCount)} following · ${ago(state.last.takenAt)}`
    : 'No snapshots yet';
  return `<div class="acct"><div class="avatar">${esc((state.username || '?')[0])}</div>
    <div><div class="acct-name">${esc(name)}</div><div class="acct-sub">${esc(sub)}</div></div></div>`;
}

function optionsView() {
  const option = (act, icon, title, desc) => `
    <button class="option" data-act="${act}">
      <span class="option-ic">${I(icon, 18)}</span>
      <span class="option-body"><span class="option-title">${title}</span><span class="option-desc">${desc}</span></span>
      <span class="chev">${I('chevron-right', 16)}</span>
    </button>`;
  return `
    <div class="section-label">New snapshot</div>
    <div class="options">
      ${option('auto', 'refresh', 'Automatic scan', 'Fetches both lists for you. About a minute per 1,000 accounts.')}
      ${option('manual', 'pointer', 'Manual capture', 'You scroll the lists on Instagram, the extension only listens.')}
    </div>`;
}

function captureView() {
  const c = state.capture;
  const kind = c.step === 'following' ? 'following' : 'followers';
  const label = kind === 'followers' ? 'Followers' : 'Following';
  const count = c[kind].length;
  const total = kind === 'followers' ? c.me.followerCount : c.me.followingCount;

  let hint = '<div class="hint">Keep scrolling until the list stops loading.</div>';
  if (ST.isComplete(count, total)) hint = `<div class="hint ok">${I('check-circle', 15)} Looks complete</div>`;
  else if (count === 0) hint = `<div class="hint">Open your ${label} list on Instagram and scroll to the very bottom. The number on the toolbar icon goes up as accounts load. Come back here when it stops.</div>`;

  const next = kind === 'followers'
    ? `<button class="btn" data-act="step-following" ${c.followers.length ? '' : 'disabled'}>Next: Following ${I('arrow-right', 15)}</button>`
    : `<button class="btn" data-act="save" ${c.following.length ? '' : 'disabled'}>Save snapshot</button>`;
  const step = (name, text) => `<button class="${kind === name ? 'on' : ''}" data-act="step-${name}">${text} <span class="n">${c[name].length || ''}</span></button>`;

  return `<div class="card">
      <div class="seg">${step('followers', '1 · Followers')}${step('following', '2 · Following')}</div>
      <div class="big"><b>${fmt(count)}</b><span>${total != null ? `of ${fmt(total)} ` : ''}${label.toLowerCase()} captured</span></div>
      ${total ? `<div class="bar"><div class="fill" style="width:${Math.min(100, (count / total) * 100).toFixed(1)}%"></div></div>` : ''}
      ${hint}
      ${c.me.username ? `<button class="link" data-act="open-${kind}">Open my ${label} list ${I('arrow-right', 14)}</button>` : ''}
      <div class="row">
        <button class="btn icon secondary" data-act="discard" title="Discard this capture">${I('trash', 16)}</button>
        ${next}
      </div>
    </div>`;
}

function scanView() {
  const s = state.scan;
  const viewChanges = `<button class="btn" data-act="dashboard">View changes ${I('arrow-right', 15)}</button>`;
  if (s.running) {
    return `<div class="card">
        <div class="card-head">Scanning</div>
        ${PR.render(s)}
        ${s.note ? `<div class="note">${esc(s.note)}</div>` : ''}
        <div class="row"><button class="btn secondary" data-act="cancel">Cancel</button></div>
      </div>
      <p class="hint">You can close this popup. The scan keeps running in the Instagram tab.</p>`;
  }
  if (s.error) {
    return `<div class="card">
        <div class="card-head bad">${I('alert', 16)} Scan stopped</div>
        <p>${esc(s.error)}</p>
        <div class="row"><button class="btn secondary" data-act="dismiss">Dismiss</button></div>
      </div>`;
  }
  return `<div class="card">
      <div class="card-head good">${I('check-circle', 18)} Snapshot saved</div>
      <p>${fmt(s.followers || 0)} followers · ${fmt(s.following || 0)} following</p>
      <div class="row"><button class="btn secondary" data-act="dismiss">Done</button>${viewChanges}</div>
    </div>`;
}

function render() {
  const app = $('app');
  if (state.view === 'loading') app.innerHTML = '';
  else if (state.view === 'notab') {
    app.innerHTML = messageView('globe', 'Open Instagram first', 'Follower Diff works inside an instagram.com tab, using the session you are already logged in with.', 'open-ig', 'Open instagram.com');
  } else if (state.view === 'reload') {
    app.innerHTML = messageView('refresh', 'Reload Instagram', 'The extension was just installed or updated, so the Instagram tab needs a refresh before it can connect.', 'reload', 'Reload the tab');
  } else if (state.view === 'login') {
    app.innerHTML = messageView('log-in', 'Log in to Instagram', 'You don\'t seem to be logged in on instagram.com in this browser.', 'focus', 'Go to Instagram');
  } else {
    const body = state.capture ? captureView() : scanVisible(state.scan) ? scanView() : optionsView();
    app.innerHTML = accountView() + body + (state.error ? `<div class="error-line">${esc(state.error)}</div>` : '');
  }
}

// ---------------------------------------------------------------- data

async function loadAccount() {
  state.username = (await ST.getAccounts())[state.userId]?.username ?? null;
  [state.last] = await ST.listSnapshots(state.userId);
}

function setCapture(capture) {
  state.capture = capture?.me.userId === state.userId ? capture : null;
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
      state.userId = res.userId;
      setCapture(stored.manual_buffer);
      await loadAccount();
      state.view = 'main';
    }
  }
  render();
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || state.view !== 'main') return;
  if (changes.scan_state) state.scan = changes.scan_state.newValue ?? null;
  if (changes.manual_buffer) setCapture(changes.manual_buffer.newValue);
  if (changes.snapshots_index || changes.accounts) await loadAccount();
  render();
});

// ---------------------------------------------------------------- actions

const actions = {
  'open-ig': async () => { await chrome.tabs.create({ url: 'https://www.instagram.com/' }); window.close(); },
  reload: async () => { await chrome.tabs.reload(state.tab.id); window.close(); },
  focus: async () => { await focusTab(); window.close(); },
  dashboard: async () => {
    if (state.scan && !state.scan.running) await dismissScan();
    openDashboard();
  },
  dismiss: dismissScan,
  auto: () => command({ type: 'startAuto' }),
  manual: () => command({ type: 'startManual' }),
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
  const action = actions[e.target.closest('[data-act]')?.dataset.act];
  if (!action) return;
  state.error = null;
  try {
    await action();
  } catch (err) {
    const lost = /Receiving end does not exist|Could not establish connection/i.test(err.message);
    state.error = lost ? 'Lost contact with the Instagram tab. Reload it and try again.' : err.message;
    render();
  }
});

$('logo').innerHTML = I('logo', 24);
$('btn-dashboard').innerHTML = I('history', 18);
$('btn-dashboard').addEventListener('click', openDashboard);
const style = document.createElement('style');
style.textContent = PR.css;
document.head.append(style);

init();
