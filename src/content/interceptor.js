// Runs in the page's own JS world. Passively copies data Instagram's UI loads anyway (follow
// lists and profile info) and forwards it to the content script.
(() => {
  if (window.__followerDiffHooked) return;
  window.__followerDiffHooked = true;

  const LIST_URL = /\/api\/v1\/friendships\/(\d+)\/(followers|following)\//;
  const PROFILE_URL = /\/api\/v1\/users\/web_profile_info\/|\/graphql/;
  const queue = [];
  let ready = false;

  const send = (msg) => window.postMessage(msg, location.origin);
  const post = (msg) => (ready ? send(msg) : queue.push(msg));

  // The content script loads later than this script; hold messages until it says hello.
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data?.__followerDiffReady || ready) return;
    ready = true;
    queue.splice(0).forEach(send);
  });

  function parse(body) {
    if (typeof body !== 'string') return body;
    try {
      return JSON.parse(body);
    } catch {
      // Some GraphQL responses are several JSON documents, one per line.
      return body.split('\n').map((line) => { try { return JSON.parse(line); } catch { return null; } });
    }
  }

  function findProfiles(node, found = [], depth = 0) {
    if (!node || typeof node !== 'object' || depth > 12 || found.length >= 100) return found;
    const id = node.pk ?? node.id;
    if (typeof node.username === 'string' && id != null && 'full_name' in node) {
      const profile = { id: String(id), username: node.username, fullName: node.full_name || '' };
      const following = node.friendship_status?.following ?? node.followed_by_viewer;
      if (typeof node.is_private === 'boolean') profile.isPrivate = node.is_private;
      if (typeof node.is_verified === 'boolean') profile.isVerified = node.is_verified;
      if (typeof following === 'boolean') profile.followedByViewer = following;
      found.push(profile);
    }
    for (const value of Object.values(node)) findProfiles(value, found, depth + 1);
    return found;
  }

  function handle(url, body) {
    const list = LIST_URL.exec(url);
    if (list) {
      const data = parse(body);
      if (Array.isArray(data?.users) && data.users.length) {
        post({ __followerDiff: true, kind: list[2], userId: list[1], users: data.users });
      }
    } else if (PROFILE_URL.test(url)) {
      const profiles = findProfiles(parse(body));
      if (profiles.length) post({ __followerDiff: true, kind: 'profiles', profiles });
    }
  }

  const watched = (url) => LIST_URL.test(url) || PROFILE_URL.test(url);

  const originalFetch = window.fetch;
  window.fetch = function (input, ...rest) {
    const promise = originalFetch.call(this, input, ...rest);
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    if (watched(url)) {
      promise.then((res) => res.clone().text()).then((text) => handle(url, text)).catch(() => {});
    }
    return promise;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (watched(String(url))) {
      this.addEventListener('load', () => {
        try {
          handle(String(url), this.responseType === 'json' ? this.response : this.responseText);
        } catch { /* unreadable response type */ }
      });
    }
    return originalOpen.call(this, method, url, ...rest);
  };
})();
