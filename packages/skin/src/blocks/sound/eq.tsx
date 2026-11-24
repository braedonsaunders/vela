// The `eq` rich block: ten bands drawn as a response curve through each band's handle. Drag a handle,
// or focus it and use the up and down arrows; a TV has − and + under each band. It shows and edits the
// gains it is given (core's sound settings decide what they mean) and reports a band's new gain.
import { useRef, useState } from 'react';
import { Platform, Text, View, type ViewStyle } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import { EQ_BANDS_HZ, EQ_RANGE_DB, msg, number } from '@vela/core';
import { NO_RING } from '../../widgets/common/controls';
import { alpha, FocusGroup, RoundIcon, useSoundLook } from './controls';

const web = Platform.OS === 'web';
const BAND_HEIGHT = 132;
const bandLabel = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : String(hz));

/** "+3 dB", "−4.5 dB", "0 dB". */
export function decibels(value: number): string {
  const shown = number(Math.abs(value), { maximumFractionDigits: 1 });
  return msg('sound.db', { value: value > 0 ? `+${shown}` : value < 0 ? `−${shown}` : shown });
}

export function EqBlock({ bands, on, onBand, tv = false }: { bands: number[]; on: boolean; onBand(band: number, gainDb: number): void; tv?: boolean }) {
  const m = useSoundLook();
  const [width, setWidth] = useState(0);
  // A band being dragged: the curve follows it before the gain is set.
  const [preview, setPreview] = useState<{ band: number; gain: number } | null>(null);
  const shownBands = preview ? bands.map((gain, i) => (i === preview.band ? preview.gain : gain)) : bands;
  const column = width / bands.length;
  const y = (gain: number) => BAND_HEIGHT / 2 - (gain / EQ_RANGE_DB) * (BAND_HEIGHT / 2 - 8);
  const points = shownBands.map((gain, i) => ({ x: column * (i + 0.5), y: y(gain) }));
  // A smooth curve through the handles (Catmull-Rom as cubic Béziers), carried flat to both edges.
  let curve = points.length ? `M0 ${points[0]!.y} L${points[0]!.x} ${points[0]!.y}` : '';
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!, p1 = points[i]!, p2 = points[i + 1]!, p3 = points[Math.min(points.length - 1, i + 2)]!;
    curve += ` C${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6} ${p2.x - (p3.x - p1.x) / 6} ${p2.y - (p3.y - p1.y) / 6} ${p2.x} ${p2.y}`;
  }
  if (points.length) curve += ` L${width} ${points[points.length - 1]!.y}`;
  const ink = on ? m.ui.accent : m.ui.inkQuiet;
  return (
    <View style={{ marginTop: 8, opacity: on ? 1 : 0.55 }} testID="sound-eq-bands">
      <Text style={[m.text({ 'font-size': '11px', color: '$ui.inkQuiet' }), { marginBottom: 4 }]}>{msg('sound.db', { value: `+${EQ_RANGE_DB}` })}</Text>
      <View onLayout={e => setWidth(e.nativeEvent.layout.width)} style={{ height: BAND_HEIGHT }}>
        {width > 0 ? (
          <Svg width={width} height={BAND_HEIGHT} style={{ position: 'absolute', left: 0, top: 0 } as never} pointerEvents="none">
            <Line x1={0} x2={width} y1={BAND_HEIGHT / 2} y2={BAND_HEIGHT / 2} stroke={alpha(m.ui.ink, 0.18)} strokeWidth={1} strokeDasharray="3 4" />
            <Path d={`${curve} L${width} ${BAND_HEIGHT} L0 ${BAND_HEIGHT} Z`} fill={alpha(ink, 0.12)} />
            <Path d={curve} stroke={ink} strokeWidth={2.5} fill="none" strokeLinecap="round" />
          </Svg>
        ) : null}
        <FocusGroup style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row' }}>
          {bands.map((gain, i) => (
            <Band key={EQ_BANDS_HZ[i]} index={i} gain={gain} y={y} tv={tv}
              onChange={g => { setPreview(null); onBand(i, g); }} onPreview={g => setPreview(g === null ? null : { band: i, gain: g })} />
          ))}
        </FocusGroup>
      </View>
      <View style={{ flexDirection: 'row' }}>
        {EQ_BANDS_HZ.map(hz => <Text key={hz} style={[m.text({ 'font-size': '11px', 'font-weight': '600', color: '$ui.inkQuiet', 'font-variant-numeric': 'tabular-nums' }), { flex: 1, textAlign: 'center' }]}>{bandLabel(hz)}</Text>)}
      </View>
      {tv ? (
        <FocusGroup style={{ flexDirection: 'row', marginTop: 6 }}>
          {bands.map((gain, i) => {
            const label = msg('sound.band', { frequency: bandLabel(EQ_BANDS_HZ[i]!) });
            return (
              <View key={EQ_BANDS_HZ[i]} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                <RoundIcon name="plus" label={`${label} +`} onPress={() => onBand(i, gain + 1)} size={34} iconSize={14} tv />
                <RoundIcon name="minus" label={`${label} −`} onPress={() => onBand(i, gain - 1)} size={34} iconSize={14} tv />
              </View>
            );
          })}
        </FocusGroup>
      ) : null}
    </View>
  );
}

