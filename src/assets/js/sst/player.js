/**
 * SST Adventure player — explorable transcript.
 *
 * Reads a manifest of scenes (/sst/scenes.json) and plays them as a GROWING
 * SCROLL: each scene is appended as a block beneath the last, animates in, and
 * its "choices" branch to the next scene. There is no slide/present mode — the
 * whole history stays on the page and you scroll up to revisit it, like a
 * prompt/transcript. It should feel like exploring, not clicking through slides.
 *
 * Loaded globally (like airfoil-anim.js); acts only when #sst-app is present.
 * window.initSST() re-boots it after SPA navigation.
 *
 * The player is EMBEDDED in the SST section of /research/ (there is no
 * standalone /sst/ page). Two consequences:
 *   - it boots lazily behind #sst-launch so /research/ stays a readable page;
 *   - scene ids are written to the URL under an `sst-` prefix so they cannot
 *     collide with the research page's own section anchors.
 * /sst/scenes.json survives as a data endpoint (built from the scene
 * collection), it is not a page.
 */

const MANIFEST_URL = '/sst/scenes.json';
const HASH_PREFIX = 'sst-';

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
    this.mapToggle = document.getElementById('sst-map-toggle');
    this.mapPanel = document.getElementById('sst-mappanel');

    this.widgets = [];     // mounted widget handles ({ destroy() })
    this.last = null;      // id of the most recently appended scene

    this.wire();

    // Only an `sst-`-prefixed hash names a scene; anything else on the page
    // (e.g. #spectrum-sharing) belongs to the research page, not to us.
    const hash = (location.hash || '').replace(/^#/, '');
    const fromHash = hash.startsWith(HASH_PREFIX) ? hash.slice(HASH_PREFIX.length) : '';
    const startId = fromHash ||
      root.dataset.start || (manifest.scenes[0] && manifest.scenes[0].id);
    this.append(startId, { animate: false, scroll: false });
  }

  wire () {
    this.fsBtn?.addEventListener('click', () => this.toggleFullscreen());
    this.restartBtn?.addEventListener('click', () => this.restart());
    this.mapToggle?.addEventListener('click', () => this.toggleMap());
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

  // The map is a panel inside the embed rather than its own page, so opening it
  // is a local toggle and picking a node jumps the player straight to that scene.
  toggleMap (force) {
    if (!this.mapPanel) return;
    const open = force === undefined ? this.mapPanel.hasAttribute('hidden') : force;
    this.mapPanel.toggleAttribute('hidden', !open);
    this.mapToggle?.setAttribute('aria-expanded', String(open));
    if (open) this.mapPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    history.replaceState(null, '', '#' + HASH_PREFIX + id);

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

function renderMap (mapEl, manifest, player) {
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
      // Buttons, not links: the map lives inside the player now, so a node
      // jumps the transcript rather than navigating to a page.
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'sst-map-node';
      node.innerHTML = `<span class="sst-map-node-title">${s.title}</span>`;
      const edges = (s.choices || []).map(c => c.target);
      if (edges.length) node.innerHTML += `<span class="sst-map-edges">→ ${edges.join(', ')}</span>`;
      node.addEventListener('click', () => {
        player?.append(s.id);
        player?.toggleMap(false);
      });
      col.appendChild(node);
    });
    mapEl.appendChild(col);
  });
}

// ---- Boot -----------------------------------------------------------------

// The Hub graph also fronts the standalone map page (no player there): mount it
// directly into #sst-hub-graph if present.
function mountHubGraph (hostId) {
  const host = document.getElementById(hostId);
  if (!host || host._sstGraph) return;
  import('./widgets/hub-graph.js')
    .then(mod => { if (document.body.contains(host)) host._sstGraph = (mod.default || mod.mount)(host); })
    .catch(err => console.error('SST hub graph failed', err));
}

function boot (app) {
  if (app._sstCleanup) app._sstCleanup();
  return loadManifest().then(manifest => {
    if (!document.body.contains(app)) return;
    const player = new Player(app, manifest);
    app._sstPlayer = player;
    const mapEl = document.getElementById('sst-map');
    if (mapEl) renderMap(mapEl, manifest, player);
    mountHubGraph('sst-hub-graph');
  }).catch(err => console.error('SST manifest load failed', err));
}

// Widgets used as standalone figures in page prose (outside any scene), e.g.
// the Pareto-tracing figure in the spectrum-sharing section. Idempotent: a
// host already carrying a widget is skipped, so SPA re-init is safe.
function mountStandaloneWidgets () {
  document.querySelectorAll('[data-widget]').forEach(host => {
    if (host._sstWidget) return;
    const name = host.dataset.widget;
    if (!/^[a-z0-9-]+$/.test(name)) return;
    import(`./widgets/${name}.js`)
      .then(mod => {
        if (!host.isConnected || host._sstWidget) return;
        host._sstWidget = (mod.default || mod.mount)(host) || true;
      })
      .catch(err => {
        host.innerHTML = `<p class="sst-note">figure “${name}” failed to load.</p>`;
        console.error(err);
      });
  });
}

function init () {
  mountStandaloneWidgets();

  const app = document.getElementById('sst-app');
  if (!app) return;

  const launch = document.getElementById('sst-launch');
  const closeBtn = document.getElementById('sst-close');

  // No launcher (or the URL already names a scene) => boot straight away.
  const wantsScene = (location.hash || '').replace(/^#/, '').startsWith(HASH_PREFIX);
  if (!launch || wantsScene) {
    app.hidden = false;
    if (launch) launch.hidden = true;
    boot(app);
    return;
  }

  const open = () => {
    app.hidden = false;
    launch.hidden = true;
    boot(app).then(() => app.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  launch.addEventListener('click', open, { once: true });

  closeBtn?.addEventListener('click', () => {
    if (app._sstCleanup) app._sstCleanup();
    app.hidden = true;
    launch.hidden = false;
    // Drop the scene hash so a reload returns to the plain research page.
    if ((location.hash || '').replace(/^#/, '').startsWith(HASH_PREFIX)) {
      history.replaceState(null, '', location.pathname);
    }
    launch.addEventListener('click', open, { once: true });
    launch.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

window.initSST = init;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
