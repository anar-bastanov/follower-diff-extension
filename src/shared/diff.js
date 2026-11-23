// Plain diff of two snapshots. For every account whose relationship changed:
//   f = change in "follows you", g = change in "you follow"  (+1 added, 0 same, -1 removed)
// Accounts are matched by their permanent id, so a new username is a rename, not a removal.
(() => {
  const byPk = (list) => new Map(list.map((u) => [u.pk, u]));
  const delta = (before, after) => (before === after ? 0 : after ? 1 : -1);

  function diff(a, b) {
    const af = byPk(a.followers), bf = byPk(b.followers);
    const ag = byPk(a.following), bg = byPk(b.following);

    const rows = [];
    for (const pk of new Set([...af.keys(), ...ag.keys(), ...bf.keys(), ...bg.keys()])) {
      const f = delta(af.has(pk), bf.has(pk));
      const g = delta(ag.has(pk), bg.has(pk));
      const now = bf.get(pk) || bg.get(pk);
      const old = af.get(pk) || ag.get(pk);
      const renamedFrom = now && old && now.username !== old.username ? old.username : null;
      if (f === 0 && g === 0 && !renamedFrom) continue;
      rows.push({ ...(now || old), f, g, fNow: bf.has(pk), gNow: bg.has(pk), renamedFrom });
    }
    rows.sort((x, y) => x.f - y.f || x.g - y.g || x.username.localeCompare(y.username));

    const count = (key, sign) => rows.filter((r) => r[key] === sign).length;
    return {
      rows,
      followers: { from: a.followers.length, to: b.followers.length, added: count('f', 1), removed: count('f', -1) },
      following: { from: a.following.length, to: b.following.length, added: count('g', 1), removed: count('g', -1) },
      renamed: rows.filter((r) => r.renamedFrom).length,
    };
  }

  function notFollowingBack(s) {
    const followers = new Set(s.followers.map((u) => u.pk));
    return s.following.filter((u) => !followers.has(u.pk));
  }

  function fans(s) {
    const following = new Set(s.following.map((u) => u.pk));
    return s.followers.filter((u) => !following.has(u.pk));
  }

  globalThis.FD_Diff = { diff, notFollowingBack, fans };
})();
