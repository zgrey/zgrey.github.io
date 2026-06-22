/**
 * SST Adventure player — explorable transcript.
 *
 * Reads a manifest of scenes (/sst/scenes.json) and plays them as a GROWING
 * SCROLL: each scene is appended as a block beneath the last, animates in, and
 * its "choices" branch to the next scene. There is no slide/present mode — the
 * whole history stays on the page and you scroll up to revisit it, like a
 * prompt/transcript. It should feel like exploring, not clicking through slides.
 *
 * Loaded globally (like airfoil-anim.js); acts only when #sst-app / #sst-map is
 * present. window.initSST() re-boots it after SPA navigation.
 */

const MANIFEST_URL = '/sst/scenes.json';

let manifestPromise = null;
function loadManifest () {
  if (!manifestPromise) {
    manifestPromise = fetch(MANIFEST_URL)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(data => {
        const scenes = (data.scenes || []).slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
        return { scenes, byId: new Map(scenes.map(s => [s.id, s])) };
      });
  }
  return manifestPromise;
}

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

const prefersReducedMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- Player ---------------------------------------------------------------

class Player {
  constructor (root, manifest) {
    this.root = root;
    this.manifest = manifest;
    this.transcript = root.querySelector('#sst-transcript');
    this.actEl = root.querySelector('#sst-act');
    this.titleEl = root.querySelector('#sst-scene-title');
    this.fsBtn = root.querySelector('#sst-fullscreen');
    this.restartBtn = root.querySelector('#sst-restart');

    this.widgets = [];     // mounted widget handles ({ destroy() })
    this.last = null;      // id of the most recently appended scene

    this.wire();

    const startId = (location.hash || '').replace(/^#/, '') ||
      root.dataset.start || (manifest.scenes[0] && manifest.scenes[0].id);
    this.append(startId, { animate: false, scroll: false });
  }

  wire () {
    this.fsBtn?.addEventListener('click', () => this.toggleFullscreen());
    this.restartBtn?.addEventListener('click', () => this.restart());
    this._onKey = e => {
      if (!this.root.isConnected) return;
      if (e.key.toLowerCase() === 'f' && !/INPUT|TEXTAREA/.test(e.target.tagName)) this.toggleFullscreen();
    };
    document.addEventListener('keydown', this._onKey);
    this.root._sstCleanup = () => this.destroy();
  }

  destroy () {
    document.removeEventListener('keydown', this._onKey);
    this._destroyWidgets();
  }

  _destroyWidgets () {
    this.widgets.forEach(w => { try { w && w.destroy && w.destroy(); } catch (_) { /* noop */ } });
    this.widgets = [];
  }

  toggleFullscreen () {
    if (!document.fullscreenElement) this.root.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  restart () {
    this._destroyWidgets();
    this.transcript.innerHTML = '';
    this.last = null;
    const startId = this.root.dataset.start || (this.manifest.scenes[0] && this.manifest.scenes[0].id);
    this.append(startId, { animate: true, scroll: true });
  }

  // Append a scene as a new block at the bottom of the transcript.
  append (id, { animate = true, scroll = true } = {}) {
    const scene = this.manifest.byId.get(id);
    if (!scene) return;
    this.last = id;

    const block = document.createElement('section');
    block.className = 'sst-block';
    block.dataset.id = id;
    block.innerHTML =
      (scene.act ? `<div class="sst-block-act">${scene.act}</div>` : '') +
      `<div class="sst-block-title">${scene.title || ''}</div>` +
      `<div class="sst-block-body">${scene.html}</div>`;

    const body = block.querySelector('.sst-block-body');
    this.mountWidget(scene, body);
    this.renderChoices(scene, block);
    renderMath(block);

    // stagger the fragment reveals
    if (!prefersReducedMotion()) {
      block.querySelectorAll('.sst-frag').forEach((f, i) => {
        f.style.animationDelay = (0.18 + i * 0.16).toFixed(2) + 's';
      });
    }

    this.transcript.appendChild(block);
    if (animate) requestAnimationFrame(() => block.classList.add('is-in'));
    else block.classList.add('is-in');

    if (this.actEl) this.actEl.textContent = scene.act || 'SST';
    if (this.titleEl) this.titleEl.innerHTML = scene.title || '';
    history.replaceState(null, '', '#' + id);

    if (scroll) {
      requestAnimationFrame(() => block.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'start'
      }));
    }
  }

