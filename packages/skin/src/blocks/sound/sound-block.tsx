// The Sound block: AutoMix, volume levelling and the equalizer, over the settings and decisions in
// core (packages/core/src/audio/sound.ts, store.audio.setSound). A self-contained rich block: the music
// widgets draw it beside the page (the bar's Sound button) and as Now Playing's Sound tab today, and the
// Listen experience documents draw it unchanged (docs/sound.md). The settings are this device's own.
// Spoken word has no AutoMix (a book always plays straight through) and is offered Spoken word first.
// `tv` swaps sliders for − and + (a remote's arrows move the focus).
import type { ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import {
  albumInOrder, currentInQueue, EQ_PRESETS, LEVELLING_MODES, levellingGain, msg, number, PREAMP_RANGE_DB,
  TRANSITION_LENGTHS, withBand, withPreset, type SoundSettings,
} from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { alpha, Chip, FocusGroup, RoundIcon, Slider, SoundTV, Toggle, useSoundLook } from './controls';
import { decibels, EqBlock } from './eq';

/** The Sound block. `onClose` draws its own header (beside the page); inside Now Playing the tab names it. */
export function SoundBlock({ onClose, scroll = true, tv = false }: { onClose?(): void; scroll?: boolean; tv?: boolean }) {
  const m = useSoundLook();
  const store = useVela();
  const audio = useVelaState(s => s.audio);
  const sound = audio.sound;
  const item = currentInQueue(audio.queue);
  const cls = item?.media?.class;
  const spoken = cls === 'audiobook' || cls === 'podcast';
  const set = (next: SoundSettings) => store.audio.setSound(next);
  const automix = (patch: Partial<SoundSettings['automix']>) => set({ ...sound, automix: { ...sound.automix, ...patch } });
  const levelling = (patch: Partial<SoundSettings['levelling']>) => set({ ...sound, levelling: { ...sound.levelling, ...patch } });
  const body = (
    <View style={{ gap: 4, paddingBottom: 12 }}>
      {spoken ? null : (
        <Section title={msg('sound.automix')} hint={msg('sound.automixHint')} on={sound.automix.on} onToggle={on => automix({ on })} testID="sound-automix">
          {sound.automix.on ? <>
            <Label text={msg('sound.transition')} />
            <FocusGroup style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {TRANSITION_LENGTHS.map(length => (
                <Chip key={String(length)} label={length === 'smart' ? msg('sound.transitionSmart') : msg('sound.seconds', { count: number(length) })}
                  on={sound.automix.length === length} onPress={() => automix({ length })} />
              ))}
            </FocusGroup>
            <Hint text={sound.automix.length === 'smart' ? msg('sound.transitionSmartHint') : msg('sound.transitionFixedHint', { count: number(sound.automix.length) })} />
            <ToggleRow label={msg('sound.keepAlbumsGapless')} hint={msg('sound.keepAlbumsGaplessHint')} on={sound.automix.keepAlbumsGapless} onToggle={keepAlbumsGapless => automix({ keepAlbumsGapless })} testID="sound-gapless" />
          </> : null}
        </Section>
      )}
      <Section title={msg('sound.levelling')} hint={msg(spoken ? 'sound.levellingSpokenHint' : 'sound.levellingHint')} testID="sound-levelling">
        {/* Spoken word has no album-or-track choice to make: on is Smart (a book's parts as one, an episode alone). */}
        <FocusGroup style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {spoken ? <>
            <Chip label={msg('sound.levelling.off')} on={sound.levelling.mode === 'off'} onPress={() => levelling({ mode: 'off' })} />
            <Chip label={msg('sound.levelling.on')} on={sound.levelling.mode !== 'off'} onPress={() => { if (sound.levelling.mode === 'off') levelling({ mode: 'smart' }); }} />
          </> : LEVELLING_MODES.map(mode => <Chip key={mode} label={msg(`sound.levelling.${mode}`)} on={sound.levelling.mode === mode} onPress={() => levelling({ mode })} />)}
        </FocusGroup>
        <Hint text={msg(spoken && sound.levelling.mode !== 'off' ? 'sound.levelling.spokenOnHint' : `sound.levelling.${sound.levelling.mode}Hint`)} />
        {sound.levelling.mode !== 'off' ? <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 }}>
            <Text style={[m.text({ 'font-size': '14px', 'font-weight': '600', color: '$ui.ink' }), { width: 74 }]}>{msg('sound.preamp')}</Text>
            {tv ? <Stepper tv={tv} value={sound.levelling.preampDb} min={-PREAMP_RANGE_DB} max={PREAMP_RANGE_DB} onChange={preampDb => levelling({ preampDb })} label={msg('sound.preamp')} />
              : <Slider value={(sound.levelling.preampDb + PREAMP_RANGE_DB) / (PREAMP_RANGE_DB * 2)} onChange={f => levelling({ preampDb: Math.round(f * PREAMP_RANGE_DB * 2 - PREAMP_RANGE_DB) })} label={msg('sound.preamp')} testID="sound-preamp" />}
            <Text style={[m.text({ 'font-size': '13px', color: '$ui.inkSecondary', 'font-variant-numeric': 'tabular-nums' }), { width: 50, textAlign: 'right' }]}>{decibels(sound.levelling.preampDb)}</Text>
          </View>
          <ToggleRow label={msg('sound.preventClipping')} hint={msg('sound.preventClippingHint')} on={sound.levelling.preventClipping} onToggle={preventClipping => levelling({ preventClipping })} testID="sound-clipping" />
          <NowLevel />
        </> : null}
      </Section>
      <Section title={msg('sound.eq')} hint={msg('sound.eqHint')} on={sound.eq.on} onToggle={on => set({ ...sound, eq: { ...sound.eq, on } })} testID="sound-eq">
        <FocusGroup style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {[...EQ_PRESETS].sort((a, b) => (spoken ? Number(!!b.spoken) - Number(!!a.spoken) : 0)).map(p => (
            <Chip key={p.id} label={msg(`sound.preset.${p.id}`)} on={sound.eq.on && sound.eq.preset === p.id} onPress={() => set(withPreset(sound, p.id))} />
          ))}
          {sound.eq.preset === 'custom' ? <Chip label={msg('sound.preset.custom')} on={sound.eq.on} onPress={() => set({ ...sound, eq: { ...sound.eq, on: true } })} /> : null}
        </FocusGroup>
        <EqBlock tv={tv} bands={sound.eq.bands} on={sound.eq.on} onBand={(band, gain) => set(withBand(sound, band, gain))} />
      </Section>
      <Text style={[m.text({ 'font-size': '12px', color: '$ui.inkQuiet' }), { paddingHorizontal: 18, paddingTop: 6 }]}>{spoken ? `${msg('sound.spokenNote')} ${msg('sound.deviceNote')}` : msg('sound.deviceNote')}</Text>
    </View>
  );
  if (!onClose) return <SoundTV.Provider value={tv}><View testID="sound-panel">{body}</View></SoundTV.Provider>;
  return (
    <SoundTV.Provider value={tv}>
    <View style={{ flex: 1 }} testID="sound-panel">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 6 }}>
        <Text accessibilityRole="header" style={m.text({ 'font-size': '18px', 'font-weight': '750', color: '$ui.ink' })}>{msg('music.sound')}</Text>
        <RoundIcon name="close" label={msg('ui.close')} onPress={onClose} size={32} iconSize={16} />
      </View>
      {scroll ? <ScrollView style={{ flex: 1 }}>{body}</ScrollView> : body}
    </View>
    </SoundTV.Provider>
  );
}

