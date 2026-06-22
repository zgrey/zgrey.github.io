/**
 * Blade interpolation widget.
 *
 * Builds a blade left→right by Riemannian interpolation of airfoil
 * cross-sections (genuine Grassmann + SPD geodesics, see _g2.js), spinning as it
 * goes, with the current cross-section drawn above. Each station is the polar
 * reconstruction X = X̃P of an interpolated undulation [X̃] and scale P — the SST
 * decomposition turned into a design tool (G2Aero).
 *
 * Contract: default export mount(rootEl) -> { destroy() }.
 */

import { polar, grassGeo, spdGeo, frameR, rotAt, mul2 } from './_g2.js';

// NACA 4-digit airfoil as a centred landmark matrix (consistent parametrization)
function naca (m, p, t, n) {
  const xs = [];
  for (let i = 0; i < n; i++) xs.push(0.5 * (1 - Math.cos(Math.PI * i / (n - 1))));
  const yt = x => 5 * t * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4);
  const cam = x => {
    let yc, dy;
    if (x < p) { yc = m / (p * p) * (2 * p * x - x * x); dy = 2 * m / (p * p) * (p - x); } else { yc = m / ((1 - p) ** 2) * ((1 - 2 * p) + 2 * p * x - x * x); dy = 2 * m / ((1 - p) ** 2) * (p - x); }
    return [yc, dy];
  };
  const up = [], lo = [];
  for (const x of xs) { const T = yt(x); const [yc, dy] = cam(x); const th = Math.atan(dy); up.push([x - T * Math.sin(th), yc + T * Math.cos(th)]); lo.push([x + T * Math.sin(th), yc - T * Math.cos(th)]); }
  const pts = [];
  for (let i = n - 1; i >= 0; i--) pts.push(up[i]);
  for (let i = 1; i < n; i++) pts.push(lo[i]);
  let mx = 0, my = 0; for (const q of pts) { mx += q[0]; my += q[1]; }
  mx /= pts.length; my /= pts.length;
  return pts.map(q => [q[0] - mx, q[1] - my]);
}

