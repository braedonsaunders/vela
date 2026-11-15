/** Pinned MIT engine adaptation: decode seek preroll for references, but never
 * present it or start the audio clock until a frame covers the requested time. */
export function transformUpstreamVideo(path: string, source: string): string | null {
  if (!path.replaceAll('\\','/').endsWith('/pipeline/CustomDecodeSession.ts')) return null;
  const before = '        this.queueDecodedFrame(generationRecord, presentationFrame);\n        this.recordDolbyVisionMetadata(presentationFrame.dolbyVision?.encodedMetadata);';
  if (source.split(before).length !== 2) throw new Error('Pinned frame-pool preroll hook anchor changed');
  return source.replace(before,
    '        if (presentationFrame.mediaTimeMicroseconds + presentationFrame.durationMicroseconds <= generationRecord.startTimeMicroseconds) {\n' +
    '            this.gpuVideoDecodeFeed?.releaseFrame(presentationFrame);\n' +
    '            return;\n' +
    '        }\n' + before);
}
