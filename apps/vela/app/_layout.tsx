import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSideInsets, VelaProvider } from '../src/vela';

export default function Layout() {
  return (
    <VelaProvider>
      <StatusBar style="light" />
      {/* An Android phone draws edge to edge: the top and bottom bars are kept clear here, the sides by Screens. */}
      {Platform.OS === 'android' && !Platform.isTV
        ? <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: '#090b0e' }}><Screens /></SafeAreaView>
        : <Screens />}
    </VelaProvider>
  );
}

function Screens() {
  // Every screen keeps clear of the safe area at its sides (a title or person page pads inside its scrim).
  const sides = useSideInsets();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: sides, animation: 'fade' }}>
      <Stack.Screen
        name="title/[id]"
        // On a TV the title page is presented within the app's root view: react-native-tvos finds
        // the root view to move focus (a route's first focus, a preferred control), and a page
        // presented in a view controller of its own is outside it, so no focus request lands.
        options={{
          presentation: Platform.isTV ? 'containedTransparentModal' : 'transparentModal',
          contentStyle: { backgroundColor: 'transparent' },
        }}
      />
      {/* Over a title page (contained, above) the player is contained too on a TV: pushed as a
          card it went under the title page's container, which kept the remote's focus and input. */}
      <Stack.Screen name="watch/[id]" options={{ presentation: Platform.isTV ? 'containedModal' : 'card', contentStyle: { ...sides, backgroundColor: '#000' } }} />
      <Stack.Screen name="person" options={{ presentation: Platform.isTV ? 'containedTransparentModal' : 'transparentModal', contentStyle: { backgroundColor: 'transparent' } }} />
    </Stack>
  );
}
