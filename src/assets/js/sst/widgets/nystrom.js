/**
 * Nyström spectral-convergence demo (Cassini oval).
 *
 * The scale operator P = (X_c^T W X_c)^{1/2} is built from n quadrature nodes
 * (periodic trapezoid) on a Cassini oval — pinched enough to make convergence
 * interesting. As n grows, P_n -> P_inf. The error ||P_n - P_inf||_F is drawn
 * on LOG-LOG axes with a decade grid so the convergence rate is visible.
 *
 * Contract: default export mount(rootEl) -> { destroy() }.
 */

// Cassini oval, a < b so it's a single (pinched) closed loop. Smaller b/a -> tighter waist.
const CASSINI_A = 1.0;
const CASSINI_B = 1.05;

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

// Cassini oval in polar form: r^2 = a^2 cos2t + sqrt(b^4 - a^4 sin^2 2t)
function curve (t) {
  const a2 = CASSINI_A * CASSINI_A, a4 = a2 * a2, b4 = Math.pow(CASSINI_B, 4);
  const s = Math.sin(2 * t);
  const r2 = a2 * Math.cos(2 * t) + Math.sqrt(Math.max(0, b4 - a4 * s * s));
  const r = Math.sqrt(Math.max(0, r2));
  return { x: r * Math.cos(t), y: r * Math.sin(t) };
}

// P = sqrt of the weight-normalized centered second moment, from n nodes
function operatorP (n) {
  const pts = [];
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { const p = curve((i / n) * Math.PI * 2); pts.push(p); mx += p.x; my += p.y; }
  mx /= n; my /= n;
  let a = 0, b = 0, c = 0;
  for (const p of pts) { const x = p.x - mx, y = p.y - my; a += x * x; b += x * y; c += y * y; }
  a /= n; b /= n; c /= n;
  const e = eig2(a, b, c);
  const s1 = Math.sqrt(Math.max(0, e.vals[0])), s2 = Math.sqrt(Math.max(0, e.vals[1]));
  const [u1, u2] = [e.v1, e.v2];
  return [
    u1[0] * u1[0] * s1 + u2[0] * u2[0] * s2,
    u1[0] * u1[1] * s1 + u2[0] * u2[1] * s2,
    u1[1] * u1[1] * s1 + u2[1] * u2[1] * s2
  ];
}

function frob (P, Q) {
  return Math.sqrt((P[0] - Q[0]) ** 2 + 2 * (P[1] - Q[1]) ** 2 + (P[2] - Q[2]) ** 2);
}

