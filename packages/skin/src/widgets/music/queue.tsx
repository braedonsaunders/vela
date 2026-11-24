// The queue beside the page: what is playing, what the viewer queued (Play next, Add to queue) and
// what comes next from the source. Rows can be played, removed, and moved by dragging (web) or
// with Move up / Move down in their menu.
import { Text, View, ScrollView } from 'react-native';
import { autoplayNext, clock, currentInQueue, msg, queuedNext, sourceNext, type Card } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { FocusPressable as Pressable } from '../../focus';
import { NO_RING } from '../common/controls';
import { alpha, Cover, useMediaLook } from '../media/parts';
import { IconButton, Surface, transition } from './parts';
import { Meter } from './tracks';

export function QueuePanel({ onClose }: { onClose(): void }) {
  const m = useMediaLook();
  const store = useVela();
  const audio = useVelaState(s => s.audio);
  const queue = audio.queue;
  const now = currentInQueue(queue);
  const mine = queue ? queuedNext(queue) : [];
  const rest = queue ? sourceNext(queue) : [];
  const auto = queue ? autoplayNext(queue) : [];
  const playing = audio.phase === 'playing' || audio.phase === 'buffering' || audio.phase === 'loading';
  const position = (card: Card) => (queue ? queue.order.indexOf(queue.items.indexOf(card)) : -1);
  return (
    <View style={{ flex: 1 }} testID="music-queue">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 6 }}>
        <Text accessibilityRole="header" style={m.text({ 'font-size': '18px', 'font-weight': '750', color: '$ui.ink' })}>{msg('music.queue')}</Text>
        <IconButton symbol="close" label={msg('ui.close')} onPress={onClose} size={32} iconSize={16} />
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 18 }}>
        {now ? <><Heading label={msg('media.player.nowPlaying')} /><QueueRow card={now} current playing={playing} /></> : <Text style={[m.text({ 'font-size': '14px', color: '$ui.inkQuiet' }), { padding: 12 }]}>{msg('media.player.nothingNext')}</Text>}
        {mine.length ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 8 }}>
              <Heading label={msg('music.nextInQueue')} />
              <Pressable onPress={() => store.audio.clearQueued()} accessibilityRole="button" style={NO_RING}><Text style={m.text({ 'font-size': '13px', 'font-weight': '650', color: '$ui.inkSecondary' })}>{msg('music.clearQueue')}</Text></Pressable>
            </View>
            {mine.map(card => <QueueRow key={`q-${card.id}-${position(card)}`} card={card} onRemove={() => store.audio.remove(position(card))} onPlay={() => store.audio.jump(queue!.items.indexOf(card))} />)}
          </>
        ) : null}
        {rest.length ? (
          <>
            <Heading label={queue?.source ? msg('music.nextFrom', { name: queue.source.name }) : msg('media.player.upNext')} />
            {rest.slice(0, 60).map(card => <QueueRow key={`s-${card.id}-${position(card)}`} card={card} onRemove={() => store.audio.remove(position(card))} onPlay={() => store.audio.jump(queue!.items.indexOf(card))} />)}
          </>
        ) : null}
        {auto.length ? (
          <>
            <Heading label={msg('music.autoplayFrom', { name: queue?.autoplay?.seed ?? '' })} />
            {auto.slice(0, 60).map(card => <QueueRow key={`a-${card.id}-${position(card)}`} card={card} onRemove={() => store.audio.remove(position(card))} onPlay={() => store.audio.jump(queue!.items.indexOf(card))} />)}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Heading({ label }: { label: string }) {
  const m = useMediaLook();
  return <Text style={[m.text({ 'font-size': '14px', 'font-weight': '700', color: '$ui.inkSecondary' }), { paddingHorizontal: 10, paddingTop: 16, paddingBottom: 6 }]}>{label}</Text>;
}

function QueueRow({ card, current = false, playing = false, onPlay, onRemove }: { card: Card; current?: boolean; playing?: boolean; onPlay?(): void; onRemove?(): void }) {
  const m = useMediaLook();
  return (
    <Surface onPress={onPlay} label={[card.name, card.media?.byline].filter(Boolean).join(', ')} selected={current}
      style={lit => [{ borderRadius: 8, backgroundColor: lit ? m.ui.control : current ? alpha(m.ui.accent, 0.1) : 'transparent' }, transition('background-color', 120)]}
      contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 6 }}>
      {lit => (
        <>
          <View pointerEvents="none">
            <Cover uri={card.poster} shape="square" size={46} title={card.name} accent={card.accent} lift={0.2} />
            {current && playing ? <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 4 }}><Meter color="#ffffff" /></View> : null}
          </View>
          <View pointerEvents="none" style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={m.text({ 'font-size': '14px', 'font-weight': '600', color: current ? m.ui.accent : '$ui.ink' })}>{card.name}</Text>
            <Text numberOfLines={1} style={m.text({ 'font-size': '12px', color: '$ui.inkQuiet' })}>{card.media?.byline ?? ''}</Text>
          </View>
          {onRemove && lit ? <IconButton symbol="close" label={msg('music.removeFromQueue')} onPress={onRemove} size={28} iconSize={13} />
            : <View pointerEvents="none"><Text style={m.text({ 'font-size': '12px', color: '$ui.inkQuiet', 'font-variant-numeric': 'tabular-nums' })}>{card.media?.clockLabel || (card.durationSeconds ? clock(card.durationSeconds) : '')}</Text></View>}
        </>
      )}
    </Surface>
  );
}
