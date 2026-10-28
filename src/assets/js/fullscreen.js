// ===== Full-screen buttons =====
// <button data-fullscreen="some-id"> puts that element in full screen (the
// EVIE page uses it for the embedded dashboard). Delegated from document, so
// it keeps working after router.js swaps <main>.

document.addEventListener('click', function (e) {
  const btn = e.target.closest('[data-fullscreen]');
  if (!btn) return;
  const el = document.getElementById(btn.dataset.fullscreen);
  // A refusal (no user gesture, or the browser disallows it) leaves the page
  // as it was, which is all there is to do about it.
  if (el && el.requestFullscreen) el.requestFullscreen().catch(function () {});
});
