// Step list for the automatic scan. Only the running step shows a bar: a real one when the
// total is known, an indeterminate one otherwise.
(() => {
  const I = (n, s) => globalThis.FD_Icons.icon(n, s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => (n == null ? '' : Number(n).toLocaleString());

  function render(s) {
    const steps = [
      { key: 'account', label: 'Reading your profile' },
      { key: 'followers', label: 'Followers', n: s.followers, total: s.expectedFollowers },
      { key: 'following', label: 'Following', n: s.following, total: s.expectedFollowing },
    ];
    const cur = s.done ? steps.length : Math.max(0, steps.findIndex((step) => step.key === s.stage));
    return `<ol class="fd-steps">${steps.map((st, i) => {
      const status = s.done || i < cur ? 'done' : i === cur ? (s.error ? 'error' : (s.running ? 'active' : 'pending')) : 'pending';
      const dot = status === 'done' ? I('check', 12) : status === 'error' ? I('x', 12) : status === 'active' ? '<span class="fd-spin"></span>' : '';
      const showTotal = st.total != null && status === 'active';
      const count = st.n != null && status !== 'pending'
        ? `<span class="fd-count">${fmt(st.n)}${showTotal ? `<span class="fd-of"> / ${fmt(st.total)}</span>` : ''}</span>` : '';
      let bar = '';
      if (status === 'active' && st.key !== 'account') {
        bar = st.total
          ? `<div class="fd-bar"><div class="fd-fill" style="width:${Math.min(100, ((st.n || 0) / st.total) * 100).toFixed(1)}%"></div></div>`
          : `<div class="fd-bar fd-ind"><div class="fd-fill"></div></div>`;
      }
      return `<li class="fd-step is-${status}"><span class="fd-dot">${dot}</span><span class="fd-label">${esc(st.label)}</span>${count}${bar}</li>`;
    }).join('')}</ol>`;
  }

  // The host page defines --fd-muted, --fd-line, --fd-accent, --fd-good and --fd-bad.
  const css = `
    .fd-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
    .fd-step { display: grid; grid-template-columns: 20px 1fr auto; align-items: center; column-gap: 10px; padding: 7px 0; }
    .fd-dot { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; box-sizing: border-box; border: 1.5px solid var(--fd-line); color: #fff; }
    .fd-step.is-done .fd-dot { background: var(--fd-good); border-color: var(--fd-good); }
    .fd-step.is-error .fd-dot { background: var(--fd-bad); border-color: var(--fd-bad); }
    .fd-step.is-active .fd-dot { border-color: transparent; }
    .fd-step.is-pending .fd-label { color: var(--fd-muted); }
    .fd-step.is-active .fd-label { font-weight: 600; }
    .fd-count { font-variant-numeric: tabular-nums; font-weight: 600; }
    .fd-of { color: var(--fd-muted); font-weight: 400; }
    .fd-bar { grid-column: 2 / 4; height: 4px; border-radius: 2px; background: var(--fd-line); overflow: hidden; margin-top: 8px; position: relative; }
    .fd-fill { height: 100%; background: var(--fd-accent); border-radius: 2px; transition: width .5s ease; }
    .fd-ind .fd-fill { position: absolute; inset: 0 auto 0 0; width: 35%; animation: fd-slide 1.6s ease-in-out infinite; }
    @keyframes fd-slide { from { transform: translateX(-100%); } to { transform: translateX(290%); } }
    .fd-spin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--fd-line); border-top-color: var(--fd-accent); animation: fd-rot .8s linear infinite; box-sizing: border-box; }
    @keyframes fd-rot { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .fd-ind .fd-fill, .fd-spin { animation-duration: 3s; } }
  `;

  globalThis.FD_Progress = { render, css };
})();
