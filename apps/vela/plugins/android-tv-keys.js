// React Native's bridgeless Android surface does not reliably forward hardware presses to
// useTVEventHandler. Capture at the activity, before native focus consumes the arrows, and
// leave normal dispatch (including BackHandler and button presses) intact.
const { withMainActivity } = require('expo/config-plugins');

module.exports = function withAndroidTVKeys(config) {
  return withMainActivity(config, mod => {
    if (mod.modResults.language !== 'kt') throw new Error('Android TV keys require a Kotlin MainActivity');
    const marker = '  // Vela Android TV hardware events';
    if (mod.modResults.contents.includes(marker)) return mod;
    const code = `${marker}
  override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
    val tv = (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_TYPE_MASK) ==
      android.content.res.Configuration.UI_MODE_TYPE_TELEVISION
    if (tv && (event.action == android.view.KeyEvent.ACTION_DOWN || event.action == android.view.KeyEvent.ACTION_UP)) {
      val type = when (event.keyCode) {
        android.view.KeyEvent.KEYCODE_DPAD_UP -> "up"
        android.view.KeyEvent.KEYCODE_DPAD_DOWN -> "down"
        android.view.KeyEvent.KEYCODE_DPAD_LEFT -> "left"
        android.view.KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
        android.view.KeyEvent.KEYCODE_DPAD_CENTER, android.view.KeyEvent.KEYCODE_ENTER -> "select"
        android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> "playPause"
        android.view.KeyEvent.KEYCODE_MEDIA_PLAY -> "play"
        android.view.KeyEvent.KEYCODE_MEDIA_PAUSE -> "pause"
        android.view.KeyEvent.KEYCODE_MEDIA_REWIND -> "rewind"
        android.view.KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> "fastForward"
        android.view.KeyEvent.KEYCODE_CHANNEL_UP -> "channelUp"
        android.view.KeyEvent.KEYCODE_CHANNEL_DOWN -> "channelDown"
        else -> null
      }
      if (type != null) {
        val data = com.facebook.react.bridge.Arguments.createMap().apply {
          putString("eventType", type)
          putInt("eventKeyAction", event.action)
        }
        reactHost?.currentReactContext?.emitDeviceEvent("velaAndroidTVKey", data)
      }
    }
    return super.dispatchKeyEvent(event)
  }
`;
    mod.modResults.contents = mod.modResults.contents.replace('class MainActivity : ReactActivity() {', 'class MainActivity : ReactActivity() {\n' + code);
    return mod;
  });
};
