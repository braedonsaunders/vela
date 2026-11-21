import { expect, test } from 'bun:test';
import { Media } from '../src/store/media';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';

test('leaving a book re-reads progress shelves only after its last place is saved', async () => {
  const events: string[] = [];
  let release = () => {};
  const adapter = {
    openReading: async () => ({}),
    saveReadingProgress: (_id: string, request: { fraction: number }) => {
      events.push(`save ${request.fraction}`);
      return new Promise<void>(resolve => { release = () => { events.push('saved'); resolve(); }; });
    },
  };
  const session = { epoch: 0, onReset() {}, ready: async () => ({ adapter }), key: () => 'key' };
  const box = new StateBox({ titles: {}, children: {} } as unknown as VelaState);
  const media = new Media(box, session as unknown as Session, () => 300, () => events.push('shelves'));
  void media.saveReadingProgress('book', 'epubcfi(/6/4)', 0.5);
  const finished = media.finishedReading();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(events).toEqual(['save 0.5']);
  release();
  await finished;
  expect(events).toEqual(['save 0.5', 'saved', 'shelves']);
});
