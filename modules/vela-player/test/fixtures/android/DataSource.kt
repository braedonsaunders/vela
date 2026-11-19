package androidx.media3.datasource
import android.net.Uri
class DataSpec(val uri: Uri, val position: Long = 0, val length: Long = -1)
interface DataSource {
  fun open(dataSpec: DataSpec): Long
  fun read(buffer: ByteArray, offset: Int, length: Int): Int
  fun close()
  fun getUri(): Uri?
  fun getResponseHeaders(): Map<String, List<String>>
  interface Factory { fun createDataSource(): DataSource }
}
abstract class BaseDataSource(network: Boolean) : DataSource {
  fun transferInitializing(spec: DataSpec) {}
  fun transferStarted(spec: DataSpec) {}
  fun transferEnded() {}
  fun bytesTransferred(count: Int) {}
}
