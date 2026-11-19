'use strict';
const path = require('node:path');
let addon;
function load() {
  if (addon) return addon;
  const root = process.env.VELA_NATIVE_MAC_DIR || path.join(process.resourcesPath, 'native-mac');
  return (addon = require(path.join(root, 'vela-native.node')));
}
exports.available = () => {
  if (process.platform !== 'darwin') return false;
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
  const timer = setInterval(() => {
    if (disposed) return;
    for (const { event, value } of call('poll')) {
      if (disposed) break;
      emit(event, value);
    }
  }, 50);
  return {
    update: props => call('update', props),
    setAccess: access => call('access', access),
    setBounds: bounds => call('bounds', bounds),
    diagnostics: () => call('diagnostics'),
    destroy() {
      if (disposed) return;
      disposed = true;
      clearInterval(timer);
      binary.destroy(handle);
    },
  };
};