export default function mount (root) {
  const noms = [naca(0.04, 0.4, 0.21, 36), naca(0.02, 0.4, 0.14, 36), naca(0.01, 0.4, 0.08, 36)];
  const pol = noms.map(polar);
  const K = noms.length;

  function airfoilAt (u) {
    if (u <= 0) return noms[0];
    if (u >= K - 1) return noms[K - 1];
    const i = Math.floor(u), t = u - i;
    const A = pol[i].Xt, Bp = pol[i + 1].Xt;
    const g = grassGeo(A, Bp, t);
    const R = frameR(grassGeo(A, Bp, 1), Bp);
    const RP = mul2(rotAt(R, t), spdGeo(pol[i].P, pol[i + 1].P, t));
    return g.map(r => [r[0] * RP[0][0] + r[1] * RP[1][0], r[0] * RP[0][1] + r[1] * RP[1][1]]);
  }

  root.innerHTML = `
    <div class="sst-iv">
      <figure style="margin:0">
        <canvas class="sst-iv-canvas" width="380" height="300"></canvas>
        <figcaption style="font-size:0.72rem;color:var(--color-text-secondary);text-align:center;margin-top:0.3rem">
          cross-section at the build front (top) · blade by Riemannian interpolation (below)</figcaption>
      </figure>
      <div class="sst-iv-side">
        <div class="sst-iv-controls">
          <button type="button" data-op="play">⏸ pause</button>
          <button type="button" data-op="restart">↻ restart</button>
        </div>
        <label class="sst-iv-range-row">span
          <input type="range" class="sst-range" data-span min="0" max="1000" value="0" step="1" aria-label="Span build position">
        </label>
        <p class="sst-iv-hint">Each station is X = X̃P: the undulation [X̃] walks a
        <strong>Grassmann geodesic</strong>, the scale P an <strong>SPD geodesic</strong>. Drag span to scrub.</p>
      </div>
    </div>`;

  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const spanRange = root.querySelector('[data-span]');
  const playBtn = root.querySelector('[data-op="play"]');
  const css = n => getComputedStyle(document.body).getPropertyValue(n).trim() || null;

  let p = 0, theta = 0, building = true, playing = true, raf = 0, last = 0;
  const STN = 13;

  // project a centred airfoil point (cx,cy) at span fraction sf, spun by theta
  const OX = 44, OY = 216, L = 300, TILT = -34, S = 50;
  function proj (cx, cy, sf) {
    const a = cx * Math.cos(theta) - cy * Math.sin(theta);
    const b = cx * Math.sin(theta) + cy * Math.cos(theta);
    return { x: OX + sf * L + b * S * 0.42, y: OY + sf * TILT - a * S };
  }

  function drawAirfoilFlat (X) {
    // top panel: current cross-section, chord horizontal, auto-fit
    let xmn = 9, xmx = -9, ymn = 9, ymx = -9;
    for (const q of X) { xmn = Math.min(xmn, q[0]); xmx = Math.max(xmx, q[0]); ymn = Math.min(ymn, q[1]); ymx = Math.max(ymx, q[1]); }
    const sc = 150 / (xmx - xmn), cx = 190, cy = 58;
    ctx.strokeStyle = css('--color-accent-hover') || '#6ea262'; ctx.lineWidth = 2; ctx.beginPath();
    X.forEach((q, i) => { const x = cx + (q[0] - (xmn + xmx) / 2) * sc, y = cy - (q[1] - (ymn + ymx) / 2) * sc; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath(); ctx.stroke();
  }

  function draw () {
    ctx.clearRect(0, 0, 380, 300);
    const front = p * (K - 1);
    drawAirfoilFlat(airfoilAt(front));

    // separator
    ctx.strokeStyle = css('--color-border') || '#333'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(20, 118); ctx.lineTo(360, 118); ctx.stroke();

    // blade: stations 0..front
    const nb = Math.max(1, Math.round(p * (STN - 1)));
    const stations = [];
    for (let k = 0; k <= nb; k++) {
      const sf = (nb === 0) ? 0 : (k / (STN - 1));
      const sfc = Math.min(sf, p);
      stations.push({ sf: sfc, X: airfoilAt(sfc * (K - 1)) });
    }
    // spanwise wireframe (subset of landmarks) between consecutive stations
    const n = noms[0].length;
    const idx = []; for (let i = 0; i < n; i += 5) idx.push(i);
    ctx.strokeStyle = css('--color-accent-dim') || '#2d3d28'; ctx.lineWidth = 1; ctx.globalAlpha = 0.9;
    for (let k = 1; k < stations.length; k++) {
      idx.forEach(i => {
        const a = proj(stations[k - 1].X[i][0], stations[k - 1].X[i][1], stations[k - 1].sf);
        const b = proj(stations[k].X[i][0], stations[k].X[i][1], stations[k].sf);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      });
    }
    ctx.globalAlpha = 1;
    // cross-section outlines, root faint -> front bright
    stations.forEach((st, k) => {
      const lead = k === stations.length - 1;
      ctx.strokeStyle = lead ? (css('--color-accent-hover') || '#6ea262') : (css('--color-accent-primary') || '#537949');
      ctx.globalAlpha = lead ? 1 : 0.35 + 0.5 * (st.sf);
      ctx.lineWidth = lead ? 2 : 1.3;
      ctx.beginPath();
      st.X.forEach((q, i) => { const pr = proj(q[0], q[1], st.sf); i ? ctx.lineTo(pr.x, pr.y) : ctx.moveTo(pr.x, pr.y); });
      ctx.closePath(); ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }

  function frame (ts) {
    if (!last) last = ts;
    const dt = Math.min(0.05, (ts - last) / 1000); last = ts;
    theta += dt * 0.85;
    if (building) { p = Math.min(1, p + dt / 3.4); spanRange.value = String(Math.round(p * 1000)); if (p >= 1) building = false; }
    draw();
    raf = requestAnimationFrame(frame);
  }
  function start () { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }
  function stop () { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

  function onClick (e) {
    const b = e.target.closest('[data-op]');
    if (!b) return;
    if (b.dataset.op === 'play') {
      playing = !playing;
      playBtn.textContent = playing ? '⏸ pause' : '▶ play';
      if (playing) start(); else stop();
    } else if (b.dataset.op === 'restart') {
      p = 0; building = true; theta = 0; spanRange.value = '0';
      if (playing) start(); else draw();
    }
  }
  root.querySelector('.sst-iv-controls').addEventListener('click', onClick);
  const onSpan = () => { building = false; p = Number(spanRange.value) / 1000; if (!playing) draw(); };
  spanRange.addEventListener('input', onSpan);

  draw();
  start();

  return {
    destroy () {
      stop();
      root.querySelector('.sst-iv-controls')?.removeEventListener('click', onClick);
      spanRange.removeEventListener('input', onSpan);
      root.innerHTML = '';
    }
  };
}
