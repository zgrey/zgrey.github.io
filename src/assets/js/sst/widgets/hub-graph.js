/**
 * The Hub — SST as an undirected graph.
 *
 * One CORE node (SST) sits at the centre; every application spokes off it AND is
 * wired to the others, so the whole thing reads as a connected, undirected graph
 * rather than a list. Live spokes are clickable (they drive the adventure into
 * that story); WIP spokes are dimmed. The same widget powers the in-adventure
 * Hub scene and the standalone /sst/map/ page:
 *   - inside the player, a click appends the target scene (no reload);
 *   - on the map page (no player), it navigates to /sst/#<id>.
 *
 * SVG is resolution-independent, so there is no canvas zoom here; colours use
 * CSS custom properties via inline `style`, so light/dark theming stays live.
 *
 * Contract: default export mount(rootEl) -> { destroy() }.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

// core + five application spokes (3 live, 2 WIP)
const CORE = { id: 'sst', label: 'SST', sub: 'the engine' };
const APPS = [
  { id: 'chips', label: 'Chips', sub: 'xCT defects', target: 'chips-problem', live: true },
  { id: 'ebsd', label: 'EBSD', sub: 'grain maps', target: 'ebsd-problem', live: true },
  { id: 'airfoil', label: 'Airfoils', sub: 'G2Aero', target: 'airfoil-problem', live: true },
  { id: 'hail', label: 'Hailstone', sub: 'LBM · WIP', target: null, live: false },
  { id: 'topo', label: 'Topology', sub: 'TDA · WIP', target: null, live: false }
];

const W = 560, H = 470, CX = 280, CY = 232, RING = 158, RC = 50, RA = 40;

function el (name, attrs = {}, styles = {}) {
  const n = document.createElementNS(SVG_NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  for (const k in styles) n.style[k] = styles[k];
  return n;
}

export default function mount (root) {
  // place the spokes on a ring, first one at the top
  const pos = {};
  APPS.forEach((a, i) => {
    const th = -Math.PI / 2 + i * (2 * Math.PI / APPS.length);
    pos[a.id] = [CX + RING * Math.cos(th), CY + RING * Math.sin(th)];
  });
  pos[CORE.id] = [CX, CY];

  const svg = el('svg', {
    viewBox: `0 0 ${W} ${H}`,
    width: '100%',
    role: 'group',
    'aria-label': 'SST application graph'
  });
  svg.style.maxWidth = '38rem';
  svg.style.display = 'block';
  svg.style.margin = '0 auto';

  const edges = el('g');
  const nodes = el('g');
  svg.appendChild(edges);
  svg.appendChild(nodes);

  // edge between two node centres, trimmed to sit just outside the node radii
  function edge (aId, bId, r1, r2, opts = {}) {
    const [x1, y1] = pos[aId], [x2, y2] = pos[bId];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    return el('line', {
      x1: x1 + ux * r1, y1: y1 + uy * r1, x2: x2 - ux * r2, y2: y2 - uy * r2
    }, {
      stroke: opts.color || 'var(--color-accent-primary)',
      strokeWidth: opts.width || 2,
      strokeOpacity: opts.opacity != null ? opts.opacity : 0.85,
      strokeDasharray: opts.dash || 'none'
    });
  }

  // app <-> app: the "connected to each other" mesh (faint), WIP fainter/dashed
  for (let i = 0; i < APPS.length; i++) {
    for (let j = i + 1; j < APPS.length; j++) {
      const both = APPS[i].live && APPS[j].live;
      edges.appendChild(edge(APPS[i].id, APPS[j].id, RA, RA, {
        color: 'var(--color-text-secondary)',
        width: 1,
        opacity: both ? 0.32 : 0.16,
        dash: both ? 'none' : '3 3'
      }));
    }
  }
  // core -> each spoke (the bold radial backbone)
  APPS.forEach(a => edges.appendChild(edge(CORE.id, a.id, RC, RA, {
    width: a.live ? 2.4 : 1.4,
    opacity: a.live ? 0.9 : 0.4,
    dash: a.live ? 'none' : '4 4'
  })));

  // does an SST player own this page? then click = append; else = navigate
  const player = () => document.getElementById('sst-app')?._sstPlayer || null;
  function go (target) {
    if (!target) return;
    const p = player();
    if (p && typeof p.append === 'function') p.append(target);
    else window.location.href = '/sst/#' + target;
  }

  function node (spec, r, core) {
    const [x, y] = pos[spec.id];
    const g = el('g', { transform: `translate(${x} ${y})` });
    const interactive = core ? false : spec.live;
    g.style.cursor = interactive ? 'pointer' : 'default';

    const circle = el('circle', { r }, {
      fill: core ? 'var(--color-accent-dim)' : 'var(--color-bg-elevated)',
      stroke: core
        ? 'var(--color-accent-hover)'
        : (spec.live ? 'var(--color-accent-primary)' : 'var(--color-border)'),
      strokeWidth: core ? 2.4 : 2,
      strokeDasharray: (!core && !spec.live) ? '4 4' : 'none',
      transition: 'fill .15s, stroke .15s'
    });
    g.appendChild(circle);

    const label = el('text', {
      x: 0, y: core ? -2 : -3, 'text-anchor': 'middle'
    }, {
      fill: core
        ? 'var(--color-accent-hover)'
        : (spec.live ? 'var(--color-text-heading)' : 'var(--color-text-secondary)'),
      fontFamily: 'var(--font-mono)',
      fontSize: core ? '20px' : '15px',
      fontWeight: '500'
    });
    label.textContent = spec.label;
    g.appendChild(label);

    const sub = el('text', {
      x: 0, y: core ? 16 : 14, 'text-anchor': 'middle'
    }, {
      fill: 'var(--color-text-secondary)',
      fontFamily: 'var(--font-mono)',
      fontSize: core ? '10px' : '9px'
    });
    sub.textContent = spec.sub;
    g.appendChild(sub);

    if (interactive) {
      g.setAttribute('role', 'link');
      g.setAttribute('tabindex', '0');
      g.setAttribute('aria-label', `${spec.label} story`);
      const enter = () => { circle.style.fill = 'var(--color-accent-dim)'; circle.style.stroke = 'var(--color-accent-hover)'; };
      const leave = () => { circle.style.fill = 'var(--color-bg-elevated)'; circle.style.stroke = 'var(--color-accent-primary)'; };
      g.addEventListener('mouseenter', enter);
      g.addEventListener('mouseleave', leave);
      g.addEventListener('click', () => go(spec.target));
      g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(spec.target); } });
    }
    return g;
  }

  APPS.forEach(a => nodes.appendChild(node(a, RA, false)));
  nodes.appendChild(node(CORE, RC, true));

  const wrap = document.createElement('div');
  wrap.className = 'sst-graph';
  wrap.appendChild(svg);
  const legend = document.createElement('p');
  legend.className = 'sst-graph-legend';
  legend.innerHTML = '<span class="sst-graph-live">● live spoke</span> &nbsp; ' +
    '<span class="sst-graph-wip">◌ WIP</span> &nbsp; — every spoke reuses the same SST engine and connects to the others.';
  wrap.appendChild(legend);
  root.appendChild(wrap);

  return { destroy () { root.innerHTML = ''; } };
}
