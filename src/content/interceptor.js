// Runs in the page's own JS world. Passively copies the follower/following lists that
// Instagram's UI loads, and forwards them to the content script.
(() => {
  if (window.__followerDiffHooked) return;
  window.__followerDiffHooked = true;

  const LIST_URL = /\/api\/v1\/friendships\/(\d+)\/(followers|following)\//;
  const queue = [];
  let ready = false;

  const send = (msg) => window.postMessage(msg, location.origin);

  // The content script loads later than this script; hold messages until it says hello.
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data?.__followerDiffReady || ready) return;
    ready = true;
    queue.splice(0).forEach(send);
  });

  function handle(url, body) {
    const match = LIST_URL.exec(url);
    if (!match) return;
    let data = body;
    if (typeof body === 'string') {
      try { data = JSON.parse(body); } catch { return; }
    }
    if (!Array.isArray(data?.users) || data.users.length === 0) return;
    const msg = { __followerDiff: true, userId: match[1], kind: match[2], users: data.users };
    if (ready) send(msg);
    else queue.push(msg);
  }

  const originalFetch = window.fetch;
  window.fetch = function (input, ...rest) {
    const promise = originalFetch.call(this, input, ...rest);
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    if (LIST_URL.test(url)) {
      promise.then((res) => res.clone().text()).then((text) => handle(url, text)).catch(() => {});
    }
    return promise;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (LIST_URL.test(String(url))) {
      this.addEventListener('load', () => {
        try {
          handle(String(url), this.responseType === 'json' ? this.response : this.responseText);
        } catch { /* unreadable response type */ }
      });
    }
    return originalOpen.call(this, method, url, ...rest);
  };
})();
