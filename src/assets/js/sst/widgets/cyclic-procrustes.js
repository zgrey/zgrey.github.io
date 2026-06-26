/**
 * Cyclic Procrustes demo — the fix for the phase-shift problem.
 *
 * Y is the FIXED reference apple. X is the manipulable query: cyclically permute
 * its landmark indexing (phase slider), rotate it, and drag points. Naively
 * pairing landmark i <-> i is then wrong. Pressing "register" solves the cyclic
 * Procrustes problem in the paper's order: find the optimal permutation FIRST,
 *     p* = argmax_p || Y^T C(p) X ||_*   (nuclear norm over all cyclic shifts),
 * THEN the optimal rotation/reflection given p*,
 *     R* = U V^T   from  Y^T C(p*) X = U Σ V^T,
 * and overlays X onto Y. Rather than SNAP, "register" ANIMATES the solution in
 * the same order: (1) the optimal permutation re-threads the correspondence,
 * then (2) the optimal rotation — and, when R* is a reflection, an explicit
 * mirror flip — rolls X onto Y. Any leftover residual is genuine undulation.
 *
 * Contract: default export mount(rootEl) -> { destroy() }.
 */

import { APPLE } from './_apple.js';

const N = APPLE.length;
const SHAPE_SCALE = 1.45;
const BASE = APPLE.map(([x, y]) => [x * SHAPE_SCALE, y * SHAPE_SCALE]);
const Z = 1.25;                 // uniform widget zoom (backing store + drawing)
const INIT_ROT = 50 * Math.PI / 180;   // start the query visibly rotated off Y

function eig2 (a, b, c) {
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
const mul2 = (A, B) => [
  [A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1]],
  [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1]]
];
const apply2 = (R, p) => [R[0][0] * p[0] + R[0][1] * p[1], R[1][0] * p[0] + R[1][1] * p[1]];
const rotM = th => [[Math.cos(th), -Math.sin(th)], [Math.sin(th), Math.cos(th)]];
const FLIP = [[1, 0], [0, -1]];                       // reflection across the x-axis
const ease = t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;   // easeInOutQuad

// any R in O(2) is a rotation (det +1) or a rotation composed with a flip
// (det -1). Return the rotation angle and whether a reflection is present.
function decomposeO2 (R) {
  const det = R[0][0] * R[1][1] - R[0][1] * R[1][0];
  if (det > 0) return { reflect: false, theta: Math.atan2(R[1][0], R[0][0]) };
  const M = mul2(R, FLIP);                            // R·FLIP is a pure rotation
  return { reflect: true, theta: Math.atan2(M[1][0], M[0][0]) };
}

