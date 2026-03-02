// ===== ASCII Animation Engine =====
// ===== Animation Configuration Flags =====
// Set these booleans to enable/disable individual background animations.
// true  → animation runs
// false → animation is omitted from the cycle.
const ENABLE_VORONOI   = true;   // Grain‑morphology (Voronoi) animation
const ENABLE_SIMPLICIAL = false; // Random‑graph (simplicial) animation
const ENABLE_AIRFOIL   = false; // Airfoil flow animation
// =========================================

const COLOR_GOLD = '#A69C7D';
const COLOR_DIM_GREEN = '#2d3d28';
const COLOR_GREEN = '#4a6741';
const CHAR_W = 10;
const CHAR_H = 18;
const SIM_INTERVAL = 1000 / 18; // ~18fps simulation
const SCENE_DURATION = 60000;   // 10s per scene
const FADE_DURATION = 1500;     // 1.5s cross-fade

// ===== ASCIIRenderer =====
class ASCIIRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cols = 0;
    this.rows = 0;
    this.grid = [];
    this.colorGrid = [];
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cols = Math.floor(w / CHAR_W);
    this.rows = Math.floor(h / CHAR_H);
    this.clear();
  }

  clear() {
    this.grid = Array.from({ length: this.rows }, () => Array(this.cols).fill(' '));
    this.colorGrid = Array.from({ length: this.rows }, () => Array(this.cols).fill(COLOR_GOLD));
  }

  setChar(r, c, ch, color) {
    if (r >= 0 && r < this.rows && c >= 0 && c < this.cols) {
      this.grid[r][c] = ch;
      if (color) this.colorGrid[r][c] = color;
    }
  }

  render(alpha = 1) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
    ctx.font = `${CHAR_H - 4}px 'IBM Plex Mono', monospace`;
    ctx.textBaseline = 'top';
    ctx.globalAlpha = alpha;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const ch = this.grid[r][c];
        if (ch !== ' ') {
          ctx.fillStyle = this.colorGrid[r][c];
          ctx.fillText(ch, c * CHAR_W, r * CHAR_H + 2);
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}

// ===== VoronoiScene (Grain Boundaries) =====
class VoronoiScene {
  constructor() {
    this.seeds = [];
    this.numSeeds = 14;
  }

  init(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.seeds = [];
    for (let i = 0; i < this.numSeeds; i++) {
      this.seeds.push({
        x: Math.random() * cols,
        y: Math.random() * rows,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.2,
      });
    }
  }

  update() {
    for (const s of this.seeds) {
      s.x += s.vx;
      s.y += s.vy;
      if (s.x < 0 || s.x >= this.cols) s.vx *= -1;
      if (s.y < 0 || s.y >= this.rows) s.vy *= -1;
      s.x = Math.max(0, Math.min(this.cols - 1, s.x));
      s.y = Math.max(0, Math.min(this.rows - 1, s.y));
    }
  }

  draw(renderer) {
    const boundaryChars = ['|', '-', '/', '\\', '+'];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        let minD = Infinity, minI = -1;
        let secondD = Infinity;
        for (let i = 0; i < this.seeds.length; i++) {
          const dx = c - this.seeds[i].x;
          const dy = (r - this.seeds[i].y) * 1.8; // aspect ratio correction
          const d = dx * dx + dy * dy;
          if (d < minD) {
            secondD = minD;
            minD = d;
            minI = i;
          } else if (d < secondD) {
            secondD = d;
          }
        }
        const ratio = minD / (secondD + 0.001);
        if (ratio > 0.75) {
          const ch = boundaryChars[minI % boundaryChars.length];
          renderer.setChar(r, c, ch, COLOR_GREEN);
        } else if (ratio > 0.5) {
          renderer.setChar(r, c, '.', COLOR_DIM_GREEN);
        }
      }
    }
    // Mark seed points
    for (const s of this.seeds) {
      renderer.setChar(Math.round(s.y), Math.round(s.x), '*', COLOR_GREEN);
    }
  }
}

// ===== SimplicialScene (Growing Mesh) =====
class SimplicialScene {
  constructor() {
    this.vertices = [];
    this.edges = [];
    this.maxVerts = 30;
    this.addTimer = 0;
  }

  init(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.vertices = [];
    this.edges = [];
    this.addTimer = 0;
    // Start with 3 initial vertices
    for (let i = 0; i < 3; i++) {
      this.vertices.push({
        x: cols * 0.3 + Math.random() * cols * 0.4,
        y: rows * 0.3 + Math.random() * rows * 0.4,
        vx: (Math.random() - 0.5) * 0.15,
        vy: (Math.random() - 0.5) * 0.1,
      });
    }
    this.edges = [[0, 1], [1, 2], [2, 0]];
  }

