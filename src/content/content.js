// Runs inside the Instagram tab, so scans keep going after the popup closes. Every scan
// targets the profile open in the tab. State lives in chrome.storage.local; the popup and
// the toolbar badge only display it.
(() => {
  if (window.__followerDiffLoaded) return;
  window.__followerDiffLoaded = true;

  const IG = globalThis.FD_IG;
  const ST = globalThis.FD_Storage;
  const local = chrome.storage.local;
  const viewerId = () => IG.getCookie('ds_user_id');
  const tooLarge = (p) => (p.followerCount ?? 0) > ST.MAX_LIST || (p.followingCount ?? 0) > ST.MAX_LIST;

  let job = null;
  let scanState = {};

  // ---------------------------------------------------------------- what the page has loaded

  // Profiles seen on this page, by lowercase username.
  const profiles = new Map();

  // List entries Instagram loaded recently, so a manual capture started after scrolling still
  // includes them. Kept per logged-in account and profile, and cleared on save or discard.
  const SEEN_FOR_MS = 10 * 60 * 1000;
  const seen = new Map();

  function seenFor(viewer, profileId) {
    const key = `${viewer}:${profileId}`;
    if (!seen.has(key)) seen.set(key, { followers: new Map(), following: new Map() });
    return seen.get(key);
  }

  function recentlySeen(viewer, profileId, kind) {
    const cutoff = Date.now() - SEEN_FOR_MS;
    return [...seenFor(viewer, profileId)[kind].values()].filter((e) => e.at >= cutoff).map((e) => e.user);
  }

  function ingestList({ userId, kind, users }) {
    if (kind !== 'followers' && kind !== 'following') return;
    const fresh = users.map((u) => IG.normalizeUser(u)).filter(Boolean);
    const at = Date.now();
    const lists = seenFor(viewerId(), userId);
    for (const user of fresh) lists[kind].set(user.pk, { user, at });

    updateCapture((capture) => {
      if (capture?.profile.id !== userId || capture.scannedBy !== viewerId()) return undefined;
      const list = new Map(capture[kind].map((u) => [u.pk, u]));
      const before = list.size;
      for (const user of fresh) if (list.size < ST.MAX_LIST) list.set(user.pk, user);
      if (list.size === before) return undefined;
      return { ...capture, step: kind, [kind]: [...list.values()] };
    });
  }

  function ingestProfiles(found) {
    for (const profile of found) {
      const key = profile.username.toLowerCase();
      const known = profiles.get(key);
      if (!known?.detailed) profiles.set(key, { ...(known?.id === profile.id ? known : {}), ...profile });
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data?.__followerDiff) return;
    if (e.data.kind === 'profiles') ingestProfiles(e.data.profiles);
    else ingestList(e.data);
  });

  // ---------------------------------------------------------------- the profile on the page

  // Without `fresh`, what this page already knows is reused, so reopening the popup costs no
  // request. Saved names are only a last resort: a username may belong to someone else now.
  async function pageProfile({ fresh }) {
    const username = IG.usernameFromPath(location.pathname);
    if (!username) return null;
    const key = username.toLowerCase();

    let profile = fresh ? null : profiles.get(key);
    if (!profile) {
      try {
        profile = { ...(await IG.lookupProfile(username)), detailed: true };
        profiles.set(key, profile);
      } catch (e) {
        if (e.code === 'aborted') throw e;
        profile = profiles.get(key) ?? (await savedProfile(key));
        if (!profile) throw e;
      }
    }

    await ST.rememberProfile(profile);
    // Unknown privacy counts as visible here; targetProfile() checks for real.
    const canView = profile.id === viewerId() || !profile.isPrivate || !!profile.followedByViewer;
    return { ...profile, canView, tooLarge: tooLarge(profile) };
  }

  async function savedProfile(key) {
    const found = Object.entries(await ST.getProfiles()).find(([, p]) => p.username.toLowerCase() === key);
    return found ? { id: found[0], ...found[1] } : null;
  }

  // The profile a scan or capture is about to start on, after checking it can be scanned.
  async function targetProfile(profileId) {
    const profile = await pageProfile({ fresh: true });
    if (!profile) throw new Error('Open a profile on Instagram first.');
    if (profileId && profile.id !== profileId) throw new Error('The page changed. Reopen this menu and try again.');

    const privateText = `@${profile.username} is private. You can only scan it if you follow it.`;
    if (!profile.canView) throw new Error(privateText);
    if (tooLarge(profile)) {
      throw new Error(`@${profile.username} has more than ${ST.MAX_LIST.toLocaleString()} followers or following, which is too many to scan.`);
    }
    // Lists the page already loaded are clearly visible. Asking again could make Instagram
    // reshuffle a list that's open halfway in the page.
    const viewer = viewerId();
    const loaded = recentlySeen(viewer, profile.id, 'followers').length || recentlySeen(viewer, profile.id, 'following').length;
    if (!loaded && !(await IG.listsVisible(profile.id))) {
      throw new Error(profile.isPrivate === false ? `Instagram isn't showing @${profile.username}'s followers or following to you.` : privateText);
    }
    return profile;
  }

  // ---------------------------------------------------------------- automatic scan

  async function publish(patch) {
    scanState = { ...scanState, ...patch, updatedAt: Date.now() };
    await local.set({ scan_state: scanState });
  }

  function errorText(e) {
    if (e?.code === 'aborted') return 'Cancelled. Nothing was saved.';
    if (e?.code === 'rate_limited') return 'Instagram is rate limiting you. Wait an hour or more before trying again. Nothing was saved.';
    if (e?.status === 403) return 'Instagram won\'t show this account\'s lists to you. Nothing was saved.';
    return e?.message || String(e);
  }

  async function startAuto({ profileId }) {
    const { scan_state: other, manual_buffer: capture } = await local.get(['scan_state', 'manual_buffer']);
    if (job) throw new Error('A scan is already running.');
    if (ST.isAlive(other)) throw new Error('A scan is already running in another Instagram tab.');
    if (capture?.scannedBy === viewerId()) throw new Error('Finish or discard the manual capture first.');
    const profile = await targetProfile(profileId);
    if (job) throw new Error('A scan is already running.');
    runAuto(profile);
  }

  async function runAuto(profile) {
    const controller = new AbortController();
    job = controller; // set before any await, so a second start is refused
    scanState = {};
    const { signal } = controller;
    const viewer = viewerId();
    const { pace } = await ST.getSettings();
    const options = {
      signal,
      pace,
      limit: ST.MAX_LIST,
      onWait: (ms) => publish({ waitUntil: Date.now() + ms, note: `Instagram asked us to slow down. Pausing ${ms / 1000}s, then continuing.` }),
    };

    try {
      await publish({
        running: true, done: false, error: null, dismissed: false, note: null, waitUntil: null,
        mode: 'auto', stage: 'followers', viewerId: viewer, startedAt: Date.now(), snapshotId: null,
        profile: { id: profile.id, username: profile.username, fullName: profile.fullName, isPrivate: profile.isPrivate, isVerified: profile.isVerified },
        followers: 0, following: null,
        expectedFollowers: profile.followerCount ?? null, expectedFollowing: profile.followingCount ?? null,
      });
      const followers = await fetchComplete(profile.id, 'followers', profile.followerCount, options);
      await publish({ stage: 'following', following: 0 });
      await IG.sleep(2500 + Math.random() * 2500, signal);
      const following = await fetchComplete(profile.id, 'following', profile.followingCount, options);

      if (viewerId() !== viewer) throw new Error('You switched Instagram accounts during the scan. Nothing was saved.');
      // An empty list where there should be accounts is a broken response, not an unfollow wave.
      const [previous] = await ST.listSnapshots(profile.id);
      const suspicious = (list, count, before) => list.length === 0 && (count ?? before ?? 0) > 0;
      if ((!followers.length && !following.length)
        || suspicious(followers, profile.followerCount, previous?.followerCount)
        || suspicious(following, profile.followingCount, previous?.followingCount)) {
        throw new Error('Instagram returned an empty list, so nothing was saved. Try again later.');
      }

      const snapshot = await ST.saveSnapshot(ST.buildSnapshot(profile, viewer, followers, following, 'auto'));
      await publish({ running: false, done: true, snapshotId: snapshot.id, note: null });
    } catch (e) {
      await publish({ running: false, error: errorText(e), note: null }).catch(() => {});
    } finally {
      job = null;
    }
  }

  // Other people's lists come back ranked for you, and the ranking can shift between pages,
  // so one pass may skip accounts. A list clearly short of Instagram's counter is read again
  // and merged; each pass misses different accounts.
  const MAX_PASSES = 3;
  const REREAD_UP_TO = 10000;

  async function fetchComplete(profileId, kind, expected, options) {
    const users = new Map();
    let note = null;
    for (let pass = 1; pass <= MAX_PASSES; pass++) {
      const before = users.size;
      const list = await IG.fetchList(profileId, kind, {
        ...options, onProgress: (n) => publish({ [kind]: Math.max(users.size, n), waitUntil: null, note }),
      });
      for (const user of list) users.set(user.pk, user);
      await publish({ [kind]: users.size });

      const enough = expected == null || expected > REREAD_UP_TO || ST.isComplete(users.size, expected);
      const stuck = pass > 1 && users.size === before;
      if (enough || stuck || pass === MAX_PASSES) break;
      note = `Instagram skipped some ${kind} (${users.size} of ${expected}). Reading the list again to fill the gaps.`;
      await publish({ note });
      await IG.sleep(3000 + Math.random() * 3000, options.signal);
    }
    await publish({ note: null });
    return [...users.values()];
  }

  // ---------------------------------------------------------------- manual capture
  // The capture lives only in storage. A Web Lock shared by every Instagram tab makes each
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

  async function startManual({ profileId }) {
    if (job) throw new Error('A scan is already running.');
    const viewer = viewerId();
    if (!viewer) throw new Error('You are not logged in to Instagram.');
    const profile = await targetProfile(profileId);

    await updateCapture((capture) => {
      if (capture?.profile.id === profile.id && capture.scannedBy === viewer) return undefined;
      const followers = recentlySeen(viewer, profile.id, 'followers');
      const following = recentlySeen(viewer, profile.id, 'following');
      return {
        startedAt: Date.now(),
        step: following.length && !followers.length ? 'following' : 'followers',
        scannedBy: viewer,
        profile: {
          id: profile.id,
          username: profile.username,
          fullName: profile.fullName ?? '',
          isPrivate: profile.isPrivate,
          isVerified: profile.isVerified,
          followerCount: profile.followerCount ?? null,
          followingCount: profile.followingCount ?? null,
        },
        followers,
        following,
      };
    });
  }

  async function saveCapture() {
    let snapshot, profile;
    await updateCapture(async (capture) => {
      if (!capture) throw new Error('There is no capture to save.');
      ({ profile } = capture);
      snapshot = await ST.saveSnapshot(ST.buildSnapshot(profile, capture.scannedBy, capture.followers, capture.following, 'manual'));
      return null;
    });
    seen.clear();
    scanState = {};
    await publish({
      running: false, done: true, error: null, dismissed: false, mode: 'manual',
      viewerId: snapshot.scannedBy, profile, startedAt: Date.now(), snapshotId: snapshot.id,
      followers: snapshot.followers.length, following: snapshot.following.length,
    });
  }

  async function discardCapture() {
    seen.clear();
    await updateCapture(() => null);
  }

  async function openList(kind) {
    const capture = await updateCapture((c) => (c ? { ...c, step: kind } : undefined));
    const username = capture?.profile.username;
    if (!username) return;
    const link = document.querySelector(`a[href="/${username}/${kind}/"]`);
    if (link) link.click();
    else location.assign(`/${username}/${kind}/`);
  }

  // ---------------------------------------------------------------- messages from the popup

  const handlers = {
    ping: () => ({ userId: viewerId() }),
    getProfile: async () => ({ viewerId: viewerId(), profile: await pageProfile({ fresh: false }) }),
    startAuto,
    startManual,
    saveManual: saveCapture,
    discardManual: discardCapture,
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

  // A scan can't survive a page reload: mark a leftover one as interrupted.
  local.get('scan_state').then(({ scan_state: s }) => {
    if (s?.running && !job && !ST.isAlive(s)) {
      local.set({ scan_state: { ...s, running: false, error: 'Interrupted: the Instagram tab was reloaded or closed.', updatedAt: Date.now() } });
    }
  });

  window.postMessage({ __followerDiffReady: true }, location.origin);
})();
