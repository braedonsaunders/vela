// Fonts attached to a Matroska file, which ASS scripts name and Media3's extractor skips. Located through
// the Segment's SeekHead (or met before the first Cluster) and read with one ranged request. Pure: the
// caller supplies the byte reader, so it runs on a plain JVM.
package app.ether.vela.player

internal data class MatroskaAttachment(val name: String, val mimeType: String, val data: ByteArray)

internal object MatroskaAttachments {
  private const val EBML = 0x1A45DFA3L
  private const val SEGMENT = 0x18538067L
  private const val SEEK_HEAD = 0x114D9B74L
  private const val SEEK = 0x4DBBL
  private const val SEEK_ID = 0x53ABL
  private const val SEEK_POSITION = 0x53ACL
  private const val ATTACHMENTS = 0x1941A469L
  private const val ATTACHED_FILE = 0x61A7L
  private const val FILE_NAME = 0x466EL
  private const val FILE_MIME_TYPE = 0x4660L
  private const val FILE_DATA = 0x465CL
  private const val CLUSTER = 0x1F43B675L
  private const val HEAD_BYTES = 64 * 1024
  /** Attachments larger than this are not read (a cover image collection, not fonts). */
  const val MAX_BYTES = 64 * 1024 * 1024

  private val fontTypes = setOf(
    "application/x-truetype-font", "application/x-font-ttf", "application/x-font-otf", "application/x-font",
    "application/vnd.ms-opentype", "application/font-sfnt", "font/ttf", "font/otf", "font/sfnt", "font/collection",
  )

  /** An attached font, by MIME type or by file extension. */
  fun isFont(attachment: MatroskaAttachment): Boolean =
    attachment.mimeType.lowercase() in fontTypes ||
      attachment.name.lowercase().substringAfterLast('.', "") in setOf("ttf", "otf", "ttc", "otc")

  /** The fonts attached to the file `read(position, length)` reads, or empty when there are none. */
  fun fonts(read: (Long, Int) -> ByteArray?): List<MatroskaAttachment> {
    val head = read(0, HEAD_BYTES) ?: return emptyList()
    val ebml = element(head, 0) ?: return emptyList()
    if (ebml.id != EBML) return emptyList()
    val segment = element(head, ebml.end.toInt()) ?: return emptyList()
    if (segment.id != SEGMENT) return emptyList()
    val segmentStart = segment.dataStart
    val position = locate(head, segmentStart) ?: return emptyList()
    val header = read(position, 12) ?: return emptyList()
    val attachments = element(header, 0)?.takeIf { it.id == ATTACHMENTS } ?: return emptyList()
    val size = attachments.size ?: return emptyList()
    if (size > MAX_BYTES) return emptyList()
    val body = read(position + attachments.dataStart, size.toInt()) ?: return emptyList()
    return files(body).filter(::isFont)
  }

  /** The Attachments element's file position: from the SeekHead, or met among the Segment's children. */
  private fun locate(head: ByteArray, segmentStart: Long): Long? {
    var offset = segmentStart.toInt()
    while (offset < head.size) {
      val child = element(head, offset) ?: return null
      when (child.id) {
        ATTACHMENTS -> return offset.toLong()
        CLUSTER -> return null
        SEEK_HEAD -> {
          val end = minOf(child.end, head.size.toLong()).toInt()
          seekEntries(head, child.dataStart.toInt(), end)[ATTACHMENTS]?.let { return segmentStart + it }
        }
      }
      offset = child.end.takeIf { it <= Int.MAX_VALUE }?.toInt() ?: return null
    }
    return null
  }

  private fun seekEntries(data: ByteArray, start: Int, end: Int): Map<Long, Long> {
    val entries = mutableMapOf<Long, Long>()
    each(data, start, end, SEEK) { seekStart, seekEnd ->
      var id: Long? = null
      var position: Long? = null
      children(data, seekStart, seekEnd, null) { element, valueStart, valueEnd ->
        when (element) {
          SEEK_ID -> id = unsigned(data, valueStart, valueEnd)
          SEEK_POSITION -> position = unsigned(data, valueStart, valueEnd)
        }
      }
      if (id != null && position != null) entries[id!!] = position!!
    }
    return entries
  }

  private fun files(body: ByteArray): List<MatroskaAttachment> {
    val files = mutableListOf<MatroskaAttachment>()
    each(body, 0, body.size, ATTACHED_FILE) { start, end ->
      var name = ""
      var mime = ""
      var data: ByteArray? = null
      children(body, start, end, null) { element, valueStart, valueEnd ->
        when (element) {
          FILE_NAME -> name = String(body, valueStart, valueEnd - valueStart, Charsets.UTF_8)
          FILE_MIME_TYPE -> mime = String(body, valueStart, valueEnd - valueStart, Charsets.US_ASCII)
          FILE_DATA -> data = body.copyOfRange(valueStart, valueEnd)
        }
      }
      data?.let { files += MatroskaAttachment(name, mime, it) }
    }
    return files
  }

  private class Element(val id: Long, val size: Long?, val dataStart: Long) {
    /** Unknown-size elements end at the end of what was read. */
    val end: Long get() = dataStart + (size ?: Long.MAX_VALUE / 2)
  }

  /** The element header at `offset` (its ID keeps the marker bits, as Matroska IDs are written). */
  private fun element(data: ByteArray, offset: Int): Element? {
    val (id, idLength) = vint(data, offset, keepMarker = true) ?: return null
    val (size, sizeLength) = vint(data, offset + idLength, keepMarker = false) ?: return null
    val unknown = size == (1L shl (7 * sizeLength)) - 1
    return Element(id, if (unknown) null else size, (offset + idLength + sizeLength).toLong())
  }

  private fun vint(data: ByteArray, offset: Int, keepMarker: Boolean): Pair<Long, Int>? {
    if (offset >= data.size) return null
    val first = data[offset].toInt() and 0xff
    if (first == 0) return null
    val length = Integer.numberOfLeadingZeros(first) - 23
    if (offset + length > data.size) return null
    var value = (if (keepMarker) first else first and (0xff shr length)).toLong()
    for (i in 1 until length) value = (value shl 8) or (data[offset + i].toLong() and 0xff)
    return value to length
  }

  private fun unsigned(data: ByteArray, start: Int, end: Int): Long =
    (start until end).fold(0L) { value, i -> (value shl 8) or (data[i].toLong() and 0xff) }

  /** Calls `visit` with the bounds of each child with `id` inside [start, end). */
  private fun each(data: ByteArray, start: Int, end: Int, id: Long, visit: (Int, Int) -> Unit) =
    children(data, start, end, id) { _, childStart, childEnd -> visit(childStart, childEnd) }

  /** Calls `visit` for each child with `id` (or every child when null) inside [start, end). */
  private fun children(data: ByteArray, start: Int, end: Int, id: Long?, visit: (Long, Int, Int) -> Unit) {
    var offset = start
    while (offset < end) {
      val child = element(data, offset) ?: return
      val size = child.size ?: return
      val childStart = child.dataStart.toInt()
      val childEnd = (child.dataStart + size).takeIf { it <= end }?.toInt() ?: return
      if (id == null || child.id == id) visit(child.id, childStart, childEnd)
      offset = childEnd
    }
  }
}
