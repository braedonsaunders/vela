import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform, processColor } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSideInsets, useVela, VelaProvider } from '../src/vela';
import { resolveUi } from '@vela/skin/src/resolve/ui';
import { systemBarStyle } from '../src/system-bar-style';
import { AudioDock } from '../src/media/audio';
import { LiveAlerts, LiveOverlayProvider } from '../src/live-alerts';

export default function Layout() {
  return (
    <VelaProvider>
      <LiveOverlayProvider>
        <SystemBar />
        <Screens />
        <AudioDock />
        <LiveAlerts />
      </LiveOverlayProvider>
    </VelaProvider>
  );
}

function SystemBar() {
  const { doc } = useVela();
  const colour = doc ? processColor(resolveUi(doc.document.ui).page) : undefined;
  const style = Platform.OS === 'android'
    ? systemBarStyle(typeof colour === 'number' ? colour : undefined) : 'light';
  return <StatusBar style={style} />;
}

const sides0 = { paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0 };

function Screens() {
  // Content screens keep clear of system bars; playback owns a full-display surface.
  const sides = useSideInsets();
  const insets = useSafeAreaInsets();
  const bars = Platform.OS === 'android' && !Platform.isTV
    ? { paddingTop: insets.top, paddingBottom: insets.bottom } : {};
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { ...sides, ...bars }, animation: 'fade' }}>
      <Stack.Screen name="(auth)/sign-in" options={{ contentStyle: { paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0 } }} />
      <Stack.Screen name="(auth)/connect" options={{ contentStyle: { paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0 } }} />
      <Stack.Screen
        name="title/[id]"
        // On a TV the title page is presented within the app's root view: react-native-tvos finds
        // the root view to move focus (a route's first focus, a preferred control), and a page
        // presented in a view controller of its own is outside it, so no focus request lands.
        options={{
          presentation: Platform.isTV ? 'containedTransparentModal' : 'transparentModal',
          contentStyle: { ...bars, backgroundColor: 'transparent' },
        }}
      />
      {/* Playback must present above title/person modals. A card is pushed beneath their
          native controller on iOS and Android, hiding the playing film and its controls. */}
      <Stack.Screen name="watch/[id]" options={{ presentation: Platform.isTV ? 'containedModal' : Platform.OS === 'ios' || Platform.OS === 'android' ? 'fullScreenModal' : 'card', ...(Platform.OS === 'android' ? { statusBarHidden: true, navigationBarHidden: true } : {}), contentStyle: { paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0, backgroundColor: '#000' } }} />
      {/* The reader grows out of the book's cover over the page it opened from, so that page stays
          drawn beneath it (media/reader.tsx). Like playback it presents above the title modal, and
          it keeps clear of the system bars itself, so its paper runs beneath them. */}
      <Stack.Screen name="multiview" options={{ presentation: Platform.isTV ? 'containedModal' : Platform.OS === 'ios' || Platform.OS === 'android' ? 'fullScreenModal' : 'card', ...(Platform.OS === 'android' ? { statusBarHidden: true, navigationBarHidden: true } : {}), contentStyle: { paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0, backgroundColor: '#000' } }} />
      <Stack.Screen name="read/[id]" options={{ presentation: Platform.isTV ? 'containedModal' : 'transparentModal', contentStyle: { ...sides0, backgroundColor: 'transparent' } }} />
      {/* Apple TV's system search screen opens over the section it was asked from (apple-tv-search.tsx). */}
      <Stack.Screen name="search" options={{ presentation: Platform.isTV ? 'containedModal' : 'card' }} />
      <Stack.Screen name="row/[id]" options={{ presentation: Platform.isTV ? 'containedModal' : Platform.OS === 'ios' ? 'fullScreenModal' : 'card' }} />
      {/* A game's page (Sports) opens over its section like a title page. */}
      <Stack.Screen
        name="game/[id]"
        options={{
          presentation: Platform.isTV ? 'containedTransparentModal' : 'transparentModal',
          contentStyle: { ...bars, backgroundColor: 'transparent' },
        }}
      />
      <Stack.Screen name="person" options={{ presentation: Platform.isTV ? 'containedTransparentModal' : 'transparentModal', contentStyle: { ...bars, backgroundColor: 'transparent' } }} />
    </Stack>
  );
}
