// The Listen blocks lab's page document (listen-blocks.tsx draws it).
import type { ScreenDocument } from '../../../../packages/protocol/screen';

export const LAB_HREF = 'vela:listen/blocks-lab';

/** The lab page: a heading, an album's tracks, a playlist's (reorderable) tracks, and the bar. */
export function labDocument(styled: boolean): ScreenDocument {
  const parts = styled ? {
    'trackTable.activeRow': { style: { 'background-color': 'color-mix(in srgb, $ui.accent 22%, transparent)' } },
    'trackTable.title': { style: { 'font-weight': '700' } },
    'trackTable.row': { style: { 'border-radius': '14px' }, hover: { 'background-color': '$ui.controlHover' } },
    'trackTable.header': { style: { color: '$ui.accent' } },
    'bar.toggle': { style: { 'background-color': '$ui.accent' } },
    'bar.title': { style: { color: '$ui.accent' } },
    'bar.scrubber': { style: { color: '$ui.accent' } },
  } : undefined;
  const heading = (text: string) => ({ type: 'text', text, style: { 'font-size': '22px', 'font-weight': '700', color: '$ui.ink', margin: '24px 0px 8px 0px' } });
  return {
    schema: 1, kind: 'screen', renderer: 20, owner: 'vela', experience: 'listen',
    screen: 'vela.listen', page: 'blocks-lab', version: '1', title: 'Listen blocks lab', presentation: 'section',
    params: { album: { type: 'string', default: 'album-paper-boats' }, playlist: { type: 'string', default: '' } },
    sources: {
      album: { from: 'vela.title', id: '{param.album}' },
      tracks: { from: 'vela.children', id: '{param.album}', role: 'track' },
      playlist: { from: 'vela.playlist', id: '{param.playlist}' },
    },
    ...(parts ? { parts } : {}),
    tree: {
      type: 'box', style: { display: 'flex', 'flex-direction': 'column', flex: '1', height: '100%', 'background-color': '$ui.page' },
      children: [
        {
          type: 'box', style: { display: 'flex', 'flex-direction': 'row', flex: '1', 'min-height': '0px' },
          children: [
        { type: 'box', style: { width: '316px', 'background-color': '$ui.raised', 'border-right': '1px solid $ui.glassEdge' }, children: [{ type: 'rail', props: { mode: 'expanded' } }] },
        {
          type: 'box', style: { flex: '1', 'min-width': '0px', 'overflow-y': 'auto', padding: '0px 28px 32px 28px' },
          children: [
            heading('{src.album.item.name}'),
            { type: 'trackTable', testId: 'lab-album', props: { tracks: '{src.tracks}', album: 'true', sourceId: '{param.album}', sourceName: '{src.album.item.name}', sourceKind: 'title', discs: 'true' } },
            heading('{src.playlist.playlist.name}'),
            { type: 'trackTable', testId: 'lab-playlist', when: [{ test: 'param.playlist' }],
              props: { tracks: '{src.playlist.items}', entryIds: '{src.playlist.entryIds}', playlist: '{param.playlist}', covers: 'true', album: 'true', reorder: 'true', sourceId: '{param.playlist}', sourceName: '{src.playlist.playlist.name}', sourceKind: 'playlist' },
              partTemplates: styled ? { 'trackTable.row': {
                type: 'box', style: { display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '12px', flex: '1', padding: '0px 16px' },
                children: [
                  { type: 'text', text: '{part.number}', style: { width: '28px', color: '$ui.inkQuiet' } },
                  { type: 'text', text: '{item.name}', style: { flex: '1', color: '$ui.ink', 'font-weight': '600' } },
                  { type: 'text', text: '{item.media.byline}', style: { color: '$ui.inkSecondary' } },
                ],
              } } : undefined },
          ],
        },
        { type: 'box', when: [{ test: 'state.queue' }], style: { width: '340px', 'background-color': '$ui.raised', 'border-left': '1px solid $ui.glassEdge' }, children: [{ type: 'queue', props: { closeFlag: 'queue' } }] },
        { type: 'box', when: [{ test: 'state.sound' }], style: { width: '360px', 'background-color': '$ui.raised', 'border-left': '1px solid $ui.glassEdge' }, children: [{ type: 'eq', props: { closeFlag: 'sound' } }] },
          ],
        },
        { type: 'box', style: { height: '1px', 'background-color': '$ui.glassEdge' } },
        { type: 'bar', props: {} },
      ],
    },
  } as unknown as ScreenDocument;
}

