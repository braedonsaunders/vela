// What a plugin screen's presses do in the app (docs/plugin-screens.md: Actions): open a page
// (apps/vela/app/screen/[id]/[page].tsx) or a built-in route, play through the watch routes, add to
// the multiview while it is available, open a vetted link outside the app, confirm, go back.
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import type { ScreenAppActions, ScreenDestination } from '@vela/skin/src/screen/host';
import type { SkinHost } from '@vela/skin';
import { useMultiview } from './multiview-registry';

/** A record key's id (`channel:ch-1` -> `ch-1`); an id as it is. */
const bare = (value: string) => value.replace(/^(channel|item|event|entity|detail):/, '');

/** The address of a plugin screen's page. */
export function screenPagePath(screen: string, page: string): string {
  return `/screen/${encodeURIComponent(screen)}/${encodeURIComponent(page)}`;
}

function confirm(text: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(typeof window === 'undefined' || window.confirm(text));
  return new Promise(resolve => Alert.alert('', text, [
    { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
    { text: 'OK', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }));
}

export function useAppScreenActions({ host, back, setParams }: {
  /** The app's skin host here: built-in routes go through its dispatch, as the shell's presses do. */
  host: SkinHost | null;
  back(): void;
  setParams(params: Record<string, string>): void;
}): ScreenAppActions {
  const multiview = useMultiview();
  return useMemo<ScreenAppActions>(() => ({
    navigate(to: ScreenDestination) {
      if (to.kind === 'route') {
        switch (to.route) {
          case 'title': if (to.id) router.push({ pathname: '/title/[id]', params: { id: bare(to.id) } }); return;
          case 'live': case 'guide': host?.dispatch('live', ''); return;
          case 'search': host?.dispatch('search', ''); return;
          case 'home': host?.dispatch('home', ''); return;
          case 'library': if (to.id) host?.dispatch('library', to.id); return;
        }
        return;
      }
      if (!to.screen) return;
      // The page's document href comes from the screen's bootstrap entry (screenDocumentHref).
      router.push({ pathname: '/screen/[id]/[page]', params: { id: to.screen, page: to.page, ...to.params } });
    },
    setParams,
    play(args) {
      const channel = args.channel ? bare(args.channel) : '';
      if (args.programme && channel) {
        router.navigate({ pathname: '/watch/[id]', params: { id: args.programme, kind: 'programme', channelId: channel, ...(args.from === 'startOver' || args.from === 'start' ? { from: 'start' } : {}) } });
      } else if (channel) {
        router.navigate({ pathname: '/watch/[id]', params: { id: channel, kind: 'channel' } });
      } else if (args.item) {
        router.navigate({ pathname: '/watch/[id]', params: { id: bare(args.item) } });
      }
    },
    ...(multiview ? { multiview: (channel: string) => multiview(bare(channel)) } : {}),
    openLink(href) {
      if (Platform.isTV || !/^https:\/\//.test(href)) return;
      void Linking.openURL(href).catch(() => {});
    },
    back,
    confirm,
    toast() {
      // The screen host draws its own toast line.
    },
  }), [host, back, setParams, multiview]);
}
