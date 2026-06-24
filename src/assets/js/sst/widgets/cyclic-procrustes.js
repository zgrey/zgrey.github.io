/**
 * Cyclic Procrustes demo — the fix for the phase-shift problem.
 *
 * The apple registered against itself. Y is the apple in a shifted + rotated
 * pose (a reparametrized, rigidly-moved measurement); X is the editable apple.
 * Naively pairing landmark i <-> i is wrong (the phase shift + rotation). Cyclic
 * Procrustes recovers the cyclic offset p* and rotation R*:
 *     min_{p, R in O(2)} || C(p) X - Y R ||_F
 *       <=>  p* = argmax_p || Y^T C(p) X ||_*,   R* = U V^T  (SVD of Y^T C(p*) X)
 * After registration the shapes coincide; any residual is genuine undulation
 * (drag a landmark to perturb and see the residual appear). This is the
 * reparametrization fix the eigenfunction phase shift needed.
 *
 * Contract: default export mount(rootEl) -> { destroy() }.
 */

import { APPLE } from './_apple.js';

const N = APPLE.length;
const SHAPE_SCALE = 1.45;
const BASE = APPLE.map(([x, y]) => [x * SHAPE_SCALE, y * SHAPE_SCALE]);

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

// 2x2 second-moment cross matrix M(p) = Y^T C(p) X,  (C(p)X)[i] = X[(i+p)%n]
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
function procrustesR (M) {              // R = M (M^T M)^{-1/2}  (orthogonal factor)
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
  let X = BASE.map(p => [...p]);          // editable query apple
  let pTrue = 18;                          // applied cyclic phase shift
  let thTrue = 35 * Math.PI / 180;         // applied rotation
  let registered = false;

  function makeY () {                       // reference apple: shifted + rotated original
    const R = rotM(thTrue);
    return BASE.map((_, i) => apply2(R, BASE[(i - pTrue + N) % N]));
  }

  function register (Y) {
    let best = -1, pstar = 0;
    const fs = new Array(N);
    for (let p = 0; p < N; p++) { const f = nuclear2(crossM(Y, X, p)); fs[p] = f; if (f > best) { best = f; pstar = p; } }
    const R = procrustesR(crossM(Y, X, pstar));
    let resid = 0;
    for (let i = 0; i < N; i++) {            // ||C(p*)X - Y R||_F
      const xi = X[(i + pstar) % N], yi = apply2(R, Y[i]);
      resid += (xi[0] - yi[0]) ** 2 + (xi[1] - yi[1]) ** 2;
    }
    return { fs, pstar, R, resid: Math.sqrt(resid) };
  }

  root.innerHTML = `
    <div class="sst-iv">
      <figure style="margin:0"><canvas class="sst-iv-canvas" width="300" height="260" data-reg></canvas>
        <figcaption><span style="color:#c9603f">Y</span> reference vs <span style="color:var(--color-accent-primary)">X</span> query · correspondence</figcaption></figure>
      <figure style="margin:0"><canvas class="sst-iv-canvas" width="230" height="200" data-obj></canvas>
        <figcaption>‖Y<sup>⊤</sup>C(p)X‖<sub>∗</sub> over cyclic shift p</figcaption></figure>
      <div class="sst-iv-side">
        <div class="sst-iv-readout">
          <div><span class="sst-iv-k">found p*</span><span class="sst-iv-v" data-ps>—</span></div>
          <div><span class="sst-iv-k">residual</span><span class="sst-iv-v" data-res>—</span></div>
        </div>
        <label class="sst-iv-range-row">phase
          <input type="range" class="sst-range" data-ph min="0" max="${N - 1}" value="${pTrue}" step="1" aria-label="Applied cyclic phase shift">
        </label>
        <div class="sst-iv-controls">
          <button type="button" data-act="rotate">rotate</button>
          <button type="button" data-act="register">register</button>
          <button type="button" data-act="reset">reset</button>
        </div>
        <p class="sst-iv-hint">A phase-shifted, rotated copy looks misaligned (tangled correspondence).
        <strong>Register</strong> recovers the cyclic shift + rotation. <strong>Drag</strong> a landmark: the
        leftover residual is genuine undulation, not phase.</p>
      </div>
    </div>`;

  const rc = root.querySelector('[data-reg]').getContext('2d');
  const oc = root.querySelector('[data-obj]').getContext('2d');
  const psEl = root.querySelector('[data-ps]');
  const resEl = root.querySelector('[data-res]');
  const phRange = root.querySelector('[data-ph]');
  const regBtn = root.querySelector('[data-act="register"]');
  const css = n => getComputedStyle(document.body).getPropertyValue(n).trim() || null;
  const GREEN = () => css('--color-accent-primary') || '#537949';
  const APPLE_C = '#c9603f';

  const S = 78, CX = 150, CY = 130;
  const toPx = p => [CX + p[0] * S, CY - p[1] * S];
  const strokeShape = (ctx, pts, color, w) => {
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath();
    pts.forEach((p, i) => { const q = toPx(p); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
    ctx.closePath(); ctx.stroke();
  };

  function draw () {
    const Y = makeY();
    const reg = register(Y);
    // X displayed: aligned to Y when registered, else its own (naive) frame
    const Rt = [[reg.R[0][0], reg.R[1][0]], [reg.R[0][1], reg.R[1][1]]]; // R^T
    // X aligned to Y when registered: corresponds index i to Y[i]; naive pairs i<->i too,
    // but in X's own (un-shifted, un-rotated) frame so the lines tangle.
    const Xdisp = X.map((_, i) => registered ? apply2(Rt, X[(i + reg.pstar) % N]) : X[i]);

    rc.clearRect(0, 0, 300, 260);
    rc.strokeStyle = css('--color-text-secondary') || '#999'; rc.globalAlpha = 0.4; rc.lineWidth = 1;
    for (let i = 0; i < N; i += 1) {
      const a = toPx(Xdisp[i]), b = toPx(Y[i]);
      rc.beginPath(); rc.moveTo(a[0], a[1]); rc.lineTo(b[0], b[1]); rc.stroke();
    }
    rc.globalAlpha = 1;
    strokeShape(rc, Y, APPLE_C, 2);
    strokeShape(rc, Xdisp, GREEN(), 2);

    // objective plot (y zoomed to min..max so the peak reads)
    const fs = reg.fs;
    const fmin = Math.min(...fs), fmax = Math.max(...fs);
    const X0 = 30, X1 = 222, Y0 = 12, Y1 = 178;
    const xp = p => X0 + p / (N - 1) * (X1 - X0);
    const yp = f => Y1 - (f - fmin) / (fmax - fmin || 1) * (Y1 - Y0);
    oc.clearRect(0, 0, 230, 200);
    oc.strokeStyle = css('--color-border') || '#444'; oc.lineWidth = 1; oc.strokeRect(X0, Y0, X1 - X0, Y1 - Y0);
    oc.strokeStyle = GREEN(); oc.lineWidth = 2; oc.beginPath();
    fs.forEach((f, p) => { const x = xp(p), y = yp(f); p ? oc.lineTo(x, y) : oc.moveTo(x, y); });
    oc.stroke();
    // peak marker
    oc.fillStyle = APPLE_C; oc.beginPath(); oc.arc(xp(reg.pstar), yp(fs[reg.pstar]), 4, 0, 7); oc.fill();
    oc.fillStyle = css('--color-text-secondary') || '#999'; oc.font = '9px monospace'; oc.textAlign = 'center';
    oc.fillText('p', (X0 + X1) / 2, 196); oc.fillText('p* = ' + reg.pstar, xp(reg.pstar), Y0 + 10);

    psEl.textContent = String(reg.pstar);
    resEl.textContent = reg.resid.toFixed(3);
    regBtn.textContent = registered ? 'un-register' : 'register';
  }

  function onAct (act) {
    if (act === 'rotate') { thTrue += Math.PI / 9; } else if (act === 'register') { registered = !registered; } else if (act === 'reset') { X = BASE.map(p => [...p]); pTrue = 18; thTrue = 35 * Math.PI / 180; registered = false; phRange.value = String(pTrue); }
    draw();
  }
  const onClick = e => { const a = e.target.closest('[data-act]'); if (a) onAct(a.dataset.act); };
  root.querySelector('.sst-iv-controls').addEventListener('click', onClick);
  const onPhase = () => { pTrue = Number(phRange.value); registered = false; draw(); };
  phRange.addEventListener('input', onPhase);

  // drag a landmark of X (naive frame only)
  const canvas = root.querySelector('[data-reg]');
  let drag = -1;
  const evModel = e => {
    const r = canvas.getBoundingClientRect();
    const px = (e.clientX - r.left) * (canvas.width / r.width);
    const py = (e.clientY - r.top) * (canvas.height / r.height);
    return [(px - CX) / S, (CY - py) / S];
  };
  const onDown = e => {
    if (registered) { registered = false; draw(); }
    const m = evModel(e); let best = -1, bd = 0.05;
    for (let i = 0; i < N; i++) { const d = (X[i][0] - m[0]) ** 2 + (X[i][1] - m[1]) ** 2; if (d < bd) { bd = d; best = i; } }
    if (best >= 0) { drag = best; e.preventDefault(); }
  };
  const onMove = e => { if (drag >= 0) { X[drag] = evModel(e); draw(); } };
  const onUp = () => { drag = -1; };
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);

  draw();

  return {
    destroy () {
      root.querySelector('.sst-iv-controls')?.removeEventListener('click', onClick);
      phRange.removeEventListener('input', onPhase);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      root.innerHTML = '';
    }
  };
}