// linear interpolation along a closed polygon at a real index f
function polyAt (P, f) {
  const n = P.length;
  const fi = ((f % n) + n) % n;
  const i0 = Math.floor(fi), t = fi - i0;
  const a = P[i0 % n], b = P[(i0 + 1) % n];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// 2x2 cross matrix M(p) = Y^T C(p) X,  (C(p)X)[i] = X[(i+p)%N]
function crossM (Y, X, p) {
  let a = 0, b = 0, c = 0, d = 0;
  for (let i = 0; i < N; i++) {
    const xi = X[(i + p) % N];
    a += Y[i][0] * xi[0]; b += Y[i][0] * xi[1];
    c += Y[i][1] * xi[0]; d += Y[i][1] * xi[1];
  }
  return [[a, b], [c, d]];
}
function nuclear2 (M) {
  const A = M[0][0] ** 2 + M[1][0] ** 2;
  const B = M[0][0] * M[0][1] + M[1][0] * M[1][1];
  const C = M[0][1] ** 2 + M[1][1] ** 2;
  const e = eig2(A, B, C);
  return Math.sqrt(Math.max(0, e.l1)) + Math.sqrt(Math.max(0, e.l2));
}
function procrustesR (M) {              // R = M (M^T M)^{-1/2} = U V^T
  const A = M[0][0] ** 2 + M[1][0] ** 2;
  const B = M[0][0] * M[0][1] + M[1][0] * M[1][1];
  const C = M[0][1] ** 2 + M[1][1] ** 2;
  const e = eig2(A, B, C);
  const s1 = Math.sqrt(Math.max(1e-12, e.l1)), s2 = Math.sqrt(Math.max(1e-12, e.l2));
  const [v1, v2] = [e.v1, e.v2];
  const inv = [
    [v1[0] * v1[0] / s1 + v2[0] * v2[0] / s2, v1[0] * v1[1] / s1 + v2[0] * v2[1] / s2],
    [v1[0] * v1[1] / s1 + v2[0] * v2[1] / s2, v1[1] * v1[1] / s1 + v2[1] * v2[1] / s2]
  ];
  return mul2(M, inv);
}

export default function mount (root) {
  const Yref = BASE.map(p => [...p]);                          // fixed reference
  let Xman = BASE.map(p => apply2(rotM(INIT_ROT), p));         // rotated query
  let pShift = 18;                                             // cyclic permutation
  let registered = false;
  let anim = null;                  // active register animation (null when idle)
  let raf = 0;
  const reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // current unregistered X: index i is landmark (i+pShift) of Xman
  const curX = () => Xman.map((_, i) => Xman[(i + pShift) % N]);

  // cyclic Procrustes: optimal p* first, then R* given p*
  function solve (X) {
    let best = -Infinity, pstar = 0;
    const fs = new Array(N);
    for (let p = 0; p < N; p++) { const f = nuclear2(crossM(Yref, X, p)); fs[p] = f; if (f > best) { best = f; pstar = p; } }
    const R = procrustesR(crossM(Yref, X, pstar));
    let resid = 0;
    for (let i = 0; i < N; i++) {            // alignment residual: ||R·X[(i+p*)] - Y[i]||
      const al = apply2(R, X[(i + pstar) % N]);
      resid += (al[0] - Yref[i][0]) ** 2 + (al[1] - Yref[i][1]) ** 2;
    }
    return { fs, pstar, R, resid: Math.sqrt(resid) };
  }

  root.innerHTML = `
    <div class="sst-iv">
      <figure style="margin:0"><canvas class="sst-iv-canvas" width="375" height="325" data-reg></canvas>
        <figcaption><span style="color:#c9603f">Y</span> reference vs <span style="color:var(--color-accent-primary)">X</span> query · correspondence</figcaption></figure>
      <figure style="margin:0"><canvas class="sst-iv-canvas" width="375" height="325" data-obj></canvas>
        <figcaption>permutation loss ‖Y<sup>⊤</sup>C(p)X‖<sub>∗</sub> · peak = p*</figcaption></figure>
      <div class="sst-iv-side">
        <div class="sst-iv-readout">
          <div><span class="sst-iv-k">found p*</span><span class="sst-iv-v" data-ps>—</span></div>
          <div><span class="sst-iv-k">residual</span><span class="sst-iv-v" data-res>—</span></div>
        </div>
        <label class="sst-iv-range-row">permute
          <input type="range" class="sst-range" data-ph min="0" max="${N - 1}" value="${pShift}" step="1" aria-label="Cyclic permutation of X">
        </label>
        <div class="sst-iv-controls">
          <button type="button" data-act="rotate">rotate X</button>
          <button type="button" data-act="register">register</button>
          <button type="button" data-act="reset">reset</button>
        </div>
        <p class="sst-iv-hint">Permute / rotate / drag the <strong style="color:var(--color-accent-primary)">X</strong>
        apple &mdash; the correspondence tangles. <strong>Register</strong> animates the fix in order: first the
        optimal permutation p* re-threads the pairing, then the rotation R* (with a mirror flip if it is a
        reflection) rolls X onto Y. Leftover residual is real undulation.</p>
      </div>
    </div>`;

  const regCanvas = root.querySelector('[data-reg]');
  const rc = regCanvas.getContext('2d');
  const oc = root.querySelector('[data-obj]').getContext('2d');
  const psEl = root.querySelector('[data-ps]');
  const resEl = root.querySelector('[data-res]');
  const phRange = root.querySelector('[data-ph]');
  const regBtn = root.querySelector('[data-act="register"]');
  const css = n => getComputedStyle(document.body).getPropertyValue(n).trim() || null;
  const GREEN = () => css('--color-accent-primary') || '#537949';
  const APPLE_C = '#c9603f';

  const S = 58, CX = 150, CY = 130;   // user-space layout (fits the apple under rotation)
  const toPx = p => [CX + p[0] * S, CY - p[1] * S];
  const strokeShape = (ctx, pts, color, w) => {
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath();
    pts.forEach((p, i) => { const q = toPx(p); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
    ctx.closePath(); ctx.stroke();
  };

  // Resolve the on-screen geometry for the current state: the green X polyline,
  // the X-endpoint of each correspondence line, the landmark-0 marker, and a
  // moving cursor on the loss plot during the permutation phase.
  function frame () {
    const X = anim ? anim.X : curX();
    const sol = anim ? anim.sol : solve(X);
    const pstar = sol.pstar;
    if (anim && anim.kind === 'A') {
      // permutation sweep: the shape holds; correspondence re-threads by p*
      return {
        sol,
        green: X,
        corr: i => polyAt(X, i + anim.f * pstar),
        mk0: polyAt(X, anim.f * pstar),
        pcursor: anim.f * pstar 
      };
    }
    if (anim && anim.kind === 'B') {
      const Xp = X.map((_, i) => X[(i + pstar) % N]);     // permuted into pairing
      const disp = Xp.map(p => apply2(anim.T, p));
      return { sol, green: disp, corr: i => disp[i], mk0: disp[0], pcursor: pstar };
    }
    if (registered) {
      const disp = X.map((_, i) => apply2(sol.R, X[(i + pstar) % N]));
      return { sol, green: disp, corr: i => disp[i], mk0: disp[0], pcursor: pstar };
    }
    return { sol, green: X, corr: i => X[i], mk0: X[0], pcursor: null };
  }

  function draw () {
    const fr = frame();
    const sol = fr.sol;

    rc.setTransform(Z, 0, 0, Z, 0, 0);
    rc.clearRect(0, 0, 300, 260);
    // faint correspondence lines (tangled when unregistered, ~0 when aligned)
    rc.strokeStyle = css('--color-text-secondary') || '#999'; rc.globalAlpha = 0.28; rc.lineWidth = 1;
    for (let i = 0; i < N; i++) {
      const a = toPx(fr.corr(i)), b = toPx(Yref[i]);
      rc.beginPath(); rc.moveTo(a[0], a[1]); rc.lineTo(b[0], b[1]); rc.stroke();
    }
    rc.globalAlpha = 1;
    // Y reference: OPEN circles, so the X line threading through them reveals the
    // machine-precision overlap (and where undulation deviates)
    rc.strokeStyle = APPLE_C; rc.lineWidth = 1.4;
    Yref.forEach((p, i) => { const q = toPx(p); rc.beginPath(); rc.arc(q[0], q[1], i === 0 ? 4.5 : 3.2, 0, Math.PI * 2); rc.stroke(); });
    // X query: a connected line
    strokeShape(rc, fr.green, GREEN(), 2);
    // landmark-0 marker on X (shows the permutation phase)
    const q0 = toPx(fr.mk0); rc.fillStyle = GREEN(); rc.beginPath(); rc.arc(q0[0], q0[1], 3.8, 0, Math.PI * 2); rc.fill();

    drawLoss(sol, fr.pcursor);

    psEl.textContent = String(sol.pstar);
    resEl.textContent = (anim ? solve(curX()).resid : sol.resid).toFixed(3);
    regBtn.textContent = registered ? 'un-register' : 'register';
  }

  // permutation-loss plot, now full-size to match its pair, with labelled axes
  function drawLoss (sol, pcursor) {
    const fs = sol.fs, fmin = Math.min(...fs), fmax = Math.max(...fs);
    const X0 = 52, X1 = 286, Y0 = 20, Y1 = 218;
    const xp = p => X0 + p / (N - 1) * (X1 - X0);
    const yp = f => Y1 - (f - fmin) / (fmax - fmin || 1) * (Y1 - Y0);
    oc.setTransform(Z, 0, 0, Z, 0, 0);
    oc.clearRect(0, 0, 300, 260);
    oc.strokeStyle = css('--color-border') || '#444'; oc.lineWidth = 1; oc.strokeRect(X0, Y0, X1 - X0, Y1 - Y0);

    const TXT = css('--color-text-secondary') || '#999';
    oc.fillStyle = TXT; oc.font = '11px monospace';
    // x-axis ticks + label
    oc.textAlign = 'center'; oc.textBaseline = 'top';
    for (let p = 0; p <= N - 1; p += 6) { oc.fillText(String(p), xp(p), Y1 + 5); }
    oc.fillText('cyclic shift  p', (X0 + X1) / 2, Y1 + 22);
    // y-axis label (rotated)
    oc.save();
    oc.translate(14, (Y0 + Y1) / 2); oc.rotate(-Math.PI / 2);
    oc.textAlign = 'center'; oc.textBaseline = 'middle';
    oc.fillText('‖YᵀC(p)X‖*', 0, 0);
    oc.restore();

    oc.strokeStyle = GREEN(); oc.lineWidth = 2; oc.beginPath();
    fs.forEach((f, p) => { const x = xp(p), y = yp(f); p ? oc.lineTo(x, y) : oc.moveTo(x, y); });
    oc.stroke();
    // p* peak marker + guide
    oc.strokeStyle = APPLE_C; oc.setLineDash([3, 2]); oc.beginPath(); oc.moveTo(xp(sol.pstar), Y0); oc.lineTo(xp(sol.pstar), Y1); oc.stroke(); oc.setLineDash([]);
    oc.fillStyle = APPLE_C; oc.beginPath(); oc.arc(xp(sol.pstar), yp(fs[sol.pstar]), 4, 0, 7); oc.fill();
    oc.textAlign = 'center'; oc.textBaseline = 'bottom'; oc.fillText('p* = ' + sol.pstar, xp(sol.pstar), Y0 - 3 + 14);
    // moving cursor that sweeps to p* during the permutation animation
    if (pcursor != null && anim && anim.kind === 'A') {
      const xc = xp(pcursor);
      oc.fillStyle = GREEN(); oc.beginPath(); oc.arc(xc, yp(fs[Math.round(pcursor) % N]), 4, 0, 7); oc.fill();
    }
  }

  // ---- register animation -------------------------------------------------
  const DUR_A = 800, DUR_FLIP = 420, DUR_ROT = 760;
  function startRegister () {
    const X = curX();
    const sol = solve(X);
    const dec = decomposeO2(sol.R);
    if (reduceMotion) { registered = true; draw(); return; }
    anim = { X, sol, dec, kind: 'A', f: 0, t0: performance.now() };
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }
  function tick (now) {
    if (!anim) return;
    const e = now - anim.t0;
    if (anim.kind === 'A') {
      anim.f = ease(Math.min(1, e / DUR_A));
      if (e >= DUR_A) { anim.kind = 'B'; anim.t0 = now; anim.T = [[1, 0], [0, 1]]; }
    } else {                                   // phase B: flip (if any) then rotate
      const eb = e;
      if (anim.dec.reflect) {
        if (eb < DUR_FLIP) {
          const tf = ease(eb / DUR_FLIP);
          anim.T = [[1, 0], [0, 1 - 2 * tf]];               // mirror across x
        } else if (eb < DUR_FLIP + DUR_ROT) {
          const tr = ease((eb - DUR_FLIP) / DUR_ROT);
          anim.T = mul2(rotM(anim.dec.theta * tr), FLIP);
        } else { finishRegister(); return; }
      } else {
        if (eb < DUR_ROT) {
          anim.T = rotM(anim.dec.theta * ease(eb / DUR_ROT));
        } else { finishRegister(); return; }
      }
    }
    draw();
    raf = requestAnimationFrame(tick);
  }
  function finishRegister () {
    anim = null; registered = true; cancelAnimationFrame(raf); draw();
  }

  function onAct (act) {
    if (act === 'rotate') {
      cancelAnimationFrame(raf); anim = null;
      const R = rotM(Math.PI / 9); Xman = Xman.map(p => apply2(R, p)); registered = false; draw();
    } else if (act === 'register') {
      if (registered || anim) { cancelAnimationFrame(raf); anim = null; registered = false; draw(); } else startRegister();
    } else if (act === 'reset') {
      cancelAnimationFrame(raf); anim = null;
      Xman = BASE.map(p => apply2(rotM(INIT_ROT), p)); pShift = 18; registered = false; phRange.value = '18'; draw();
    }
  }
  const onClick = e => { const a = e.target.closest('[data-act]'); if (a) onAct(a.dataset.act); };
  root.querySelector('.sst-iv-controls').addEventListener('click', onClick);
  const onPhase = () => { cancelAnimationFrame(raf); anim = null; pShift = Number(phRange.value); registered = false; draw(); };
  phRange.addEventListener('input', onPhase);

  // drag a landmark of X (operates on Xman; un-registers first)
  let drag = -1;
  const evModel = e => {
    const r = regCanvas.getBoundingClientRect();
    const px = (e.clientX - r.left) * (regCanvas.width / r.width) / Z;
    const py = (e.clientY - r.top) * (regCanvas.height / r.height) / Z;
    return [(px - CX) / S, (CY - py) / S];
  };
  const onDown = e => {
    cancelAnimationFrame(raf); anim = null;
    if (registered) { registered = false; }
    const m = evModel(e), X = curX(); let best = -1, bd = 0.05;
    for (let i = 0; i < N; i++) { const d = (X[i][0] - m[0]) ** 2 + (X[i][1] - m[1]) ** 2; if (d < bd) { bd = d; best = i; } }
    if (best >= 0) { drag = (best + pShift) % N; e.preventDefault(); }   // map display index -> Xman index
    draw();
  };
  const onMove = e => { if (drag >= 0) { Xman[drag] = evModel(e); draw(); } };
  const onUp = () => { drag = -1; };
  regCanvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);

  draw();

  return {
    destroy () {
      cancelAnimationFrame(raf);
      root.querySelector('.sst-iv-controls')?.removeEventListener('click', onClick);
      phRange.removeEventListener('input', onPhase);
      regCanvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      root.innerHTML = '';
    }
  };
}
