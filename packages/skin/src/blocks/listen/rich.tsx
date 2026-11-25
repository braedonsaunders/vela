// The Listen rich blocks as document nodes (docs/experiences.md: Blocks; the registry is
// packages/protocol/rich-blocks.ts). The resolver hands a block its props (holes compiled as
// arguments), its parts (document, node and skin styles already merged) and its part templates;
// this file reads them in the block's context, publishes the parts and templates to the engine
// below (look.tsx), and draws the engine. Engines keep their own data reads, focus and timing.
import { useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useHost, type ScreenPress } from '../../host';
import { fill, type RNode } from '../../resolve';
import type { Arg } from '../../screen/holes';
import { bind } from '../../screen/items';
import { useScopedReads } from '../../screen/scoped-reads';
import type { Ctx, Env } from '../../vocabulary';
import { useMediaLook } from '../../widgets/media/parts';
import { useScreenBlockRuntime } from '../types';
import { isRichBlock, type RichBlockName } from '../../../../protocol/rich-blocks';
import { BarPanelView, NowPlayingBar, NOW_PLAYING_BAR_HEIGHT, type BarPanel } from './bar';
import { ListenLookProvider, usePart, type ListenLook } from './look';
import { fillParts } from './part-style';
import { barPresses, parseBool, parseEnum, propDefault, tableTracks } from './props';
import { TrackList, type TrackListOptions } from './track-table';

/** A rich block node as resolved (resolve.ts). */
export type RichNode = Extract<RNode, { kind: 'rich' }>;

/** A block's props read in its context: raw values, text, and the registry's defaults. */
export interface Props {
  /** The raw value (a list, a record), or its text when the prop is not a single hole. */
  value(name: string): unknown;
  text(name: string): string;
  bool(name: string): boolean;
  enum<T extends string>(name: string, values: readonly T[]): T;
}

export function readProps(block: RichBlockName, props: Record<string, Arg>, ctx: Ctx, env: Env): Props {
  const text = (name: string) => {
    const arg = props[name];
    return arg ? fill(arg.template, ctx, env) : propDefault(block, name);
  };
  const value = (name: string) => {
    const arg = props[name];
    if (!arg) return undefined;
    return arg.value ? arg.value(ctx, env) : fill(arg.template, ctx, env);
  };
  return {
    value,
    text,
    bool: name => {
      const raw = props[name] ? value(name) : undefined;
      return parseBool(raw, parseBool(propDefault(block, name), false));
    },
    enum: (name, values) => parseEnum(text(name), values, parseEnum(propDefault(block, name), values, values[0]!)),
  };
}

export function RichBlock({ node, ctx }: { node: RichNode; ctx: Ctx }) {
  const host = useHost();
  const runtime = useScreenBlockRuntime();
  // The block subscribes to the records it reads (a pushed item: record redraws this block only).
  const scoped = useScopedReads(ctx);
  const env = host.env;
  const parts = fillParts(node.parts, template => fill(template, scoped, env));
  const look = useMemo<ListenLook>(() => {
    const names = Object.keys(node.templates ?? {});
    return {
      parts,
      templates: new Set(names),
      template: runtime && names.length ? (name, item, part, index) => {
        const template = node.templates[name];
        return template ? runtime.renderNode(template, bind(bind(scoped, 'item', item, index), 'part', part, index)) : null;
      } : undefined,
    };
  // Parts are filled afresh each draw; their rows decide whether anything changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(parts), node.templates, runtime, scoped]);
  if (!isRichBlock(node.block)) return node.fallback && runtime ? runtime.renderNode(node.fallback, ctx) : null;
  const props = readProps(node.block, node.props ?? {}, scoped, env);
  let drawn: ReactNode;
  switch (node.block) {
    case 'trackTable': drawn = <TrackTableBlock props={props} ctx={scoped} />; break;
    case 'bar': drawn = <BarBlock props={props} ctx={scoped} press={host.screenPress} />; break;
    default: drawn = node.fallback && runtime ? runtime.renderNode(node.fallback, ctx) : null;
  }
  return <ListenLookProvider look={look}>{drawn}</ListenLookProvider>;
}

// ——— trackTable ————————————————————————————————————————————————————————————————————

function TrackTableBlock({ props, ctx }: { props: Props; ctx: Ctx }) {
  const read = ctx.screen?.record ?? (() => undefined);
  const { tracks, entryIds } = tableTracks(props.value('tracks'), props.value('entryIds'), read);
  const playlistId = props.text('playlist');
  const sourceId = props.text('sourceId');
  const options: TrackListOptions = {
    covers: props.bool('covers'),
    album: props.bool('album'),
    position: props.bool('position'),
    header: props.bool('header'),
    discs: props.bool('discs'),
    reorder: props.bool('reorder'),
    ...(sourceId ? { source: { id: sourceId, name: props.text('sourceName'), kind: props.enum('sourceKind', ['title', 'playlist', 'favorites'] as const) } } : {}),
    ...(playlistId && entryIds.some(Boolean) ? { playlist: { id: playlistId, entryIds } } : {}),
  };
  // A stable list while the same tracks are named (the engine's progressive drawing keys on it).
  const key = tracks.map(t => t.id).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useMemo(() => tracks, [key]);
  return <TrackList tracks={stable} options={options} />;
}

// ——— bar ———————————————————————————————————————————————————————————————————————————

function BarBlock({ props, ctx, press }: { props: Props; ctx: Ctx; press?(p: ScreenPress): void }) {
  const m = useMediaLook();
  const root = usePart('bar.root');
  const [panel, setPanel] = useState<BarPanel>('');
  const state = ctx.screen?.state ?? {};
  const queueFlag = props.text('queueFlag') || 'queue';
  const soundFlag = props.text('soundFlag') || 'sound';
  const soundOpen = state[soundFlag] === 'true';
  const queueOpen = state[queueFlag] === 'true' && !soundOpen;
  const send = (which: 'queue' | 'sound') => {
    for (const p of barPresses(which, queueFlag, soundFlag, state)) press?.({ action: p.action, arg: p.flag, args: {}, control: `bar-${which}` });
  };
  return (
    <View style={[{ height: NOW_PLAYING_BAR_HEIGHT, backgroundColor: m.ui.raised }, root.box]} testID="listen-bar">
      <NowPlayingBar queueOpen={queueOpen} onQueue={() => send('queue')} soundOpen={soundOpen} onSound={props.bool('sound') ? () => send('sound') : undefined} panel={panel} onPanel={setPanel} />
      <BarPanelView panel={panel} onClose={() => setPanel('')} />
    </View>
  );
}