  update() {
    // Drift vertices
    for (const v of this.vertices) {
      v.x += v.vx;
      v.y += v.vy;
      if (v.x < 1 || v.x >= this.cols - 1) v.vx *= -1;
      if (v.y < 1 || v.y >= this.rows - 1) v.vy *= -1;
      v.x = Math.max(1, Math.min(this.cols - 2, v.x));
      v.y = Math.max(1, Math.min(this.rows - 2, v.y));
    }

    // Incrementally add vertices
    this.addTimer++;
    if (this.addTimer > 20 && this.vertices.length < this.maxVerts) {
      this.addTimer = 0;
      const newV = {
        x: this.cols * 0.1 + Math.random() * this.cols * 0.8,
        y: this.rows * 0.1 + Math.random() * this.rows * 0.8,
        vx: (Math.random() - 0.5) * 0.15,
        vy: (Math.random() - 0.5) * 0.1,
      };
      const idx = this.vertices.length;
      this.vertices.push(newV);

      // Connect to 2 nearest existing vertices
      const dists = this.vertices.slice(0, idx).map((v, i) => ({
        i,
        d: (v.x - newV.x) ** 2 + (v.y - newV.y) ** 2
      }));
      dists.sort((a, b) => a.d - b.d);
      const n1 = dists[0].i;
      const n2 = dists.length > 1 ? dists[1].i : n1;
      this.edges.push([idx, n1]);
      if (n2 !== n1) {
        this.edges.push([idx, n2]);
      }
    }
  }

  draw(renderer) {
    // Draw edges using Bresenham
    for (const [a, b] of this.edges) {
      const v0 = this.vertices[a];
      const v1 = this.vertices[b];
      this._drawLine(renderer, Math.round(v0.x), Math.round(v0.y), Math.round(v1.x), Math.round(v1.y));
    }
    // Draw vertices
    for (const v of this.vertices) {
      renderer.setChar(Math.round(v.y), Math.round(v.x), 'o', COLOR_GOLD);
    }
  }

  _drawLine(renderer, x0, y0, x1, y1) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    const lineChars = { h: '-', v: '|', d1: '/', d2: '\\' };
    let cx = x0, cy = y0;
    const maxSteps = dx + dy + 1;
    for (let step = 0; step < maxSteps; step++) {
      // Pick character based on direction
      let ch = '+';
      if (dx > dy * 2) ch = lineChars.h;
      else if (dy > dx * 2) ch = lineChars.v;
      else ch = (sx === sy) ? lineChars.d2 : lineChars.d1;

      renderer.setChar(cy, cx, ch, COLOR_DIM_GREEN);

      if (cx === x1 && cy === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; cx += sx; }
      if (e2 < dx) { err += dx; cy += sy; }
    }
  }
}

// ===== AirfoilScene (NACA 0012 Flow) =====
class AirfoilScene {
  constructor() {
    this.particles = [];
    this.maxParticles = 80;
    this.airfoilPoints = [];
  }

  init(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.particles = [];

    // Precompute airfoil boundary in grid coords
    this.cx = Math.floor(cols * 0.45);
    this.cy = Math.floor(rows * 0.5);
    this.chord = Math.floor(cols * 0.3);
    this.airfoilPoints = [];

    for (let i = 0; i <= this.chord; i++) {
      const x = i / this.chord; // 0..1
      // NACA 0012 thickness distribution
      const yt = 0.6 * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1015 * x * x * x * x);
      const screenY = yt * this.chord * 0.5; // Scale to grid
      this.airfoilPoints.push({ gx: this.cx - this.chord / 2 + i, upper: this.cy - screenY, lower: this.cy + screenY });
    }

