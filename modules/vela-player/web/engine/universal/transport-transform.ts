/** Small pinned-library hooks; no vendor changes or separate playback policy. */
export function transformUpstreamTransport(path:string,source:string,audit=false):string|null{
  const normalized=path.replaceAll('\\','/');
  const module=JSON.stringify(new URL('./transport.ts',import.meta.url).pathname);
  const authModule=JSON.stringify(new URL('../media-auth.ts',import.meta.url).pathname);
  const auditModule=JSON.stringify(new URL('./buffer-audit.ts',import.meta.url).pathname);
  if(normalized.endsWith('/pipeline/DecodeWorkerProtocol.ts')){
    // The desktop shell serves immutable engine assets from its secure origin.
    // Restrict the extra scheme to that origin and its asset path.
    const anchor = "return (parsedURL.protocol === 'http:' || parsedURL.protocol === 'https:')";
    if(source.split(anchor).length!==2)throw new Error('Pinned codec asset URL validation changed');
    return source.replace(anchor, "return (parsedURL.protocol === 'http:' || parsedURL.protocol === 'https:' || (parsedURL.protocol === 'vela-app:' && parsedURL.host === 'app' && parsedURL.pathname.startsWith('/vela/')))");
  }
  if(normalized.endsWith('/pipeline/CustomPlaybackController.ts')){
    // An audio-clocked native decoder can stop as soon as the page hides;
    // hidden-page timers may be throttled before a delayed drain can run.
    const delay = 'export const CUSTOM_PLAYBACK_BACKGROUND_VIDEO_SUSPENSION_DELAY_MICROSECONDS = millisecondsToMicroseconds(10_000);';
    const hidden = '            this.pageHiddenAtMicroseconds = this.readMonotonicTime();\n            return false;';
    const drain = 'const presentationFrame = this.videoDecodeSession.takeFrame(this.getCurrentPresentationTargetTime());';
    const take = 'this.videoDecodeSession.takeFrame(addMicroseconds(targetTimeMicroseconds, lookaheadMicroseconds))';
    if([hidden,drain,delay,take].some(value=>source.split(value).length!==2))throw new Error('Pinned background video handling changed');
    return source.replace(delay, 'export const CUSTOM_PLAYBACK_BACKGROUND_VIDEO_SUSPENSION_DELAY_MICROSECONDS = millisecondsToMicroseconds(0);').replace(hidden, `            this.pageHiddenAtMicroseconds = this.readMonotonicTime();\n            if (this.state === 'playing' && this.canSuspendBackgroundVideo() && this.videoDecodeSession.suspendVideo?.()) {\n                this.videoSuspended = true;\n                this.pendingVideoResyncKeyframe = null;\n            }\n            return false;`)
      .replace(drain, 'const presentationFrame = this.videoDecodeSession.takeFrame(this.getCurrentPresentationTargetTime(), false);')
      .replace(take, 'this.videoDecodeSession.takeFrame(addMicroseconds(targetTimeMicroseconds, lookaheadMicroseconds), !this.videoCatchUpActive)');
  }
  if(normalized.endsWith('/pipeline/CustomDecode.worker.ts')){
    if(audit){
      const settle='await urlSourceRetention.settle(run.urlSource, prepared.durationMicroseconds);';
      const release='urlSourceRetention.releaseAfterRun(run, failed);';
      if([settle,release].some(value=>source.split(value).length!==2))throw new Error('Pinned source buffer audit lifecycle changed');
      source=`import {startSourceBufferAudit,stopSourceBufferAudit} from ${auditModule};\n`+source
        .replace(settle,settle+`\n            startSourceBufferAudit(run,run.urlSource,sample=>{
          if(!run.cancelled&&currentRun===run)postResponse({type:'source-progress',generation:run.generation,byteCount:1,velaBuffer:sample} as DecodeWorkerResponse & {velaBuffer:typeof sample});
        },run.timelineOriginMicroseconds/1000000);`)
        .replace(release,'stopSourceBufferAudit(run);\n        '+release);
    }
    const begin='        const fetchStartedAt = startTimingWait();';
    const end="        requireValidByteRangeResponse(requestHeaders.get('Range'), response, hiddenContentRangePathPattern);\n        return response;";
    if(source.split(begin).length!==2||source.split(end).length!==2)throw new Error('Pinned decode transport hook changed');
    const signature='function createValidatedRangeFetch(hiddenContentRangePathPattern: RegExp | null): typeof fetch {';
    const read='            response = await fetch(input, requestInit);';
    const call='createValidatedRangeFetch(source.hiddenContentRangePathPattern ?? null)';
    const retain='return JSON.stringify([ source.url, hiddenContentRangePathPattern?.source ?? null, hiddenContentRangePathPattern?.flags ?? null ]);';
    if(source.split(signature).length!==2||source.split(read).length!==2||source.split(call).length!==3||source.split(retain).length!==2)throw new Error('Pinned private media authorization hook changed');
    const privateValue='(source as typeof source & {velaMediaAuthorization?:MediaAuthorization}).velaMediaAuthorization';
    source=source.replace(signature,'function createValidatedRangeFetch(hiddenContentRangePathPattern: RegExp | null, authorization?:MediaAuthorization): typeof fetch {\n    const velaFetch=authorizedMediaFetch(authorization);')
      .replace(read,'            response = await velaFetch(input, requestInit);')
      .replaceAll(call,`createValidatedRangeFetch(source.hiddenContentRangePathPattern ?? null,${privateValue})`)
      .replace(retain,`return JSON.stringify([source.url,hiddenContentRangePathPattern?.source??null,hiddenContentRangePathPattern?.flags??null,${privateValue}?.handle??null]);`);
    return `import {measureDecodeResponse} from ${module};\nimport {authorizedMediaFetch,type MediaAuthorization} from ${authModule};\n`+source.replace(begin,
      begin+'\n        const velaRun=currentRun,velaStarted=performance.now();').replace(end,
      "        requireValidByteRangeResponse(requestHeaders.get('Range'), response, hiddenContentRangePathPattern);\n"+
      "        return measureDecodeResponse(response,velaStarted,sample=>{if(velaRun&&!velaRun.cancelled&&currentRun===velaRun)postResponse({type:'source-progress',generation:velaRun.generation,byteCount:1,velaTransfer:sample} as DecodeWorkerResponse & {velaTransfer:typeof sample});});");
  }
  if(normalized.endsWith('/pipeline/CustomDecodeSession.ts')){
    const receive="            case 'source-progress':\n                this.telemetry.preparationSourceByteCount = messageValue.byteCount;";
    const report='            ...this.telemetry,\n            earliestQueuedFrameMediaTimeMicroseconds:';
    if(source.split(receive).length!==2||source.split(report).length!==2)throw new Error('Pinned decoder network telemetry hook changed');
    const take='public takeFrame(targetTimeMicroseconds: Microseconds): DecodedPresentationFrame | null {';
    const count='        this.telemetry.droppedFrameCount += consumedFrames.length;';
    if([take,count].some(value=>source.split(value).length!==2))throw new Error('Pinned frame drop accounting changed');
    source=source.replace(take,'public takeFrame(targetTimeMicroseconds: Microseconds, countDrops = true): DecodedPresentationFrame | null {')
      .replace(count,'        if (countDrops) this.telemetry.droppedFrameCount += consumedFrames.length;');
    return `import {recordDecoderTransfer,decoderNetwork,type TransferSample} from ${module};\n`+
      (audit?`import {recordDecoderBuffer,decoderBuffer,type SourceBufferAudit} from ${auditModule};\n`:'')+source.replace(receive,
      "            case 'source-progress':\n                "+(audit?"{const buffer=(messageValue as typeof messageValue & {velaBuffer?:SourceBufferAudit}).velaBuffer;if(buffer){recordDecoderBuffer(this,messageValue.generation,buffer);break;}}\n                ":'')+
      "{const sample=(messageValue as typeof messageValue & {velaTransfer?:TransferSample}).velaTransfer;if(sample){recordDecoderTransfer(this,messageValue.generation,sample);break;}}\n                this.telemetry.preparationSourceByteCount = messageValue.byteCount;")
      .replace(report,'            ...this.telemetry,\n            ...{velaNetwork:decoderNetwork(this,this.telemetry.activeGeneration)'+(audit?',velaBuffer:decoderBuffer(this,this.telemetry.activeGeneration)':'')+'},\n            earliestQueuedFrameMediaTimeMicroseconds:');
  }
  return null;
}
