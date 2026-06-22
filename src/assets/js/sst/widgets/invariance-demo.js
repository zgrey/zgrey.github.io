/**
 * PRRTI invariance demo (honest rebuild).
 *
 * A closed landmark curve. The eigenfunctions ṽⱼ(s) = (1/σⱼ) αⱼ · 𝒯[c](s) and
 * the singular values σⱼ are computed from EXACTLY the points drawn, so the
 * behaviour is demonstrated, not asserted:
 *   - rotate / reflect / translate  → σ and ṽⱼ are invariant (the rotation is
 *     absorbed into the principal directions αⱼ, drawn on the curve — this is
 *     the uniqueness of the polar decomposition X = X̃P at work);
 *   - permute (cyclic reindex)       → the eigenfunctions PHASE-SHIFT. This is
 *     the reparametrization freedom that cyclic Procrustes resolves downstream;
 *   - drag a landmark                → genuine undulation: σ and ṽⱼ change.
 *
 * The shape is deliberately anisotropic (σ₁/σ₂ well above 1) so P is
 * non-degenerate and the decomposition is unique — no near-circular ambiguity.
 *
 * Contract: default export mount(rootEl) -> { destroy() }.
 */

// eigendecomposition of 2x2 symmetric [[a,b],[b,c]] -> {vals:[l1>=l2], v1, v2}
function eig2 (a, b, c) {
  const tr = a + c;
  const disc = Math.sqrt(Math.max(0, (a - c) * (a - c) / 4 + b * b));
  const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
  let v1;
  if (Math.abs(b) > 1e-9) v1 = [l1 - c, b];
  else v1 = (a >= c) ? [1, 0] : [0, 1];
  const nrm = Math.hypot(v1[0], v1[1]) || 1;
  v1 = [v1[0] / nrm, v1[1] / nrm];
  return { vals: [l1, l2], v1, v2: [-v1[1], v1[0]] };
}

// Deterministic sign fixed on the eigenFUNCTION values (not the eigenvector):
// make the largest-magnitude sample positive. The function values are rigid-
// invariant, so this keeps ṽⱼ from flipping sign as the shape rotates, without
// touching the genuine phase shift produced by a reparametrization (permute).
function fixFnSign (v) {
  let im = 0, am = 0;
  for (let i = 0; i < v.length; i++) { if (Math.abs(v[i]) > am) { am = Math.abs(v[i]); im = i; } }
  return v[im] < 0 ? v.map(x => -x) : v;
}