    // Seed initial particles
    for (let i = 0; i < this.maxParticles; i++) {
      this.particles.push(this._newParticle());
    }
  }

  _newParticle() {
    return {
      x: Math.random() * this.cols * 0.15,
      y: 2 + Math.random() * (this.rows - 4),
      vx: 0.4 + Math.random() * 0.3,
      vy: 0,
    };
  }

  update() {
    const foilLeft = this.cx - this.chord / 2;
    const foilRight = this.cx + this.chord / 2;

    for (const p of this.particles) {
      // Base flow velocity
      p.vx = 0.4 + Math.random() * 0.1;
      p.vy *= 0.9; // Dampen vertical

      // Deflection around airfoil
      const gi = Math.round(p.x) - foilLeft;
      if (gi >= 0 && gi < this.airfoilPoints.length) {
        const ap = this.airfoilPoints[gi];
        if (p.y > ap.upper - 1 && p.y < ap.lower + 1) {
          // Push away from center
          if (p.y < this.cy) {
            p.vy -= 0.3;
          } else {
            p.vy += 0.3;
          }
          p.vx *= 0.7;
        }
      }
      // Upstream deflection - start deflecting before reaching airfoil
      const distToFoil = foilLeft - p.x;
      if (distToFoil > 0 && distToFoil < 10) {
        const factor = 0.1 * (1 - distToFoil / 10);
        if (p.y < this.cy) p.vy -= factor;
        else if (p.y > this.cy) p.vy += factor;
      }

      p.x += p.vx;
      p.y += p.vy;

      // Recycle off-screen particles
      if (p.x >= this.cols || p.y < 0 || p.y >= this.rows) {
        Object.assign(p, this._newParticle());
      }
    }
  }

  draw(renderer) {
    // Draw airfoil body
    for (const ap of this.airfoilPoints) {
      const c = Math.round(ap.gx);
      const rU = Math.round(ap.upper);
      const rL = Math.round(ap.lower);
      renderer.setChar(rU, c, '#', COLOR_GOLD);
      renderer.setChar(rL, c, '#', COLOR_GOLD);
      // Fill interior
      for (let r = rU + 1; r < rL; r++) {
        renderer.setChar(r, c, '.', COLOR_DIM_GREEN);
      }
    }

    // Draw particles as streamline chars
    for (const p of this.particles) {
      const r = Math.round(p.y);
      const c = Math.round(p.x);
      let ch = '-';
      if (p.vy > 0.15) ch = '\\';
      else if (p.vy < -0.15) ch = '/';
      else if (Math.abs(p.vy) > 0.05) ch = '~';
      renderer.setChar(r, c, ch, COLOR_GREEN);
    }
  }
}

// ===== AnimationController =====
class AnimationController {
  constructor(canvas) {
    this.renderer = new ASCIIRenderer(canvas);
    // Build the scenes array based on the configuration flags above.
    this.scenes = [];
    if (ENABLE_VORONOI)   this.scenes.push(new VoronoiScene());
    if (ENABLE_SIMPLICIAL) this.scenes.push(new SimplicialScene());
    if (ENABLE_AIRFOIL)   this.scenes.push(new AirfoilScene());
    
    this.currentScene = 0;
    this.sceneStartTime = 0;
    this.lastSimTime = 0;
    this.running = false;
    this.paused = false;

    // Init first scene
    this.scenes[this.currentScene].init(this.renderer.cols, this.renderer.rows);

    // Handle resize
    this._onResize = () => {
      this.renderer.resize();
      this.scenes[this.currentScene].init(this.renderer.cols, this.renderer.rows);
    };
    window.addEventListener('resize', this._onResize);

    // Respect prefers-reduced-motion
    this._motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.paused = this._motionQuery.matches;
    this._motionQuery.addEventListener('change', (e) => {
      this.paused = e.matches;
    });
  }

  start() {
    this.running = true;
    this.sceneStartTime = performance.now();
    this.lastSimTime = performance.now();
    this._loop(performance.now());
  }

  _loop(now) {
    if (!this.running) return;
    requestAnimationFrame((t) => this._loop(t));

    if (this.paused) {
      // Still render one static frame
      this.renderer.clear();
      this.scenes[this.currentScene].draw(this.renderer);
      this.renderer.render(1);
      return;
    }

    // Simulation tick at ~18fps
    if (now - this.lastSimTime >= SIM_INTERVAL) {
      this.lastSimTime = now;
      this.scenes[this.currentScene].update();
    }

    // Scene cycling
    const elapsed = now - this.sceneStartTime;
    let alpha = 1;
    if (elapsed > SCENE_DURATION - FADE_DURATION) {
      // Fade out
      alpha = Math.max(0, (SCENE_DURATION - elapsed) / FADE_DURATION);
    }
    if (elapsed < FADE_DURATION) {
      // Fade in
      alpha = Math.min(1, elapsed / FADE_DURATION);
    }
    if (elapsed >= SCENE_DURATION) {
      // Switch scene
      this.currentScene = (this.currentScene + 1) % this.scenes.length;
      this.scenes[this.currentScene].init(this.renderer.cols, this.renderer.rows);
      this.sceneStartTime = now;
    }

    // Render
    this.renderer.clear();
    this.scenes[this.currentScene].draw(this.renderer);
    this.renderer.render(alpha);
  }
}

// ===== Init =====
const canvas = document.getElementById('ascii-canvas');
if (canvas) {
  const controller = new AnimationController(canvas);
  controller.start();
}
