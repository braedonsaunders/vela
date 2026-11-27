import { expect, test } from 'bun:test';
import broadcast from '../../protocol/fixtures/skins/broadcast/document';
import { cinematicDoc } from '../../protocol/fixtures/skins/cinematic';
import index from '../../protocol/fixtures/skins/index/document';
import jellytwin from '../../protocol/fixtures/skins/jellytwin/document';
import kids from '../../protocol/fixtures/skins/kids/document';
import latenight from '../../protocol/fixtures/skins/latenight/document';
import lounge from '../../protocol/fixtures/skins/lounge/document';
import marquee from '../../protocol/fixtures/skins/marquee/document';
import mochi from '../../protocol/fixtures/skins/mochi/document';
import { cardMenuBackground, resolveUi } from '../src/resolve/ui';

for (const [skin, expected] of [
  [broadcast, '#121821'],
  [cinematicDoc, '#111419'],
  [index, '#ffffff'],
  [jellytwin, '#202020'],
  [kids, '#ffffff'],
  [latenight, '#1224a8'],
  [lounge, '#1a1d24'],
  [marquee, '#2a2c30'],
  [mochi, '#fff8fb'],
] as const) {
  test(`${skin.name} card menu uses its popover hue at full opacity`, () => {
    expect(cardMenuBackground(resolveUi(skin.ui))).toBe(expected);
  });
}

test('a transparent popover uses the raised surface at full opacity', () => {
  expect(cardMenuBackground(resolveUi({ popover: 'transparent', raised: '#1238' }))).toBe('#112233');
  expect(cardMenuBackground(resolveUi({ popover: 'transparent', raised: 'transparent' }))).toBe('#15191e');
});
