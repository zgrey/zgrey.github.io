/**
 * Product-MMD truth table (explainable binary classification).
 *
 * Two calibrated channels — undulation t and scale ℓ — each its own
 * permutation-calibrated MMD test (shared core in _mmd.js). The product test
 * fails to reject ONLY if BOTH channels FTR; otherwise it rejects, and *which*
 * channel rejected explains the difference (undulation vs scale). This is the
 * logical decomposition behind label-free explainable classification.
 *
 * Contract: default export mount(rootEl) -> { destroy() }.
 */

import { normals, decide } from './_mmd.js';

export default function mount (root) {
  const N = 14, SIGMA = 0.6, H = 0.5;
  const ch = {
    t: { name: 'undulation t', za: normals(N, 111), zb: normals(N, 222), sep: 0.0 },
    l: { name: 'scale ℓ', za: normals(N, 333), zb: normals(N, 444), sep: 1.4 }
  };

  root.innerHTML = `
    <div class="sst-pm">
      <div class="sst-pm-channels">
        ${['t', 'l'].map(key => `
          <div class="sst-pm-ch" data-ch="${key}">
            <div class="sst-pm-row">
              <span class="sst-pm-name">${ch[key].name}</span>
              <span class="sst-pm-badge" data-badge="${key}">—</span>
            </div>
            <canvas class="sst-iv-canvas" width="260" height="40" data-strip="${key}"></canvas>
            <label class="sst-iv-range-row">sep
              <input type="range" class="sst-range" data-range="${key}" min="0" max="320" value="${Math.round(ch[key].sep * 100)}" step="1" aria-label="${ch[key].name} separation">
            </label>
          </div>`).join('')}
      </div>
      <table class="sst-pm-table" aria-label="Product decision truth table">
        <tr><td class="sst-pm-corner"></td><th>scale: same</th><th>scale: differ</th></tr>
        <tr><th>undul.: same</th><td data-cell="0,0">FTR</td><td data-cell="0,1">Reject</td></tr>
        <tr><th>undul.: differ</th><td data-cell="1,0">Reject</td><td data-cell="1,1">Reject</td></tr>
      </table>
      <p class="sst-pm-verdict" data-verdict>—</p>
      <p class="sst-iv-hint">Each channel is its own calibrated test. The product <strong>FTR</strong>s only if both do;
      otherwise <em>which</em> channel rejected names the cause.</p>
    </div>`;

  const css = n => getComputedStyle(document.body).getPropertyValue(n).trim() || null;
  const verdictEl = root.querySelector('[data-verdict]');
  const REJECT = '#c9603f';

  function drawStrip (key, X, Y) {
    const c = root.querySelector(`[data-strip="${key}"]`);
    const g = c.getContext('2d');
    const W = 260, AX = 20, PAD = 12, T0 = -3.2, T1 = 3.2;
    const xp = t => PAD + (t - T0) / (T1 - T0) * (W - 2 * PAD);
    g.clearRect(0, 0, W, 40);
    g.strokeStyle = css('--color-border') || '#333'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(PAD, AX); g.lineTo(W - PAD, AX); g.stroke();
    const tick = (vals, color, dir) => { g.strokeStyle = color; g.lineWidth = 2; vals.forEach(v => { g.beginPath(); g.moveTo(xp(v), AX); g.lineTo(xp(v), AX + dir * 12); g.stroke(); }); };
    tick(X, css('--color-accent-primary') || '#537949', 1);
    tick(Y, css('--color-accent-hover') || '#6ea262', -1);
  }

  function evalChannel (key) {
    const c = ch[key];
    const X = c.za.map(z => -c.sep / 2 + SIGMA * z);
    const Y = c.zb.map(z => c.sep / 2 + SIGMA * z);
    const d = decide(X, Y, H, { B: 200 });
    drawStrip(key, X, Y);
    const badge = root.querySelector(`[data-badge="${key}"]`);
    badge.textContent = d.reject ? 'Reject' : 'FTR';
    badge.style.color = d.reject ? REJECT : (css('--color-accent-hover') || '#6ea262');
    return d.reject;
  }

  function draw () {
    const rt = evalChannel('t');
    const rl = evalChannel('l');
    // highlight the active truth-table cell
    root.querySelectorAll('[data-cell]').forEach(td => td.classList.remove('is-cell-active'));
    const cell = root.querySelector(`[data-cell="${rt ? 1 : 0},${rl ? 1 : 0}"]`);
    if (cell) cell.classList.add('is-cell-active');

    const reject = rt || rl;
    let msg;
    if (!rt && !rl) msg = 'FTR — same shape distribution.';
    else if (rt && !rl) msg = 'Reject — differ by undulation (nonlinear deformation).';
    else if (!rt && rl) msg = 'Reject — differ by scale (linear deformation).';
    else msg = 'Reject — differ in both undulation and scale.';
    verdictEl.textContent = msg;
    verdictEl.style.color = reject ? REJECT : (css('--color-accent-hover') || '#6ea262');
  }

  const onInput = e => {
    const r = e.target.closest('[data-range]');
    if (!r) return;
    ch[r.dataset.range].sep = Number(r.value) / 100;
    draw();
  };
  root.querySelector('.sst-pm-channels').addEventListener('input', onInput);
  draw();

  return {
    destroy () {
      root.querySelector('.sst-pm-channels')?.removeEventListener('input', onInput);
      root.innerHTML = '';
    }
  };
}
