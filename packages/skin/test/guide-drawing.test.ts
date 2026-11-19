import { expect, test } from 'bun:test';
import type { GuideChannel, GuideProgramme } from '@vela/core';
import { rowDrawing } from '../src/widgets/guide/drawing';
import type { GuideLook } from '../src/widgets/guide/look';

test('native rows use shared time geometry and retain complete programme bounds and accessible copy', () => {
  const look = { page: '#090b0e', ui: { raised: '#15191e' }, radiusCell: 8, font: () => ({ fontFamily: 'Body' }), tone: () => '#ff0000', cell: '#111111', live: '#222222', liveEdge: '#333333', hairline: '#444444', liveFill: '#555555', accent: '#eeeeee', ink: '#ffffff', inkSecondary: '#aaaaaa' } as unknown as GuideLook;
  const programmes = [
    { id: 'long', at: 60, span: 180, name: 'Sport', startLabel: '1 PM', endLabel: '4 PM', airing: true, ended: false, tone: 1, remainingLabel: '90 min left' },
    { id: 'tiny', at: 240, span: 5, name: 'News', startLabel: '4 PM', endLabel: '4:05 PM', airing: false, ended: false, tone: -1 },
  ] as GuideProgramme[];
  const drawing = rowDrawing({ id: 'channel', name: 'Sports' } as GuideChannel, programmes, 6, 96, { from: 120, to: 300 }, 150, look, false);
  expect(drawing.colours.background).toBe('#090b0e');
  expect(drawing.colours.surface).toBe('#15191e');
  expect(drawing.originX).toBe(720);
  expect(drawing.width).toBe(1080);
  expect(drawing.cells[0]).toMatchObject({ x: -358, width: 1076, elapsed: 540, title: 'Sport', detail: '90 min left' });
  expect(drawing.cells[1]).toMatchObject({ x: 722, width: 26, title: '', detail: '' });
  expect(drawing.cells[0]!.label).toContain('Sport');
  expect(drawing.cells[1]!.label).toContain('News');
  expect(drawing.cells[1]!.label).toContain('Sports');
});
