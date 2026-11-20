// Capability-backed title mutations shown on every built-in title surface.
import { msg, type TitleActions as Actions } from '@vela/core';
import { useVela } from '@vela/core/react';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { FocusPressable } from '../focus';
import { useHost } from '../host';
import { useLook } from './common/look';

export function TitleActions() {
  const vela = useVela();
  const host = useHost();
  const look = useLook();
  const id = host.env.detail?.title[0]?.id ?? '';
  const [actions, setActions] = useState<Actions | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setActions(null);
    if (id) void vela.catalogue.titleActions(id).then(value => { if (live) setActions(value); }).catch(() => {});
    return () => { live = false; };
  }, [vela, id]);
  if (!actions || (!actions.watched && !actions.favorite && !actions.watchlist)) return null;

  const change = async (value: { played?: boolean; favorite?: boolean; watchlisted?: boolean }) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await vela.catalogue.setTitleWatch(id, value);
      setActions(await vela.catalogue.titleActions(id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : msg('cardMenu.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ alignItems: 'flex-end', maxWidth: '100%' }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, padding: 4 }}>
        {actions.watched ? <ActionButton disabled={busy} label={msg(actions.watch.played ? 'cardMenu.markUnwatched' : 'cardMenu.markWatched')} run={() => void change({ played: !actions.watch.played })} /> : null}
        {actions.favorite ? <ActionButton disabled={busy} label={msg(actions.watch.favorite ? 'cardMenu.removeFavourite' : 'cardMenu.addFavourite')} run={() => void change({ favorite: !actions.watch.favorite })} /> : null}
        {actions.watchlist ? <ActionButton disabled={busy} label={msg(actions.watch.watchlisted ? 'cardMenu.removeWatchlist' : 'cardMenu.addWatchlist')} run={() => void change({ watchlisted: !actions.watch.watchlisted })} /> : null}
      </ScrollView>
      {error ? <Text accessibilityRole="alert" style={look.text({ 'font-size': '13px', color: '$ui.accent' })}>{error}</Text> : null}
    </View>
  );
}

function ActionButton({ label, run, disabled }: { label: string; run(): void; disabled: boolean }) {
  const look = useLook();
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pressed, setPressed] = useState(false);
  const lit = hover || focus;
  return (
    <FocusPressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
      disabled={disabled} onPress={run}
      onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
      onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
      onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
      style={[
        look.box({
          'min-height': '40px', padding: '8px 14px', 'justify-content': 'center',
          'border-radius': '9999px', 'background-color': lit ? '$ui.controlHover' : '$ui.control',
          border: focus ? '1px solid $ui.accent' : '1px solid $ui.glassEdge',
          'backdrop-filter': 'blur(16px)',
        }),
        pressed ? { opacity: 0.7, transform: [{ scale: 0.985 }] } : null,
        disabled ? { opacity: 0.5 } : null,
      ]}
    >
      <Text style={look.text({ 'font-size': '13px', 'font-weight': lit ? '650' : '500' })}>{label}</Text>
    </FocusPressable>
  );
}
