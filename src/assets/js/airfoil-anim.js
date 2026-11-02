/**
 * Generic frame-cycling animation.
 * Usage: <div class="frame-anim" data-frames="200" data-fps="8" data-path="/assets/img/airfoil_frames/"></div>
 *
 * Frames are PNGs named 000.png, 001.png, ... under data-path.  They are
 * fetched only once the animation nears the viewport, a few at a time and in
 * order, and playback starts with the first frame: while frames are still
 * arriving it holds on the newest one, so the first loop plays at download
 * speed and later loops at data-fps.  A frame that fails twice is skipped
 * rather than stalling the whole animation.
 *
 * Call window.initFrameAnims() to (re)initialize after SPA navigation; it
 * stops the previous page's timers, observers and pending downloads.
 */
(function () {
  const PARALLEL = 6;          // frame downloads in flight per animation
  const RETRY_MS = 1000;       // one retry for a failed frame, after this long
  const PENDING = 0, OK = 1, FAILED = 2;

  let generation = 0;
  let timers = [];
  let observers = [];

  function frameUrl(basePath, i) {
    return basePath + String(i).padStart(3, '0') + '.png';
  }

  function setup(container, gen) {
    container.innerHTML = '';
    const total = parseInt(container.dataset.frames || '200', 10);
    const fps = parseInt(container.dataset.fps || '8', 10);
    const basePath = container.dataset.path || '/assets/img/airfoil_frames/';

    const img = document.createElement('img');
    img.alt = 'Animation';
    img.draggable = false;
    container.appendChild(img);

    const frames = new Array(total);
    const status = new Array(total).fill(PENDING);
    let shown = -1;
    let nextToLoad = 0;

    function load(i, retried) {
      if (gen !== generation) return;
      const f = new Image();
      f.onload = () => {
        if (gen !== generation) return;
        frames[i] = f;
        status[i] = OK;
        if (shown < 0) show(i);
        pump();
      };
      f.onerror = () => {
        if (gen !== generation) return;
        if (!retried) { setTimeout(() => load(i, true), RETRY_MS); return; }
        status[i] = FAILED;
        pump();
      };
      f.src = frameUrl(basePath, i);
    }

    let inFlight = 0;
    function pump() {
      // called once per settled frame (and once to start): keep PARALLEL going
      if (inFlight > 0) inFlight--;
      while (inFlight < PARALLEL && nextToLoad < total) {
        inFlight++;
        load(nextToLoad++, false);
      }
    }

    function show(i) {
      shown = i;
      img.src = frames[i].src;
    }

    function tick() {
      if (shown < 0) return;
      // step forward past failed frames; hold if the next one has not arrived
      for (let step = 1; step <= total; step++) {
        const i = (shown + step) % total;
        if (status[i] === OK) { if (i !== shown) show(i); return; }
        if (status[i] === PENDING) return;
      }
    }

    function start() {
      inFlight = 1;              // pump() decrements first
      pump();
      timers.push(setInterval(tick, 1000 / fps));
    }

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          if (gen === generation) start();
        }
      }, { rootMargin: '300px 0px' });
      io.observe(container);
      observers.push(io);
    } else {
      start();
    }
  }

  function init() {
    generation++;
    timers.forEach((id) => clearInterval(id));
    observers.forEach((io) => io.disconnect());
    timers = [];
    observers = [];
    document.querySelectorAll('.frame-anim').forEach((c) => setup(c, generation));
  }

  // Keep backward compat and add new name
  window.initAirfoilAnim = init;
  window.initFrameAnims = init;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