/** What levelling does to the song playing, in words. */
function NowLevel() {
  const m = useSoundLook();
  const store = useVela();
  const audio = useVelaState(s => s.audio);
  const item = currentInQueue(audio.queue);
  if (!item) return null;
  const loudness = item.media?.loudness;
  const line = !store.music.loudnessAvailable && !loudness ? msg('sound.unavailable')
    : !loudness ? msg('sound.nowUnmeasured')
    : (() => {
      const level = levellingGain(loudness, audio.sound.levelling, { albumInOrder: albumInOrder(audio.queue, item) });
      const spoken = item.media?.class === 'audiobook' || item.media?.class === 'podcast';
      return [msg(level.applied === 'album' ? (spoken ? 'sound.nowBook' : 'sound.nowAlbum') : 'sound.nowTrack', { gain: decibels(level.gainDb) }),
        level.limited ? msg('sound.nowLimited') : '', loudness.source === 'provider' ? msg('sound.nowEstimate') : ''].filter(Boolean).join(' · ');
    })();
  return (
    <View testID="sound-now" style={[{ marginTop: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 }, m.box({ 'background-color': alpha(m.ui.ink, 0.06) })]}>
      <Text numberOfLines={1} style={m.text({ 'font-size': '12px', 'font-weight': '650', color: '$ui.inkQuiet' })}>{item.name}</Text>
      <Text style={m.text({ 'font-size': '13px', color: '$ui.inkSecondary' })}>{line}</Text>
    </View>
  );
}

