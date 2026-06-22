/**
 * SRQD / polar-decomposition demo.
 *
 * A 2-D landmark curve X (centered). Its thin SVD gives the polar split
 *   X = X~ P,   X~ = U V^T  (orthonormal cols -> undulation [X~] in Gr(2,n)),
 *                P = V Σ V^T (2x2 SPD -> generalized scale).
 * Left panel: the raw shape with the P-ellipse (orientation + anisotropy of
 * scale). Right panel: the standardized undulation X~ = X P^{-1}. Dragging a
 * landmark changes the undulation; stretching the whole shape moves P but leaves
 * the undulation subspace [X~] essentially fixed.
 *
 * Contract: default export mount(rootEl) -> { destroy() }.
 */

// eigendecomposition of a 2x2 symmetric matrix [[a,b],[b,c]] -> {vals:[l1>=l2], vecs:[[..],[..]]}
function eig2 (a, b, c) {
  const tr = a + c;
  const disc = Math.sqrt(Math.max(0, (a - c) * (a - c) / 4 + b * b));
  const l1 = tr / 2 + disc;
  const l2 = tr / 2 - disc;
  let v1;
  if (Math.abs(b) > 1e-9) v1 = [l1 - c, b];
  else v1 = (a >= c) ? [1, 0] : [0, 1];
  const n1 = Math.hypot(v1[0], v1[1]) || 1;
  v1 = [v1[0] / n1, v1[1] / n1];
  const v2 = [-v1[1], v1[0]];
  return { vals: [l1, l2], vecs: [v1, v2] };
}

