// Mute and the volume slider. The slider is for pointers: phones use their buttons and
// televisions their own volume, so there only the mute button shows.
import { useRef, useState, type ComponentRef } from 'react';
import { View, type GestureResponderEvent } from 'react-native';
import { msg } from '@vela/core';
import { ChromeButton } from './button';
import type { CommandInput } from './context';
import type { PlayerLook } from './look';
import type { PlayerView } from './present';

interface Props {
  look: PlayerLook;
  view: PlayerView;
  send(command: CommandInput): void;
  onActive(active: boolean): void;
}

export function Volume({ look, view, send, onActive }: Props) {
  const silent = view.muted || view.volume <= 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: look.size(4) }}>
      <ChromeButton look={look} icon={silent ? 'speakerMute' : 'speaker'} label={view.muted ? msg('ui.unmute') : msg('ui.mute')}
        selected={view.muted} testID="player-mute" onPress={() => send({ type: 'mute', muted: !view.muted })} />
      {look.small || look.tv ? null : <Slider look={look} level={view.muted ? 0 : view.volume} send={send} onActive={onActive} />}
    </View>
  );
}

function Slider({ look, level, send, onActive }: { look: PlayerLook; level: number; send: Props['send']; onActive: Props['onActive'] }) {
  const box = useRef<ComponentRef<typeof View>>(null);
  const frame = useRef({ left: 0, width: 1 });
  const [dragging, setDragging] = useState<number | null>(null);
  const width = look.size(104);
  const knob = look.size(12);
  const shown = Math.max(0, Math.min(1, dragging ?? level));

  const at = (event: GestureResponderEvent) =>
    Math.max(0, Math.min(1, (event.nativeEvent.pageX - frame.current.left) / Math.max(1, frame.current.width)));
  const apply = (value: number) => {
    setDragging(value);
    send({ type: 'volume', value });
  };

  return (
    <View ref={box} accessibilityRole="adjustable" accessibilityLabel={msg('ui.volume')}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(shown * 100) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={e => send({ type: 'volume', value: Math.max(0, Math.min(1, level + (e.nativeEvent.actionName === 'increment' ? 0.1 : -0.1))) })}
      testID="player-volume"
      style={{ width, height: look.size(22), justifyContent: 'center', marginRight: look.size(8) }}
      onStartShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={event => {
        const pageX = event.nativeEvent.pageX;
        onActive(true);
        box.current?.measureInWindow((left, _top, measured) => {
          frame.current = { left, width: measured };
          apply(Math.max(0, Math.min(1, (pageX - left) / Math.max(1, measured))));
        });
      }}
      onResponderMove={event => apply(at(event))}
      onResponderRelease={event => { apply(at(event)); setDragging(null); onActive(false); }}
      onResponderTerminate={() => { setDragging(null); onActive(false); }}>
      <View style={{ height: look.size(4), borderRadius: look.size(2), backgroundColor: look.trackStrong, overflow: 'hidden' }}>
        <View style={{ width: `${shown * 100}%`, height: '100%', backgroundColor: look.ink }} />
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', left: `${shown * 100}%`, marginLeft: -knob / 2, width: knob,
        height: knob, borderRadius: knob / 2, backgroundColor: look.ink, boxShadow: `0px 1px 6px ${look.shadow}` }} />
    </View>
  );
}
