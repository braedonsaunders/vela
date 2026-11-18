// Keep a real fallback under every loading or refused signed image, on web and native.
import { useRef, useState } from 'react';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import { HeroPreview } from './preview';
import { resolveUi } from '../../resolve/ui';
import { useHost, type WidgetProps } from '../../host';

export function HeroArtwork({ ctx }: WidgetProps) {
  const host = useHost();
  const hero = ctx.hero;
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [revision, setRevision] = useState(0);
  const retried = useRef(new Set<string>());
  if (!hero) return null;
  const fail = (url: string, kind: 'poster' | 'backdrop') => {
    setFailed(current => new Set(current).add(url));
    const key = `${hero.id}:${kind}`;
    if (retried.current.has(key)) return;
    // Remember before asking: even a server returning the same dead grant is retried only once.
    retried.current.add(key);
    void host.refreshHeroArtwork?.(hero.id).then(() => {
      setFailed(current => { const next = new Set(current); next.delete(url); return next; });
      setRevision(value => value + 1);
    }).catch(() => {});
  };
  const ui = resolveUi(host.doc.document.ui);
  const ground = String(ui.page);
  const accent = hero.accent || String(ui.accent);
  return <View style={StyleSheet.absoluteFill} pointerEvents="none">
    <LinearGradient colors={[accent, ground]} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
    {!!hero.poster && !failed.has(hero.poster) && <Image key={`${hero.poster}:${revision}`} source={host.image(hero.poster)}
      style={[StyleSheet.absoluteFill, { transform: [{ scale: 1.15 }] }]} contentFit="cover" blurRadius={55}
      onError={() => fail(hero.poster, 'poster')} onLoad={() => retried.current.delete(`${hero.id}:poster`)} />}
    {!!hero.backdrop && !failed.has(hero.backdrop) && <Image key={`${hero.backdrop}:${revision}`} source={host.image(hero.backdrop)}
      style={StyleSheet.absoluteFill} contentFit="cover" onError={() => fail(hero.backdrop, 'backdrop')} onLoad={() => retried.current.delete(`${hero.id}:backdrop`)} />}
    {!host.env.still && <HeroPreview ctx={ctx} params={{}} />}
  </View>;
}