export default function mount (root) {
  const N = 16;
  const base = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 1 + 0.25 * Math.sin(3 * a);
    base.push({ x: 1.4 * r * Math.cos(a), y: 0.85 * r * Math.sin(a) }); // mildly anisotropic
  }
  let pts = base.map(p => ({ ...p }));

  root.innerHTML = `
    <div class="sst-iv">
      <div class="sst-sp-panels">
        <figure><canvas class="sst-iv-canvas" width="300" height="260" data-left></canvas>
          <figcaption>raw shape + P (scale)</figcaption></figure>
        <figure><canvas class="sst-iv-canvas" width="300" height="260" data-right></canvas>
          <figcaption>standardized undulation X̃</figcaption></figure>
      </div>
      <div class="sst-iv-side">
        <div class="sst-iv-readout">
          <div><span class="sst-iv-k">σ₁</span><span class="sst-iv-v" data-s1>—</span></div>
          <div><span class="sst-iv-k">σ₂</span><span class="sst-iv-v" data-s2>—</span></div>
          <div><span class="sst-iv-k">anisotropy σ₁/σ₂</span><span class="sst-iv-v" data-an>—</span></div>
        </div>
        <div class="sst-iv-controls">
          <button type="button" data-act="stretchx">stretch x</button>
          <button type="button" data-act="stretchy">stretch y</button>
          <button type="button" data-act="rotate">rotate</button>
          <button type="button" data-act="reset">reset</button>
        </div>
        <p class="sst-iv-hint"><strong>Drag</strong> a landmark to change undulation. <strong>Stretch</strong>
        to change scale P while [X̃] stays put.</p>
      </div>
    </div>`;

  const left = root.querySelector('[data-left]');
  const right = root.querySelector('[data-right]');
  const lx = left.getContext('2d');
  const rx = right.getContext('2d');
  const s1El = root.querySelector('[data-s1]');
  const s2El = root.querySelector('[data-s2]');
  const anEl = root.querySelector('[data-an]');
  const css = n => getComputedStyle(document.body).getPropertyValue(n).trim() || null;

  function centered () {
    const n = pts.length;
    let mx = 0, my = 0;
    for (const p of pts) { mx += p.x; my += p.y; }
    mx /= n; my /= n;
    return pts.map(p => ({ x: p.x - mx, y: p.y - my }));
  }

  // polar factors of the centered landmark matrix
  function decomp (X) {
    let a = 0, b = 0, c = 0;
    for (const p of X) { a += p.x * p.x; b += p.x * p.y; c += p.y * p.y; }
    const e = eig2(a, b, c);
    const s1 = Math.sqrt(Math.max(1e-12, e.vals[0]));
    const s2 = Math.sqrt(Math.max(1e-12, e.vals[1]));
    const V = e.vecs; // columns v1, v2
    // P^{-1} = V diag(1/s) V^T
    const i1 = 1 / s1, i2 = 1 / s2;
    const [v1, v2] = V;
    const Pinv = [
      [v1[0] * v1[0] * i1 + v2[0] * v2[0] * i2, v1[0] * v1[1] * i1 + v2[0] * v2[1] * i2],
      [v1[0] * v1[1] * i1 + v2[0] * v2[1] * i2, v1[1] * v1[1] * i1 + v2[1] * v2[1] * i2]
    ];
    const Xt = X.map(p => ({ x: Pinv[0][0] * p.x + Pinv[0][1] * p.y, y: Pinv[1][0] * p.x + Pinv[1][1] * p.y }));
    return { s1, s2, V, Xt };
  }

  function strokeCurve (ctx, pix) {
    ctx.beginPath();
    pix.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.stroke();
  }

  function draw () {
    const X = centered();
    const { s1, s2, V, Xt } = decomp(X);

    // ----- left: raw shape (fixed scale) + P-ellipse -----
    lx.clearRect(0, 0, left.width, left.height);
    const LS = 70, LCX = 150, LCY = 130;
    const lpix = X.map(p => ({ x: LCX + p.x * LS, y: LCY - p.y * LS }));
    lx.strokeStyle = css('--color-accent-primary') || '#537949';
    lx.lineWidth = 2; strokeCurve(lx, lpix);
    lx.fillStyle = css('--color-text-secondary') || '#999';
    lpix.forEach((q, i) => { lx.beginPath(); lx.arc(q.x, q.y, i === 0 ? 5 : 3, 0, 7); lx.fillStyle = i === 0 ? (css('--color-accent-hover') || '#6ea262') : (css('--color-text-secondary') || '#999'); lx.fill(); });
    // P-ellipse: axes along V with relative lengths s1:s2, normalized to a display radius
    const ER = 64, big = Math.max(s1, s2);
    lx.strokeStyle = css('--color-accent-hover') || '#6ea262';
    lx.lineWidth = 1.5; lx.setLineDash([4, 3]); lx.beginPath();
    for (let t = 0; t <= 64; t++) {
      const th = (t / 64) * Math.PI * 2;
      const e1 = Math.cos(th) * (s1 / big) * ER, e2 = Math.sin(th) * (s2 / big) * ER;
      const px = LCX + (V[0][0] * e1 + V[1][0] * e2);
      const py = LCY - (V[0][1] * e1 + V[1][1] * e2);
      t ? lx.lineTo(px, py) : lx.moveTo(px, py);
    }
    lx.closePath(); lx.stroke(); lx.setLineDash([]);

    // ----- right: standardized undulation X~ (auto-fit) -----
    rx.clearRect(0, 0, right.width, right.height);
    let mr = 0;
    for (const p of Xt) mr = Math.max(mr, Math.hypot(p.x, p.y));
    const RS = mr ? 95 / mr : 1, RCX = 150, RCY = 130;
    const rpix = Xt.map(p => ({ x: RCX + p.x * RS, y: RCY - p.y * RS }));
    rx.strokeStyle = css('--color-text-heading') || '#d0c2a5';
    rx.lineWidth = 2; strokeCurve(rx, rpix);
    rpix.forEach((q, i) => { rx.beginPath(); rx.arc(q.x, q.y, i === 0 ? 4 : 2.5, 0, 7); rx.fillStyle = i === 0 ? (css('--color-accent-hover') || '#6ea262') : (css('--color-text-secondary') || '#999'); rx.fill(); });

    s1El.textContent = s1.toFixed(3);
    s2El.textContent = s2.toFixed(3);
    anEl.textContent = (s1 / s2).toFixed(3);
  }

  function onAct (act) {
    if (act === 'stretchx') {
      pts = pts.map(p => ({ x: p.x * 1.25, y: p.y }));
    } else if (act === 'stretchy') {
      pts = pts.map(p => ({ x: p.x, y: p.y * 1.25 }));
    } else if (act === 'rotate') {
      const ct = Math.cos(0.4), st = Math.sin(0.4);
      pts = pts.map(p => ({ x: ct * p.x - st * p.y, y: st * p.x + ct * p.y }));
    } else if (act === 'reset') {
      pts = base.map(p => ({ ...p }));
    }
    draw();
  }
  const onClick = e => { const a = e.target.closest('[data-act]'); if (a) onAct(a.dataset.act); };
  root.querySelector('.sst-iv-controls').addEventListener('click', onClick);

  // drag on the left panel (uses the same centering, so we edit raw pts by delta)
  let drag = -1;
  function leftModel (e) {
    const rect = left.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (left.width / rect.width);
    const py = (e.clientY - rect.top) * (left.height / rect.height);
    return { x: (px - 150) / 70, y: (130 - py) / 70 };
  }
  function nearest (m) {
    const X = centered();
    let best = -1, bd = 0.08;
    for (let i = 0; i < X.length; i++) {
      const d = (X[i].x - m.x) ** 2 + (X[i].y - m.y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  const onDown = e => { const i = nearest(leftModel(e)); if (i >= 0) { drag = i; e.preventDefault(); } };
  const onMove = e => {
    if (drag < 0) return;
    // move the dragged landmark to the pointer (in centered coords -> back to raw via current mean)
    const n = pts.length; let mx = 0, my = 0;
    for (const p of pts) { mx += p.x; my += p.y; }
    mx /= n; my /= n;
    const m = leftModel(e);
    pts[drag] = { x: m.x + mx, y: m.y + my };
    draw();
  };
  const onUp = () => { drag = -1; };
  left.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);

  draw();

  return {
    destroy () {
      root.querySelector('.sst-iv-controls')?.removeEventListener('click', onClick);
      left.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      root.innerHTML = '';
    }
  };
}
