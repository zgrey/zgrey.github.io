/**
 * Animated operations widget.
 *
 * Pairs an algebraic ACTION with the matching CURVE animation: applying 𝒯
 * (centering) slides the curve's centroid to the origin while the centering
 * formula lights up; applying P⁻¹ (standardization) morphs the anisotropic
 * scale away to the standardized undulation X̃ while its formula lights up.
 * The point: each math operation is something you *do* to the curve, shown on
 * both the algebra and the picture at once.
 *
 * Contract: default export mount(rootEl) -> { destroy() }.
 */

function renderMath (el) {
  if (typeof window.renderMathInElement === 'function') {
    window.renderMathInElement(el, {
      delimiters: [
        { left: '\\(', right: '\\)', display: false },
        { left: '\\[', right: '\\]', display: true }
      ],
      throwOnError: false
    });
  }
}

const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function mount (root) {
  // centered undulation landmarks (the X̃ the pipeline ends on)
  const N = 22;
  const base = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 1 + 0.22 * Math.sin(3 * a) + 0.1 * Math.cos(5 * a);
    base.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  const P0 = [[1.35, 0.28], [0.28, 0.8]]; // SPD scale applied to the raw curve
  const T0 = [0.95, 0.6];                 // raw off-centre offset
  const I = [[1, 0], [0, 1]];

  // animated affine state: display_i = M · base_i + t
  let curM = [[P0[0][0], P0[0][1]], [P0[1][0], P0[1][1]]];
  let curT = [T0[0], T0[1]];
  let step = 0;            // 0 raw, 1 centred, 2 standardized
  let raf = 0;

  root.innerHTML = `
    <div class="sst-op">
      <canvas class="sst-iv-canvas" width="300" height="260"></canvas>
      <div class="sst-op-algebra">
        <div class="sst-op-line" data-line="0">\\( c(s) \\)</div>
        <div class="sst-op-line" data-line="1">\\( \\mathcal{T}[c](s) = c(s) - \\int_{\\mathcal{I}} c\\, d\\mu \\)</div>
        <div class="sst-op-line" data-line="2">\\( \\widetilde{X} = \\mathcal{T}[c]\\, P^{-1} \\)</div>
        <div class="sst-op-controls">
          <button type="button" data-op="center">apply 𝒯 (center)</button>
          <button type="button" data-op="standardize">standardize P⁻¹</button>
          <button type="button" data-op="reset">reset</button>
        </div>
        <p class="sst-iv-hint">Each button is an <strong>action</strong> on the curve — watch the algebra and the
        picture move together.</p>
      </div>
    </div>`;
  renderMath(root);

  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const lines = [...root.querySelectorAll('.sst-op-line')];
  const btn = op => root.querySelector(`[data-op="${op}"]`);
  const css = n => getComputedStyle(document.body).getPropertyValue(n).trim() || null;

  const SCALE = 56, CX = 150, CY = 130;
  const apply = (M, p) => ({ x: M[0][0] * p.x + M[0][1] * p.y, y: M[1][0] * p.x + M[1][1] * p.y });
  const toPx = p => ({ x: CX + p.x * SCALE, y: CY - p.y * SCALE });

  function draw () {
    ctx.clearRect(0, 0, 300, 260);
    // axes
    ctx.strokeStyle = css('--color-border') || '#333'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, CY); ctx.lineTo(300, CY); ctx.moveTo(CX, 0); ctx.lineTo(CX, 260); ctx.stroke();

    // P-ellipse (current linear scale) — circle once standardized
    ctx.strokeStyle = css('--color-accent-hover') || '#6ea262';
    ctx.setLineDash([4, 3]); ctx.lineWidth = 1.3; ctx.globalAlpha = 0.8; ctx.beginPath();
    for (let t = 0; t <= 60; t++) {
      const th = (t / 60) * Math.PI * 2;
      const e = apply(curM, { x: Math.cos(th), y: Math.sin(th) });
      const q = toPx({ x: e.x + curT[0], y: e.y + curT[1] });
      t ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
    }
    ctx.closePath(); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;

    // the curve
    ctx.strokeStyle = css('--color-accent-primary') || '#537949'; ctx.lineWidth = 2; ctx.beginPath();
    base.forEach((p, i) => {
      const d = apply(curM, p);
      const q = toPx({ x: d.x + curT[0], y: d.y + curT[1] });
      i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
    });
    ctx.closePath(); ctx.stroke();

    // centroid marker (sits at the current translation)
    const c = toPx({ x: curT[0], y: curT[1] });
    ctx.fillStyle = css('--color-text-heading') || '#d0c2a5';
    ctx.beginPath(); ctx.arc(c.x, c.y, 4, 0, 7); ctx.fill();
  }

  function setActive (idx) {
    lines.forEach((el, i) => {
      el.classList.toggle('is-active', i === idx);
      el.classList.toggle('is-done', i < idx);
    });
  }

  function updateButtons () {
    btn('center').disabled = step !== 0;
    btn('standardize').disabled = step !== 1;
    btn('reset').disabled = step === 0;
  }

  const lerp = (a, b, u) => a + (b - a) * u;
  function lerpM (A, B, u) {
    return [[lerp(A[0][0], B[0][0], u), lerp(A[0][1], B[0][1], u)],
      [lerp(A[1][0], B[1][0], u), lerp(A[1][1], B[1][1], u)]];
  }

  function animate (M1, t1, dur, done) {
    cancelAnimationFrame(raf);
    if (reduced()) { curM = M1; curT = t1.slice(); draw(); done && done(); return; }
    const M0 = [[curM[0][0], curM[0][1]], [curM[1][0], curM[1][1]]];
    const t0 = curT.slice();
    const start = performance.now();
    const ease = u => 1 - Math.pow(1 - u, 3);
    const frame = now => {
      const u = Math.min(1, (now - start) / dur), e = ease(u);
      curM = lerpM(M0, M1, e);
      curT = [lerp(t0[0], t1[0], e), lerp(t0[1], t1[1], e)];
      draw();
      if (u < 1) raf = requestAnimationFrame(frame); else if (done) done();
    };
    raf = requestAnimationFrame(frame);
  }

  function onClick (e) {
    const b = e.target.closest('[data-op]');
    if (!b || b.disabled) return;
    const op = b.dataset.op;
    if (op === 'center') {
      setActive(1);
      animate(P0, [0, 0], 900, () => { step = 1; updateButtons(); });
      step = 1; updateButtons();
    } else if (op === 'standardize') {
      setActive(2);
      animate(I, [0, 0], 900, () => { step = 2; updateButtons(); });
      step = 2; updateButtons();
    } else if (op === 'reset') {
      cancelAnimationFrame(raf);
      curM = [[P0[0][0], P0[0][1]], [P0[1][0], P0[1][1]]];
      curT = [T0[0], T0[1]];
      step = 0; setActive(0); updateButtons(); draw();
    }
  }
  root.querySelector('.sst-op-controls').addEventListener('click', onClick);

  setActive(0);
  updateButtons();
  draw();

  return {
    destroy () {
      cancelAnimationFrame(raf);
      root.querySelector('.sst-op-controls')?.removeEventListener('click', onClick);
      root.innerHTML = '';
    }
  };
}
