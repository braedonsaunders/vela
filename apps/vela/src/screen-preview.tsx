// Ether Studio's live preview of a plugin screen (docs/plugin-screens.md; Ether's preview contract):
// Studio frames Vela at /vela/screen/<id>[/<page>]?screenPreview=<token> (or a channel's watch page
// for overlays) and signs it in with the usual #code= web handoff. The token is kept for the tab
// (sessionStorage; `?screenPreview=` with no value leaves preview), core sends it on every screen
// call, the console's "reload" message re-reads the drafts it names, playback stays muted, and a
// small Preview badge shows. Web only: native builds never preview.
import { useEffect } from 'react';
import { Platform, Text, View } from 'react-native';
import { msg, type Vela as Store } from '@vela/core';
import { useVelaState } from '@vela/core/react';
import { setForcedMute } from '@vela/skin/src/quiet-playback';
import { acceptReload } from './screen-preview-message';
import { PX } from '@vela/skin/src/css';

const KEY = 'vela.screenPreview';
const PARAM = 'screenPreview';

/** The token from the address, kept for the tab; and where the preview opened (to return after sign-in). */
function capture(): { token?: string; path?: string } {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return {};
  const url = new URL(window.location.href);
  try {
    if (url.searchParams.has(PARAM)) {
      const value = url.searchParams.get(PARAM) ?? '';
      if (value) window.sessionStorage.setItem(KEY, value);
      else window.sessionStorage.removeItem(KEY);
    }
    const token = window.sessionStorage.getItem(KEY) || undefined;
    if (!url.searchParams.has(PARAM) || !token) return { token };
    // The app's own address of what Studio opened, without the base (/vela) and the token.
    url.searchParams.delete(PARAM);
    const path = url.pathname.replace(/^\/vela(?=\/)/, '') + (url.searchParams.size ? `?${url.searchParams}` : '');
    return { token, path };
  } catch {
    return {};
  }
}

const captured = capture();

/** The tab's preview token, or undefined outside a Studio preview. */
export function previewToken(): string | undefined {
  return captured.token;
}

/** Where to go once the #code= sign-in lands: the page Studio opened (else home). */
export function previewReturnPath(): string | undefined {
  return captured.path;
}

/** Enter preview mode before anything reads (bootstrap carries the drafts under the token). */
export function startPreview(store: Store): void {
  const token = previewToken();
  if (!token) return;
  setForcedMute(true);
  void store.screens.setPreview(token);
}

/** While previewing: the console's reload messages re-read the drafts they name. */
export function usePreviewReload(store: Store): void {
  useEffect(() => {
    if (!previewToken() || Platform.OS !== 'web' || typeof window === 'undefined' || window.parent === window) return;
    const onMessage = (event: MessageEvent) => {
      const reload = acceptReload(event, window.parent, store.screens.origin());
      if (reload) void store.screens.reload(reload.screen, reload.page);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [store]);
}

/** The small badge a previewing tab shows over the shell. */
export function PreviewBadge() {
  const preview = useVelaState(state => state.screens.preview);
  if (!previewToken() && !preview?.token) return null;
  return (
    <View pointerEvents="none" testID="screen-preview-badge" style={{ position: 'absolute', left: 12 * PX, bottom: 12 * PX, zIndex: 1000,
      paddingHorizontal: 10 * PX, paddingVertical: 4 * PX, borderRadius: 999, backgroundColor: 'rgba(0, 0, 0, 0.72)', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.35)' }}>
      <Text style={{ color: '#ffffff', fontSize: 12 * PX, fontWeight: '700', letterSpacing: 0.6 }}>{msg('screen.previewBadge')}</Text>
    </View>
  );
}
