// Manage libraries, from the profile menu: the viewer's order for the libraries in the navigation,
// and which ones it shows, kept on this device for this server and viewer (core
// store/library-orders.ts). Up and Down move a library one place, so a remote works as well as
// touch; a change applies at once. Search and the home rows still read every library.
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { router } from '../router';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { orderLibraries, viewerLibraryOrder } from '@vela/core';
import { useVelaState } from '@vela/core/react';
import { FocusPressable as Pressable } from '@vela/skin/src/focus';
import { useFocusClaim } from '@vela/skin/src/widgets/common/focus-claim';
import { useVela } from '../vela';

// The layout pads only Android's system bars (app/_layout.tsx), so on iOS and the web the screen
// keeps clear of the status bar and the home indicator itself, as Downloads does; a TV has none.
const BARS: Edge[] = Platform.isTV || Platform.OS === 'android' ? [] : ['top', 'bottom'];

export function LibrariesScreen() {
  const { store } = useVela();
  const list = useVelaState(state => state.libraries);
  const libraries = list.value;
  const preference = useVelaState(viewerLibraryOrder);
  const rows = useMemo(() => orderLibraries(libraries ?? [], preference), [libraries, preference]);
  const [confirming, setConfirming] = useState(false);
  // The control that takes focus after the list changes under it: `<library id>:up`, `:down`, 'reset'.
  const [refocus, setRefocus] = useState('');
  const claimed = useCallback(() => setRefocus(''), []);
  const names = new Map<string, number>();
  for (const { library } of rows) names.set(library.name, (names.get(library.name) ?? 0) + 1);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const move = (id: string, step: -1 | 1) => {
    const to = rows.findIndex(row => row.library.id === id) + step;
    if (step < 0) store.libraryOrders.moveUp(id); else store.libraryOrders.moveDown(id);
    // Focus stays on the button pressed, or moves to the other one once the library reaches an end.
    const end = step < 0 ? to === 0 : to === rows.length - 1;
    setRefocus(`${id}:${(step < 0) !== end ? 'up' : 'down'}`);
  };
  const reset = () => { store.libraryOrders.reset(); setConfirming(false); setRefocus('reset'); };
  return <SafeAreaView edges={BARS} style={styles.page}>
    <View style={styles.top}><Control label="Back" onPress={back} style={styles.round}><Text style={styles.roundText}>‹</Text></Control>
      <View style={{ flex: 1 }}><Text style={styles.eyebrow}>ON THIS DEVICE</Text><Text accessibilityRole="header" style={styles.title}>Manage libraries</Text></View>
    </View>
    <Text style={styles.hint}>Choose the order of your libraries in the menu, and hide the ones you don’t use. Search still finds everything.</Text>
    {list.load === 'failed' && !libraries ? <View style={styles.failed}>
      <Text accessibilityRole="alert" style={styles.error}>Couldn’t load the libraries from this server.</Text>
      <Control label="Try again" onPress={() => void store.home.libraries()} style={[styles.button, styles.retry]}><Text style={styles.buttonText}>Try again</Text></Control>
    </View>
      : !libraries ? <ActivityIndicator color="#d5a676" size="large" />
      : !libraries.length ? <Text style={styles.empty}>This server has no libraries to show yet.</Text> : null}
    <ScrollView style={styles.list} contentContainerStyle={styles.rows}>
      {rows.map(({ library, hidden }, index) => {
        const shared = names.get(library.name)! > 1;
        const detail = [shared ? library.kind : '', hidden ? 'Hidden' : ''].filter(Boolean).join(' · ');
        // Two libraries with one name differ by their kind, on screen and in the button labels.
        const named = shared ? `${library.name}, ${library.kind}` : library.name;
        return <View key={library.id} testID={`library-row-${library.id}`} style={styles.row}>
          <View style={styles.name}>
            <Text style={[styles.nameText, hidden && styles.hidden]}>{library.name}</Text>
            {detail ? <Text style={styles.detail}>{detail}</Text> : null}
          </View>
          <View style={styles.controls}>
            <Control label={`Move ${named} up`} disabled={index === 0} preferred={refocus === `${library.id}:up`} onClaimed={claimed}
              onPress={() => move(library.id, -1)} style={[styles.round, styles.step]}><Text style={styles.arrow}>↑</Text></Control>
            <Control label={`Move ${named} down`} disabled={index === rows.length - 1} preferred={refocus === `${library.id}:down`} onClaimed={claimed}
              onPress={() => move(library.id, 1)} style={[styles.round, styles.step]}><Text style={styles.arrow}>↓</Text></Control>
            <Control label={`${hidden ? 'Show' : 'Hide'} ${named}`} onPress={() => store.libraryOrders.setHidden(library.id, !hidden)}
              style={[styles.button, styles.toggle, !hidden && styles.quiet]}><Text style={styles.buttonText}>{hidden ? 'Show' : 'Hide'}</Text></Control>
          </View>
        </View>;
      })}
      {confirming ? <View style={styles.confirm}><Text style={styles.confirmText}>Put every library back in the server’s order and show them all?</Text>
        <View style={styles.controls}>
          <Control label="Cancel" preferred onPress={() => { setConfirming(false); setRefocus('reset'); }} style={[styles.button, styles.quiet]}><Text style={styles.buttonText}>Cancel</Text></Control>
          <Control label="Reset" onPress={reset} style={styles.button}><Text style={styles.buttonText}>Reset</Text></Control>
        </View></View>
        : rows.length ? <Control label="Reset" preferred={refocus === 'reset'} onClaimed={claimed} onPress={() => setConfirming(true)}
          style={[styles.button, styles.quiet, styles.reset]}><Text style={styles.buttonText}>Reset</Text></Control> : null}
    </ScrollView>
  </SafeAreaView>;
}

