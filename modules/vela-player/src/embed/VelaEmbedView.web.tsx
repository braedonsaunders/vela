// VelaEmbedView on the web and the desktop apps (Electron, WebView2): an iframe of the player URL. The
// sandbox lets the player run as its own origin but never navigate this page or open windows.
import { createElement, useEffect, useRef } from 'react';
import { View } from 'react-native';
import type { VelaEmbedViewProps } from './types';

export type { VelaEmbedViewProps } from './types';

/** Browsers and the desktop hosts can embed. */
export function canEmbed(): boolean {
  return typeof document !== 'undefined';
}

export function VelaEmbedView({ playerUrl, handshake, onMessage, onFailure, accessibilityLabel, testID, style }: VelaEmbedViewProps) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const handlers = useRef({ onMessage, onFailure });
  handlers.current = { onMessage, onFailure };
  useEffect(() => {
    let origin: string;
    try { origin = new URL(playerUrl).origin; } catch {
      handlers.current.onFailure('invalid-url');
      return;
    }
    let heard = false;
    const receive = (event: MessageEvent) => {
      // Only the player's own frame, from the player's origin.
      if (event.origin !== origin || event.source !== frame.current?.contentWindow || typeof event.data !== 'string') return;
      heard = true;
      handlers.current.onMessage(event.data);
    };
    window.addEventListener('message', receive);
    const timer = setInterval(() => {
      if (heard) { clearInterval(timer); return; }
      try { frame.current?.contentWindow?.postMessage(handshake, origin); } catch { /* the frame is still loading */ }
    }, 250);
    return () => {
      clearInterval(timer);
      window.removeEventListener('message', receive);
    };
  }, [playerUrl, handshake]);
  return (
    <View style={style} testID={testID}>
      {createElement('iframe', {
        ref: frame,
        src: playerUrl,
        title: accessibilityLabel,
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
        allowFullScreen: true,
        referrerPolicy: 'strict-origin-when-cross-origin',
        sandbox: 'allow-scripts allow-same-origin allow-presentation',
        'data-testid': testID ? `${testID}-frame` : undefined,
        style: { border: 0, width: '100%', height: '100%', display: 'block', backgroundColor: '#000' },
      })}
    </View>
  );
}
