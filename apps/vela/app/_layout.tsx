import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { VelaProvider } from '../src/vela';

export default function Layout() {
  return (
    <VelaProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#090b0e' }, animation: 'fade' }} />
    </VelaProvider>
  );
}
