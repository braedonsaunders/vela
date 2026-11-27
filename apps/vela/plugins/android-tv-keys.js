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

  // A grid's track carries "vela-grid", or "vela-grid-open" while rows are left to draw
  // (packages/skin/src/grid-focus.ts): the track around the view, an open one only if asked.
  private fun velaGrid(view: android.view.View?, open: Boolean): android.view.View? {
    var parent = view?.parent
    while (parent is android.view.View) {
      val id = parent.getTag(com.facebook.react.R.id.view_tag_native_id)
      if (id == "vela-grid-open" || (!open && id == "vela-grid")) return parent
      parent = parent.parent
    }
    return null
  }

  // A grid card focused from JavaScript as its row is drawn can take focus before it is laid out: the
  // scroll then brings an empty box at the grid's top into view, and the card is left off screen, where
  // the next press makes the scroll take focus itself. Before the next frame is drawn with the card laid
  // out, the card is brought on screen.
  private fun velaRevealGridCard(card: android.view.View?) {
    if (card == null || velaGrid(card, false) == null) return
    var frames = 0
    val observer = card.viewTreeObserver
    observer.addOnPreDrawListener(object : android.view.ViewTreeObserver.OnPreDrawListener {
      override fun onPreDraw(): Boolean {
        if (!card.isFocused || frames++ > 60) {
          card.viewTreeObserver.removeOnPreDrawListener(this)
          return true
        }
        if (card.width == 0 || card.height == 0) return true
        card.viewTreeObserver.removeOnPreDrawListener(this)
        return !card.requestRectangleOnScreen(android.graphics.Rect(0, 0, card.width, card.height), true)
      }
    })
  }

  // The grid card focus was last on, until focus moves to a control outside grids. A press that finds
  // the scroll around that card holding focus (Android's scroll takes focus when a press scrolls the
  // focused card away) puts it back on the card. Focus on nothing is left alone: the player wants that.
  private var velaLastGridCard: java.lang.ref.WeakReference<android.view.View>? = null

  private fun velaNoControl(view: android.view.View?): Boolean =
    view == null || view is android.widget.ScrollView || view is com.facebook.react.ReactRootView

  private fun velaContains(ancestor: android.view.View, view: android.view.View): Boolean {
    var parent = view.parent
    while (parent is android.view.View) {
      if (parent === ancestor) return true
      parent = parent.parent
    }
    return false
  }

  private fun velaNoteFocus(view: android.view.View?) {
    if (view != null && velaGrid(view, false) != null) velaLastGridCard = java.lang.ref.WeakReference(view)
    else if (!velaNoControl(view)) velaLastGridCard = null
  }

  private fun velaRestoreGridFocus(focused: android.view.View?): Boolean {
    if (focused !is android.widget.ScrollView) return false
    val card = velaLastGridCard?.get() ?: return false
    if (!velaContains(focused, card)) return false
    if (!card.isAttachedToWindow || !card.isShown || !card.isFocusable) return false
    return card.requestFocus()
  }

  // Down from a card of such a grid whose next card down is not drawn yet: Android would take focus out
  // of the grid (to what lies past it, or to the scroll itself), so the press stays on the card and the
  // grid moves focus once the row is drawn.
  private fun isVelaGridHeld(focused: android.view.View?): Boolean {
    val grid = velaGrid(focused, true) ?: return false
    var next: Any? = focused?.focusSearch(android.view.View.FOCUS_DOWN)
    while (next is android.view.View) {
      if (next === grid) return false
      next = next.parent
    }
    return true
  }

  private fun isVelaTelevision(): Boolean =
     (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_TYPE_MASK) ==
      android.content.res.Configuration.UI_MODE_TYPE_TELEVISION
  override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
    if (isVelaTelevision() && (event.action == android.view.KeyEvent.ACTION_DOWN || event.action == android.view.KeyEvent.ACTION_UP)) {
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
        if (event.action == android.view.KeyEvent.ACTION_DOWN && velaRestoreGridFocus(focused)) return true
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
        val gridHeld = type == "down" && event.action == android.view.KeyEvent.ACTION_DOWN && isVelaGridHeld(focused)
        val data = com.facebook.react.bridge.Arguments.createMap().apply {
          putString("eventType", type)
          putInt("eventKeyAction", event.action)
          // What has native focus as the press arrives: the testID of the focused view, "" for a
          // view without one, "none" when nothing is focused. The player acts on presses that no
          // control will take (the picture is focused) without trusting a re-rendered flag.
          putInt("repeatCount", event.repeatCount)
          if (hero && focused != null) putInt("heroTag", focused.id)
          putBoolean("withinHero", withinHero)
          if (gridHeld && focused != null) {
            putBoolean("gridHeld", true)
            putInt("focusTag", focused.id)
          }
          putString("focus", if (focused == null) "none" else (focused.getTag(com.facebook.react.R.id.react_test_id) as? String) ?: "")
        }
        reactHost?.currentReactContext?.emitDeviceEvent("velaAndroidTVKey", data)
        if (hero) {
          if (withinHero) next?.requestFocus(heroDirection!!)
          return true
        }
        if (gridHeld) return true
      }
    }
    return super.dispatchKeyEvent(event)
  }
`;
    mod.modResults.contents = mod.modResults.contents.replace('class MainActivity : ReactActivity() {', 'class MainActivity : ReactActivity() {\n' + code);
    const superCreate = /^(\s*)super\.onCreate\([^)]*\)\s*$/m;
    if (!superCreate.test(mod.modResults.contents)) throw new Error('MainActivity.onCreate has no super.onCreate call');
    const openingFocus = `    if (isVelaTelevision()) {
      window.decorView.viewTreeObserver.addOnGlobalFocusChangeListener { _, focused ->
        velaNoteFocus(focused)
        velaRevealGridCard(focused)
      }
    }
    // A physical keyboard can make Android focus the first button as the tree mounts.
    if (!isVelaTelevision()) {
      findViewById<android.view.ViewGroup>(android.R.id.content)?.apply {
        isFocusableInTouchMode = true
        requestFocus()
      }
    }`;
    mod.modResults.contents = mod.modResults.contents.replace(superCreate, match => `${match}\n${openingFocus}`);
    return mod;
  });
};
