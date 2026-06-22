/**
 * G2Aero-style separable interpolation geometry (planar, d=2).
 *
 * An airfoil is a centred landmark matrix X (n×2). Its polar decomposition
 * X = X̃P splits undulation [X̃] ∈ Gr(2,n) from scale P ∈ SPD(2) — the same split
 * the SST prologue builds. To interpolate two airfoils we walk the GEODESIC on
 * each factor: a Grassmann geodesic for X̃, an SPD (affine-invariant) geodesic
 * for P, then reconstruct X = X̃P. A small orthogonal framing correction R(t)
 * makes the reconstruction hit each nominal airfoil exactly at the knots.
 *
 * Reference: Grey, Glaws, et al., "Separable shape tensors for aerodynamic
 * design" (JCDE 2023). This is a faithful planar implementation, not a sketch.
 */

// 2×2 symmetric eig of [[a,b],[b,c]] -> eigenpairs, l1 >= l2
export function eigSym2 (a, b, c) {
  const tr = a + c;
  const disc = Math.sqrt(Math.max(0, (a - c) * (a - c) / 4 + b * b));
  const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
  let v1;
  if (Math.abs(b) > 1e-12) v1 = [l1 - c, b];
  else v1 = (a >= c) ? [1, 0] : [0, 1];
  const nrm = Math.hypot(v1[0], v1[1]) || 1;
  v1 = [v1[0] / nrm, v1[1] / nrm];
  return { l1, l2, v1, v2: [-v1[1], v1[0]] };
}

// thin SVD of an n×2 matrix C (array of [x,y]); returns U (n×2), S=[s1,s2], V cols v1,v2
export function thinSVD (C) {
  let a = 0, b = 0, c = 0;
  for (const r of C) { a += r[0] * r[0]; b += r[0] * r[1]; c += r[1] * r[1]; }
  const e = eigSym2(a, b, c);
  const s1 = Math.sqrt(Math.max(1e-14, e.l1)), s2 = Math.sqrt(Math.max(1e-14, e.l2));
  const V = [e.v1, e.v2];
  const U = C.map(r => [
    (r[0] * V[0][0] + r[1] * V[0][1]) / s1,
    (r[0] * V[1][0] + r[1] * V[1][1]) / s2
  ]);
  return { U, S: [s1, s2], V };
}

// 2×2 helpers
const mul2 = (A, B) => [
  [A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1]],
  [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1]]
];
const tpose2 = A => [[A[0][0], A[1][0]], [A[0][1], A[1][1]]];
const inv2 = A => { const d = A[0][0] * A[1][1] - A[0][1] * A[1][0]; return [[A[1][1] / d, -A[0][1] / d], [-A[1][0] / d, A[0][0] / d]]; };

// polar X = X̃ P with X̃ orthonormal cols, P SPD (2×2)
export function polar (C) {
  const { U, S, V } = thinSVD(C);
  const Xt = U.map(u => [
    u[0] * V[0][0] + u[1] * V[1][0],
    u[0] * V[0][1] + u[1] * V[1][1]
  ]); // X̃ = U Vᵀ
  // P = V diag(S) Vᵀ
  const P = [
    [S[0] * V[0][0] * V[0][0] + S[1] * V[1][0] * V[1][0], S[0] * V[0][0] * V[0][1] + S[1] * V[1][0] * V[1][1]],
    [0, S[0] * V[0][1] * V[0][1] + S[1] * V[1][1] * V[1][1]]
  ];
  P[1][0] = P[0][1];
  return { Xt, P };
}

// SPD matrix function via eig (f applied to eigenvalues)
function spdFun (P, f) {
  const e = eigSym2(P[0][0], P[0][1], P[1][1]);
  const f1 = f(e.l1), f2 = f(e.l2), v1 = e.v1, v2 = e.v2;
  return [
    [f1 * v1[0] * v1[0] + f2 * v2[0] * v2[0], f1 * v1[0] * v1[1] + f2 * v2[0] * v2[1]],
    [f1 * v1[0] * v1[1] + f2 * v2[0] * v2[1], f1 * v1[1] * v1[1] + f2 * v2[1] * v2[1]]
  ];
}

// affine-invariant SPD geodesic P0 -> P1 at t
export function spdGeo (P0, P1, t) {
  const h = spdFun(P0, Math.sqrt);
  const hi = spdFun(P0, x => 1 / Math.sqrt(x));
  const mid = mul2(mul2(hi, P1), hi);
  const midt = spdFun(mid, x => Math.pow(x, t));
  return mul2(mul2(h, midt), h);
}

// Grassmann geodesic between orthonormal A,B (n×2 reps) at t -> n×2 rep
export function grassGeo (A, B, t) {
  const AtB = [[0, 0], [0, 0]];
  for (let i = 0; i < A.length; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) AtB[j][k] += A[i][j] * B[i][k];
  const Minv = inv2(AtB);
  // N = B - A·AtB ; T = N·Minv
  const T = B.map((bi, i) => {
    const ax = A[i][0], ay = A[i][1];
    const n0 = bi[0] - (ax * AtB[0][0] + ay * AtB[1][0]);
    const n1 = bi[1] - (ax * AtB[0][1] + ay * AtB[1][1]);
    return [n0 * Minv[0][0] + n1 * Minv[1][0], n0 * Minv[0][1] + n1 * Minv[1][1]];
  });
  const { U, S, V } = thinSVD(T);
  const th = [Math.atan(S[0]), Math.atan(S[1])];
  const cs = [Math.cos(t * th[0]), Math.cos(t * th[1])];
  const sn = [Math.sin(t * th[0]), Math.sin(t * th[1])];
  // VcosVᵀ (2×2)
  const VC = [
    [V[0][0] * cs[0] * V[0][0] + V[1][0] * cs[1] * V[1][0], V[0][0] * cs[0] * V[0][1] + V[1][0] * cs[1] * V[1][1]],
    [V[0][1] * cs[0] * V[0][0] + V[1][1] * cs[1] * V[1][0], V[0][1] * cs[0] * V[0][1] + V[1][1] * cs[1] * V[1][1]]
  ];
  return A.map((ai, i) => {
    const t0 = ai[0] * VC[0][0] + ai[1] * VC[1][0];
    const t1 = ai[0] * VC[0][1] + ai[1] * VC[1][1];
    const u0 = U[i][0], u1 = U[i][1];
    const s0 = u0 * sn[0] * V[0][0] + u1 * sn[1] * V[0][1];
    const s1 = u0 * sn[0] * V[1][0] + u1 * sn[1] * V[1][1];
    return [t0 + s0, t1 + s1];
  });
}

// orthogonal R (2×2) with X̃next = γ1·R  (framing correction so knots match)
export function frameR (gamma1, Xtnext) {
  const R = [[0, 0], [0, 0]];
  for (let i = 0; i < gamma1.length; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) R[j][k] += gamma1[i][j] * Xtnext[i][k];
  return R;
}

// interpolate R(t): I -> R along the shortest rotation (R assumed ~ rotation)
export function rotAt (R, t) {
  const ang = Math.atan2(R[1][0] - R[0][1], R[0][0] + R[1][1]) * t; // SO(2) part
  const c = Math.cos(ang), s = Math.sin(ang);
  return [[c, -s], [s, c]];
}

export { mul2 };
