/**
 * Nyström spectral-convergence demo — two curves, two metrics.
 *
 * Compares an analytic curve (Cassini oval) against a real segmented boundary
 * (apple-1, MPEG-7, as a periodic cubic spline). For each, arc-length-weighted
 * quadrature on N nodes builds the weighted second moment; we track two errors
 * vs a refined reference (see scripts/compute_nystrom_convergence.py, following
 * TDA-SST's nystrom_demo.m):
 *   - scale:  ||P_N - P_ref||_F            (the scale operator P)
 *   - efunc:  max_s ||v_N(s) - v_ref(s)||  (the eigenfunctions v = c·A·diag(1/σ),
 *             i.e. the α-defined linear combinations — not just scales)
 * Cassini converges spectrally; the apple spline only algebraically (real data
 * has finite smoothness). Slide N to populate nodes and move the markers.
 *
 * Contract: default export mount(rootEl) -> { destroy() }.
 */

import { NYSTROM } from './_nystrom_data.js';

const NS = NYSTROM.N;
const P1 = NYSTROM.p1, P2 = NYSTROM.p2;
const OUTLINE = NYSTROM.appleOutline;

function cassiniPt (t) {
  const r = Math.sqrt(Math.max(0, P1 * Math.cos(2 * t) +
    Math.sqrt(Math.max(0, P2 / (P1 ** 4) - Math.sin(2 * t) ** 2))));
  return [r * Math.cos(t), r * Math.sin(t)];
}

