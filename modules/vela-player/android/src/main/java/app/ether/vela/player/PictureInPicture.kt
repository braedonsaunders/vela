// Picture-in-picture on Android phones and tablets: the activity's own picture-in-picture mode, showing the
// full-screen player's video alone (VelaPlayerView moves its picture above the app while it lasts). The view
// that plays full screen owns it; the window takes the video's shape, carries play/pause as remote actions,
// and is entered by the player's button or, while playing, by leaving the app with the home gesture.
// Android TV leaves a watch with Home instead, so it never offers it.
package app.ether.vela.player

import android.app.Activity
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Rect
import android.graphics.drawable.Icon
import android.os.Build
import android.util.Log
import android.util.Rational
import androidx.core.app.OnPictureInPictureModeChangedProvider
import androidx.core.app.PictureInPictureModeChangedInfo
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import java.lang.ref.WeakReference
import java.util.WeakHashMap

internal object PictureInPicture {
  private const val ACTION = "app.ether.vela.player.PICTURE_IN_PICTURE"
  private const val CONTROL = "control"

  private var owner: WeakReference<VelaPlayerView>? = null
  private var playing = false
  private var receiver: BroadcastReceiver? = null
  private val watched = WeakHashMap<Activity, Boolean>()

  /** Whether `activity` can show the player in picture-in-picture: a phone or tablet that has the feature. */
  fun supported(activity: Activity?): Boolean {
    if (activity == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
    val feature = hasFeature ?: activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE).also { hasFeature = it }
    val television = activity.resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK == Configuration.UI_MODE_TYPE_TELEVISION
    return feature && !television
  }
  private var hasFeature: Boolean? = null

  /** Whether the activity shows `view` in picture-in-picture now. */
  fun showing(view: VelaPlayerView, activity: Activity?): Boolean =
    owner?.get() === view && active(activity)

  fun active(activity: Activity?): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && activity?.isInPictureInPictureMode == true

  /** `view` plays full screen: its state decides the window's shape, actions and whether Home enters it. */
  fun claim(view: VelaPlayerView, activity: Activity?) {
    if (owner?.get() !== view) { owner = WeakReference(view); playing = false }
    activity ?: return
    watch(activity)
  }

  /** `view` no longer plays full screen: Home leaves the app as usual. */
  fun release(view: VelaPlayerView, activity: Activity?) {
    if (owner?.get() !== view) return
    owner = null
    playing = false
    if (supported(activity) && !active(activity)) apply(activity!!, params(activity, false, 0, 0, null, autoEnter = false))
  }

  /** The owner's state changed: the window's ratio, its play/pause action, and auto-enter (Android 12+). */
  fun update(view: VelaPlayerView, activity: Activity?, playing: Boolean, width: Int, height: Int, hint: Rect?) {
    if (owner?.get() !== view || !supported(activity)) return
    this.playing = playing
    apply(activity!!, params(activity, playing, width, height, hint, autoEnter = playing))
  }

  /** The player's button: null when the window opened, else why not. */
  fun enter(view: VelaPlayerView, activity: Activity?, width: Int, height: Int, hint: Rect?): String? {
    if (owner?.get() !== view || !supported(activity)) return "Picture-in-picture is unavailable"
    return try {
      if (activity!!.enterPictureInPictureMode(params(activity, playing, width, height, hint, autoEnter = playing))) null
      else "Picture-in-picture is unavailable"
    } catch (error: IllegalStateException) {
      Log.w("vela-media3", "picture-in-picture refused: ${error.message}")
      "Picture-in-picture is unavailable"
    }
  }

  /** Home before Android 12 (no auto-enter): a playing full-screen video goes on in the window. */
  fun userLeaving(activity: Activity?) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S || !playing) return
    val view = owner?.get() ?: return
    if (supported(activity) && !active(activity)) view.enterPictureInPicture()
  }

  private fun apply(activity: Activity, params: PictureInPictureParams) {
    runCatching { activity.setPictureInPictureParams(params) }
      .onFailure { Log.w("vela-media3", "picture-in-picture params refused: ${it.message}") }
  }

  private fun params(activity: Activity, playing: Boolean, width: Int, height: Int, hint: Rect?, autoEnter: Boolean): PictureInPictureParams {
    val builder = PictureInPictureParams.Builder()
    PictureInPictureShape.ratio(width, height)?.let { (w, h) -> builder.setAspectRatio(Rational(w, h)) }
    hint?.takeIf { !it.isEmpty }?.let { builder.setSourceRectHint(it) }
    builder.setActions(listOf(action(activity, playing)))
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) builder.setAutoEnterEnabled(autoEnter).setSeamlessResizeEnabled(false)
    return builder.build()
  }

  private fun action(context: Context, playing: Boolean): RemoteAction {
    val control = if (playing) "pause" else "play"
    val intent = Intent(ACTION).setPackage(context.packageName).putExtra(CONTROL, control)
    val pending = PendingIntent.getBroadcast(context, if (playing) 1 else 2, intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val icon = Icon.createWithResource(context, if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play)
    val label = if (playing) "Pause" else "Play"
    return RemoteAction(icon, label, label, pending)
  }

  /** The window's play/pause actions, and the activity entering and leaving picture-in-picture. */
  private fun watch(activity: Activity) {
    if (receiver == null) {
      val heard = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
          owner?.get()?.pictureInPictureControl(intent.getStringExtra(CONTROL) ?: return)
        }
      }
      val filter = IntentFilter(ACTION)
      val context = activity.applicationContext
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) context.registerReceiver(heard, filter, Context.RECEIVER_NOT_EXPORTED)
      else @Suppress("UnspecifiedRegisterReceiverFlag") context.registerReceiver(heard, filter)
      receiver = heard
    }
    if (watched.containsKey(activity)) return
    val provider = activity as? OnPictureInPictureModeChangedProvider ?: return
    watched[activity] = true
    provider.addOnPictureInPictureModeChangedListener { info: PictureInPictureModeChangedInfo ->
      // Closing the window stops the activity first; expanding it starts it again.
      val closed = !info.isInPictureInPictureMode &&
        (activity as? LifecycleOwner)?.lifecycle?.currentState == Lifecycle.State.CREATED
      owner?.get()?.pictureInPictureChanged(info.isInPictureInPictureMode, closed)
    }
  }
}