export default function mount (root) {
  const N = 20;
  const base = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 1 + 0.16 * Math.sin(3 * a) + 0.08 * Math.cos(5 * a);
    base.push({ x: 1.7 * r * Math.cos(a), y: 0.95 * r * Math.sin(a) }); // anisotropic
  }

  let pts = base.map(p => ({ ...p }));
  let theta = 0;          // rotation
  let reflect = 1;        // +1 or -1 (x-flip)
  let tx = 0, ty = 0;     // translation
  let roll = 0;           // permutation / index offset

  root.innerHTML = `
    <div class="sst-iv">
      <div class="sst-sp-panels">
        <figure><canvas class="sst-iv-canvas" width="300" height="260" data-shape></canvas>
          <figcaption>landmark curve + principal axes α</figcaption></figure>
        <figure><canvas class="sst-iv-canvas" width="300" height="260" data-eig></canvas>
          <figcaption>eigenfunctions ṽ₁(s), ṽ₂(s)</figcaption></figure>
      </div>
      <div class="sst-iv-side">
        <div class="sst-iv-readout">
          <div><span class="sst-iv-k">σ₁</span><span class="sst-iv-v" data-s1>—</span></div>
          <div><span class="sst-iv-k">σ₂</span><span class="sst-iv-v" data-s2>—</span></div>
          <div><span class="sst-iv-k">start idx</span><span class="sst-iv-v" data-idx>0</span></div>
        </div>
        <div class="sst-iv-controls">
          <button type="button" data-act="rotate">rotate</button>
          <button type="button" data-act="reflect">reflect</button>
          <button type="button" data-act="translate">translate</button>
          <button type="button" data-act="permute">permute</button>
          <button type="button" data-act="reset">reset</button>
        </div>
        <p class="sst-iv-hint">Rotate/reflect/translate: σ and ṽⱼ hold — the motion is absorbed into the
        axes α (uniqueness of X = X̃P). <strong>Permute</strong> phase-shifts ṽⱼ (the freedom cyclic
        Procrustes resolves). <strong>Drag</strong> a landmark for genuine undulation.</p>
      </div>
    </div>`;

  const shape = root.querySelector('[data-shape]');
  const eig = root.querySelector('[data-eig]');
  const sx = shape.getContext('2d');
  const ex = eig.getContext('2d');
  const s1El = root.querySelector('[data-s1]');
  const s2El = root.querySelector('[data-s2]');
  const idxEl = root.querySelector('[data-idx]');
  const css = name => getComputedStyle(document.body).getPropertyValue(name).trim() || null;

  // rigid transform + permutation applied to the model — the points actually drawn
  function transformed () {
    const out = [];
    const ct = Math.cos(theta), st = Math.sin(theta);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[(i + roll) % pts.length];
      const rx = reflect * p.x;
      out.push({ x: ct * rx - st * p.y + tx, y: st * rx + ct * p.y + ty });
    }
    return out;
  }

  function centroid (P) {
    let mx = 0, my = 0;
    for (const p of P) { mx += p.x; my += p.y; }
    return { x: mx / P.length, y: my / P.length };
  }

  // σ, principal directions α, and eigenfunctions ṽⱼ(sᵢ)=(xᵢ·αⱼ)/σⱼ from the
  // centred version of *exactly these* points.
  function analyze (P) {
    const c = centroid(P);
    const X = P.map(p => ({ x: p.x - c.x, y: p.y - c.y }));
    let a = 0, b = 0, cc = 0;
    for (const p of X) { a += p.x * p.x; b += p.x * p.y; cc += p.y * p.y; }
    const e = eig2(a, b, cc);
    const s1 = Math.sqrt(Math.max(1e-12, e.vals[0]));
    const s2 = Math.sqrt(Math.max(1e-12, e.vals[1]));
    const v1 = fixFnSign(X.map(p => (p.x * e.v1[0] + p.y * e.v1[1]) / s1));
    const v2 = fixFnSign(X.map(p => (p.x * e.v2[0] + p.y * e.v2[1]) / s2));
    return { s1, s2, a1: e.v1, a2: e.v2, v1, v2, c };
  }

  const SCALE = 52, CX = 150, CY = 130;
  const toPx = p => ({ x: CX + p.x * SCALE, y: CY - p.y * SCALE });

  function drawShape (disp, A) {
    sx.clearRect(0, 0, 300, 260);
    sx.strokeStyle = css('--color-border') || '#333'; sx.lineWidth = 1;
    sx.beginPath(); sx.moveTo(0, CY); sx.lineTo(300, CY); sx.moveTo(CX, 0); sx.lineTo(CX, 260); sx.stroke();

    // curve
    sx.strokeStyle = css('--color-accent-primary') || '#537949'; sx.lineWidth = 2; sx.beginPath();
    disp.forEach((p, i) => { const q = toPx(p); i ? sx.lineTo(q.x, q.y) : sx.moveTo(q.x, q.y); });
    sx.closePath(); sx.stroke();

    // principal axes α (drawn from the centroid, lengths ∝ σ) — these rotate
    // with the shape: the rigid motion is absorbed here, not in ṽⱼ.
    const axis = (a, len, color) => {
      const c0 = toPx(A.c);
      const e = toPx({ x: A.c.x + a[0] * len, y: A.c.y + a[1] * len });
      const f = toPx({ x: A.c.x - a[0] * len, y: A.c.y - a[1] * len });
      sx.strokeStyle = color; sx.lineWidth = 1.6; sx.beginPath();
      sx.moveTo(f.x, f.y); sx.lineTo(e.x, e.y); sx.stroke();
      sx.fillStyle = color; sx.beginPath(); sx.arc(c0.x, c0.y, 2, 0, 7); sx.fill();
    };
    axis(A.a1, A.s1 / Math.sqrt(N), css('--color-accent-primary') || '#537949');
    axis(A.a2, A.s2 / Math.sqrt(N), css('--color-accent-hover') || '#6ea262');

    // landmarks; first one highlighted to show indexing
    disp.forEach((p, i) => {
      const q = toPx(p);
      sx.beginPath(); sx.arc(q.x, q.y, i === 0 ? 5 : 3, 0, Math.PI * 2);
      sx.fillStyle = i === 0 ? (css('--color-text-heading') || '#d0c2a5') : (css('--color-text-secondary') || '#999');
      sx.fill();
    });
  }

  function drawEig (v1, v2) {
    const n = v1.length;
    const PX0 = 30, PX1 = 290, PY0 = 18, PY1 = 242, PMID = (PY0 + PY1) / 2;
    ex.clearRect(0, 0, 300, 260);
    ex.strokeStyle = css('--color-border') || '#333'; ex.lineWidth = 1;
    ex.strokeRect(PX0, PY0, PX1 - PX0, PY1 - PY0);
    ex.globalAlpha = 0.6; ex.beginPath(); ex.moveTo(PX0, PMID); ex.lineTo(PX1, PMID); ex.stroke(); ex.globalAlpha = 1;

    let m = 1e-6;
    for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(v1[i]), Math.abs(v2[i]));
    m *= 1.15;
    const xAt = i => PX0 + (i / n) * (PX1 - PX0);
    const yAt = val => PMID - (val / m) * ((PY1 - PY0) / 2);

    const series = (v, color) => {
      ex.strokeStyle = color; ex.lineWidth = 2; ex.beginPath();
      for (let i = 0; i <= n; i++) { const val = v[i % n]; const x = xAt(i), y = yAt(val); i ? ex.lineTo(x, y) : ex.moveTo(x, y); }
      ex.stroke();
      ex.fillStyle = color;
      for (let i = 0; i < n; i++) { ex.beginPath(); ex.arc(xAt(i), yAt(v[i]), 2, 0, 7); ex.fill(); }
    };
    series(v1, css('--color-accent-primary') || '#537949');
    series(v2, css('--color-accent-hover') || '#6ea262');

    ex.fillStyle = css('--color-text-secondary') || '#999';
    ex.font = '10px monospace'; ex.textAlign = 'left';
    ex.fillText('ṽ₁', PX0 + 4, PY0 + 12);
    ex.fillText('ṽ₂', PX0 + 22, PY0 + 12);
    ex.textAlign = 'right'; ex.fillText('s', PX1 - 3, PY1 - 4);
  }

  function draw () {
    const disp = transformed();
    const A = analyze(disp);
    drawShape(disp, A);
    drawEig(A.v1, A.v2);
    s1El.textContent = A.s1.toFixed(4);
    s2El.textContent = A.s2.toFixed(4);
    idxEl.textContent = String(roll % pts.length);
  }

  // --- interaction ---------------------------------------------------------
  function onAct (act) {
    if (act === 'rotate') {
      theta += Math.PI / 6;
    } else if (act === 'reflect') {
      reflect *= -1;
    } else if (act === 'translate') {
      tx = tx ? 0 : 0.55; ty = ty ? 0 : -0.4;
    } else if (act === 'permute') {
      roll = (roll + 1) % pts.length;
    } else if (act === 'reset') {
      pts = base.map(p => ({ ...p })); theta = 0; reflect = 1; tx = ty = 0; roll = 0;
    }
    draw();
  }
  const onClick = e => { const a = e.target.closest('[data-act]'); if (a) onAct(a.dataset.act); };
  root.querySelector('.sst-iv-controls').addEventListener('click', onClick);

  // drag a landmark on the shape canvas (invert the rigid transform + roll)
  let dragging = -1;
  function modelIndexFromEvent (e) {
    const rect = shape.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (shape.width / rect.width);
    const py = (e.clientY - rect.top) * (shape.height / rect.height);
    return { px, py };
  }
  function modelPointFromPx (px, py) {
    const dx = (px - CX) / SCALE, dy = (CY - py) / SCALE;
    const ct = Math.cos(-theta), st = Math.sin(-theta);
    const ux = dx - tx, uy = dy - ty;
    const rx = ct * ux - st * uy, ry = st * ux + ct * uy;
    return { x: reflect * rx, y: ry };
  }
  function nearestDisplayIndex (px, py) {
    const disp = transformed();
    let best = -1, bd = 14 * 14;
    for (let i = 0; i < disp.length; i++) {
      const q = toPx(disp[i]);
      const d = (q.x - px) ** 2 + (q.y - py) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  const onDown = e => {
    const { px, py } = modelIndexFromEvent(e);
    const di = nearestDisplayIndex(px, py);
    if (di >= 0) { dragging = (di + roll) % pts.length; e.preventDefault(); }
  };
  const onMove = e => {
    if (dragging < 0) return;
    const { px, py } = modelIndexFromEvent(e);
    pts[dragging] = modelPointFromPx(px, py);
    draw();
  };
  const onUp = () => { dragging = -1; };
  shape.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);

  draw();

  return {
    destroy () {
      root.querySelector('.sst-iv-controls')?.removeEventListener('click', onClick);
      shape.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      root.innerHTML = '';
    }
  };
}
