/* EVIE web demo: the dashboard's server, replaced by recordings.

   Loaded before app.js on the public demo page.  app.js there is the real
   dashboard, byte-for-byte; it talks to its FastAPI server three ways --
   fetch('/api/...'), <img src="/api/...">, and one WebSocket on /ws -- and
   this file answers all three from files that make_web_demo.py recorded by
   driving the real server through real runs.  Nothing here computes a
   result: a request that was not recorded is refused, never approximated.

   The key format, normalize() below, must match _key() in make_web_demo.py.
   Plain script, no inline code: the dashboard's CSP (script-src 'self')
   forbids inline scripts, and this page keeps to the same rule. */
(function () {
  'use strict';

  const me = document.currentScript;
  const BUILD = (me && me.dataset.build) || '';
  const DATA = new URL('data/', me ? me.src : location.href);
  const NOT_HERE = 'this is a recorded demo of the EVIE dashboard. Running an '
    + 'analysis needs the evie package itself, which is coming soon.';
  /* the run replays at its recorded pace, compressed to about this long */
  const REPLAY_MS = 6000;

  const realFetch = window.fetch.bind(window);
  const files = {};
  function file(name) {
    if (!files[name]) {
      files[name] = realFetch(new URL(name + '?v=' + BUILD, DATA)).then((r) => {
        if (!r.ok) throw new Error(name + ': HTTP ' + r.status);
        return r.json();
      });
    }
    return files[name];
  }

  let state = null;                 // key into manifest.states
  const manifest = file('manifest.json').then((m) => {
    state = m.initial;
    return m;
  });

  /* ---- request keys: path without /api, query sorted, token dropped ---- */
  function normalize(url) {
    const u = new URL(url, location.href);
    const at = u.pathname.indexOf('/api/');
    const path = decodeURIComponent(at >= 0 ? u.pathname.slice(at + 4) : u.pathname);
    let q = [];
    u.searchParams.forEach((v, k) => { if (k !== 't') q.push([k, v]); });
    if (path === '/store/clusters') {
      /* the server lowercases basis, and only the T basis depends on r
         (store.clusters keys its cache the same way) */
      const basis = (q.find(([k]) => k === 'basis') || [, 'joint'])[1].toLowerCase();
      q = q.map(([k, v]) => [k, k === 'basis' ? basis : v])
        .filter(([k]) => k !== 'r' || basis === 't');
    }
    q.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return { path, query: q, key: path + (q.length ? '?' + q.map(([k, v]) => k + '=' + v).join('&') : '') };
  }

  function reply(status, body) {
    return new Response(JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json' } });
  }
  const refuse = () => reply(409, { detail: NOT_HERE });

  /* ---- help: pages recorded whole; search mirrors evie.help.corpus ---- */
  const helpKey = (s) => s.trim().toLowerCase().replace(/[\s-]+/g, '_');
  function helpSearch(help, text) {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const scored = [];
    for (const p of help.pages) {
      const ids = [p.id, ...p.aliases].map((s) => s.toLowerCase());
      const names = ids.join(' ');
      let score = 0;
      for (const w of words) {
        if (ids.includes(w)) score += 100;
        else if (names.includes(w)) score += 40;
        else if (p.title.toLowerCase().includes(w)) score += 20;
        else if (p.short.toLowerCase().includes(w)) score += 8;
        else if (p.body.includes(w)) score += 2;          // body is pre-lowered
        else { score = 0; break; }
      }
      if (score) scored.push([-score, p.id.toLowerCase(), p]);
    }
    scored.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    return scored.slice(0, 12).map((s) => s[2]);
  }
  async function answerHelp(path, query) {
    const help = await file('help.json');
    if (path === '/help') return reply(200, help.index);
    if (path === '/help/search') {
      const q = (query.find(([k]) => k === 'q') || [, ''])[1];
      return reply(200, { query: q, results: helpSearch(help, q).map((p) =>
        ({ id: p.id, title: p.title, short: p.short, section: p.section })) });
    }
    const key = path.slice('/help/page/'.length);
    const id = help.lookup[helpKey(key)];
    if (id) return reply(200, help.views[id]);
    return reply(404, { detail: { message: 'no help topic ' + JSON.stringify(key),
      suggestions: helpSearch(help, key).slice(0, 8).map((p) => p.id) } });
  }

  /* ---- reconstructions: one file per r, every sample; filter to ids ---- */
  async function answerReconstruct(m, query) {
    const get = (k) => (query.find(([n]) => n === k) || [])[1];
    const r = get('r');
    const name = m.states[state].recon[r];
    if (!name) return reply(409, { detail: 'reconstruction at r=' + r + ' was not recorded in this demo' });
    const all = await file(name);
    const out = {};
    for (const id of String(get('ids') || '').split(',')) if (id in all) out[id] = all[id];
    return reply(200, out);
  }

  async function recorded(m, key) {
    for (const name of [m.states[state].api, m.shared]) {
      const table = await file(name);
      if (key in table) return table[key];
    }
    return null;
  }

  async function answer(url, init) {
    const m = await manifest;
    const method = String((init && init.method) || 'GET').toUpperCase();
    const { path, query, key } = normalize(url);
    if (method === 'POST' && path === '/load') {
      const body = JSON.parse((init && init.body) || '{}');
      const s = m.sessions.find((x) => x.path === body.path);
      if (!s) return reply(404, { detail: 'no such session: ' + body.path });
      state = s.state;
      return reply(200, s.meta);
    }
    if (method !== 'GET') return refuse();
    if (path.startsWith('/help')) return answerHelp(path, query);
    if (path === '/store/reconstruct') return answerReconstruct(m, query);
    const rec = await recorded(m, key);
    if (!rec) {
      console.warn('[evie demo] not recorded:', key);
      return reply(409, { detail: 'not recorded in this demo: ' + key });
    }
    /* large responses live in files of their own, fetched on first use */
    const body = rec[1] && rec[1].$json ? await file(rec[1].$json) : rec[1];
    return reply(rec[0], body);
  }

  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    if (!new URL(url, location.href).pathname.startsWith('/api/')) return realFetch(input, init);
    return answer(url, init);
  };

  /* ---- images: app.js points <img>.src at /api/...; aim it at the file ---- */
  const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    enumerable: src.enumerable,
    get: src.get,
    set(value) {
      const v = String(value);
      if (!new URL(v, location.href).pathname.startsWith('/api/')) { src.set.call(this, v); return; }
      const img = this;
      manifest.then((m) => recorded(m, normalize(v).key)).then((rec) => {
        /* a missing image must still fire onerror, so the UI's own
           "unavailable" path runs rather than a spinner forever */
        src.set.call(img, rec && rec[1] && rec[1].$file
          ? new URL(rec[1].$file + '?v=' + BUILD, DATA).href : 'data:,');
      });
    },
  });

  /* ---- the event stream: replay the recorded run, as a reconnect does ---- */
  function DemoSocket() {
    this.readyState = 0;
    const sock = this;
    manifest.then((m) => file(m.states[state].events)).then((events) => {
      sock.readyState = 1;
      if (sock.onopen) sock.onopen({});
      const t0 = events.length ? events[0].ts : 0;
      const span = Math.max(1e-3, (events.length ? events[events.length - 1].ts : 0) - t0);
      events.forEach((ev) => {
        /* recorded pace, compressed; anything after the run's last stage
           lands at once so the results are not held back */
        const at = ev.ts ? ((ev.ts - t0) / span) * REPLAY_MS : 0;
        setTimeout(() => { if (sock.onmessage) sock.onmessage({ data: JSON.stringify(ev) }); }, at);
      });
    });
  }
  DemoSocket.prototype.send = function () {};      // a recorded run never waits for input
  DemoSocket.prototype.close = function () { this.readyState = 3; };
  DemoSocket.CONNECTING = 0; DemoSocket.OPEN = 1; DemoSocket.CLOSING = 2; DemoSocket.CLOSED = 3;
  window.WebSocket = DemoSocket;
})();
