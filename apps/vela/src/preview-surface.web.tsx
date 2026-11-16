// A trailer preview on the web: the broker's muted MP4, looping, filling its box. The grant URL
// carries its own authority (Ether's broker), so no credential is involved. The video element is
// mounted into the View's DOM node, as the web player view mounts its engine.
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

function previewVideo(url: string): HTMLVideoElement {
  const video = document.createElement('video');
  video.muted = true;
  video.autoplay = true;
  video.loop = true;
  video.playsInline = true;
  video.src = url;
  Object.assign(video.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover' });
  return video;
}

export function PreviewSurface({ url }: { url: string }) {
  const element = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const parent = element.current;
    if (!parent) return;
    const video = previewVideo(url);
    parent.appendChild(video);
    return () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
    };
  }, [url]);
  return <View ref={element as never} style={StyleSheet.absoluteFill} />;
}
