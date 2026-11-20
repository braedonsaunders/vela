import { Link, router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SkinRoot } from '@vela/skin';
import { useVela } from '../src/vela';

export default function NotFound() {
  const vela = useVela();
  const host = vela.host('home', 'home');
  const shell = vela.doc?.shell;
  const content = (
    <View style={styles.page} accessibilityRole="summary">
      <Text style={styles.eyebrow}>404</Text>
      <Text style={styles.title}>This page drifted out of range.</Text>
      <Text style={styles.copy}>The address doesn’t match anything in Vela.</Text>
      <Link href="/" asChild>
        <Pressable accessibilityRole="link" onPress={() => router.replace('/')} style={styles.button}>
          <Text style={styles.buttonText}>Go home</Text>
        </Pressable>
      </Link>
    </View>
  );
  if (!host || !shell) return content;
  return <SkinRoot host={{ ...host, children: content }} node={shell} />;
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32, backgroundColor: '#090b0e' },
  eyebrow: { color: '#9da7b4', fontSize: 15, fontWeight: '700', letterSpacing: 2 },
  title: { color: '#f5f1e9', fontSize: 34, fontWeight: '700', textAlign: 'center' },
  copy: { color: '#c0c6cf', fontSize: 17, textAlign: 'center' },
  button: { marginTop: 12, borderRadius: 999, backgroundColor: '#f5f1e9', paddingHorizontal: 22, paddingVertical: 12 },
  buttonText: { color: '#090b0e', fontSize: 16, fontWeight: '700' },
});
