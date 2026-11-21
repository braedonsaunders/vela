'use strict';

/**
 * A window's page must come up with the shell's preload in it: the preload checks in (synchronously,
 * before any page script) for every main-frame document. A document that finishes loading without
 * that check-in, a failed main-frame load or a renderer that is gone leaves the viewer a blank or
 * half-working page, so the guard loads the app again — once per window, and says why. After that
 * it only logs: a page that cannot come up is not reloaded in a loop.
 */
function attachLoadGuard(window, { load, log, reloads = 1 }) {
  const contents = window.webContents;
  let checkedIn = false;
  let left = reloads;
  let recovering = false;
  const recover = reason => {
    if (window.isDestroyed() || recovering) return;
    if (left <= 0) { log(`${reason}; already reloaded once, leaving the page as it is`); return; }
    left -= 1;
    recovering = true;
    log(`${reason}; reloading the app`);
    // Off the emitting event: Chromium is still finishing the load or the crash it reported.
    setImmediate(() => {
      recovering = false;
      if (!window.isDestroyed()) load();
    });
  };
  const started = (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) checkedIn = false;
  };
  const finished = () => {
    if (!checkedIn) recover(`the page at ${contents.getURL()} loaded without the shell's preload`);
  };
  const failed = (_event, code, description, url, mainFrame) => {
    // -3 (ERR_ABORTED) is a load replaced by another, not a failure.
    if (mainFrame && code !== -3) recover(`the page failed to load (${code} ${description}) at ${url}`);
  };
  const gone = (_event, details) => {
    if (details?.reason !== 'clean-exit') recover(`the page's renderer is gone (${details?.reason}, exit ${details?.exitCode})`);
  };
  contents.on('did-start-navigation', started);
  contents.on('did-finish-load', finished);
  contents.on('did-fail-load', failed);
  contents.on('render-process-gone', gone);
  return {
    /** The preload of the current document has run. */
    checkIn() { checkedIn = true; },
    dispose() {
      contents.off('did-start-navigation', started);
      contents.off('did-finish-load', finished);
      contents.off('did-fail-load', failed);
      contents.off('render-process-gone', gone);
    },
  };
}

module.exports = { attachLoadGuard };
