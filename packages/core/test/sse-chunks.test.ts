// Server events read the same however the body is cut into chunks: a long plan line over many chunks,
// line ends split between chunks, CR, LF and CRLF.
import { expect, test } from 'bun:test';
import { readEvents, type StreamEvent } from '../src/protocol/sse';

async function events(chunks: string[]): Promise<StreamEvent[]> {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); },
  });
  const out: StreamEvent[] = [];
  await readEvents(new Response(body), event => { out.push(event); });
  return out;
}

const plan = JSON.stringify({ sessionId: 's1', paths: Array.from({ length: 200 }, (_, i) => ({ id: `p${i}`, kind: 'transcode' })) });
const stream = `: hello\nevent: plan\nid: 7\ndata: ${plan}\n\nevent: ended\r\nid: 8\r\ndata: a\r\ndata: b\r\n\r\ndata: last\r\r\n`;

test('every cut of the stream gives the same events', async () => {
  const whole = await events([stream]);
  expect(whole).toEqual([
    { event: 'plan', id: '7', data: plan },
    { event: 'ended', id: '8', data: 'a\nb' },
    { event: 'message', id: '8', data: 'last' },
  ]);
  for (const size of [1, 2, 3, 7, 64, 1000]) {
    const chunks: string[] = [];
    for (let at = 0; at < stream.length; at += size) chunks.push(stream.slice(at, at + size));
    expect(await events(chunks)).toEqual(whole);
  }
  // A CRLF split between chunks is one line end.
  expect(await events(['data: x\r', '\n\r', '\n'])).toEqual([{ event: 'message', id: '', data: 'x' }]);
});
