// The appearance picker (the documents' `openPicker` action): every built-in skin document by
// its name, tagline, preview and swatches. Choosing one applies it at once and is remembered on
// this device. It is the app's own chrome, drawn the same under every document.
import { Image, type ImageSource } from 'expo-image';
import { useEffect, useState, type ReactNode } from 'react';
import {
  BackHandler,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { SkinDocument } from '../../../packages/protocol/skin';
import { msg } from '@vela/core';

interface Props {
  documents: SkinDocument[];
  current: number;
  image(path: string): ImageSource | number | undefined;
  onPick(index: number): void;
  onClose(): void;
}

export function AppearancePicker({ documents, current, image, onPick, onClose }: Props) {
  const { width } = useWindowDimensions();
  const small = width < 640;

  useEffect(() => {
    // Web has no hardware Back (react-native-web logs an error for BackHandler): Escape closes.
    if (Platform.OS !== 'web') {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
      return () => sub.remove();
    }
    if (typeof window === 'undefined') return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <View style={styles.scrim} accessibilityViewIsModal>
      <View style={[styles.panel, small && styles.panelSmall]}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">{msg('ui.appearance')}</Text>
          <Choice style={styles.close} focusedStyle={styles.closeFocused} label={msg('ui.close')} onPress={onClose}>
            <Text style={styles.closeText}>✕</Text>
          </Choice>
        </View>
        <ScrollView contentContainerStyle={styles.grid}>
          {documents.map((doc, index) => (
            <DocumentCard
              key={doc.id}
              doc={doc}
              preview={doc.preview ? image(doc.preview) : undefined}
              selected={index === current}
              small={small}
              onPress={() => onPick(index)}
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

interface DocumentCardProps {
  doc: SkinDocument;
  preview: ImageSource | number | undefined;
  selected: boolean;
  small: boolean;
  onPress(): void;
}

/** One document: its preview, name, tagline and up to six swatches. */
function DocumentCard({ doc, preview, selected, small, onPress }: DocumentCardProps) {
  return (
    <Choice
      label={doc.name}
      selected={selected}
      preferred={selected}
      onPress={onPress}
      style={[styles.card, small && styles.cardSmall, selected && styles.cardSelected]}
      focusedStyle={styles.cardFocused}
    >
      <View style={styles.preview}>
        {preview ? <Image source={preview} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      </View>
      <View style={styles.meta}>
        <Text style={styles.name} numberOfLines={1}>{doc.name}</Text>
        {doc.tagline ? <Text style={styles.tagline} numberOfLines={2}>{doc.tagline}</Text> : null}
        <View style={styles.swatches}>
          {doc.swatches.slice(0, 6).map((colour, i) => (
            <View key={i} style={[styles.swatch, { backgroundColor: colour }]} />
          ))}
        </View>
      </View>
    </Choice>
  );
}

interface ChoiceProps {
  label: string;
  selected?: boolean;
  /** Takes the TV focus engine's first focus. */
  preferred?: boolean;
  onPress(): void;
  style: StyleProp<ViewStyle>;
  focusedStyle: ViewStyle;
  children: ReactNode;
}

/** A focusable choice: keyboard, pointer and the TV focus engine show the same focus look. */
function Choice({ label, selected, preferred, onPress, style, focusedStyle, children }: ChoiceProps) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      hasTVPreferredFocus={preferred}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onHoverIn={() => setFocused(true)}
      onHoverOut={() => setFocused(false)}
      style={[style, focused && focusedStyle]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(5, 6, 8, 0.86)', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  panel: { width: '88%', maxWidth: 1480, maxHeight: '88%', borderRadius: 28, backgroundColor: '#12151a', borderWidth: 1, borderColor: '#ffffff1f', padding: 32, gap: 24 },
  panelSmall: { width: '94%', padding: 18, borderRadius: 22 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#f5f1e9', fontSize: 28, fontWeight: '600' },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff12' },
  closeFocused: { backgroundColor: '#ffffff33' },
  closeText: { color: '#f5f1e9', fontSize: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, paddingBottom: 8 },
  card: { width: 300, borderRadius: 18, backgroundColor: '#1b1f26', borderWidth: 2, borderColor: 'transparent', overflow: 'hidden' },
  cardSmall: { width: '100%' },
  cardSelected: { borderColor: '#dcb998' },
  cardFocused: { borderColor: '#f5f1e9', transform: [{ scale: 1.04 }] },
  preview: { aspectRatio: 16 / 9, backgroundColor: '#0b0d10' },
  meta: { padding: 16, gap: 6 },
  name: { color: '#f5f1e9', fontSize: 18, fontWeight: '600' },
  tagline: { color: '#b6b8bb', fontSize: 14, lineHeight: 19 },
  swatches: { flexDirection: 'row', gap: 6, marginTop: 6 },
  swatch: { width: 16, height: 16, borderRadius: 8, borderWidth: 1, borderColor: '#ffffff33' },
});