  mountWidget (scene, host) {
    const spec = scene.mount || 'none';
    if (spec.startsWith('widget:')) {
      const name = spec.slice('widget:'.length);
      const mountEl = document.createElement('div');
      mountEl.className = 'sst-widget';
      host.appendChild(mountEl);
      import(`./widgets/${name}.js`)
        .then(mod => {
          if (!mountEl.isConnected) return;
          const handle = (mod.default || mod.mount)(mountEl);
          if (handle) this.widgets.push(handle);
        })
        .catch(err => { mountEl.innerHTML = `<p class="sst-note">widget “${name}” failed to load.</p>`; console.error(err); });
    } else if (spec.startsWith('video:')) {
      this.mountVideo(spec.slice('video:'.length), host);
    }
  }

  // Pre-rendered Manim set-piece (the "cinematic tier"). Plays only while in
  // view (so older history scenes don't keep looping); respects reduced motion.
  mountVideo (name, host) {
    const fig = document.createElement('figure');
    fig.className = 'sst-video';
    const reduce = prefersReducedMotion();
    const v = document.createElement('video');
    v.src = `/assets/video/sst/${name}.webm`;
    v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'metadata';
    if (reduce) v.controls = true;
    const cap = document.createElement('figcaption');
    cap.textContent = 'pre-rendered animation (Manim, draft — to be refined)';
    fig.appendChild(v); fig.appendChild(cap);
    host.appendChild(fig);

    let observer = null;
    if (!reduce && 'IntersectionObserver' in window) {
      observer = new IntersectionObserver(entries => {
        entries.forEach(e => { if (e.isIntersecting) v.play().catch(() => {}); else v.pause(); });
      }, { threshold: 0.25 });
      observer.observe(v);
    }
    this.widgets.push({ destroy () { if (observer) observer.disconnect(); v.pause(); v.removeAttribute('src'); v.load(); } });
  }

  renderChoices (scene, block) {
    const nav = document.createElement('nav');
    nav.className = 'sst-choices';
    nav.setAttribute('aria-label', 'Branch choices');
    (scene.choices || []).forEach(c => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sst-choice';
      b.innerHTML = c.label;
      b.addEventListener('click', () => {
        nav.classList.add('is-spent');
        this.append(c.target);
      });
      nav.appendChild(b);
    });
    block.appendChild(nav);
  }
}

// ---- Map ------------------------------------------------------------------

function renderMap (mapEl, manifest) {
  mapEl.innerHTML = '';
  const acts = [];
  const seen = new Map();
  manifest.scenes.forEach(s => {
    const key = s.act || 'Other';
    if (!seen.has(key)) { seen.set(key, { act: key, scenes: [] }); acts.push(seen.get(key)); }
    seen.get(key).scenes.push(s);
  });
  acts.forEach(group => {
    const col = document.createElement('div');
    col.className = 'sst-map-act';
    col.innerHTML = `<h3>${group.act}</h3>`;
    group.scenes.forEach(s => {
      const node = document.createElement('a');
      node.className = 'sst-map-node';
      node.href = '/sst/#' + s.id;
      node.innerHTML = `<span class="sst-map-node-title">${s.title}</span>`;
      const edges = (s.choices || []).map(c => c.target);
      if (edges.length) node.innerHTML += `<span class="sst-map-edges">→ ${edges.join(', ')}</span>`;
      col.appendChild(node);
    });
    mapEl.appendChild(col);
  });
}

// ---- Boot -----------------------------------------------------------------

function init () {
  const app = document.getElementById('sst-app');
  const mapEl = document.getElementById('sst-map');
  if (!app && !mapEl) return;

  if (app && app._sstCleanup) app._sstCleanup();

  loadManifest().then(manifest => {
    if (app && document.body.contains(app)) app._sstPlayer = new Player(app, manifest);
    if (mapEl && document.body.contains(mapEl)) renderMap(mapEl, manifest);
  }).catch(err => console.error('SST manifest load failed', err));
}

window.initSST = init;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
