/**
 * MMD / witness-function demo (honest rebuild).
 *
 * Two INDEPENDENT feature samples ρ̂, ρ̌ (different noise). A Gaussian kernel
 * gives the witness f*(t) = (1/n)Σk(t,x̂ᵢ) − (1/m)Σk(t,x̌ⱼ) whose sup-norm is the
 * MMD. The decision is NOT a fixed threshold: we calibrate against the
 * permutation null (pool the samples, reshuffle, recompute MMD² many times) and
 * report a p-value. So at coincidence the verdict is FTR ~with high probability,
 * not deterministically — the honest behaviour of a finite-sample two-sample
 * test. The unbiased MMD² estimator (no diagonal self-pairs) is used throughout.
 *
 * Contract: default export mount(rootEl) -> { destroy() }.
 */

import { normals, witness as witnessFn, decide } from './_mmd.js';

const Z = 1.25;              // uniform widget zoom (backing store + drawing)

export default function mount (root) {
  const N = 16, SIGMA = 0.6, H = 0.5;
  // INDEPENDENT noise for the two measurements (different seeds)
  const zx = normals(N, 12345);
  const zy = normals(N, 67890);
  let sep = 1.0;

  root.innerHTML = `
    <div class="sst-iv">
      <figure style="margin:0">
        <canvas class="sst-iv-canvas" width="475" height="275" data-dist></canvas>
        <figcaption style="font-size:0.82rem;color:var(--color-text-secondary);text-align:center;margin-top:0.35rem">
          ρ̂ (lower) vs ρ̌ (upper) &nbsp;·&nbsp; witness f*(t)</figcaption>
      </figure>
      <div class="sst-iv-side">
        <div class="sst-iv-readout">
          <div><span class="sst-iv-k">MMD</span><span class="sst-iv-v" data-mmd>—</span></div>
          <div><span class="sst-iv-k">p (perm.)</span><span class="sst-iv-v" data-p>—</span></div>
          <div><span class="sst-iv-k">verdict</span><span class="sst-iv-v" data-verdict>—</span></div>
        </div>
        <canvas class="sst-iv-canvas" width="300" height="70" data-null style="margin-bottom:0.5rem"></canvas>
        <label class="sst-iv-range-row">separation
          <input type="range" class="sst-range" data-sep min="0" max="320" value="100" step="1" aria-label="Separation between the two distributions">
        </label>
        <p class="sst-iv-hint">Decision is calibrated: verdict <strong>Rejects</strong> only when the observed MMD²
        beats the permutation null at α = 0.05. At coincidence it usually <strong>FTR</strong>s &mdash; but not always.</p>
      </div>
    </div>`;

  const dist = root.querySelector('[data-dist]');
  const nul = root.querySelector('[data-null]');
  const dx = dist.getContext('2d');
  const nx = nul.getContext('2d');
  const mmdEl = root.querySelector('[data-mmd]');
  const pEl = root.querySelector('[data-p]');
  const verdictEl = root.querySelector('[data-verdict]');
  const sepRange = root.querySelector('[data-sep]');
  const css = n => getComputedStyle(document.body).getPropertyValue(n).trim() || null;

  const W = 380, AX = 150, PAD = 24, T0 = -3.4, T1 = 3.4;
  const xPix = t => PAD + (t - T0) / (T1 - T0) * (W - 2 * PAD);
  const samples = () => ({ X: zx.map(z => -sep / 2 + SIGMA * z), Y: zy.map(z => sep / 2 + SIGMA * z) });
  const witness = (t, X, Y) => witnessFn(t, X, Y, H);

  function drawDist (X, Y) {
    dx.setTransform(Z, 0, 0, Z, 0, 0);
    dx.clearRect(0, 0, W, 220);
    dx.strokeStyle = css('--color-border') || '#333'; dx.lineWidth = 1;
    dx.beginPath(); dx.moveTo(PAD, AX); dx.lineTo(W - PAD, AX); dx.stroke();

    const ts = [];
    for (let i = 0; i <= 160; i++) { const t = T0 + (i / 160) * (T1 - T0); ts.push([t, witness(t, X, Y)]); }
    const FPEAK = 0.85;
    const yAt = f => AX - Math.max(-1.5, Math.min(1.5, f / FPEAK)) * 64;
    dx.fillStyle = css('--color-accent-dim') || 'rgba(83,121,73,0.3)'; dx.globalAlpha = 0.7;
    dx.beginPath(); dx.moveTo(xPix(ts[0][0]), AX); ts.forEach(([t, f]) => dx.lineTo(xPix(t), yAt(f))); dx.lineTo(xPix(ts[ts.length - 1][0]), AX); dx.closePath(); dx.fill(); dx.globalAlpha = 1;
    dx.strokeStyle = css('--color-text-heading') || '#d0c2a5'; dx.lineWidth = 2;
    dx.beginPath(); ts.forEach(([t, f], i) => { const x = xPix(t), y = yAt(f); i ? dx.lineTo(x, y) : dx.moveTo(x, y); }); dx.stroke();

    const tick = (vals, color, dir) => { dx.strokeStyle = color; dx.lineWidth = 2; vals.forEach(v => { dx.beginPath(); dx.moveTo(xPix(v), AX); dx.lineTo(xPix(v), AX + dir * 16); dx.stroke(); }); };
    tick(X, css('--color-accent-primary') || '#537949', 1);
    tick(Y, css('--color-accent-hover') || '#6ea262', -1);
  }

  // small panel: permutation null cloud + α cutoff + observed marker
  function drawNull (nulls, obs, cut) {
    nx.setTransform(Z, 0, 0, Z, 0, 0);
    nx.clearRect(0, 0, 240, 56);
    const lo = Math.min(nulls[0], obs), hi = Math.max(nulls[nulls.length - 1], obs);
    const span = (hi - lo) || 1;
    const xp = v => 8 + (v - lo) / span * (240 - 16);
    nx.strokeStyle = css('--color-border') || '#333'; nx.lineWidth = 1;
    nx.beginPath(); nx.moveTo(8, 40); nx.lineTo(232, 40); nx.stroke();
    nx.fillStyle = css('--color-text-secondary') || '#999'; nx.globalAlpha = 0.5;
    nulls.forEach(v => { nx.beginPath(); nx.arc(xp(v), 40, 1.5, 0, 7); nx.fill(); });
    nx.globalAlpha = 1;
    nx.strokeStyle = css('--color-text-secondary') || '#999'; nx.setLineDash([3, 2]);
    nx.beginPath(); nx.moveTo(xp(cut), 14); nx.lineTo(xp(cut), 46); nx.stroke(); nx.setLineDash([]);
    // observed
    const reject = obs > cut;
    nx.fillStyle = reject ? '#c9603f' : (css('--color-accent-hover') || '#6ea262');
    nx.beginPath(); nx.arc(xp(obs), 40, 4, 0, 7); nx.fill();
    nx.font = '9px monospace'; nx.fillStyle = css('--color-text-secondary') || '#999';
    nx.textAlign = 'center'; nx.fillText('perm. null  ·  95% cutoff  ·  ● obs', 120, 10);
  }

  function draw () {
    const { X, Y } = samples();
    const { obs, p, reject, nulls, cut } = decide(X, Y, H, { B: 300 });

    drawDist(X, Y);
    drawNull(nulls, obs, cut);
    mmdEl.textContent = Math.sqrt(Math.max(0, obs)).toFixed(3);
    pEl.textContent = p.toFixed(3);
    verdictEl.textContent = reject ? 'Reject' : 'FTR';
    verdictEl.style.color = reject ? '#c9603f' : (css('--color-accent-hover') || '#6ea262');
  }

  const onInput = () => { sep = Number(sepRange.value) / 100; draw(); };
  sepRange.addEventListener('input', onInput);
  draw();

  return {
    destroy () { sepRange.removeEventListener('input', onInput); root.innerHTML = ''; }
  };
}
