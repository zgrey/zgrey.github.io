// ===== SPA Router =====
// Intercepts internal navigation to swap page content without full reloads,
// keeping the canvas animation running continuously.

(function () {
  function navigate(url, pushState = true) {
    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(res.status);
        return res.text();
      })
      .then(html => {
        const doc = new DOMParser().parseFromString(html, 'text/html');

        // Swap main content
        const newMain = doc.querySelector('main');
        const currentMain = document.querySelector('main');
        if (newMain && currentMain) {
          currentMain.innerHTML = newMain.innerHTML;
        }

        // Update body class (landing vs normal pages)
        document.body.className = doc.body.className || '';

        // Update document title
        document.title = doc.title;

        // Update nav active state
        document.querySelectorAll('.nav-links a').forEach(link => {
          const href = link.getAttribute('href');
          const isActive = href === '/'
            ? url === '/'
            : url.startsWith(href);
          link.classList.toggle('active', isActive);
          if (isActive) {
            link.setAttribute('aria-current', 'page');
          } else {
            link.removeAttribute('aria-current');
          }
        });

        // Push history
        if (pushState) {
          history.pushState(null, '', url);
        }

        // Scroll to top
        window.scrollTo(0, 0);

        // Re-render KaTeX math in swapped content
        if (typeof renderMathInElement === 'function') {
          renderMathInElement(document.body, {
            delimiters: [
              {left: "\\(", right: "\\)", display: false},
              {left: "\\[", right: "\\]", display: true}
            ]
          });
        }
      })
      .catch(() => {
        // Fallback to normal navigation on error
        window.location.href = url;
      });
  }

  // Intercept clicks on internal links
  document.addEventListener('click', function (e) {
    const link = e.target.closest('a');
    if (!link) return;

    const href = link.getAttribute('href');
    if (!href) return;

    // Only handle internal links
    if (link.origin !== window.location.origin) return;
    if (link.target === '_blank') return;
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;

    e.preventDefault();
    if (href !== window.location.pathname) {
      navigate(href);
    }
  });

  // Handle back/forward
  window.addEventListener('popstate', function () {
    navigate(window.location.pathname, false);
  });
})();
