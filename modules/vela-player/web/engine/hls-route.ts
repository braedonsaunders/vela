// Which player takes an HLS source. Vela's own players come first: the packet runtime (vela-core:
// WebCodecs decode, WebGPU presentation), then the segment pipeline (MSE). The browser's own
// <video> HLS is the last resort: stricter about what it parses, and without Vela's recovery,
// live latency control or timeline.
//
// The packet runtime needs a secure context (https or localhost): WebCodecs and WebGPU do not
// exist on a plain-http LAN address. MSE does, so such a page plays through the segment pipeline,
// which reads the codecs from the init segment when the plan offers no ladder (Ether's live
// remux). Safari's own HLS stays first there when the pipeline would add nothing.

export type HlsBackend = 'packet' | 'mse' | 'native';

export interface HlsRouteFacts {
  /** The bundle offers the packet runtime for this kind of session (live or on-demand HLS). */
  packetOffered: boolean;
  /** This page can run it: a secure context with WebGPU, WebCodecs frames and workers. */
  packetCapable: boolean;
  /** Recovery already moved this route off the packet runtime, or off the segment pipeline. */
  packetFailed: boolean;
  segmentsFailed: boolean;
  /** MediaSource (or ManagedMediaSource) exists. */
  mediaSource: boolean;
  /** The <video> element plays HLS itself. */
  nativeHls: boolean;
  /** Safari (Apple's own HLS), and whether it offers ManagedMediaSource. */
  apple: boolean;
  managedMediaSource: boolean;
  /** The plan's ladder: whether each rendition's codecs are known, and if so whether MSE takes them. */
  renditions: { known: boolean; supported: boolean }[];
}

/** The player for an HLS source, or null when this browser has none. */
export function hlsBackend(facts: HlsRouteFacts): HlsBackend | null {
  if (facts.packetOffered && facts.packetCapable && !facts.packetFailed) return 'packet';
  const segments = facts.mediaSource && !facts.segmentsFailed;
  if (!facts.renditions.length) {
    // No ladder: the pipeline reads the stream's own init. Safari's HLS plays such a stream as well.
    if (facts.nativeHls && (facts.apple || !segments)) return 'native';
    return segments ? 'mse' : null;
  }
  const segmented = segments && facts.renditions.some((r) => !r.known || r.supported);
  const pending = facts.renditions.some((r) => !r.known);
  if (facts.nativeHls && (!segmented || (facts.apple && !facts.managedMediaSource && !pending))) return 'native';
  return segmented ? 'mse' : null;
}
