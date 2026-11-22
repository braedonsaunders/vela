// The score bug a tile draws over its picture when the programme on air is a live event: away and
// home abbreviations around the score, then the status on the live colour. Drawn by Vela, so it
// works over any channel. A ranking event (F1, golf) shows its title, the leader's line and status.
import { View } from 'react-native';
import type { GuideLook } from '../guide/look';
import { Line } from '../guide/parts';
import { bugLeader, bugSides, bugTitle, type BugEvent } from './bug-model';

export type { BugEvent };

export function ScoreBug({ event, look, size }: { event: BugEvent; look: GuideLook; size: number }) {
  const sides = bugSides(event);
  const pad = { paddingHorizontal: size * 0.62, paddingVertical: size * 0.32, justifyContent: 'center' as const };
  const dark = { ...pad, backgroundColor: 'rgba(11, 15, 26, 0.84)' };
  const live = event.status.state === 'in';
  const leader = bugLeader(event);
  return (
    <View style={{ flexDirection: 'row', alignSelf: 'flex-start', borderRadius: size * 0.5, overflow: 'hidden',
      shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: size, shadowOffset: { width: 0, height: size * 0.3 } }}>
      {sides ? <>
        <View style={dark}><Line look={look} size={size} weight={750} color="#ffffff">{sides.left}</Line></View>
        {sides.score ? <View style={{ ...pad, backgroundColor: '#ffffffee' }}>
          <Line look={look} size={size} weight={800} color="#0b0f1a" tabular>{sides.score}</Line>
        </View> : null}
        <View style={dark}><Line look={look} size={size} weight={750} color="#ffffff">{sides.right}</Line></View>
      </> : <>
        {/* A race or round: its name, where it stands (the lap) and the leader on the live colour. */}
        <View style={dark}><Line look={look} size={size} weight={750} color="#ffffff">{bugTitle(event)}</Line></View>
        {event.status.detail ? <View style={{ ...pad, backgroundColor: '#ffffffee' }}>
          <Line look={look} size={size} weight={800} color="#0b0f1a" tabular>{event.status.detail}</Line>
        </View> : null}
      </>}
      {sides ? (event.status.detail ? <View style={{ ...pad, backgroundColor: live ? look.now : 'rgba(11, 15, 26, 0.84)' }}>
        <Line look={look} size={size * 0.82} weight={800} color={live ? look.liveInk : '#ffffff'} tabular>{event.status.detail}</Line>
      </View> : null) : leader ? <View style={{ ...pad, backgroundColor: live ? look.now : 'rgba(11, 15, 26, 0.84)' }}>
        <Line look={look} size={size * 0.82} weight={800} color={live ? look.liveInk : '#ffffff'} tabular>{leader}</Line>
      </View> : null}
    </View>
  );
}
