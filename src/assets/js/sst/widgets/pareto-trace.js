/**
 * Subspace-based Pareto tracing.
 *
 * Two competing throughputs are scalarized as g(y;λ) = λ f₁(y) + (1−λ) f₂(y)
 * over the REDUCED coordinates y = Uᵀx of a 2-D aggregate active subspace.
 * Sweeping λ from 0 to 1 sweeps the maximizer y*(λ) along a continuous path —
 * that path is the Pareto set, and its image is the Pareto frontier.
 *
 * The point is that you never re-solve from scratch: differentiating the
 * stationarity condition ∇g(y*(λ);λ) = 0 in λ gives a predictor ODE
 *
 *     dy*(λ)/dλ = −H(λ)⁻¹ (∇f₁ − ∇f₂),   H(λ) = λ∇²f₁ + (1−λ)∇²f₂,
 *
 * which is integrated to TRACE the frontier. Both objectives here are concave
 * quadratics, so the stationary point also has a closed form
 * y*(λ) = [λA + (1−λ)B]⁻¹(λAa + (1−λ)Bb); the widget integrates the ODE and
 * draws the closed form on top, so the two visibly agree — the residual between
 * them is reported live.
 *
 * Contract: default export mount(rootEl) -> { destroy() }.
 */

const Z = 1.25;                       // uniform widget zoom, matches sibling widgets

// --- the two criteria, as concave quadratics on the reduced 2-D subspace ----
const A = [[1.6, 0.5], [0.5, 0.9]];   // curvature of criterion 1
const B = [[0.8, -0.45], [-0.45, 1.7]];
const a = [-0.55, 0.35];              // unconstrained optimum of criterion 1
const b = [0.62, -0.28];

const mv = (M, v) => [M[0][0] * v[0] + M[0][1] * v[1], M[1][0] * v[0] + M[1][1] * v[1]];
const sub = (u, v) => [u[0] - v[0], u[1] - v[1]];
const quad = (M, d) => 0.5 * (d[0] * (M[0][0] * d[0] + M[0][1] * d[1]) + d[1] * (M[1][0] * d[0] + M[1][1] * d[1]));

const f1 = y => -quad(A, sub(y, a));
const f2 = y => -quad(B, sub(y, b));
const gf1 = y => mv(A, sub(y, a)).map(v => -v);   // ∇f₁ = −A(y−a)
const gf2 = y => mv(B, sub(y, b)).map(v => -v);

// H(λ) = −(λA + (1−λ)B), the Hessian of the scalarized objective
function solveH (lam, r) {
  const h00 = -(lam * A[0][0] + (1 - lam) * B[0][0]);
  const h01 = -(lam * A[0][1] + (1 - lam) * B[0][1]);
  const h11 = -(lam * A[1][1] + (1 - lam) * B[1][1]);
  const det = h00 * h11 - h01 * h01;
  return [(h11 * r[0] - h01 * r[1]) / det, (-h01 * r[0] + h00 * r[1]) / det];
}

// closed-form maximizer, used as ground truth against the traced path
function exact (lam) {
  const m00 = lam * A[0][0] + (1 - lam) * B[0][0];
  const m01 = lam * A[0][1] + (1 - lam) * B[0][1];
  const m11 = lam * A[1][1] + (1 - lam) * B[1][1];
  const r = [lam * (A[0][0] * a[0] + A[0][1] * a[1]) + (1 - lam) * (B[0][0] * b[0] + B[0][1] * b[1]),
    lam * (A[1][0] * a[0] + A[1][1] * a[1]) + (1 - lam) * (B[1][0] * b[0] + B[1][1] * b[1])];
  const det = m00 * m11 - m01 * m01;
  return [(m11 * r[0] - m01 * r[1]) / det, (-m01 * r[0] + m00 * r[1]) / det];
}

