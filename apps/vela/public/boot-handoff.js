// Capture before Expo Router, the PWA or any session code can read the URL.
// Only memory carries the single-use code into the application bundle.
(function () {
  function capture(event) {
    var fragment = location.hash;
    var params = new URLSearchParams(fragment.slice(1));
    if (!params.has('code') && !params.has('console')) return;
    history.replaceState(history.state, '', location.pathname + location.search);
    if (event) event.stopImmediatePropagation();
    if (window.__VELA_DESKTOP__) return;
    window.__VELA_WEB_HANDOFF__ = fragment;
    window.dispatchEvent(new Event('vela:web-handoff'));
  }
  capture();
  // Fragment navigation can emit popstate before hashchange; beat the router to both.
  window.addEventListener('popstate', capture, true);
  window.addEventListener('hashchange', capture, true);
})();
