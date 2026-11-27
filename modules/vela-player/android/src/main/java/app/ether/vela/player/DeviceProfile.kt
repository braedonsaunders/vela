// What the device is, for the app's render tier (packages/skin device-tier.ts): memory, Android's own low-RAM
// flag, the CPU's cores, clock and class, and whether the userland is 64-bit. Read once per process; cheap.
package app.ether.vela.player

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import java.io.File

internal object DeviceProfile {
  private var cached: Map<String, Any>? = null

  fun read(context: Context?): Map<String, Any> = cached ?: probe(context).also { if (context != null) cached = it }

  private fun probe(context: Context?): Map<String, Any> {
    val manager = context?.getSystemService(ActivityManager::class.java)
    val memory = ActivityManager.MemoryInfo().also { manager?.getMemoryInfo(it) }
    val parts = cpuParts()
    return mapOf(
      "totalMemoryMiB" to (memory.totalMem / (1024 * 1024)).toInt(),
      "lowRam" to (manager?.isLowRamDevice == true),
      "memoryClassMiB" to (manager?.memoryClass ?: 0),
      "cores" to Runtime.getRuntime().availableProcessors(),
      "maxCpuMHz" to maxCpuMHz(),
      // Every core an in-order efficiency design (Cortex-A7/A35/A53/A55/A510/A520): no big core to lean on.
      "littleCoresOnly" to (parts.isNotEmpty() && parts.all { it in LITTLE }),
      "is64Bit" to Build.SUPPORTED_64_BIT_ABIS.isNotEmpty(),
      "sdk" to Build.VERSION.SDK_INT,
    )
  }

  /** ARM "CPU part" numbers of in-order little cores. */
  private val LITTLE = setOf(0xc07, 0xd04, 0xd03, 0xd05, 0xd46, 0xd80)

  private fun cpuParts(): List<Int> = runCatching {
    File("/proc/cpuinfo").readLines().filter { it.startsWith("CPU part") }
      .mapNotNull { it.substringAfter(':').trim().removePrefix("0x").toIntOrNull(16) }
  }.getOrDefault(emptyList())

  private fun maxCpuMHz(): Int = runCatching {
    File("/sys/devices/system/cpu").listFiles { file -> file.name.matches(Regex("cpu\\d+")) }.orEmpty()
      .mapNotNull { File(it, "cpufreq/cpuinfo_max_freq").takeIf(File::canRead)?.readText()?.trim()?.toIntOrNull() }
      .maxOrNull()?.div(1000) ?: 0
  }.getOrDefault(0)
}