export default function mount (root) {
  let idx = Math.max(0, NS.indexOf(NS.find(n => n >= 24)));
  if (idx < 0) idx = 0;

  root.innerHTML = `
    <div class="sst-iv">
      <div class="sst-sp-panels">
        <figure style="margin:0"><canvas class="sst-iv-canvas" width="230" height="180" data-cassini></canvas>
          <figcaption>Cassini oval · N nodes</figcaption></figure>
        <figure style="margin:0"><canvas class="sst-iv-canvas" width="230" height="180" data-apple></canvas>
          <figcaption>apple-1 boundary · N nodes</figcaption></figure>
      </div>
      <div class="sst-sp-panels">
        <figure style="margin:0"><canvas class="sst-iv-canvas" width="230" height="200" data-scale></canvas>
          <figcaption>scale error ‖P<sub>N</sub>−P<sub>ref</sub>‖ (log–log)</figcaption></figure>
        <figure style="margin:0"><canvas class="sst-iv-canvas" width="230" height="200" data-efunc></canvas>
          <figcaption>eigenfunction error max‖v<sub>N</sub>−v<sub>ref</sub>‖ (log–log)</figcaption></figure>
      </div>
      <div class="sst-iv-side">
        <div class="sst-iv-readout">
          <div><span class="sst-iv-k">N nodes</span><span class="sst-iv-v" data-n>—</span></div>
          <div><span class="sst-iv-k" style="color:var(--color-accent-primary)">Cassini</span><span class="sst-iv-v" data-ec>—</span></div>
          <div><span class="sst-iv-k" style="color:#c9603f">apple</span><span class="sst-iv-v" data-ea>—</span></div>
        </div>
        <label class="sst-iv-range-row">N
          <input type="range" class="sst-range" data-nr min="0" max="${NS.length - 1}" value="${idx}" step="1" aria-label="Number of quadrature nodes">
        </label>
        <p class="sst-iv-hint">The analytic <strong style="color:var(--color-accent-primary)">Cassini</strong>
        converges <strong>spectrally</strong>; the real <strong style="color:#c9603f">apple</strong> spline only
        <strong>algebraically</strong> — finite smoothness of measured data. The right plot tracks the
        eigenfunctions (the α-defined combinations), not just scale.</p>
      </div>
    </div>`;

  const cc = root.querySelector('[data-cassini]').getContext('2d');
  const ac = root.querySelector('[data-apple]').getContext('2d');
  const sc = root.querySelector('[data-scale]').getContext('2d');
  const ec = root.querySelector('[data-efunc]').getContext('2d');
  const nEl = root.querySelector('[data-n]');
  const ecEl = root.querySelector('[data-ec]');
  const eaEl = root.querySelector('[data-ea]');
  const range = root.querySelector('[data-nr]');
  const css = n => getComputedStyle(document.body).getPropertyValue(n).trim() || null;
  const GREEN = () => css('--color-accent-primary') || '#537949';
  const APPLE = '#c9603f';
  const GRID = () => css('--color-border') || '#444';
  const TXT = () => css('--color-text-secondary') || '#999';

  function fit (pts, W, H, pad) {
    let xm = 9, xM = -9, ym = 9, yM = -9;
    for (const [x, y] of pts) { xm = Math.min(xm, x); xM = Math.max(xM, x); ym = Math.min(ym, y); yM = Math.max(yM, y); }
    const s = Math.min((W - 2 * pad) / (xM - xm), (H - 2 * pad) / (yM - ym));
    const cx = (xm + xM) / 2, cy = (ym + yM) / 2;
    return p => [W / 2 + (p[0] - cx) * s, H / 2 - (p[1] - cy) * s];
  }

  function drawCurve (ctx, outlinePts, nodeAt, n, color, W, H) {
    ctx.clearRect(0, 0, W, H);
    const T = fit(outlinePts, W, H, 16);
    ctx.strokeStyle = GRID(); ctx.lineWidth = 1; ctx.beginPath();
    outlinePts.forEach((p, i) => { const q = T(p); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
    ctx.closePath(); ctx.stroke();
    ctx.fillStyle = color;
    for (let i = 0; i < n; i++) { const q = T(nodeAt(i, n)); ctx.beginPath(); ctx.arc(q[0], q[1], 2.3, 0, 7); ctx.fill(); }
  }

  // log-log convergence plot with both curves + marker at current idx
  function drawPlot (ctx, key, W, H) {
    const cVals = NYSTROM.cassini[key], aVals = NYSTROM.apple[key];
    const X0 = 38, X1 = W - 10, Y0 = 12, Y1 = H - 26;
    const all = cVals.concat(aVals);
    const loE = Math.floor(Math.log10(Math.min(...all)));
    const hiE = Math.ceil(Math.log10(Math.max(...all)));
    const logNmin = Math.log10(NS[0]), logNmax = Math.log10(NS[NS.length - 1]);
    const xP = nn => X0 + (Math.log10(nn) - logNmin) / (logNmax - logNmin) * (X1 - X0);
    const yP = e => Y0 + (hiE - Math.log10(e)) / (hiE - loE) * (Y1 - Y0);

    ctx.clearRect(0, 0, W, H);
    ctx.font = '8px monospace'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = GRID(); ctx.fillStyle = TXT();
    for (let q = loE; q <= hiE; q++) {
      const y = yP(Math.pow(10, q));
      ctx.globalAlpha = 0.4; ctx.beginPath(); ctx.moveTo(X0, y); ctx.lineTo(X1, y); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.textAlign = 'right'; ctx.fillText('1e' + q, X0 - 3, y);
    }
    for (const p of [1, 2]) {
      const nn = Math.pow(10, p); if (nn < NS[0] || nn > NS[NS.length - 1]) continue;
      const x = xP(nn); ctx.globalAlpha = 0.4; ctx.beginPath(); ctx.moveTo(x, Y0); ctx.lineTo(x, Y1); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.textAlign = 'center'; ctx.fillText(String(nn), x, Y1 + 9);
    }
    ctx.textAlign = 'center'; ctx.fillText('N', (X0 + X1) / 2, H - 4);
    ctx.strokeStyle = TXT(); ctx.globalAlpha = 1; ctx.strokeRect(X0, Y0, X1 - X0, Y1 - Y0);

    const series = (vals, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
      vals.forEach((e, i) => { const x = xP(NS[i]), y = yP(e); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(xP(NS[idx]), yP(vals[idx]), 4, 0, 7); ctx.fill();
    };
    series(cVals, GREEN());
    series(aVals, APPLE);
  }

  function draw () {
    const n = NS[idx];
    drawCurve(cc, Array.from({ length: 200 }, (_, k) => cassiniPt((k / 200) * 2 * Math.PI)),
      (i, nn) => cassiniPt((i / nn) * 2 * Math.PI), n, GREEN(), 230, 180);
    drawCurve(ac, OUTLINE,
      (i, nn) => OUTLINE[Math.round((i / nn) * OUTLINE.length) % OUTLINE.length], n, APPLE, 230, 180);
    drawPlot(sc, 'scale', 230, 200);
    drawPlot(ec, 'efunc', 230, 200);
    nEl.textContent = String(n);
    ecEl.textContent = NYSTROM.cassini.scale[idx].toExponential(1);
    eaEl.textContent = NYSTROM.apple.scale[idx].toExponential(1);
  }

  const onInput = () => { idx = Number(range.value); draw(); };
  range.addEventListener('input', onInput);
  draw();

  return {
    destroy () { range.removeEventListener('input', onInput); root.innerHTML = ''; }
  };
}