function Band({ index, gain, y, onChange, onPreview, tv }: { index: number; gain: number; y(gain: number): number; onChange(gain: number): void; onPreview(gain: number | null): void; tv: boolean }) {
  const m = useSoundLook();
  // Where the press began, inside the band and on the page: a move is the press point plus how far the
  // finger has gone, so nothing waits on a measurement.
  const press = useRef({ location: 0, page: 0 });
  const height = useRef(BAND_HEIGHT);
  const [drag, setDragState] = useState<number | null>(null);
  const setDrag = (value: number | null) => { setDragState(value); onPreview(value); };
  const [focus, setFocus] = useState(false);
  const shown = drag ?? gain;
  const at = (pageY: number) => {
    const fraction = (press.current.location + pageY - press.current.page - 8) / Math.max(1, height.current - 16);
    return Math.round((1 - Math.min(1, Math.max(0, fraction)) * 2) * EQ_RANGE_DB);
  };
  const label = msg('sound.band', { frequency: bandLabel(EQ_BANDS_HZ[index]!) });
  const lit = drag !== null || focus;
  return (
    <View onLayout={e => { height.current = e.nativeEvent.layout.height; }} accessible focusable={!tv} accessibilityRole="adjustable" accessibilityLabel={label}
      accessibilityValue={{ min: -EQ_RANGE_DB, max: EQ_RANGE_DB, now: shown, text: decibels(shown) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={e => onChange(gain + (e.nativeEvent.actionName === 'increment' ? 1 : -1))}
      onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
      onStartShouldSetResponder={() => !tv} onMoveShouldSetResponder={() => !tv}
      onResponderGrant={e => { press.current = { location: e.nativeEvent.locationY, page: e.nativeEvent.pageY }; setDrag(at(e.nativeEvent.pageY)); }}
      onResponderMove={e => setDrag(at(e.nativeEvent.pageY))}
      onResponderRelease={e => { const to = at(e.nativeEvent.pageY); setDrag(null); onChange(to); }}
      onResponderTerminate={() => setDrag(null)}
      {...(web ? { onKeyDown: (e: { key: string; preventDefault(): void }) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); onChange(gain + (e.key === 'ArrowUp' ? 1 : -1)); }
      } } as object : {})}
      testID={`sound-band-${index}`}
      style={[NO_RING, { flex: 1, alignItems: 'center' }, web && !tv ? ({ cursor: 'ns-resize' } as unknown as ViewStyle) : {}]}>
      <View pointerEvents="none" style={{ position: 'absolute', top: 8, bottom: 8, width: 2, borderRadius: 1, backgroundColor: alpha(m.ui.ink, lit ? 0.22 : 0.1) }} />
      <View pointerEvents="none" style={[{ position: 'absolute', top: y(shown) - 8, width: 16, height: 16, borderRadius: 8, backgroundColor: m.ui.ink, borderWidth: 3, borderColor: m.ui.page,
        transform: [{ scale: lit ? 1.2 : 1 }] }, lit ? m.box({ 'box-shadow': `0px 0px 0px 3px ${m.ui.focusHalo}` }) : {}]} />
      {lit ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: '50%', width: 60, marginLeft: -30, top: Math.max(0, y(shown) - 30), alignItems: 'center' }}>
          <Text numberOfLines={1} style={m.text({ 'font-size': '11px', 'font-weight': '700', color: '$ui.ink', 'font-variant-numeric': 'tabular-nums' })}>{decibels(shown)}</Text>
        </View>
      ) : null}
    </View>
  );
}
