// React Native's bridgeless Android surface does not reliably forward hardware presses to
// useTVEventHandler. Capture at the activity, before native focus consumes the arrows, and
// leave normal dispatch (including BackHandler and button presses) intact. Phone remote apps send
// the same D-pad and media keys as the remote; Enter, the numeric pad's Enter and the headset
// hook stand for select and play/pause, the skip keys for the ten-second steps.
const { withMainActivity } = require('expo/config-plugins');

module.exports = function withAndroidTVKeys(config) {
  return withMainActivity(config, mod => {
    if (mod.modResults.language !== 'kt') throw new Error('Android TV keys require a Kotlin MainActivity');
    const marker = '  // Vela Android TV hardware events';
    if (mod.modResults.contents.includes(marker)) return mod;
    const code = `${marker}
  private fun isVelaHeroButton(view: android.view.View?): Boolean {
    val id = view?.getTag(com.facebook.react.R.id.view_tag_native_id) as? String
    return id?.startsWith("vela-hero-action:") == true
  }

  override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
    val tv = (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_TYPE_MASK) ==
      android.content.res.Configuration.UI_MODE_TYPE_TELEVISION
    if (tv && (event.action == android.view.KeyEvent.ACTION_DOWN || event.action == android.view.KeyEvent.ACTION_UP)) {
      val type = when (event.keyCode) {
        android.view.KeyEvent.KEYCODE_DPAD_UP -> "up"
        android.view.KeyEvent.KEYCODE_DPAD_DOWN -> "down"
        android.view.KeyEvent.KEYCODE_DPAD_LEFT -> "left"
        android.view.KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
        android.view.KeyEvent.KEYCODE_DPAD_CENTER, android.view.KeyEvent.KEYCODE_ENTER,
        android.view.KeyEvent.KEYCODE_NUMPAD_ENTER -> "select"
        android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, android.view.KeyEvent.KEYCODE_HEADSETHOOK -> "playPause"
        android.view.KeyEvent.KEYCODE_MEDIA_PLAY -> "play"
        android.view.KeyEvent.KEYCODE_MEDIA_PAUSE, android.view.KeyEvent.KEYCODE_MEDIA_STOP -> "pause"
        android.view.KeyEvent.KEYCODE_MEDIA_REWIND, android.view.KeyEvent.KEYCODE_MEDIA_SKIP_BACKWARD -> "rewind"
        android.view.KeyEvent.KEYCODE_MEDIA_FAST_FORWARD, android.view.KeyEvent.KEYCODE_MEDIA_SKIP_FORWARD -> "fastForward"
        android.view.KeyEvent.KEYCODE_CHANNEL_UP -> "channelUp"
        android.view.KeyEvent.KEYCODE_CHANNEL_DOWN -> "channelDown"
        else -> null
      }
      if (type != null) {
        val focused = currentFocus
        val heroDirection = when (type) {
          "left" -> android.view.View.FOCUS_LEFT
          "right" -> android.view.View.FOCUS_RIGHT
          else -> null
        }
        val hero = heroDirection != null && isVelaHeroButton(focused)
        val next = if (hero && event.action == android.view.KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
          focused?.focusSearch(heroDirection!!)
        } else null
        val withinHero = next !== focused && isVelaHeroButton(next)
        val data = com.facebook.react.bridge.Arguments.createMap().apply {
          putString("eventType", type)
          putInt("eventKeyAction", event.action)
          // What has native focus as the press arrives: the testID of the focused view, "" for a
          // view without one, "none" when nothing is focused. The player acts on presses that no
          // control will take (the picture is focused) without trusting a re-rendered flag.
          putInt("repeatCount", event.repeatCount)
          if (hero && focused != null) putInt("heroTag", focused.id)
          putBoolean("withinHero", withinHero)
          putString("focus", if (focused == null) "none" else (focused.getTag(com.facebook.react.R.id.react_test_id) as? String) ?: "")
        }
        reactHost?.currentReactContext?.emitDeviceEvent("velaAndroidTVKey", data)
        if (hero) {
          if (withinHero) next?.requestFocus(heroDirection!!)
          return true
        }
      }
    }
    return super.dispatchKeyEvent(event)
  }
`;
    mod.modResults.contents = mod.modResults.contents.replace('class MainActivity : ReactActivity() {', 'class MainActivity : ReactActivity() {\n' + code);
    return mod;
  });
};
