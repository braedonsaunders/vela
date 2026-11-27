'use strict';
const path = require('node:path');
const { existsSync } = require('node:fs');
const { downloadsRoot, localizePlayback } = require('../downloads-paths');
// A downloaded title plays from disk: its vela-app://app/vela-downloads/ URLs become file:// URLs of the
// validated local files, which AetherEngine opens directly (no media access headers apply to file URLs).
const downloads = () => downloadsRoot(require('electron').app.getPath('userData'));
let addon;
function load() {
  if (!existsSync(path.join(process.resourcesPath, 'AetherEngine_AetherEngine.bundle')))
    throw new Error('Native engine resource bundle unavailable');
  if (addon) return addon;
  const root = process.env.VELA_NATIVE_MAC_DIR || path.join(process.resourcesPath, 'native-mac');
  return (addon = require(path.join(root, 'vela-native.node')));
}
exports.available = () => {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return false;
  if (Number(process.getSystemVersion().split('.')[0]) < 15) return false;
  try { load(); return true; } catch { return false; }
};
exports.capabilities = async () => JSON.parse(load().capabilities());
exports.create = async ({ window, emit }) => {
  const binary = load();
  const handle = binary.create(window.getNativeWindowHandle());
  let disposed = false;
  const call = (op, value = {}) => {
    if (disposed) return;
    return JSON.parse(binary.call(handle, op, JSON.stringify(value ?? {})));
  };
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    clearInterval(timer);
    binary.destroy(handle);
  };
  const timer = setInterval(() => {
    if (disposed) return;
    let events;
    try {
      events = call('poll');
      if (!Array.isArray(events)) throw new Error('Invalid native event list');
    }
    catch {
      try { destroy(); } catch { /* Surface disposal must not prevent fallback. */ }
      emit('fallback', { reason: 'native-bridge-failed' });
      return;
    }
    for (const { event, value } of events) {
      if (disposed) break;
      emit(event, value);
    }
  }, 50);
  // The Swift session stops on every grant change. A local file needs no grant, so while one plays a
  // grant change waits, and is applied before the next plan that is not local (server URLs always load
  // under the latest grant, exactly as before).
  let local = false;
  let pending = null;
  return {
    update: props => {
      const next = localizePlayback(props, downloads());
      if (next && typeof next === 'object' && 'plan' in next) {
        const plan = next.plan;
        const selected = plan?.paths?.find?.(item => item?.id === plan.selectedPathId);
        const isLocal = typeof selected?.url === 'string' && selected.url.startsWith('file:');
        if (!isLocal && pending) { const { access } = pending; pending = null; call('access', access); }
        local = isLocal;
      }
      return call('update', next);
    },
    setAccess: access => {
      if (local) { pending = { access }; return; }
      pending = null;
      return call('access', access);
    },
    setCaptionInsets: insets => call('caption-insets', insets),
    setBounds: bounds => call('bounds', bounds),
    diagnostics: () => call('diagnostics'),
    destroy,
  };
};
