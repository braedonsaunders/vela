// Configuration changes the activity handles itself instead of being relaunched. A relaunch rebuilds
// the whole React tree (playback stops, the page and its focus reset), and briefly runs two roots at
// once (issue #76). Neither change below alters anything Vela draws:
// - navigation: a TV remote or game pad connecting or disconnecting (a Shield remote reconnecting
//   after it sleeps);
// - colorMode: the display's wide-colour or HDR mode, which a TV switches with its display mode.
// Density and locale still relaunch the activity: those should rebuild the interface.
const { withAndroidManifest } = require('expo/config-plugins');

const CONFIG_CHANGES = ['navigation', 'colorMode'];

/** The activity's `android:configChanges` value with `changes` added, keeping existing entries and order. */
function withConfigChanges(value, changes = CONFIG_CHANGES) {
  const set = new Set((value ?? '').split('|').filter(Boolean));
  for (const change of changes) set.add(change);
  return [...set].join('|');
}

function withAndroidConfigChanges(config) {
  return withAndroidManifest(config, mod => {
    const application = mod.modResults.manifest.application?.[0];
    const activity = application?.activity?.find(item => item.$['android:name'] === '.MainActivity');
    if (!activity) throw new Error('Config changes need the .MainActivity declaration');
    activity.$['android:configChanges'] = withConfigChanges(activity.$['android:configChanges']);
    return mod;
  });
}

module.exports = withAndroidConfigChanges;
module.exports.withConfigChanges = withConfigChanges;
