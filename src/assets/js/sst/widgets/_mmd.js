/**
 * Shared MMD core for the SST widgets (mmd-witness, product-mmd,
 * decision-landscape). Unbiased MMD² with permutation-calibrated decisions —
 * no fixed thresholds, no shared-noise shortcuts. See [[never-force-the-math]].
 */

export function mulberry32 (seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normals (n, seed) {
  const rnd = mulberry32(seed); const out = [];
  for (let i = 0; i < n; i++) {
    const u1 = Math.max(1e-9, rnd()), u2 = rnd();
    out.push(Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2));
  }
  return out;
}

export const gk = (a, b, h) => Math.exp(-((a - b) * (a - b)) / (2 * h * h));

export function witness (t, X, Y, h) {
  let sx = 0, sy = 0;
  for (const x of X) sx += gk(t, x, h);
  for (const y of Y) sy += gk(t, y, h);
  return sx / X.length - sy / Y.length;
}

// unbiased MMD² (exclude diagonal self-pairs); may be slightly negative
export function mmd2 (X, Y, h) {
  const n = X.length, m = Y.length;
  let kxx = 0, kyy = 0, kxy = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) kxx += gk(X[i], X[j], h);
  for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) if (i !== j) kyy += gk(Y[i], Y[j], h);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) kxy += gk(X[i], Y[j], h);
  return kxx / (n * (n - 1)) + kyy / (m * (m - 1)) - 2 * kxy / (n * m);
}

// permutation null of MMD² (deterministic given seed): sorted ascending
export function permNull (X, Y, h, B, seed) {
  const pool = X.concat(Y), n = X.length;
  const rnd = mulberry32(seed);
  const nulls = [];
  for (let b = 0; b < B; b++) {
    const a = pool.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    nulls.push(mmd2(a.slice(0, n), a.slice(n), h));
  }
  nulls.sort((p, q) => p - q);
  return nulls;
}

// full calibrated decision: observed MMD², p-value, reject flag, null + cutoff
export function decide (X, Y, h, { B = 300, seed = 424242, alpha = 0.05 } = {}) {
  const obs = mmd2(X, Y, h);
  const nulls = permNull(X, Y, h, B, seed);
  const cut = nulls[Math.min(nulls.length - 1, Math.floor((1 - alpha) * nulls.length))];
  let ge = 0; for (const v of nulls) if (v >= obs) ge++;
  const p = (ge + 1) / (nulls.length + 1);
  return { obs, p, reject: obs > cut, nulls, cut };
}
