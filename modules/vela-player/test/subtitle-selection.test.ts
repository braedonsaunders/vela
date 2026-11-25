import { describe, expect, test } from 'bun:test';
import type { Source, Track } from '../web/engine/model';
import { requiresServerSubtitleSelection } from '../web/engine/host/command-tracks';

const source = (strategy: Source['strategy']) => ({ strategy });
const track = (delivery: Track['delivery'], url?: string): Track => ({
  id: delivery?.kind ?? 'legacy',
  label: 'Subtitle',
  delivery,
  ...(url ? { url } : {}),
});

describe('server subtitle selection', () => {
  test('routes embedded text and image subtitles through an active transcode', () => {
    for (const delivery of [{ kind: 'embedded' }, { kind: 'burn-in' }] as const) {
      expect(requiresServerSubtitleSelection(true, source('transcode'), track(delivery))).toBe(true);
    }
  });

  test('recognizes the current transcoded subtitle when turning it off or replacing it', () => {
    const current = track({ kind: 'embedded' });
    expect(requiresServerSubtitleSelection(true, source('transcode'), current)).toBe(true);
  });

  test('keeps external WebVTT and ASS documents local on a transcode', () => {
    for (const format of ['webvtt', 'ass'] as const) {
      expect(
        requiresServerSubtitleSelection(
          true,
          source('transcode'),
          track({ kind: 'external', format, url: `https://media.example/sub.${format}` }),
        ),
      ).toBe(false);
    }
    expect(requiresServerSubtitleSelection(true, source('transcode'), track(undefined, 'https://media.example/sub.vtt'))).toBe(false);
  });

  test('leaves embedded tracks local on an original file and never commands an unmanaged session', () => {
    const embedded = track({ kind: 'embedded' });
    expect(requiresServerSubtitleSelection(true, source('direct'), embedded)).toBe(false);
    expect(requiresServerSubtitleSelection(false, source('transcode'), embedded)).toBe(false);
  });
});
