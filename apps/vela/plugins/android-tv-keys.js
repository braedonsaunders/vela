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

  // The control focus was last on. A press that finds a scroll around that control holding focus
  // (Android's scroll takes focus when a press scrolls the focused control away, or finds nothing to
  // move to) puts it back on the control. Focus on nothing is left alone: the player wants that.
  private var velaLastControl: java.lang.ref.WeakReference<android.view.View>? = null

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
    if (!velaNoControl(view)) velaLastControl = java.lang.ref.WeakReference(view!!)
  }

  private fun velaRestoreFocus(focused: android.view.View?): Boolean {
    if (focused !is android.widget.ScrollView && focused !is android.widget.HorizontalScrollView) return false
    val control = velaLastControl?.get() ?: return false
    if (!velaContains(focused, control)) return false
    if (!control.isAttachedToWindow || !control.isShown || !control.isFocusable) return false
    return control.requestFocus()
  }

  // Lazily drawn rows, and a row's cards, are held by a spacer until drawn (LazyRepeat in
  // packages/skin/src/render.tsx), with the native ID vela-lazy-rest-y or -x. Android finds only drawn
  // controls: a Down (or Right) press before the next row (or card) is drawn finds nothing, and the
  // scroll jumps and takes focus. Such a press waits, on the control it was made on, and is made again
  // once a layout has drawn what it moves to; presses made meanwhile add up, a few at most.
  private var velaHeldPresses = 0
  private var velaHeldDirection = android.view.View.FOCUS_DOWN
  private var velaHeldOn: java.lang.ref.WeakReference<android.view.View>? = null

  private fun velaScrollAround(view: android.view.View, direction: Int): android.view.View? {
    var parent = view.parent
    while (parent is android.view.View) {
      if (direction == android.view.View.FOCUS_DOWN && parent is android.widget.ScrollView) return parent
      if (direction == android.view.View.FOCUS_RIGHT && parent is android.widget.HorizontalScrollView) return parent
      parent = parent.parent
    }
    return null
  }

  // The start (top, or left) of each shown spacer with this native ID in the scroll, in its coordinates.
  private fun velaSpacers(scroll: android.view.ViewGroup, id: String, view: android.view.View, y: Boolean, out: MutableList<Int>) {
    if (view !== scroll && view.getTag(com.facebook.react.R.id.view_tag_native_id) == id && view.isShown) {
      val rect = android.graphics.Rect()
      view.getDrawingRect(rect)
      scroll.offsetDescendantRectToMyCoords(view, rect)
      out.add(if (y) rect.top else rect.left)
    }
    if (view is android.view.ViewGroup && (view === scroll || !(y && view is android.widget.HorizontalScrollView))) {
      for (i in 0 until view.childCount) velaSpacers(scroll, id, view.getChildAt(i), y, out)
    }
  }

  private fun velaLazyWaits(focused: android.view.View?, direction: Int): Boolean {
    if (focused == null) return false
    val scroll = velaScrollAround(focused, direction) as? android.view.ViewGroup ?: return false
    val y = direction == android.view.View.FOCUS_DOWN
    val starts = mutableListOf<Int>()
    velaSpacers(scroll, if (y) "vela-lazy-rest-y" else "vela-lazy-rest-x", scroll, y, starts)
    if (starts.isEmpty()) return false
    val from = android.graphics.Rect()
    focused.getDrawingRect(from)
    scroll.offsetDescendantRectToMyCoords(focused, from)
    // Only a spacer past the focused control holds what a press from it moves to.
    val spacer = starts.filter { it >= (if (y) from.bottom else from.right) }.minOrNull() ?: return false
    // As the scroll's own arrow handling finds it: within the scroll.
    val next = android.view.FocusFinder.getInstance().findNextFocus(scroll, focused, direction)
    if (next == null || next === scroll) return true
    val at = android.graphics.Rect()
    next.getDrawingRect(at)
    scroll.offsetDescendantRectToMyCoords(next, at)
    return (if (y) at.top else at.left) >= spacer
  }

  // Drawing ahead follows the scroll, which a waiting press keeps still: the page is asked to draw on.
  private fun velaAskToDraw(direction: Int) {
    val data = com.facebook.react.bridge.Arguments.createMap().apply {
      putString("axis", if (direction == android.view.View.FOCUS_DOWN) "y" else "x")
    }
    reactHost?.currentReactContext?.emitDeviceEvent("velaLazyHeld", data)
  }

  private var velaAskedOn: java.lang.ref.WeakReference<android.view.View>? = null
  private var velaReplayPosted = false

  private fun velaReplayHeld() {
    if (velaHeldPresses == 0) return
    val focused = currentFocus
    if (focused == null || focused !== velaHeldOn?.get()) {
      velaHeldPresses = 0
      return
    }
    if (velaLazyWaits(focused, velaHeldDirection)) {
      // Once per control focus waits on: a replayed press that lands where the next row is not drawn either.
      if (velaAskedOn?.get() !== focused) {
        velaAskedOn = java.lang.ref.WeakReference(focused)
        velaAskToDraw(velaHeldDirection)
      }
      // Looked at again after each layout, and meanwhile every few frames.
      if (!velaReplayPosted) {
        velaReplayPosted = true
        window.decorView.postDelayed({ velaReplayPosted = false; velaReplayHeld() }, 100)
      }
      return
    }
    val scroll = velaScrollAround(focused, velaHeldDirection) as? android.view.ViewGroup
    val next = (if (scroll != null) android.view.FocusFinder.getInstance().findNextFocus(scroll, focused, velaHeldDirection) else null)
      ?: run { velaHeldPresses = 0; return }
    velaHeldPresses--
    if (!next.requestFocus(velaHeldDirection)) {
      velaHeldPresses = 0
      return
    }
    velaHeldOn = java.lang.ref.WeakReference(currentFocus ?: next)
    if (velaHeldPresses > 0) window.decorView.post { velaReplayHeld() }
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
        if (event.action == android.view.KeyEvent.ACTION_DOWN && velaRestoreFocus(focused)) return true
        // A press moves from where focus is on screen: a control focused as its row was drawn may not be
        // there yet (it is brought on screen before the next frame), and the scroll would jump past it.
        if (event.action == android.view.KeyEvent.ACTION_DOWN && (type == "up" || type == "down") && focused != null
          && velaScrollAround(focused, android.view.View.FOCUS_DOWN) != null && focused.width > 0 && focused.height > 0) {
          focused.requestRectangleOnScreen(android.graphics.Rect(0, 0, focused.width, focused.height), true)
        }
        val lazyDirection = when (type) {
          "down" -> android.view.View.FOCUS_DOWN
          "right" -> android.view.View.FOCUS_RIGHT
          else -> null
        }
        if (event.action == android.view.KeyEvent.ACTION_DOWN && (lazyDirection == null || lazyDirection != velaHeldDirection)) velaHeldPresses = 0
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
        if (lazyDirection != null && event.action == android.view.KeyEvent.ACTION_DOWN) {
          if (velaHeldPresses > 0 && focused === velaHeldOn?.get()) {
            velaHeldPresses = minOf(velaHeldPresses + 1, 3)
            velaReplayHeld()
            return true
          }
          if (velaLazyWaits(focused, lazyDirection)) {
            velaHeldPresses = 1
            velaHeldDirection = lazyDirection
            velaHeldOn = java.lang.ref.WeakReference(focused!!)
            velaAskedOn = velaHeldOn
            velaAskToDraw(lazyDirection)
            velaReplayHeld()
            return true
          }
          velaHeldPresses = 0
        }
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
      window.decorView.viewTreeObserver.addOnGlobalLayoutListener { velaReplayHeld() }
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
