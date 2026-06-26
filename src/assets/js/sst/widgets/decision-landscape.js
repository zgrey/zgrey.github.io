/**
 * Decision landscape / ambiguity.
 *
 * Honestly Monte-Carlo'd: for each effect size δ we draw M independent data
 * sets and run the permutation-calibrated MMD test on each, so P(reject)(δ) is
 * the test's ACTUAL rejection rate — ≈ α at δ=0 (correct size), → 1 for large δ.
 * The Bernoulli ambiguity 4p(1−p) peaks where p≈½: the band where the verdict
 * is a coin flip. A nuisance parameter (e.g. segmentation smoothing) slides the
 * effective δ along this axis — land in the ambiguous band and the decision is
 * unstable. Nothing here is tuned to look clean; it is the calibrated test's
 * real operating characteristic.
 *
 * Contract: default export mount(rootEl) -> { destroy() }.
 */

import { normals, decide } from './_mmd.js';

const Z = 1.25;              // uniform widget zoom (backing store + drawing)

export default function mount (root) {
  const N = 12, SIGMA = 0.6, H = 0.5, M = 24, B = 120, G = 20, DMAX = 2.4;

  // precompute the operating characteristic once
  const grid = [];
  for (let gi = 0; gi < G; gi++) {
    const d = (gi / (G - 1)) * DMAX;
    let rej = 0;
    for (let m = 0; m < M; m++) {
      const X = normals(N, 1000 + gi * 97 + m * 7).map(z => -d / 2 + SIGMA * z);
      const Y = normals(N, 5000 + gi * 131 + m * 11).map(z => d / 2 + SIGMA * z);
      if (decide(X, Y, H, { B }).reject) rej++;
    }
    const p = rej / M;
    grid.push({ d, p, amb: 4 * p * (1 - p) });
  }
  let op = Math.round((G - 1) * 0.35);

  root.innerHTML = `
    <div class="sst-iv">
      <figure style="margin:0">
        <canvas class="sst-iv-canvas" width="450" height="275" data-plot></canvas>
        <figcaption style="font-size:0.82rem;color:var(--color-text-secondary);text-align:center;margin-top:0.35rem">
          P(reject) and ambiguity 4p(1−p) vs effect size δ</figcaption>
      </figure>
      <div class="sst-iv-side">
        <div class="sst-iv-readout">
          <div><span class="sst-iv-k">effect δ</span><span class="sst-iv-v" data-d>—</span></div>
          <div><span class="sst-iv-k">P(reject)</span><span class="sst-iv-v" data-p>—</span></div>
          <div><span class="sst-iv-k">ambiguity</span><span class="sst-iv-v" data-amb>—</span></div>
        </div>
        <label class="sst-iv-range-row">δ
          <input type="range" class="sst-range" data-op min="0" max="${G - 1}" value="${op}" step="1" aria-label="Operating effect size">
        </label>
        <p class="sst-iv-hint">At δ=0 the rejection rate is ≈ α (correct size). The <strong>ambiguous band</strong>
        (4p(1−p) near 1) is where a nuisance makes the verdict a coin flip.</p>
      </div>
    </div>`;

  const css = n => getComputedStyle(document.body).getPropertyValue(n).trim() || null;
  const pc = root.querySelector('[data-plot]').getContext('2d');
  const dEl = root.querySelector('[data-d]');
  const pEl = root.querySelector('[data-p]');
  const ambEl = root.querySelector('[data-amb]');
  const opRange = root.querySelector('[data-op]');

  const X0 = 38, X1 = 348, Y0 = 14, Y1 = 188;
  const xAt = d => X0 + d / DMAX * (X1 - X0);
  const yAt = v => Y1 - v * (Y1 - Y0);

  function curve (key, color, dash) {
    pc.strokeStyle = color; pc.lineWidth = 2; pc.setLineDash(dash || []);
    pc.beginPath(); grid.forEach((g, i) => { const x = xAt(g.d), y = yAt(g[key]); i ? pc.lineTo(x, y) : pc.moveTo(x, y); });
    pc.stroke(); pc.setLineDash([]);
  }

  function draw () {
    pc.setTransform(Z, 0, 0, Z, 0, 0);
    pc.clearRect(0, 0, 360, 220);
    // grid + axes
    pc.strokeStyle = css('--color-border') || '#333'; pc.lineWidth = 1;
    pc.strokeRect(X0, Y0, X1 - X0, Y1 - Y0);
    pc.fillStyle = css('--color-text-secondary') || '#999'; pc.font = '9px monospace';
    [0, 0.5, 1].forEach(v => {
      const y = yAt(v); pc.globalAlpha = 0.4; pc.beginPath(); pc.moveTo(X0, y); pc.lineTo(X1, y); pc.stroke(); pc.globalAlpha = 1;
      pc.textAlign = 'right'; pc.fillText(v.toFixed(1), X0 - 4, y + 3);
    });
    pc.textAlign = 'center'; pc.fillText('δ', (X0 + X1) / 2, 212);

    curve('amb', css('--color-text-heading') || '#d0c2a5', [4, 3]);
    curve('p', css('--color-accent-primary') || '#537949');

    const g = grid[op];
    pc.strokeStyle = css('--color-text-secondary') || '#999'; pc.setLineDash([3, 3]);
    pc.beginPath(); pc.moveTo(xAt(g.d), Y0); pc.lineTo(xAt(g.d), Y1); pc.stroke(); pc.setLineDash([]);
    pc.fillStyle = css('--color-accent-hover') || '#6ea262';
    pc.beginPath(); pc.arc(xAt(g.d), yAt(g.p), 4, 0, 7); pc.fill();

    // legend
    pc.textAlign = 'left';
    pc.fillStyle = css('--color-accent-primary') || '#537949'; pc.fillText('— P(reject)', X0 + 6, Y0 + 12);
    pc.fillStyle = css('--color-text-heading') || '#d0c2a5'; pc.fillText('-- ambiguity', X0 + 6, Y0 + 24);

    dEl.textContent = g.d.toFixed(2);
    pEl.textContent = g.p.toFixed(2);
    ambEl.textContent = g.amb.toFixed(2);
  }

  const onInput = () => { op = Number(opRange.value); draw(); };
  opRange.addEventListener('input', onInput);
  draw();

  return {
    destroy () { opRange.removeEventListener('input', onInput); root.innerHTML = ''; }
  };
}