export default function mount (root) {
  const NMIN = 4, NMAX = 512, FLOOR = 1e-12, STEP = 2;
  const Pinf = operatorP(8192);

  // TEMPORARY DISPLAY FILTER: the trapezoid rule on the (reflection-symmetric)
  // Cassini oval shows a strong odd/even parity artifact — odd n converges much
  // faster than even n, so sampling every integer makes the curve zigzag between
  // two interleaved branches. Pending a proper debug of that parity effect, we
  // plot only EVEN n (STEP=2): the slower, more conservative branch (we are NOT
  // cherry-picking the faster odd branch). The slider is stepped to match so the
  // marker always lands on the drawn curve. TODO: debug the parity artifact.
  const errs = [];
  for (let n = NMIN; n <= NMAX; n += STEP) errs.push({ n, e: Math.max(FLOOR, frob(operatorP(n), Pinf)) });
  const eByN = new Map(errs.map(d => [d.n, d.e]));

  const logNmin = Math.log10(NMIN), logNmax = Math.log10(NMAX);
  const eLoExp = Math.floor(Math.log10(Math.min(...errs.map(d => d.e))));
  const eHiExp = Math.ceil(Math.log10(Math.max(...errs.map(d => d.e))));

  root.innerHTML = `
    <div class="sst-iv">
      <div class="sst-sp-panels">
        <figure><canvas class="sst-iv-canvas" width="300" height="260" data-curve></canvas>
          <figcaption>Cassini oval + n quadrature nodes</figcaption></figure>
        <figure><canvas class="sst-iv-canvas" width="300" height="260" data-plot></canvas>
          <figcaption>‖P<sub>n</sub> − P<sub>∞</sub>‖<sub>F</sub> &nbsp;(log–log)</figcaption></figure>
      </div>
      <div class="sst-iv-side">
        <div class="sst-iv-readout">
          <div><span class="sst-iv-k">n nodes</span><span class="sst-iv-v" data-n>—</span></div>
          <div><span class="sst-iv-k">error</span><span class="sst-iv-v" data-e>—</span></div>
        </div>
        <label class="sst-iv-range-row">n
          <input type="range" class="sst-range" data-nrange min="${NMIN}" max="${NMAX}" value="16" step="${STEP}" aria-label="Number of quadrature nodes (even)">
        </label>
        <p class="sst-iv-hint">The Cassini waist needs more nodes than a round curve — but it still converges
        <strong>spectrally</strong>, a straight-ish plunge no Monte Carlo rate can match.
        <em>(Even node counts shown; an odd/even parity artifact is still being debugged.)</em></p>
      </div>
    </div>`;

  const cc = root.querySelector('[data-curve]').getContext('2d');
  const pc = root.querySelector('[data-plot]').getContext('2d');
  const nEl = root.querySelector('[data-n]');
  const eEl = root.querySelector('[data-e]');
  const range = root.querySelector('[data-nrange]');
  const css = nm => getComputedStyle(document.body).getPropertyValue(nm).trim() || null;

  // plot box
  const X0 = 44, X1 = 288, Y0 = 16, Y1 = 226;
  const xPix = n => X0 + (Math.log10(n) - logNmin) / (logNmax - logNmin) * (X1 - X0);
  const yPix = e => Y0 + (eHiExp - Math.log10(e)) / (eHiExp - eLoExp) * (Y1 - Y0);

  function drawCurve (n) {
    cc.clearRect(0, 0, 300, 260);
    const S = 78, CX = 150, CY = 130;
    cc.strokeStyle = css('--color-border') || '#444';
    cc.lineWidth = 1; cc.beginPath();
    for (let t = 0; t <= 240; t++) {
      const p = curve((t / 240) * Math.PI * 2);
      const x = CX + p.x * S, y = CY - p.y * S;
      t ? cc.lineTo(x, y) : cc.moveTo(x, y);
    }
    cc.closePath(); cc.stroke();
    cc.fillStyle = css('--color-accent-hover') || '#6ea262';
    for (let i = 0; i < n; i++) {
      const p = curve((i / n) * Math.PI * 2);
      cc.beginPath(); cc.arc(CX + p.x * S, CY - p.y * S, 2.4, 0, 7); cc.fill();
    }
  }

  function drawGrid () {
    const grid = css('--color-border') || '#444';
    const txt = css('--color-text-secondary') || '#999';
    pc.font = '9px monospace';
    pc.textBaseline = 'middle';
    // horizontal decade lines (error)
    for (let q = eLoExp; q <= eHiExp; q++) {
      const y = yPix(Math.pow(10, q));
      pc.strokeStyle = grid; pc.globalAlpha = 0.55; pc.lineWidth = 1;
      pc.beginPath(); pc.moveTo(X0, y); pc.lineTo(X1, y); pc.stroke();
      pc.globalAlpha = 1; pc.fillStyle = txt; pc.textAlign = 'right';
      pc.fillText('1e' + q, X0 - 4, y);
    }
    // vertical log lines (nodes): majors at decades, minors at 2..9 * decade
    for (let p = Math.floor(logNmin); p <= Math.ceil(logNmax); p++) {
      for (let m = 1; m <= 9; m++) {
        const n = m * Math.pow(10, p);
        if (n < NMIN || n > NMAX) continue;
        const x = xPix(n);
        pc.strokeStyle = grid; pc.globalAlpha = (m === 1) ? 0.55 : 0.2; pc.lineWidth = 1;
        pc.beginPath(); pc.moveTo(x, Y0); pc.lineTo(x, Y1); pc.stroke();
        if (m === 1) {
          pc.globalAlpha = 1; pc.fillStyle = txt; pc.textAlign = 'center';
          pc.fillText(String(n), x, Y1 + 9);
        }
      }
    }
    // endpoints n = NMIN, NMAX as labels too
    pc.globalAlpha = 1; pc.fillStyle = txt; pc.textAlign = 'center';
    pc.fillText(String(NMIN), xPix(NMIN), Y1 + 9);
    pc.fillText(String(NMAX), xPix(NMAX), Y1 + 9);
  }

  function drawPlot (n) {
    pc.clearRect(0, 0, 300, 260);
    drawGrid();
    pc.strokeStyle = css('--color-text-secondary') || '#999';
    pc.globalAlpha = 1; pc.lineWidth = 1; pc.strokeRect(X0, Y0, X1 - X0, Y1 - Y0);
    // convergence curve
    pc.strokeStyle = css('--color-accent-primary') || '#537949';
    pc.lineWidth = 2; pc.beginPath();
    errs.forEach((d, i) => { const x = xPix(d.n), y = yPix(d.e); i ? pc.lineTo(x, y) : pc.moveTo(x, y); });
    pc.stroke();
    // marker + guide at current n
    const e = eByN.get(n);
    pc.strokeStyle = css('--color-text-secondary') || '#999';
    pc.setLineDash([3, 3]); pc.beginPath(); pc.moveTo(xPix(n), Y0); pc.lineTo(xPix(n), Y1); pc.stroke(); pc.setLineDash([]);
    pc.fillStyle = css('--color-accent-hover') || '#6ea262';
    pc.beginPath(); pc.arc(xPix(n), yPix(e), 4, 0, 7); pc.fill();
  }

  function update () {
    const n = Number(range.value);
    drawCurve(n);
    drawPlot(n);
    nEl.textContent = String(n);
    eEl.textContent = eByN.get(n).toExponential(2);
  }
  const onInput = () => update();
  range.addEventListener('input', onInput);
  update();

  return {
    destroy () {
      range.removeEventListener('input', onInput);
      root.innerHTML = '';
    }
  };
}
