/** Source-complete build adaptation; the pinned MPL library stays pristine. */
export function transformCoreDemux(path: string, source: string): string | null {
  const normalized = path.replaceAll('\\', '/');
  if (normalized.endsWith('/mediabunny/src/cursors.ts')) {
    // These narrow the base cursor's track type only. A runtime field would
    // overwrite the track assigned by super() when Bun builds the workers.
    let result = source;
    for (const type of ['InputVideoTrack', 'InputAudioTrack']) {
      const field = `override track!: ${type};`;
      if (result.split(field).length !== 2) throw new Error('Pinned cursor track declaration changed');
      result = result.replace(field, `declare track: ${type};`);
    }
    return result;
  }
  if (normalized.endsWith('/src/matroska/matroska-demuxer.ts')) {
    const anchor = 'segment.lastReadCluster = cluster;';
    const cues = 'segment.deferredCuesPosition !== null && searchTimestamp > this.internalTrack.codecDelay';
    const method =
      'async readCluster(res: ResultValue<Cluster>, startPos: number, segment: Segment): MaybeRelevantPromise {';
    const fast =
      'if (segment.lastReadCluster?.elementStartPos === startPos) {\n\t\t\treturn res.set(segment.lastReadCluster);\n\t\t}';
    const lookup =
      'if (startOffset !== null && segment.lastReadCluster?.elementStartPos === startOffset) {\n\t\t\tstartCluster = segment.lastReadCluster;';
    if ([anchor, cues, method, fast, lookup].some((value) => source.split(value).length !== 2))
      throw new Error('Pinned Matroska cluster tap changed');
    const module = JSON.stringify(new URL('./subtitle-stream.ts', import.meta.url).pathname);
    const cache = JSON.stringify(new URL('./cluster-cache.ts', import.meta.url).pathname);
    let result =
      `import {publishSubtitleCluster} from ${module};\nimport {cachedCluster,loadCluster} from ${cache};\n` +
      source
        .replace(
          method,
          method +
            `
        const cluster = await loadCluster(this,this.input._rootSource,startPos,async()=>{
          const result = new ResultValue<Cluster>();
          await this.readUncachedVelaCluster(result,startPos,segment);
          return result.value;
        },cluster=>({sourceBytes:cluster.elementEndPos-cluster.elementStartPos,
          blocks:[...cluster.trackData.values()].reduce((sum,track)=>sum+track.blocks.length,0),
          release:()=>{if(segment.lastReadCluster===cluster)segment.lastReadCluster=null;}}));
        return res.set(cluster);
      }
      private async readUncachedVelaCluster(res: ResultValue<Cluster>, startPos: number, segment: Segment): MaybeRelevantPromise {`,
        )
        .replace(fast, '')
        .replace(
          lookup,
          'const retainedCluster = startOffset === null ? null : cachedCluster<Cluster>(demuxer,startOffset);\n        if (retainedCluster) {\n            startCluster = retainedCluster;',
        )
        .replace(
          cues,
          'segment.deferredCuesPosition !== null && startOffset === null && searchTimestamp > this.internalTrack.codecDelay',
        )
        .replace(
          anchor,
          `
        if (dataSlice) {
          let subtitleClusterEnd = cluster.timestamp;
          for (const trackData of cluster.trackData.values()) subtitleClusterEnd = Math.max(subtitleClusterEnd, trackData.endTimestamp);
        publishSubtitleCluster(this.input._rootSource, elementStartPos, dataStartPos,
          readBytes(dataSlice.slice(dataStartPos, cluster.elementEndPos - dataStartPos), cluster.elementEndPos - dataStartPos),
          cluster.timestamp / segment.timestampFactor, subtitleClusterEnd / segment.timestampFactor);
        }
        ` + anchor,
        );
    const streamModule = JSON.stringify(new URL('./matroska-stream.ts', import.meta.url).pathname);
    result =
      `import {parseDtsFrame,parseAc3SyncFrame,parseEac3SyncFrame} from '../codec-data';\nimport {parseAacAudioSpecificConfig} from '../../shared/aac-misc';\nconst velaAudioFrameParsers={dts:parseDtsFrame,ac3:parseAc3SyncFrame,eac3:parseEac3SyncFrame,aac:parseAacAudioSpecificConfig};\nimport {streamingMatroskaTrack,preloadMatroskaStreaming} from ${streamModule};\n` +
      result;
    const hooks: [string, string][] = [
      [
        'async getFirstPacket(\n\t\tres: ResultValue<PacketRetrievalResult>,\n\t\toptions: PacketRetrievalOptions,\n\t): MaybeRelevantPromise {',
        'const stream=streamingMatroskaTrack(this.internalTrack,(codec,data)=>AUDIO_CODECS_WITH_DELTA_PACKETS.includes(codec as AudioCodec)?null:determineAudioPacketType(codec as AudioCodec,data),velaAudioFrameParsers);if(stream?.firstEnabled)return stream.first(res);',
      ],
      [
        'async getPacket(\n\t\tres: ResultValue<PacketRetrievalResult>,\n\t\ttimestamp: number,\n\t\toptions: PacketRetrievalOptions,\n\t): MaybeRelevantPromise {',
        "const stream=streamingMatroskaTrack(this.internalTrack,(codec,data)=>AUDIO_CODECS_WITH_DELTA_PACKETS.includes(codec as AudioCodec)?null:determineAudioPacketType(codec as AudioCodec,data),velaAudioFrameParsers);if(stream?.sequential&&this.internalTrack.info?.type==='audio')return stream.at(res,timestamp);",
      ],
      [
        'async getKeyPacket(\n\t\tres: ResultValue<PacketRetrievalResult>,\n\t\ttimestamp: number,\n\t\toptions: PacketRetrievalOptions,\n\t): MaybeRelevantPromise {',
        'const stream=streamingMatroskaTrack(this.internalTrack,(codec,data)=>AUDIO_CODECS_WITH_DELTA_PACKETS.includes(codec as AudioCodec)?null:determineAudioPacketType(codec as AudioCodec,data),velaAudioFrameParsers);if(stream?.sequential)return stream.key(res,timestamp);',
      ],
      [
        'async getNextPacket(\n\t\tres: ResultValue<PacketRetrievalResult>,\n\t\tpacket: EncodedPacket,\n\t\toptions: PacketRetrievalOptions,\n\t): MaybeRelevantPromise {',
        'const stream=streamingMatroskaTrack(this.internalTrack,(codec,data)=>AUDIO_CODECS_WITH_DELTA_PACKETS.includes(codec as AudioCodec)?null:determineAudioPacketType(codec as AudioCodec,data),velaAudioFrameParsers);if(stream?.sequential&&stream.owns(packet))return stream.after(res,packet);',
      ],
      [
        'async getNextKeyPacket(\n\t\tres: ResultValue<PacketRetrievalResult>,\n\t\tpacket: EncodedPacket,\n\t\toptions: PacketRetrievalOptions,\n\t): MaybeRelevantPromise {',
        'const stream=streamingMatroskaTrack(this.internalTrack,(codec,data)=>AUDIO_CODECS_WITH_DELTA_PACKETS.includes(codec as AudioCodec)?null:determineAudioPacketType(codec as AudioCodec,data),velaAudioFrameParsers);if(stream?.sequential&&stream.owns(packet))return stream.after(res,packet,true);',
      ],
    ];
    for (const [marker, body] of hooks) {
      if (result.split(marker).length !== 2) throw new Error('Pinned streaming Matroska packet API changed');
      result = result.replace(marker, marker + '\n' + body);
    }
    const complete = '\t\tthis.currentSegment = null;\n\t}\n\n\t/** Gives each';
    if (result.split(complete).length !== 2) throw new Error('Pinned Matroska metadata completion changed');
    return result.replace(
      complete,
      '\t\tconst completedSegment=this.currentSegment;\n\t\tthis.currentSegment = null;\npreloadMatroskaStreaming(this,completedSegment);\n\t}\n\n\t/** Gives each',
    );
  }
  if (normalized.endsWith('/src/input-format.ts')) {
    // The pinned MP4 probe recognizes styp only at byte zero. Ether can retain
    // valid free/skip padding before a fragment's styp. Its existing bounded
    // box walk must recognize that segment header after skipping the padding.
    // Ether emits free-box keepalives while an encode is pending. Their count
    // is arbitrary. A fetched HLS object's finite byte length bounds the walk;
    // every box consumes at least eight bytes. Skip payloads, yield for source
    // cancellation, and retain the conservative pin limit for unknown sizes.
    const anchor = "fourCc === 'moof'";
    const loop = 'for (let iter = 0; iter < 10; iter++)';
    const size = 'if (size < headerSize) {';
    const header = 'let slice = input._reader.requestSlice(pos, 8);';
    if ([anchor, loop, size, header].some((value) => source.split(value).length !== 2))
      throw new Error('Pinned padded MP4 format probe changed');
    return source
      .replace(anchor, "fourCc === 'moof'\n\t\t\t\t|| fourCc === 'styp'")
      .replace(
        loop,
        `const probeSize = input._reader.fileSizeNonStrict;
        const probeBoxes = probeSize !== null && Number.isSafeInteger(probeSize) ? Math.floor(probeSize / 8) : 10;
        for (let iter = 0; iter < probeBoxes; iter++)`,
      )
      .replace(
        header,
        `if (iter % 1024 === 1023) await new Promise<void>(resolve => setTimeout(resolve, 0));
            let slice = input._reader.requestSlice(pos, 8);`,
      )
      .replace(
        size,
        'if (size < headerSize || !Number.isSafeInteger(size) || !Number.isSafeInteger(pos + size)) {',
      );
  }
  if (normalized.endsWith('/src/hls/hls-segmented-input.ts')) {
    const anchor = 'input._onFormatDetermined = (format) => {';
    if (source.split(anchor).length !== 2) throw new Error('Pinned HLS source clock hook changed');
    const module = JSON.stringify(new URL('./fragment-time.ts', import.meta.url).pathname);
    return (
      `import {inheritFragmentTiming,contextualizeHlsInput} from ${module};\n` +
      source.replace(
        anchor,
        'inheritFragmentTiming(this.input._rootSource,input._rootSource);\n\t\tcontextualizeHlsInput(input,hlsSegment.index);\n\t\t' +
          anchor,
      )
    );
  }
  if (!normalized.endsWith('/src/isobmff/isobmff-demuxer.ts')) return null;
  const anchor = 'const baseMediaDecodeTime = version === 0 ? readU32Be(slice) : readU64Be(slice);';
  if (source.split(anchor).length !== 2) throw new Error('Pinned fragment clock hook changed');
  const module = JSON.stringify(new URL('./fragment-time.ts', import.meta.url).pathname);
  return (
    `import {fragmentDecodeTime} from ${module};\n` +
    source.replace(
      anchor,
      'const baseMediaDecodeTime = version === 0 ? readU32Be(slice) : fragmentDecodeTime(this.input._rootSource,this.currentTrack,readU32Be(slice),readU32Be(slice));',
    )
  );
}
