import { expect, test } from 'bun:test';
import { transformCoreDemux } from '../web/engine/core/demux/transform';

test('cursor type narrowing preserves the base track at runtime', () => {
  const source = `
    class Base { constructor(public track: unknown) {} }
    class Video extends Base { override track!: InputVideoTrack; }
    class Audio extends Base { override track!: InputAudioTrack; }
    globalThis.result = [new Video('video').track, new Audio('audio').track];
  `;
  const adapted = transformCoreDemux('/node_modules/mediabunny/src/cursors.ts', source)!;
  const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(adapted);
  const result = new Function(`${javascript}; return globalThis.result;`)();
  expect(result).toEqual(['video', 'audio']);
  delete (globalThis as typeof globalThis & { result?: unknown }).result;
});
