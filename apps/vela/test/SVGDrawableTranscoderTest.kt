// Run with expo-image's existing Robolectric setup: copy this file into the installed
// package's android/src/test/java/expo/modules/image/svg directory, then run
// ./gradlew :expo-image:testDebugUnitTest --tests expo.modules.image.svg.SVGDrawableTranscoderTest
// from the generated Android project.
package expo.modules.image.svg

import android.graphics.Color
import com.bumptech.glide.load.Options
import com.bumptech.glide.load.resource.SimpleResource
import com.caverock.androidsvg.SVG
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class SVGDrawableTranscoderTest {
  private val transcoder = SVGDrawableTranscoder(RuntimeEnvironment.getApplication())

  @Test
  fun rasterizesOnceAndPreservesSvgDimensionsForTheLoadEvent() {
    val svg = SVG.getFromString(
      """<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40" viewBox="0 0 40 20">
        <path fill="red" d="M 0 0 H 40 V 20 H 0 Z"/>
      </svg>"""
    )
    val resource = transcoder.transcode(SimpleResource<SVG?>(svg), Options())
    val first = resource.get() as SVGBitmapDrawable
    val second = resource.get() as SVGBitmapDrawable

    assertNotSame(first, second)
    assertSame(first.bitmap, second.bitmap)
    assertEquals(80, first.intrinsicWidth)
    assertEquals(40, first.intrinsicHeight)
    assertEquals(40, first.svgIntrinsicWidth)
    assertEquals(20, first.svgIntrinsicHeight)
    assertEquals(Color.RED, first.bitmap.getPixel(40, 20))
    assertEquals(first.bitmap.allocationByteCount, resource.size)
  }

  @Test
  fun capsPixelCountAndLongestEdge() {
    fun size(width: Int, height: Int): Pair<Int, Int> {
      val svg = SVG.getFromString(
        """<svg xmlns="http://www.w3.org/2000/svg" width="$width" height="$height" viewBox="0 0 $width $height"/>"""
      )
      val drawable = transcoder.transcode(SimpleResource<SVG?>(svg), Options()).get() as SVGBitmapDrawable
      return drawable.bitmap.width to drawable.bitmap.height
    }

    assertEquals(2048 to 2048, size(16_000, 16_000))
    assertEquals(4096 to 512, size(16_000, 2_000))
  }
}
