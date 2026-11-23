// Everything lives in chrome.storage.local:
//   snapshots_index  lightweight metadata for every snapshot
//   snap_<id>        one full snapshot
//   accounts         { [userId]: { username } }
//   settings         { pace, accent }
//   scan_state       progress of the current or last scan
//   manual_buffer    the manual capture in progress
(() => {
  const local = chrome.storage.local;
  const INDEX = 'snapshots_index';
  const DEFAULT_SETTINGS = { pace: 'normal', accent: 'violet' };
  const snapKey = (id) => `snap_${id}`;
  const read = async (key) => (await local.get(key))[key];

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // A job that hasn't reported in for 30s is dead (its tab was closed or reloaded).
  const isAlive = (s) => !!s?.running && Date.now() - Math.max(s.updatedAt || 0, s.waitUntil || 0) < 30000;

  // Instagram's counters drift from the real lists by a few accounts, so allow some slack.
  function isComplete(count, expected) {
    if (expected == null) return null;
    return count + Math.max(2, Math.ceil(expected * 0.005)) >= expected;
  }

  function buildSnapshot(me, followers, following, method) {
    return {
      id: newId(),
      takenAt: Date.now(),
      userId: me.userId,
      username: me.username || me.userId,
      method,
      expectedFollowers: me.followerCount ?? null,
      expectedFollowing: me.followingCount ?? null,
      followers,
      following,
    };
  }

  function metaOf(s) {
    const checks = [isComplete(s.followers.length, s.expectedFollowers), isComplete(s.following.length, s.expectedFollowing)];
    return {
      id: s.id,
      takenAt: s.takenAt,
      userId: s.userId,
      username: s.username,
      method: s.method,
      followerCount: s.followers.length,
      followingCount: s.following.length,
      expectedFollowers: s.expectedFollowers ?? null,
      expectedFollowing: s.expectedFollowing ?? null,
      complete: checks.includes(false) ? false : checks.includes(true) ? true : null,
    };
  }

  async function listSnapshots(userId) {
    const index = (await read(INDEX)) || [];
    return index.filter((m) => !userId || m.userId === userId).sort((a, b) => b.takenAt - a.takenAt);
  }

  async function getSnapshot(id) {
    return (await read(snapKey(id))) || null;
  }

  async function saveSnapshot(snapshot) {
    await local.set({ [snapKey(snapshot.id)]: snapshot });
    const index = ((await read(INDEX)) || []).filter((m) => m.id !== snapshot.id);
    await local.set({ [INDEX]: [...index, metaOf(snapshot)] });
    return snapshot;
  }

  async function deleteSnapshot(id) {
    await local.remove(snapKey(id));
    const index = (await read(INDEX)) || [];
    await local.set({ [INDEX]: index.filter((m) => m.id !== id) });
  }

  async function rememberAccount({ userId, username }) {
    if (!userId || !username) return;
    const accounts = (await read('accounts')) || {};
    accounts[userId] = { username };
    await local.set({ accounts });
  }

  const getAccounts = async () => (await read('accounts')) || {};
  const getSettings = async () => ({ ...DEFAULT_SETTINGS, ...(await read('settings')) });
  const setSettings = async (patch) => local.set({ settings: { ...(await getSettings()), ...patch } });
  const bytesInUse = () => local.getBytesInUse(null);

  async function deleteAccount(userId) {
    const index = (await read(INDEX)) || [];
    const accounts = (await read('accounts')) || {};
    const capture = await read('manual_buffer');
    delete accounts[userId];
    await local.remove(index.filter((m) => m.userId === userId).map((m) => snapKey(m.id)));
    await local.set({ [INDEX]: index.filter((m) => m.userId !== userId), accounts });
    if (capture?.me.userId === userId) await local.remove('manual_buffer');
  }

  // Keeps settings: those are preferences, not data.
  async function deleteAll() {
    const keys = Object.keys(await local.get(null)).filter((key) => key !== 'settings');
    await local.remove(keys);
  }

  async function exportAll() {
    const snapshots = [];
    for (const meta of await listSnapshots()) {
      const snapshot = await getSnapshot(meta.id);
      if (snapshot) snapshots.push(snapshot);
    }
    return { format: 'follower-diff', version: 1, exportedAt: Date.now(), snapshots };
  }

  function cleanUsers(list) {
    if (!Array.isArray(list)) return null;
    return list
      .filter((u) => u?.pk != null && typeof u.username === 'string' && u.username)
      .map((u) => ({
        pk: String(u.pk),
        username: u.username,
        full_name: typeof u.full_name === 'string' ? u.full_name : '',
        is_private: !!u.is_private,
        is_verified: !!u.is_verified,
      }));
  }

  async function importAll(data) {
    if (data?.format !== 'follower-diff' || !Array.isArray(data.snapshots)) {
      throw new Error('This is not a Follower Diff export file.');
    }
    let imported = 0;
    for (const s of data.snapshots) {
      const followers = cleanUsers(s?.followers);
      const following = cleanUsers(s?.following);
      if (typeof s?.id !== 'string' || !s.userId || !Number.isFinite(s.takenAt) || !followers || !following) continue;
      await saveSnapshot({ ...s, userId: String(s.userId), username: String(s.username || s.userId), followers, following });
      imported++;
    }
    return imported;
  }

  globalThis.FD_Storage = {
    isAlive, isComplete, buildSnapshot,
    listSnapshots, getSnapshot, saveSnapshot, deleteSnapshot,
    rememberAccount, getAccounts, getSettings, setSettings,
    bytesInUse, deleteAccount, deleteAll, exportAll, importAll,
  };
})();
