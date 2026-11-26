import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type GestureResponderEvent, type NativeTouchEvent, type ViewStyle } from 'react-native';
import { clampPhotoZoom, doubleTapPhoto, FIT_PHOTO, photoCanSwipe, zoomPhoto, type PhotoPoint, type PhotoSize, type PhotoZoom } from './photo-zoom';
import { photoSwipe, type PhotoDirection } from './viewer-nav-model';

interface PhotoTouchProps {
  ratio?: number;
  onSwipe?(direction: PhotoDirection): void;
  onTap?(): void;
  onTouch?(): void;
  children: ReactNode;
}

interface Contact {
  point: PhotoPoint;
  startTime: number;
  pose: PhotoZoom;
  moved: boolean;
  pinched: boolean;
  pinch?: { distance: number; point: PhotoPoint; pose: PhotoZoom };
}

const TAP_MS = 285;
const TAP_SLOP = 24;
const MOVE_SLOP = 10;
function point(event: GestureResponderEvent, touch: NativeTouchEvent): PhotoPoint {
  if (Platform.OS !== 'web') return { x: touch.locationX, y: touch.locationY };
  const rect = (event.currentTarget as unknown as HTMLElement).getBoundingClientRect();
  return { x: touch.pageX - rect.left - window.scrollX, y: touch.pageY - rect.top - window.scrollY };
}
const distance = (a: PhotoPoint, b: PhotoPoint): number => Math.hypot(b.x - a.x, b.y - a.y);
const midpoint = (a: PhotoPoint, b: PhotoPoint): PhotoPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function PhotoTouchSurface(props: PhotoTouchProps) {
  if (Platform.isTV) return <>{props.children}</>;
  return <TouchSurface {...props} />;
}

/** The image is painted inside a fixed, clipped touch surface. Controls stay outside its transform. */
function TouchSurface({ ratio, onSwipe, onTap, onTouch, children }: PhotoTouchProps) {
  const [viewport, setViewport] = useState<PhotoSize>({ width: 0, height: 0 });
  const [pose, setPose] = useState(FIT_PHOTO);
  const current = useRef(FIT_PHOTO);
  const contact = useRef<Contact | null>(null);
  const tap = useRef<{ point: PhotoPoint; time: number } | null>(null);
  const single = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latestTap = useRef(onTap);
  latestTap.current = onTap;

  function setZoom(next: PhotoZoom) {
    current.current = next;
    setPose(next);
  }

  useEffect(() => {
    setZoom(clampPhotoZoom(current.current, viewport, ratio));
  }, [viewport, ratio]);
  useEffect(() => () => clearTimeout(single.current), []);

  function pinch(event: GestureResponderEvent, gesture: Contact) {
    const { touches } = event.nativeEvent;
    const a = point(event, touches[0]!);
    const b = point(event, touches[1]!);
    const focus = midpoint(a, b);
    const span = distance(a, b);
    gesture.pinched = true;
    if (!gesture.pinch) {
      gesture.pinch = { distance: Math.max(1, span), point: focus, pose: current.current };
      return;
    }
    const base = gesture.pinch;
    setZoom(zoomPhoto(base.pose, base.pose.scale * span / base.distance, base.point, focus, viewport, ratio));
  }

  function begin(event: GestureResponderEvent) {
    const { touches } = event.nativeEvent;
    onTouch?.();
    const first = touches[0];
    if (!first) return;
    const gesture = contact.current ?? { point: point(event, first), pose: current.current, startTime: Date.now(), moved: false, pinched: false };
    contact.current = gesture;
    if (touches.length > 1) pinch(event, gesture);
  }

  function move(event: GestureResponderEvent) {
    const { touches } = event.nativeEvent;
    const gesture = contact.current;
    if (!gesture || !touches[0]) return;
    onTouch?.();
    if (touches.length > 1) { pinch(event, gesture); return; }
    // When one finger remains after a pinch it continues from the current image position.
    const location = point(event, touches[0]);
    if (gesture.pinch) {
      gesture.point = location;
      gesture.pose = current.current;
      gesture.pinch = undefined;
      return;
    }
    if (distance(gesture.point, location) > MOVE_SLOP) gesture.moved = true;
    if (gesture.pose.scale > 1) setZoom(clampPhotoZoom({
      scale: gesture.pose.scale,
      x: gesture.pose.x + location.x - gesture.point.x,
      y: gesture.pose.y + location.y - gesture.point.y,
    }, viewport, ratio));
  }

  function finish(event: GestureResponderEvent) {
    const { changedTouches, touches } = event.nativeEvent;
    if (touches.length) return;
    const gesture = contact.current;
    contact.current = null;
    const last = changedTouches[0];
    if (!gesture || !last) return;
    onTouch?.();
    const location = point(event, last);
    const direction = photoCanSwipe(gesture.pose, current.current, gesture.pinched) && photoSwipe(gesture.point, location);
    if (direction) { tap.current = null; clearTimeout(single.current); onSwipe?.(direction); return; }
    if (gesture.pinched || gesture.moved || distance(gesture.point, location) > MOVE_SLOP || Date.now() - gesture.startTime > TAP_MS) return;
    const now = Date.now();
    const previous = tap.current;
    if (previous && now - previous.time <= TAP_MS && distance(previous.point, location) <= TAP_SLOP) {
      tap.current = null;
      clearTimeout(single.current);
      setZoom(doubleTapPhoto(current.current, location, viewport, ratio));
      return;
    }
    if (previous) latestTap.current?.();
    clearTimeout(single.current);
    tap.current = { point: location, time: now };
    single.current = setTimeout(() => {
      tap.current = null;
      latestTap.current?.();
    }, TAP_MS);
  }

  const handlesPan = (event: GestureResponderEvent) => {
    const { touches } = event.nativeEvent;
    if (current.current.scale > 1 || touches.length > 1) return true;
    if (!onSwipe || !contact.current || !touches[0]) return false;
    const start = contact.current.point;
    const location = point(event, touches[0]);
    const dx = Math.abs(location.x - start.x);
    return dx > MOVE_SLOP && dx > Math.abs(location.y - start.y) * 1.4;
  };
  return (
    <View testID="gallery-photo-touch-surface" collapsable={false}
      style={[StyleSheet.absoluteFill, { overflow: 'hidden' }, Platform.OS === 'web' ? { touchAction: pose.scale > 1 ? 'none' : 'pan-y' } as ViewStyle : null]}
      onLayout={event => {
        const { width, height } = event.nativeEvent.layout;
        setViewport(old => old.width === width && old.height === height ? old : { width, height });
      }}
      onTouchStart={begin} onTouchMove={move} onTouchEnd={finish} onTouchCancel={() => { contact.current = null; }}
      onStartShouldSetResponderCapture={() => current.current.scale > 1}
      onMoveShouldSetResponderCapture={handlesPan} onResponderTerminationRequest={() => !contact.current}
      onResponderTerminate={() => { contact.current = null; }}>
      <View testID="gallery-photo-transform" pointerEvents="none" style={[StyleSheet.absoluteFill,
        pose.scale === 1 ? null : { transform: [{ translateX: pose.x }, { translateY: pose.y }, { scale: pose.scale }] }]}>
        {children}
      </View>
    </View>
  );
}
