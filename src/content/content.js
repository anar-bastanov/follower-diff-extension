// Runs the scans inside the Instagram tab, so they keep going after the popup closes.
// All state is kept in chrome.storage.local; the popup and toolbar badge just display it.
(() => {
  if (window.__followerDiffLoaded) return;
  window.__followerDiffLoaded = true;

  const IG = globalThis.FD_IG;
  const ST = globalThis.FD_Storage;
  const local = chrome.storage.local;
  const myId = () => IG.getCookie('ds_user_id');

  let job = null;
  let scanState = {};
  let knownUsername = null;
  // Your own list pages Instagram loaded since this page opened, so a manual capture
  // started later still includes them.
  const seen = { followers: new Map(), following: new Map() };

  ST.getAccounts().then((accounts) => { knownUsername = accounts[myId()]?.username ?? null; });

  async function remember(me) {
    if (!me.username) return;
    knownUsername = me.username;
    await ST.rememberAccount(me);
  }

  // ---------------------------------------------------------------- automatic scan

  async function publish(patch) {
    scanState = { ...scanState, ...patch, updatedAt: Date.now() };
    await local.set({ scan_state: scanState });
  }

  function errorText(e) {
    if (e?.code === 'aborted') return 'Cancelled. Nothing was saved.';
    if (e?.code === 'rate_limited') return 'Instagram is rate limiting you. Wait an hour or more before trying again. Nothing was saved.';
    return e?.message || String(e);
  }

  async function startAuto() {
    const { scan_state: other, manual_buffer: capture } = await local.get(['scan_state', 'manual_buffer']);
    if (job) throw new Error('A scan is already running.');
    if (ST.isAlive(other)) throw new Error('A scan is already running in another Instagram tab.');
    if (capture?.me.userId === myId()) throw new Error('Finish or discard the manual capture first.');
    runAuto();
  }

  async function runAuto() {
    const controller = new AbortController();
    job = controller;
    scanState = {};
    const { signal } = controller;
    const { pace } = await ST.getSettings();
    const options = {
      signal,
      pace,
      onWait: (ms) => publish({ waitUntil: Date.now() + ms, note: `Instagram asked us to slow down. Pausing ${ms / 1000}s, then continuing.` }),
    };

    try {
      await publish({
        running: true, done: false, error: null, dismissed: false, note: null, waitUntil: null,
        mode: 'auto', stage: 'account', userId: myId(), startedAt: Date.now(), snapshotId: null,
        followers: null, following: null, expectedFollowers: null, expectedFollowing: null,
      });
      const me = await IG.getMe(signal);
      await remember(me);
      me.username ??= knownUsername;

      await publish({ stage: 'followers', followers: 0, expectedFollowers: me.followerCount, expectedFollowing: me.followingCount });
      const followers = await IG.fetchList(me.userId, 'followers', {
        ...options, onProgress: (n) => publish({ followers: n, waitUntil: null, note: null }),
      });

      await publish({ stage: 'following', following: 0 });
      await IG.sleep(2500 + Math.random() * 2500, signal);
      const following = await IG.fetchList(me.userId, 'following', {
        ...options, onProgress: (n) => publish({ following: n, waitUntil: null, note: null }),
      });

      if (myId() !== me.userId) {
        throw new Error('You switched Instagram accounts during the scan. Nothing was saved.');
      }
      // An empty list where there should be accounts is a broken response, not an unfollow wave.
      const [previous] = await ST.listSnapshots(me.userId);
      const suspicious = (list, count, before) => list.length === 0 && (count ?? before ?? 0) > 0;
      if (suspicious(followers, me.followerCount, previous?.followerCount) || suspicious(following, me.followingCount, previous?.followingCount)) {
        throw new Error('Instagram returned an empty list, so nothing was saved. Try again later.');
      }
      const snapshot = await ST.saveSnapshot(ST.buildSnapshot(me, followers, following, 'auto'));
      await publish({ running: false, done: true, snapshotId: snapshot.id, note: null });
    } catch (e) {
      await publish({ running: false, error: errorText(e), note: null }).catch(() => {});
    } finally {
      job = null;
    }
  }

  // ---------------------------------------------------------------- manual capture
  // The capture lives only in storage. A Web Lock (shared by every Instagram tab) makes each
  // read-modify-write atomic, so tabs and popup commands never overwrite each other.

  function updateCapture(change) {
    return navigator.locks.request('follower-diff-capture', async () => {
      const current = (await local.get('manual_buffer')).manual_buffer ?? null;
      const next = await change(current);
      if (next === undefined) return current;
      await local.set({ manual_buffer: next });
      return next;
    });
  }

  async function startManual() {
    if (job) throw new Error('A scan is already running.');
    const userId = myId();
    if (!userId) throw new Error('You are not logged in to Instagram.');

    await updateCapture((capture) => {
      if (capture?.me.userId === userId) return undefined;
      const followers = [...seen.followers.values()];
      const following = [...seen.following.values()];
      return {
        startedAt: Date.now(),
        step: following.length && !followers.length ? 'following' : 'followers',
        me: { userId, username: knownUsername, followerCount: null, followingCount: null },
        followers,
        following,
      };
    });

    IG.getMe().then((me) => {
      remember(me);
      return updateCapture((capture) => {
        if (capture?.me.userId !== me.userId) return undefined;
        return { ...capture, me: { ...me, username: me.username ?? capture.me.username } };
      });
    }).catch(() => {});
  }

  async function saveCapture() {
    let snapshot;
    await updateCapture(async (capture) => {
      if (!capture) throw new Error('There is no capture to save.');
      snapshot = await ST.saveSnapshot(ST.buildSnapshot(capture.me, capture.followers, capture.following, 'manual'));
      return null;
    });
    scanState = {};
    await publish({
      running: false, done: true, error: null, dismissed: false, mode: 'manual',
      userId: snapshot.userId, startedAt: Date.now(), snapshotId: snapshot.id,
      followers: snapshot.followers.length, following: snapshot.following.length,
    });
  }

  async function openList(kind) {
    const capture = await updateCapture((c) => (c ? { ...c, step: kind } : undefined));
    const username = knownUsername ?? capture?.me.username;
    if (!username) return;
    const link = document.querySelector(`a[href="/${username}/${kind}/"]`);
    if (link) link.click();
    else location.assign(`/${username}/${kind}/`);
  }

  function ingest({ userId, kind, users }) {
    if (userId !== myId() || (kind !== 'followers' && kind !== 'following')) return;
    const fresh = users.map((u) => IG.normalizeUser(u)).filter(Boolean);
    for (const user of fresh) seen[kind].set(user.pk, user);

    updateCapture((capture) => {
      if (capture?.me.userId !== userId) return undefined;
      const list = new Map(capture[kind].map((u) => [u.pk, u]));
      const before = list.size;
      for (const user of fresh) list.set(user.pk, user);
      if (list.size === before) return undefined;
      return { ...capture, step: kind, [kind]: [...list.values()] };
    });
  }

  window.addEventListener('message', (e) => {
    if (e.source === window && e.data?.__followerDiff) ingest(e.data);
  });

  // ---------------------------------------------------------------- messages from the popup

  const handlers = {
    ping: () => ({ userId: myId() }),
    startAuto,
    startManual,
    saveManual: saveCapture,
    discardManual: async () => { await updateCapture(() => null); },
    manualStep: async ({ step }) => { await updateCapture((c) => (c ? { ...c, step } : undefined)); },
    openList: ({ kind }) => openList(kind),
    cancel: () => { job?.abort(); },
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const handler = handlers[msg?.type];
    if (!handler) return false;
    Promise.resolve()
      .then(() => handler(msg))
      .then((result) => sendResponse({ ok: true, ...result }), (e) => sendResponse({ ok: false, error: e.message }));
    return true;
  });

  // A scan cannot survive a page reload: mark a leftover one as interrupted.
  local.get('scan_state').then(({ scan_state: s }) => {
    if (s?.running && !job && !ST.isAlive(s)) {
      local.set({ scan_state: { ...s, running: false, error: 'Interrupted: the Instagram tab was reloaded or closed.', updatedAt: Date.now() } });
    }
  });

  window.postMessage({ __followerDiffReady: true }, location.origin);
})();