/** A button that shows a TV's or keyboard's focus natively (on the web FocusPressable's ring
 * shows it). Once `preferred`, it takes focus (the TV's focus engine, the web's) and says so. */
function Control({ label, disabled, preferred, onClaimed, onPress, style, children }: {
  label: string;
  disabled?: boolean;
  preferred?: boolean;
  onClaimed?(): void;
  onPress(): void;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const claim = useFocusClaim(preferred && !disabled);
  const [focused, setFocused] = useState(false);
  const button = useRef<ComponentRef<typeof Pressable>>(null);
  useEffect(() => {
    if (disabled) setFocused(false);
  }, [disabled]);
  useEffect(() => {
    if (!preferred || disabled) return;
    if (Platform.OS === 'web') button.current?.focus();
    onClaimed?.();
  }, [preferred, disabled, onClaimed]);
  return <Pressable ref={button} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled}
    focusable={!disabled} hasTVPreferredFocus={claim} onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={[styles.control, style, disabled && styles.disabled, focused && Platform.OS !== 'web' && styles.focused]}>{children}</Pressable>;
}

const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: '#0d0f13', paddingHorizontal: 30, paddingTop: 30 }, top: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }, eyebrow: { color: '#b9865f', fontSize: 10, fontWeight: '800', letterSpacing: 2 }, title: { color: '#f5f0e8', fontSize: 34, fontWeight: '700' },
  hint: { color: '#aeb3bd', marginBottom: 20, maxWidth: 780 }, list: { flex: 1 }, rows: { gap: 10, paddingBottom: 40, maxWidth: 780 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, backgroundColor: '#22262d', borderRadius: 12, padding: 10 }, name: { flexGrow: 1, flexBasis: 200, minWidth: 0 }, nameText: { color: '#fff', fontSize: 17, fontWeight: '700' }, hidden: { color: '#878d98' }, detail: { color: '#aeb3bd', marginTop: 3 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 8 }, control: { borderWidth: 2, borderColor: 'transparent' }, focused: { borderColor: '#f5f1e9' }, disabled: { opacity: .3 },
  round: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#242830', alignItems: 'center', justifyContent: 'center' }, roundText: { color: '#fff', fontSize: 36, lineHeight: 38 }, step: { backgroundColor: '#353a44' }, arrow: { color: '#fff', fontSize: 19 },
  button: { alignSelf: 'center', minHeight: 44, backgroundColor: '#915b3b', borderRadius: 12, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 18 }, buttonText: { color: '#fff', fontWeight: '700' }, toggle: { minWidth: 88 }, quiet: { backgroundColor: '#3b404a' }, reset: { alignSelf: 'flex-start', marginTop: 10 },
  failed: { alignItems: 'flex-start', gap: 12 }, error: { color: '#ffd0c9', backgroundColor: '#512a2a', padding: 10, borderRadius: 10 }, retry: { alignSelf: 'flex-start' }, empty: { color: '#aeb3bd', fontSize: 17, marginTop: 30 },
  confirm: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, backgroundColor: '#352425', borderRadius: 12, padding: 10, marginTop: 10 }, confirmText: { color: '#ffd7d1', flexGrow: 1, flexBasis: 200 } });
