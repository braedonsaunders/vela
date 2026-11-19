import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSideInsets, VelaProvider } from '../src/vela';

export default function Layout() {
  return (
    <VelaProvider>
      <StatusBar style="light" />
      <Screens />
    </VelaProvider>
  );
}

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
          native controller on iOS, hiding the playing film and its controls (elsewhere a card is above). */}
      <Stack.Screen name="watch/[id]" options={{ presentation: Platform.isTV ? 'containedModal' : Platform.OS === 'ios' ? 'fullScreenModal' : 'card', contentStyle: { paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0, backgroundColor: '#000' } }} />
      <Stack.Screen name="row/[id]" options={{ presentation: Platform.isTV ? 'containedModal' : Platform.OS === 'ios' ? 'fullScreenModal' : 'card' }} />
      <Stack.Screen name="person" options={{ presentation: Platform.isTV ? 'containedTransparentModal' : 'transparentModal', contentStyle: { ...bars, backgroundColor: 'transparent' } }} />
    </Stack>
  );
}
