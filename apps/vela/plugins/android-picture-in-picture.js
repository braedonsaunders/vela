// Android phones and tablets: the player continues in a picture-in-picture window (the activity's own mode,
// modules/vela-player/android PictureInPicture.kt). The activity declares it, and handles the window's size
// changes itself: without smallestScreenSize and the rest, entering the window would recreate the activity
// and with it the whole React tree. Android TV ignores it (the player never offers the window there).
const { withAndroidManifest } = require('expo/config-plugins');

const CONFIG_CHANGES = ['screenSize', 'smallestScreenSize', 'screenLayout', 'orientation'];

module.exports = function withAndroidPictureInPicture(config) {
  return withAndroidManifest(config, mod => {
    const application = mod.modResults.manifest.application?.[0];
    const activity = application?.activity?.find(item => item.$['android:name'] === '.MainActivity');
    if (!activity) throw new Error('Picture-in-picture needs the .MainActivity declaration');
    activity.$['android:supportsPictureInPicture'] = 'true';
    activity.$['android:resizeableActivity'] = 'true';
    const changes = new Set((activity.$['android:configChanges'] ?? '').split('|').filter(Boolean));
    for (const change of CONFIG_CHANGES) changes.add(change);
    activity.$['android:configChanges'] = [...changes].join('|');
    return mod;
  });
};
