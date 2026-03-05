/**
 * Generic frame-cycling animation.
 * Usage: <div class="frame-anim" data-frames="200" data-fps="8" data-path="/assets/img/airfoil_frames/"></div>
 *
 * Call window.initFrameAnims() to (re)initialize after SPA navigation.
 */
(function () {
  let activeIntervals = [];

  function init() {
    // Clean up previous instances
    activeIntervals.forEach(id => clearInterval(id));
    activeIntervals = [];

    document.querySelectorAll('.frame-anim').forEach(container => {
      container.innerHTML = '';

      const totalFrames = parseInt(container.dataset.frames || '200', 10);
      const fps = parseInt(container.dataset.fps || '8', 10);
      const basePath = container.dataset.path || '/assets/img/airfoil_frames/';

      const img = document.createElement('img');
      img.alt = 'Animation';
      img.draggable = false;
      container.appendChild(img);

      const frames = [];
      let loaded = 0;

      for (let i = 0; i < totalFrames; i++) {
        const f = new Image();
        f.src = basePath + String(i).padStart(3, '0') + '.png';
        f.onload = () => {
          loaded++;
          if (loaded === totalFrames) start();
        };
        frames.push(f);
      }

      function start() {
        let idx = 0;
        img.src = frames[0].src;
        const id = setInterval(() => {
          idx = (idx + 1) % totalFrames;
          img.src = frames[idx].src;
        }, 1000 / fps);
        activeIntervals.push(id);
      }
    });
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