function Section({ title, hint, on, onToggle, children, testID }: { title: string; hint: string; on?: boolean; onToggle?(on: boolean): void; children?: ReactNode; testID?: string }) {
  const m = useSoundLook();
  return (
    <View testID={testID} style={{ paddingHorizontal: 18, paddingVertical: 14, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text accessibilityRole="header" style={m.text({ 'font-size': '16px', 'font-weight': '750', color: '$ui.ink' })}>{title}</Text>
          <Text style={m.text({ 'font-size': '13px', color: '$ui.inkQuiet' })}>{hint}</Text>
        </View>
        {onToggle ? <Toggle on={!!on} onToggle={onToggle} label={title} testID={testID && `${testID}-toggle`} /> : null}
      </View>
      {children}
      <View style={[{ height: 1, marginTop: 6 }, m.box({ 'background-color': '$ui.glassEdge' })]} />
    </View>
  );
}

function Label({ text }: { text: string }) {
  const m = useSoundLook();
  return <Text style={m.text({ 'font-size': '12px', 'font-weight': '700', 'letter-spacing': '0.06em', 'text-transform': 'uppercase', color: '$ui.inkQuiet' })}>{text}</Text>;
}

function Hint({ text }: { text: string }) {
  const m = useSoundLook();
  return <Text style={m.text({ 'font-size': '13px', 'line-height': '1.4', color: '$ui.inkSecondary' })}>{text}</Text>;
}

function ToggleRow({ label, hint, on, onToggle, testID }: { label: string; hint: string; on: boolean; onToggle(on: boolean): void; testID?: string }) {
  const m = useSoundLook();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={m.text({ 'font-size': '14px', 'font-weight': '600', color: '$ui.ink' })}>{label}</Text>
        <Text style={m.text({ 'font-size': '12px', color: '$ui.inkQuiet' })}>{hint}</Text>
      </View>
      <Toggle on={on} onToggle={onToggle} label={label} testID={testID} />
    </View>
  );
}

/** − and + for a TV, where a slider's arrows would move the focus instead. */
function Stepper({ value, min, max, onChange, label, tv }: { value: number; min: number; max: number; onChange(value: number): void; label: string; tv: boolean }) {
  return (
    <FocusGroup style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <RoundIcon name="minus" label={`${label} −`} onPress={() => onChange(Math.max(min, value - 1))} size={40} iconSize={18} tv={tv} />
      <RoundIcon name="plus" label={`${label} +`} onPress={() => onChange(Math.min(max, value + 1))} size={40} iconSize={18} tv={tv} />
    </FocusGroup>
  );
}
