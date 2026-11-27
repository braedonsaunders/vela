// The render tier: a lighter render of the same look for TV hardware that cannot keep up with the full one
// (the lab's tx1-box: Allwinner H313, four Cortex-A53 cores, 32-bit userland, 2 GB, Android's low-RAM flag,
// a 720p UI). It is chosen from what the device is, never from a model list. Pure; the app reads the facts
// (deviceProfile in @vela/player) and puts the tier in its environment.

export type RenderTier = 'full' | 'lite';

export interface DeviceFacts {
  /** A TV device (Platform.isTV). Phones, tablets and desktops always render in full. */
  tv: boolean;
  /** Physical memory, MiB (0 or absent when unknown). */
  totalMemoryMiB?: number;
  /** Android's own judgement (ActivityManager.isLowRamDevice): the strongest signal there is. */
  lowRam?: boolean;
  /** Every core an in-order efficiency design (Cortex-A53, A55 ...). */
  littleCoresOnly?: boolean;
  /** The fastest core's top clock, MHz (0 or absent when unknown). */
  maxCpuMHz?: number;
  /** A 64-bit userland: false for 32-bit-only boxes, whose JavaScript engine runs slower. */
  is64Bit?: boolean;
  /** The screen in physical pixels (its longer side decides). */
  screenPixels?: { width: number; height: number };
}

/** A 2 GB class device (2 GB boxes report about 1.8 to 1.9 GiB). */
const SMALL_MEMORY_MIB = 2560;
/** At or under this, memory alone decides. */
const TINY_MEMORY_MIB = 1536;
/** A 720p UI. */
const LOW_RES_PIXELS = 1280;
const SLOW_CPU_MHZ = 1500;

export function renderTier(facts: DeviceFacts): RenderTier {
  if (!facts.tv) return 'full';
  if (facts.lowRam) return 'lite';
  const memory = facts.totalMemoryMiB ?? 0;
  if (memory > 0 && memory <= TINY_MEMORY_MIB) return 'lite';
  const small = memory > 0 && memory <= SMALL_MEMORY_MIB;
  const slowCpu = facts.littleCoresOnly === true || ((facts.maxCpuMHz ?? 0) > 0 && (facts.maxCpuMHz ?? 0) <= SLOW_CPU_MHZ);
  const screen = facts.screenPixels;
  const lowRes = !!screen && Math.max(screen.width, screen.height) <= LOW_RES_PIXELS;
  // A 2 GB box on efficiency cores that is also 32-bit or drives a 720p UI: the budget end. A 2 GB box
  // with big cores (a SHIELD) or a 64-bit 1080p stick keeps the full render.
  return small && slowCpu && (facts.is64Bit === false || lowRes) ? 'lite' : 'full';
}

/** The device facts from the native profile (deviceProfile); unknown fields stay absent. */
export function deviceFacts(tv: boolean, profile: Record<string, unknown> | null, screenPixels?: { width: number; height: number }): DeviceFacts {
  const number = (key: string) => (typeof profile?.[key] === 'number' ? profile[key] as number : undefined);
  const flag = (key: string) => (typeof profile?.[key] === 'boolean' ? profile[key] as boolean : undefined);
  return {
    tv,
    totalMemoryMiB: number('totalMemoryMiB'),
    lowRam: flag('lowRam'),
    littleCoresOnly: flag('littleCoresOnly'),
    maxCpuMHz: number('maxCpuMHz'),
    is64Bit: flag('is64Bit'),
    screenPixels,
  };
}
