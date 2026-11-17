import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import { VelaProvider } from '../src/vela';

export default function Layout() {
  return (
    <VelaProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#090b0e' }, animation: 'fade' }}>
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
        <Stack.Screen name="watch/[id]" options={{ presentation: Platform.isTV ? 'containedModal' : 'card' }} />
        <Stack.Screen name="person" options={{ presentation: Platform.isTV ? 'containedTransparentModal' : 'transparentModal', contentStyle: { backgroundColor: 'transparent' } }} />
      </Stack>
    </VelaProvider>
  );
}
