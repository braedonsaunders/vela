// The `queue` block's engine. The queue beside the page: what is playing, what the viewer queued
// (Play next, Add to queue) and what comes next from the source and autoplay. Rows can be played,
// removed, and moved by dragging (web pointers). A document styles its parts (queue.*) and may
// replace a row's drawing (the queue.row template); the row keeps its press and focus.
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Platform, Text, View, ScrollView } from 'react-native';
import { autoplayNext, clock, currentInQueue, msg, queuedNext, sourceNext, type Card } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { FocusPressable as Pressable } from '../../focus';
import { NO_RING } from '../../widgets/common/controls';
import { alpha, Cover, useMediaLook } from '../../widgets/media/parts';
import { IconButton, Surface, transition } from './parts';
import { Meter } from './track-table';
import { usePart, usePartStyler, useHasTemplate, useListenLook } from './look';
import { queueMove } from './props';

const web = Platform.OS === 'web';

export interface QueueOptions {
  /** Draw the Queue heading (with the close button when onClose is given). Default true. */
  header?: boolean;
  /** Rows drawn per section (60). */
  limit?: number;
}

type Section = 'now' | 'queued' | 'source' | 'autoplay';

export function QueuePanel({ onClose, options = {} }: { onClose?(): void; options?: QueueOptions }) {
  const m = useMediaLook();
  const limit = options.limit ?? 60;
  const heading = usePart('queue.heading').text;
  const [dragging, setDragging] = useState(-1);
  const [over, setOver] = useState(-1);
  const store = useVela();
  const audio = useVelaState(s => s.audio);
  const queue = audio.queue;
  const now = currentInQueue(queue);
  const mine = queue ? queuedNext(queue) : [];
  const rest = queue ? sourceNext(queue) : [];
  const auto = queue ? autoplayNext(queue) : [];
  const playing = audio.phase === 'playing' || audio.phase === 'buffering' || audio.phase === 'loading';
  const position = (card: Card) => (queue ? queue.order.indexOf(queue.items.indexOf(card)) : -1);
  // Upcoming rows move by dragging (web pointers): from one play position to another.
  const drop = (to: number) => {
    const from = dragging;
    setDragging(-1); setOver(-1);
    const move = queue ? queueMove(from, to, queue.at, queue.order.length) : undefined;
    if (move) store.audio.move(move.from, move.to);
  };
  const drag: QueueDrag | undefined = web ? { dragging, over, start: setDragging, enter: setOver, drop, end: () => { setDragging(-1); setOver(-1); } } : undefined;
  const rows = (section: Section, cards: Card[]) => cards.slice(0, limit).map((card, i) => (
    <QueueRow key={`${section[0]}-${card.id}-${position(card)}`} card={card} section={section} index={i} position={position(card)} drag={drag}
      onRemove={() => store.audio.remove(position(card))} onPlay={() => store.audio.jump(queue!.items.indexOf(card))} />
  ));
  return (
    <View style={{ flex: 1 }} testID="music-queue">
      {options.header === false ? null : <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 6 }}>
        <Text accessibilityRole="header" style={[m.text({ 'font-size': '18px', 'font-weight': '750', color: '$ui.ink' }), heading]}>{msg('music.queue')}</Text>
        {onClose ? <IconButton symbol="close" label={msg('ui.close')} onPress={onClose} size={32} iconSize={16} /> : null}
      </View>}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 18 }}>
        {now ? <><Heading label={msg('media.player.nowPlaying')} /><QueueRow card={now} section="now" index={0} position={queue?.at ?? 0} current playing={playing} /></> : <Text style={[m.text({ 'font-size': '14px', color: '$ui.inkQuiet' }), { padding: 12 }]}>{msg('media.player.nothingNext')}</Text>}
        {mine.length ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 8 }}>
              <Heading label={msg('music.nextInQueue')} />
              <Pressable onPress={() => store.audio.clearQueued()} accessibilityRole="button" style={NO_RING}><Text style={m.text({ 'font-size': '13px', 'font-weight': '650', color: '$ui.inkSecondary' })}>{msg('music.clearQueue')}</Text></Pressable>
            </View>
            {rows('queued', mine)}
          </>
        ) : null}
        {rest.length ? (
          <>
            <Heading label={queue?.source ? msg('music.nextFrom', { name: queue.source.name }) : msg('media.player.upNext')} />
            {rows('source', rest)}
          </>
        ) : null}
        {auto.length ? (
          <>
            <Heading label={msg('music.autoplayFrom', { name: queue?.autoplay?.seed ?? '' })} />
            {rows('autoplay', auto)}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Heading({ label }: { label: string }) {
  const m = useMediaLook();
  const part = usePart('queue.section');
  return <Text style={[m.text({ 'font-size': '14px', 'font-weight': '700', color: '$ui.inkSecondary' }), { paddingHorizontal: 10, paddingTop: 16, paddingBottom: 6 }, part.box, part.text]}>{label}</Text>;
}

interface QueueDrag { dragging: number; over: number; start(position: number): void; enter(position: number): void; drop(position: number): void; end(): void }

/** Web pointer moves: the row's own element is draggable (HTML drag and drop), its layout unchanged. */
function useQueueDrag(drag: QueueDrag | undefined, position: number) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const live = useRef(drag);
  live.current = drag;
  const on = !!drag && position >= 0;
  useEffect(() => {
    const node = ref.current as unknown as HTMLElement | null;
    if (!on || !node?.addEventListener) return;
    node.setAttribute('draggable', 'true');
    const start = (e: DragEvent) => { e.dataTransfer?.setData('text/plain', String(position)); live.current?.start(position); };
    const over = (e: DragEvent) => { e.preventDefault(); if (live.current && live.current.over !== position) live.current.enter(position); };
    const dropped = (e: DragEvent) => { e.preventDefault(); live.current?.drop(position); };
    const end = () => live.current?.end();
    node.addEventListener('dragstart', start);
    node.addEventListener('dragover', over);
    node.addEventListener('drop', dropped);
    node.addEventListener('dragend', end);
    return () => {
      node.removeAttribute('draggable');
      node.removeEventListener('dragstart', start);
      node.removeEventListener('dragover', over);
      node.removeEventListener('drop', dropped);
      node.removeEventListener('dragend', end);
    };
  }, [on, position]);
  return ref;
}

function QueueRow({ card, section, index, position, drag, current = false, playing = false, onPlay, onRemove }: { card: Card; section: Section; index: number; position: number; drag?: QueueDrag; current?: boolean; playing?: boolean; onPlay?(): void; onRemove?(): void }) {
  const m = useMediaLook();
  const look = useListenLook();
  const templated = useHasTemplate('queue.row');
  const rowStyle = usePartStyler(['queue.row', current && 'queue.activeRow']);
  const rowText = usePart(['queue.row', current && 'queue.activeRow']).text;
  const title = usePart('queue.title').text;
  const byline = usePart('queue.byline').text;
  const draggable = drag && section !== 'now' ? drag : undefined;
  const ref = useQueueDrag(draggable, position);
  const marker = draggable && draggable.dragging >= 0 && draggable.over === position && draggable.dragging !== position ? (draggable.dragging < position ? 'bottom' : 'top') : '';
  const row = (
    <Surface onPress={onPlay} label={[card.name, card.media?.byline].filter(Boolean).join(', ')} selected={current}
      style={(lit, focus) => [{ borderRadius: 8, backgroundColor: lit ? m.ui.control : current ? alpha(m.ui.accent, 0.1) : 'transparent' }, transition('background-color', 120),
        rowStyle?.({ hover: lit, focus }), draggable?.dragging === position ? { opacity: 0.5 } : null]}
      contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 6 }}>
      {lit => templated ? look.template!('queue.row', card, { index, section, active: current, playing, lit }, index) : (
        <>
          <View pointerEvents="none">
            <Cover uri={card.poster} shape="square" size={46} title={card.name} accent={card.accent} lift={0.2} />
            {current && playing ? <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 4 }}><Meter color="#ffffff" /></View> : null}
          </View>
          <View pointerEvents="none" style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={[m.text({ 'font-size': '14px', 'font-weight': '600', color: current ? m.ui.accent : '$ui.ink' }), rowText, title]}>{card.name}</Text>
            <Text numberOfLines={1} style={[m.text({ 'font-size': '12px', color: '$ui.inkQuiet' }), byline]}>{card.media?.byline ?? ''}</Text>
          </View>
          {onRemove && lit ? <IconButton symbol="close" label={msg('music.removeFromQueue')} onPress={onRemove} size={28} iconSize={13} />
            : <View pointerEvents="none"><Text style={m.text({ 'font-size': '12px', color: '$ui.inkQuiet', 'font-variant-numeric': 'tabular-nums' })}>{card.media?.clockLabel || (card.durationSeconds ? clock(card.durationSeconds) : '')}</Text></View>}
        </>
      )}
    </Surface>
  );
  if (!draggable) return row;
  return (
    <View ref={ref}>
      {row}
      {marker ? <View pointerEvents="none" style={{ position: 'absolute', left: 8, right: 8, height: 2, borderRadius: 1, backgroundColor: m.ui.accent, [marker]: -1 }} /> : null}
    </View>
  );
}
