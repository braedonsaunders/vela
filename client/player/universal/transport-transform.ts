/** Small pinned-library hooks; no vendor changes or separate playback policy. */
export function transformUpstreamTransport(path:string,source:string):string|null{
  const normalized=path.replaceAll('\\','/');
  const module=JSON.stringify(new URL('./transport.ts',import.meta.url).pathname);
  if(normalized.endsWith('/pipeline/CustomDecode.worker.ts')){
    const begin='        const fetchStartedAt = startTimingWait();';
    const end="        requireValidByteRangeResponse(requestHeaders.get('Range'), response, hiddenContentRangePathPattern);\n        return response;";
    if(source.split(begin).length!==2||source.split(end).length!==2)throw new Error('Pinned decode transport hook changed');
    return `import {measureDecodeResponse} from ${module};\n`+source.replace(begin,
      begin+'\n        const velaRun=currentRun,velaStarted=performance.now();').replace(end,
      "        requireValidByteRangeResponse(requestHeaders.get('Range'), response, hiddenContentRangePathPattern);\n"+
      "        return measureDecodeResponse(response,velaStarted,sample=>{if(velaRun&&!velaRun.cancelled&&currentRun===velaRun)postResponse({type:'source-progress',generation:velaRun.generation,byteCount:1,velaTransfer:sample} as DecodeWorkerResponse & {velaTransfer:typeof sample});});");
  }
  if(normalized.endsWith('/pipeline/CustomDecodeSession.ts')){
    const receive="            case 'source-progress':\n                this.telemetry.preparationSourceByteCount = messageValue.byteCount;";
    const report='            ...this.telemetry,\n            earliestQueuedFrameMediaTimeMicroseconds:';
    if(source.split(receive).length!==2||source.split(report).length!==2)throw new Error('Pinned decoder network telemetry hook changed');
    return `import {recordDecoderTransfer,decoderNetwork,type TransferSample} from ${module};\n`+source.replace(receive,
      "            case 'source-progress':\n                {const sample=(messageValue as typeof messageValue & {velaTransfer?:TransferSample}).velaTransfer;if(sample){recordDecoderTransfer(this,messageValue.generation,sample);break;}}\n                this.telemetry.preparationSourceByteCount = messageValue.byteCount;")
      .replace(report,'            ...this.telemetry,\n            ...{velaNetwork:decoderNetwork(this,this.telemetry.activeGeneration)},\n            earliestQueuedFrameMediaTimeMicroseconds:');
  }
  return null;
}
