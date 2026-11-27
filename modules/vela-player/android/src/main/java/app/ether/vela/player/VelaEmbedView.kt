package app.ether.vela.player

// VelaEmbedView (Android phones and tablets): one embedded web player, a trailer in YouTube's
// privacy-enhanced embed, in a WebView. The app hands it a host page (packages/core/src/trailer-embed.ts
// nativeEmbedPage), the origin that page loads under, and the one player frame it frames. The main frame
// never navigates after the host page; no window opens; files, content URIs, geolocation and third-party
// cookies are off. Messages the host page's script posts reach JavaScript as onEmbedMessage. TVs never
// embed (the app does not mount this view there). The WebView is destroyed with the view.

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

class VelaEmbedModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VelaEmbed")
    View(VelaEmbedView::class) {
      Events("onEmbedMessage", "onEmbedFailure")
      Prop("page") { view: VelaEmbedView, value: String? -> view.page = value.orEmpty() }
      Prop("pageOrigin") { view: VelaEmbedView, value: String? -> view.pageOrigin = value.orEmpty() }
      Prop("frameUrl") { view: VelaEmbedView, value: String? -> view.frameUrl = value.orEmpty() }
      OnViewDidUpdateProps { view: VelaEmbedView -> view.load() }
      OnViewDestroys { view: VelaEmbedView -> view.destroy() }
    }
  }
}

/** Where a frame may go: scheme, host, port and path. */
internal data class EmbedFrameRule(val scheme: String, val host: String, val port: Int, val path: String) {
  fun sameOrigin(other: EmbedFrameRule) = scheme == other.scheme && host == other.host && port == other.port

  companion object {
    fun of(value: String?): EmbedFrameRule? {
      val uri = runCatching { Uri.parse(value ?: return null) }.getOrNull() ?: return null
      val scheme = uri.scheme?.lowercase() ?: return null
      if (scheme != "https" && scheme != "http") return null
      val host = uri.host?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
      if (uri.userInfo != null) return null
      return EmbedFrameRule(scheme, host, uri.port, uri.path.orEmpty())
    }
  }
}

@SuppressLint("SetJavaScriptEnabled", "ViewConstructor")
internal class VelaEmbedView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true
  private val onEmbedMessage by EventDispatcher<Map<String, Any?>>()
  private val onEmbedFailure by EventDispatcher<Map<String, Any?>>()
  var page = ""
  var pageOrigin = ""
  var frameUrl = ""
  private var loaded: List<String>? = null
  private var player: EmbedFrameRule? = null
  private var failed = false
  private var destroyed = false
  private val main = Handler(Looper.getMainLooper())
  private var web: WebView? = null

  init {
    setBackgroundColor(Color.BLACK)
  }

  private fun webView(): WebView = web ?: WebView(context).also { view ->
    view.setBackgroundColor(Color.BLACK)
    view.isVerticalScrollBarEnabled = false
    view.isHorizontalScrollBarEnabled = false
    with(view.settings) {
      javaScriptEnabled = true
      domStorageEnabled = true
      mediaPlaybackRequiresUserGesture = false
      allowFileAccess = false
      allowContentAccess = false
      setSupportMultipleWindows(false)
      javaScriptCanOpenWindowsAutomatically = false
      setGeolocationEnabled(false)
      mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
      setSupportZoom(false)
    }
    CookieManager.getInstance().setAcceptThirdPartyCookies(view, false)
    view.webChromeClient = WebChromeClient()
    view.webViewClient = Client()
    // Injected into every frame of this view (Android cannot scope it to the main frame), so it only
    // relays short strings, which JavaScript reads strictly (parseEmbedMessage).
    view.addJavascriptInterface(Bridge(), "VelaEmbed")
    addView(view, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    web = view
  }

  fun load() {
    if (destroyed) return
    val next = listOf(page, pageOrigin, frameUrl)
    if (loaded == next) return
    val host = EmbedFrameRule.of(pageOrigin)?.takeIf { it.path.isEmpty() || it.path == "/" }
    val player = EmbedFrameRule.of(frameUrl)?.takeIf { it.path.startsWith("/embed/") }
    if (page.isEmpty() || host == null || player == null) {
      fail("invalid")
      return
    }
    loaded = next
    this.player = player
    failed = false
    val port = if (host.port == -1) "" else ":${host.port}"
    webView().loadDataWithBaseURL("${host.scheme}://${host.host}$port/", page, "text/html", "utf-8", null)
  }

  fun destroy() {
    if (destroyed) return
    destroyed = true
    main.removeCallbacksAndMessages(null)
    web?.let { view ->
      view.stopLoading()
      view.removeJavascriptInterface("VelaEmbed")
      removeView(view)
      view.destroy()
    }
    web = null
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    web?.layout(0, 0, right - left, bottom - top)
  }

  private fun fail(reason: String) {
    if (failed || destroyed) return
    failed = true
    onEmbedFailure(mapOf("reason" to reason))
  }

  private inner class Bridge {
    @JavascriptInterface
    fun postMessage(data: String?) {
      if (data == null || data.length > 65_536) return
      main.post { if (!destroyed) onEmbedMessage(mapOf("data" to data)) }
    }
  }

  private inner class Client : WebViewClient() {
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
      // The host page is loaded as data and never reaches here: any other main-frame navigation (a
      // link out to YouTube) stays put. A subframe may load the player only.
      if (request.isForMainFrame) return true
      val rule = EmbedFrameRule.of(request.url.toString())
      return rule == null || rule != player
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
      if (request.isForMainFrame) fail("load")
    }

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
      // The renderer is gone: this WebView cannot be used again, but the app lives on.
      fail("terminated")
      if (web === view) {
        removeView(view)
        view.destroy()
        web = null
        loaded = null
      }
      return true
    }
  }
}
