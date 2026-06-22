/**
 * Ridge function / active-subspace demo.
 *
 * A function on a 2-D design space that is really a RIDGE: f(x) = g(wᵀx) — it
 * varies along one direction w and is flat across it. Rotate the guessed
 * direction u and watch the SUFFICIENT SUMMARY PLOT (f vs uᵀx): aligned with w
 * it collapses to a 1-D curve, misaligned it is a scattered cloud. That collapse
 * is exactly dimension reduction — the active subspace of quad-trace / G2Aero,
 * the linear precursor to the manifold (AMG) story.
 *
 * Contract: default export mount(rootEl) -> { destroy() }.
 */

function mulberry32 (seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export default function mount (root) {
  const PHI_W = 35 * Math.PI / 180;           // true active direction
  const w = [Math.cos(PHI_W), Math.sin(PHI_W)];
  const g = t => Math.tanh(1.5 * t);          // ridge profile
  const rnd = mulberry32(2024);
  const M = 150;
  const pts = [];
  for (let i = 0; i < M; i++) {
    const x = [2 * rnd() - 1, 2 * rnd() - 1];
    pts.push({ x, f: g(w[0] * x[0] + w[1] * x[1]) });
  }
  let phi = 105 * Math.PI / 180;              // user's guess (start misaligned)

  root.innerHTML = `
    <div class="sst-iv">
      <div class="sst-sp-panels">
        <figure><canvas class="sst-iv-canvas" width="220" height="220" data-field></canvas>
          <figcaption>f(x) over the design space + guess u</figcaption></figure>
        <figure><canvas class="sst-iv-canvas" width="220" height="220" data-summary></canvas>
          <figcaption>sufficient summary: f vs uᵀx</figcaption></figure>
      </div>
      <div class="sst-iv-side">
        <div class="sst-iv-readout">
          <div><span class="sst-iv-k">alignment |uᵀw|</span><span class="sst-iv-v" data-align>—</span></div>
          <div><span class="sst-iv-k">vertical spread</span><span class="sst-iv-v" data-spread>—</span></div>
        </div>
        <label class="sst-iv-range-row">u angle
          <input type="range" class="sst-range" data-phi min="0" max="180" value="105" step="1" aria-label="Guessed active direction angle">
        </label>
        <p class="sst-iv-hint">Rotate u until the cloud <strong>collapses to a curve</strong>. There it is: the one
        direction the function actually depends on — a 1-D ridge in 2-D.</p>
      </div>
    </div>`;

  const fc = root.querySelector('[data-field]').getContext('2d');
  const sc = root.querySelector('[data-summary]').getContext('2d');
  const alignEl = root.querySelector('[data-align]');
  const spreadEl = root.querySelector('[data-spread]');
  const phiRange = root.querySelector('[data-phi]');
  const css = n => getComputedStyle(document.body).getPropertyValue(n).trim() || null;

  function drawField (u) {
    fc.clearRect(0, 0, 220, 220);
    const G = 22, cell = 200 / G, o = 10;
    for (let i = 0; i < G; i++) {
      for (let j = 0; j < G; j++) {
        const x = [-1 + 2 * (i + 0.5) / G, -1 + 2 * (j + 0.5) / G];
        const f = g(w[0] * x[0] + w[1] * x[1]);
        fc.fillStyle = css('--color-accent-primary') || '#537949';
        fc.globalAlpha = 0.12 + 0.8 * (f + 1) / 2;
        fc.fillRect(o + i * cell, o + (G - 1 - j) * cell, cell + 0.5, cell + 0.5);
      }
    }
    fc.globalAlpha = 1;
    const cx = 110, cy = 110, R = 78;
    const arrow = (v, color, lw) => { fc.strokeStyle = color; fc.lineWidth = lw; fc.beginPath(); fc.moveTo(cx - v[0] * R, cy + v[1] * R); fc.lineTo(cx + v[0] * R, cy - v[1] * R); fc.stroke(); };
    arrow(w, css('--color-text-secondary') || '#999', 1);          // true w (faint)
    arrow(u, css('--color-accent-hover') || '#6ea262', 2.5);        // guess u
  }

  function drawSummary (u) {
    sc.clearRect(0, 0, 220, 220);
    sc.strokeStyle = css('--color-border') || '#333'; sc.lineWidth = 1; sc.strokeRect(16, 10, 196, 196);
    const projs = pts.map(pt => u[0] * pt.x[0] + u[1] * pt.x[1]);
    const xAt = pr => 16 + (pr + 1.5) / 3 * 196;
    const yAt = f => 206 - (f + 1.05) / 2.1 * 196;
    sc.fillStyle = css('--color-accent-hover') || '#6ea262';
    pts.forEach((pt, i) => { sc.beginPath(); sc.arc(xAt(projs[i]), yAt(pt.f), 2, 0, 7); sc.fill(); });

    // vertical spread: residual std of f after a binned-mean trend in proj
    const NB = 12, sum = Array(NB).fill(0), cnt = Array(NB).fill(0);
    const bin = pr => Math.max(0, Math.min(NB - 1, Math.floor((pr + 1.5) / 3 * NB)));
    pts.forEach((pt, i) => { const b = bin(projs[i]); sum[b] += pt.f; cnt[b]++; });
    const mean = sum.map((s, b) => cnt[b] ? s / cnt[b] : 0);
    let ss = 0; pts.forEach((pt, i) => { const r = pt.f - mean[bin(projs[i])]; ss += r * r; });
    const spread = Math.sqrt(ss / pts.length);

    const align = Math.abs(u[0] * w[0] + u[1] * w[1]);
    alignEl.textContent = align.toFixed(3);
    spreadEl.textContent = spread.toFixed(3);
    alignEl.style.color = align > 0.98 ? (css('--color-accent-hover') || '#6ea262') : (css('--color-text-secondary') || '#999');
  }

  function draw () {
    const u = [Math.cos(phi), Math.sin(phi)];
    drawField(u);
    drawSummary(u);
  }
  const onInput = () => { phi = Number(phiRange.value) * Math.PI / 180; draw(); };
  phiRange.addEventListener('input', onInput);
  draw();

  return {
    destroy () { phiRange.removeEventListener('input', onInput); root.innerHTML = ''; }
  };
}
