// Client for the private web API that www.instagram.com itself uses. Requests are sent from
// the Instagram tab, so they carry the session you are already logged in with.
(() => {
  const APP_ID = '936619743392459';
  const TIMEOUT = 20000;
  const RETRY_WAITS = [30000, 90000];
  const RETRYABLE = new Set(['rate_limited', 'network', 'server']);
  const PACE = {
    normal: { page: [1200, 2600], rest: [5000, 9000] },
    careful: { page: [2500, 5000], rest: [10000, 18000] },
  };

  class IGError extends Error {
    constructor(code, message, status = null) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }

  function getCookie(name) {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  }

  const between = ([min, max]) => min + Math.random() * (max - min);
  const toNumber = (v) => (typeof v === 'number' ? v : null);

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new IGError('aborted', 'Cancelled.'));
      const done = () => { signal?.removeEventListener('abort', cancel); resolve(); };
      const cancel = () => { clearTimeout(timer); reject(new IGError('aborted', 'Cancelled.')); };
      const timer = setTimeout(done, ms);
      signal?.addEventListener('abort', cancel, { once: true });
    });
  }

  function headers() {
    let claim = '0';
    try { claim = sessionStorage.getItem('www-claim-v2') || '0'; } catch { /* storage blocked */ }
    return {
      'X-IG-App-ID': APP_ID,
      'X-IG-WWW-Claim': claim,
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRFToken': getCookie('csrftoken') || '',
    };
  }

  async function get(path, params, signal) {
    const url = new URL(path, location.origin);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value != null) url.searchParams.set(key, value);
    }

    const timeout = AbortSignal.timeout(TIMEOUT);
    let res, text;
    try {
      res = await fetch(url, {
        credentials: 'include',
        headers: headers(),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      text = await res.text();
    } catch {
      if (signal?.aborted) throw new IGError('aborted', 'Cancelled.');
      throw new IGError('network', timeout.aborted ? 'Instagram took too long to respond.' : 'Network error. Check your connection.');
    }

    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    const message = typeof data?.message === 'string' ? data.message : '';

    const fail = (code, msg) => {
      console.warn('[Follower Diff]', res.status, url.pathname, text.slice(0, 200));
      return new IGError(code, msg, res.status);
    };
    if (res.status === 429 || /wait a few minutes|try again later/i.test(message)) {
      throw fail('rate_limited', 'Instagram is rate limiting requests.');
    }
    if (res.status >= 500) {
      throw fail('server', `Instagram had a server error (HTTP ${res.status}).`);
    }
    // A logged-out session gets redirected to the HTML login page.
    if (res.status === 401 || data?.require_login || /login_required|checkpoint/i.test(message) || (res.ok && !data && /^\s*</.test(text))) {
      throw fail('auth', 'Instagram wants you to log in again (or confirm a security check). Open instagram.com and check.');
    }
    if (!res.ok || !data || data.status === 'fail') {
      throw fail('http', message || `Instagram sent an unexpected response (HTTP ${res.status}).`);
    }
    return data;
  }

  async function request(path, params, { signal, onWait } = {}) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await get(path, params, signal);
      } catch (e) {
        const wait = RETRYABLE.has(e.code) ? RETRY_WAITS[attempt] : undefined;
        if (wait === undefined) throw e;
        onWait?.(wait);
        await sleep(wait, signal);
      }
    }
  }

  function normalizeUser(u) {
    const pk = u?.pk ?? u?.pk_id ?? u?.id;
    if (pk == null || typeof u.username !== 'string' || !u.username) return null;
    return {
      pk: String(pk),
      username: u.username,
      full_name: u.full_name || '',
      is_private: !!u.is_private,
      is_verified: !!u.is_verified,
    };
  }

  // First path segments that are Instagram pages, not usernames.
  const NOT_PROFILES = new Set([
    'about', 'accounts', 'api', 'ar', 'challenge', 'developer', 'direct', 'directory', 'emails',
    'explore', 'graphql', 'legal', 'nametag', 'oauth', 'p', 'privacy', 'reel', 'reels', 'session',
    'stories', 'terms', 'topics', 'tv', 'web', 'your_activity',
  ]);

  function usernameFromPath(pathname) {
    const first = pathname.split('/')[1] ?? '';
    return /^[A-Za-z0-9._]{1,30}$/.test(first) && !NOT_PROFILES.has(first.toLowerCase()) ? first : null;
  }

  // The same lookup Instagram's own profile pages make.
  async function lookupProfile(username, signal) {
    let data;
    try {
      ({ data } = await get('/api/v1/users/web_profile_info/', { username }, signal));
    } catch (e) {
      if (e.status === 404) throw new IGError('not_found', `@${username} doesn't exist or isn't available.`);
      if (e.code === 'aborted') throw e;
      throw new IGError(e.code, `Instagram didn't return @${username}'s profile (${e.message})`, e.status);
    }
    const user = data?.user;
    if (!user?.id) throw new IGError('not_found', `@${username} doesn't exist or isn't available.`);
    return {
      id: String(user.id),
      username: user.username,
      fullName: user.full_name || '',
      isPrivate: !!user.is_private,
      isVerified: !!user.is_verified,
      followedByViewer: !!user.followed_by_viewer,
      followerCount: toNumber(user.edge_followed_by?.count),
      followingCount: toNumber(user.edge_follow?.count),
    };
  }

  // Asks for the first page of each list. Private accounts you don't follow come back empty
  // (or refused), which is the only reliable way to know before scanning.
  async function listsVisible(userId, signal) {
    for (const kind of ['followers', 'following']) {
      try {
        const data = await request(`/api/v1/friendships/${userId}/${kind}/`, { count: 12 }, { signal });
        if (Array.isArray(data.users) && data.users.length) return true;
      } catch (e) {
        if (e.status !== 401 && e.status !== 403) throw e;
      }
    }
    return false;
  }

  async function fetchList(userId, kind, { signal, onWait, onProgress, pace = 'normal', limit = Infinity } = {}) {
    const delays = PACE[pace] ?? PACE.normal;
    const users = new Map();
    const rankToken = crypto.randomUUID(); // asks Instagram to keep one ordering across pages
    let cursor = null;
    for (let page = 1; ; page++) {
      const params = { count: 25, max_id: cursor, rank_token: rankToken };
      if (kind === 'followers') params.search_surface = 'follow_list_page';
      const data = await request(`/api/v1/friendships/${userId}/${kind}/`, params, { signal, onWait });
      if (!Array.isArray(data.users)) throw new IGError('http', 'Instagram sent an unexpected response.');

      for (const raw of data.users) {
        const user = normalizeUser(raw);
        if (user) users.set(user.pk, user);
      }
      onProgress?.(users.size);
      if (users.size > limit) throw new IGError('too_large', `This list has more than ${limit.toLocaleString()} accounts, which is too large to scan.`);

      const next = data.next_max_id;
      if (next == null || next === '' || next === cursor || data.users.length === 0) break;
      cursor = next;
      await sleep(between(page % 10 ? delays.page : delays.rest), signal);
    }
    return [...users.values()];
  }

  globalThis.FD_IG = { getCookie, sleep, normalizeUser, usernameFromPath, lookupProfile, listsVisible, fetchList };
})();