// integrate dy*/dλ = −H⁻¹(∇f₁ − ∇f₂) from λ=0 (start at f₂'s optimum) with RK4
function tracePath (steps = 240) {
  const h = 1 / steps;
  const dydl = (lam, y) => {
    const r = sub(gf1(y), gf2(y));
    return solveH(lam, r).map(v => -v);
  };
  let y = exact(0);
  const path = [{ lam: 0, y: y.slice() }];
  for (let i = 0; i < steps; i++) {
    const l = i * h;
    const k1 = dydl(l, y);
    const k2 = dydl(l + h / 2, [y[0] + h / 2 * k1[0], y[1] + h / 2 * k1[1]]);
    const k3 = dydl(l + h / 2, [y[0] + h / 2 * k2[0], y[1] + h / 2 * k2[1]]);
    const k4 = dydl(l + h, [y[0] + h * k3[0], y[1] + h * k3[1]]);
    y = [y[0] + h / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
      y[1] + h / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])];
    path.push({ lam: (i + 1) * h, y: y.slice() });
  }
  return path;
}

export default function mount (root) {
  const path = tracePath();
  let lam = 0.5;

  root.innerHTML = `
    <div class="sst-iv">
      <div class="sst-sp-panels sst-sp-duo">
        <figure><canvas class="sst-iv-canvas" width="275" height="275" data-design></canvas>
          <figcaption>reduced design space y = Uᵀx<br>the traced Pareto set</figcaption></figure>
        <figure><canvas class="sst-iv-canvas" width="275" height="275" data-criteria></canvas>
          <figcaption>criterion space (f₁, f₂)<br>the Pareto frontier</figcaption></figure>
      </div>
      <div class="sst-iv-side">
        <div class="sst-iv-readout">
          <div><span class="sst-iv-k">weight λ</span><span class="sst-iv-v" data-lam>—</span></div>
          <div><span class="sst-iv-k">f₁ / f₂</span><span class="sst-iv-v" data-fs>—</span></div>
          <div><span class="sst-iv-k">‖traced − exact‖</span><span class="sst-iv-v" data-res>—</span></div>
        </div>
        <label class="sst-iv-range-row">λ
          <input type="range" class="sst-range" data-lam-range min="0" max="1000" value="500" step="1" aria-label="Convex weight lambda">
        </label>
        <p class="sst-iv-hint">Sweep λ. Neither criterion is maximized alone — the point slides along a
        <strong>continuous trade-off curve</strong>. The curve is integrated from the derivative of the
        optimality condition, not re-solved at each λ; the residual against the closed form stays at
        solver noise.</p>
      </div>
    </div>`;

  const dc = root.querySelector('[data-design]').getContext('2d');
  const cc = root.querySelector('[data-criteria]').getContext('2d');
  const lamEl = root.querySelector('[data-lam]');
  const fsEl = root.querySelector('[data-fs]');
  const resEl = root.querySelector('[data-res]');
  const range = root.querySelector('[data-lam-range]');
  const css = n => getComputedStyle(document.body).getPropertyValue(n).trim() || null;

  const at = l => path[Math.max(0, Math.min(path.length - 1, Math.round(l * (path.length - 1))))].y;

  // design-space mapping
  const DX = [-1.35, 1.35]; const DY = [-1.1, 1.1];
  const px = x => 12 + (x - DX[0]) / (DX[1] - DX[0]) * 196;
  const py = y => 12 + (1 - (y - DY[0]) / (DY[1] - DY[0])) * 196;

  function drawDesign () {
    dc.setTransform(Z, 0, 0, Z, 0, 0);
    dc.clearRect(0, 0, 220, 220);

    // scalarized objective field at the current λ
    const G = 40; const cell = 196 / G;
    let lo = Infinity; let hi = -Infinity; const vals = [];
    for (let i = 0; i < G; i++) {
      for (let j = 0; j < G; j++) {
        const y = [DX[0] + (DX[1] - DX[0]) * (i + 0.5) / G, DY[0] + (DY[1] - DY[0]) * (j + 0.5) / G];
        const v = lam * f1(y) + (1 - lam) * f2(y);
        vals.push(v); if (v < lo) lo = v; if (v > hi) hi = v;
      }
    }
    let k = 0;
    for (let i = 0; i < G; i++) {
      for (let j = 0; j < G; j++) {
        const t = (vals[k++] - lo) / (hi - lo || 1);
        dc.fillStyle = css('--color-accent-primary') || '#537949';
        dc.globalAlpha = 0.06 + 0.62 * Math.pow(t, 2.2);
        dc.fillRect(12 + i * cell, 12 + (G - 1 - j) * cell, cell + 0.5, cell + 0.5);
      }
    }
    dc.globalAlpha = 1;

    // the traced Pareto set
    dc.strokeStyle = css('--color-accent-hover') || '#6ea262';
    dc.lineWidth = 2;
    dc.beginPath();
    path.forEach((p, i) => { const X = px(p.y[0]); const Y = py(p.y[1]);
      if (i === 0) dc.moveTo(X, Y); else dc.lineTo(X, Y); });
    dc.stroke();

    // single-criterion optima
    dc.fillStyle = css('--color-text-secondary') || '#999';
    [a, b].forEach((p, i) => {
      dc.beginPath(); dc.arc(px(p[0]), py(p[1]), 3, 0, 2 * Math.PI); dc.fill();
      dc.font = '9px monospace';
      dc.fillText(i === 0 ? 'max f₁' : 'max f₂', px(p[0]) + 6, py(p[1]) - 5);
    });

    // current traced point
    const y = at(lam);
    dc.fillStyle = css('--color-accent-hover') || '#6ea262';
    dc.beginPath(); dc.arc(px(y[0]), py(y[1]), 4.5, 0, 2 * Math.PI); dc.fill();
  }

  function drawCriteria () {
    cc.setTransform(Z, 0, 0, Z, 0, 0);
    cc.clearRect(0, 0, 220, 220);
    const pts = path.map(p => [f1(p.y), f2(p.y)]);
    const xs = pts.map(p => p[0]); const ys = pts.map(p => p[1]);
    const x0 = Math.min(...xs); const x1 = Math.max(...xs);
    const y0 = Math.min(...ys); const y1 = Math.max(...ys);
    const pad = 0.12;
    const sx = v => 30 + (v - x0) / ((x1 - x0) || 1) * (178 - (178 * pad));
    const sy = v => 196 - (v - y0) / ((y1 - y0) || 1) * (178 - (178 * pad));

    // axes
    cc.strokeStyle = css('--color-border') || '#444';
    cc.lineWidth = 1;
    cc.beginPath(); cc.moveTo(26, 12); cc.lineTo(26, 200); cc.lineTo(212, 200); cc.stroke();
    cc.fillStyle = css('--color-text-secondary') || '#999';
    cc.font = '9px monospace';
    cc.fillText('f₁', 200, 212); cc.fillText('f₂', 8, 20);

    // attainable cloud, to show the frontier really is the boundary
    cc.fillStyle = css('--color-text-secondary') || '#999';
    cc.globalAlpha = 0.16;
    for (let i = 0; i < 500; i++) {
      const y = [DX[0] + Math.random() * (DX[1] - DX[0]), DY[0] + Math.random() * (DY[1] - DY[0])];
      const p = [f1(y), f2(y)];
      if (p[0] < x0 || p[1] < y0) continue;
      cc.beginPath(); cc.arc(sx(p[0]), sy(p[1]), 1.4, 0, 2 * Math.PI); cc.fill();
    }
    cc.globalAlpha = 1;

    // the frontier
    cc.strokeStyle = css('--color-accent-hover') || '#6ea262';
    cc.lineWidth = 2;
    cc.beginPath();
    pts.forEach((p, i) => { const X = sx(p[0]); const Y = sy(p[1]);
      if (i === 0) cc.moveTo(X, Y); else cc.lineTo(X, Y); });
    cc.stroke();

    const y = at(lam); const cur = [f1(y), f2(y)];
    cc.fillStyle = css('--color-accent-hover') || '#6ea262';
    cc.beginPath(); cc.arc(sx(cur[0]), sy(cur[1]), 4.5, 0, 2 * Math.PI); cc.fill();
  }

  function draw () {
    const y = at(lam);
    const e = exact(lam);
    lamEl.textContent = lam.toFixed(3);
    fsEl.textContent = `${f1(y).toFixed(3)} / ${f2(y).toFixed(3)}`;
    resEl.textContent = Math.hypot(y[0] - e[0], y[1] - e[1]).toExponential(1);
    drawDesign();
    drawCriteria();
  }

  const onInput = () => { lam = Number(range.value) / 1000; draw(); };
  range.addEventListener('input', onInput);
  draw();

  return {
    destroy () { range.removeEventListener('input', onInput); root.innerHTML = ''; }
  };
}
