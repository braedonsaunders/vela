// A dialog over the page (Versions, playlists, a library filter): its scrim dissolves in while the
// sheet rises a little and settles, and both leave the same way, quicker, before the modal closes.
// The shared motion of presence.tsx; under reduced motion it simply appears and goes.
import type { ReactNode } from 'react';
import { Modal, StyleSheet } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { MOTION, presenceStyle, usePresence } from '../../presence';

export function SheetModal({ open, scrim, onRequestClose, still, children }: {
  open: boolean;
  /** The scrim's colour. */
  scrim: string;
  onRequestClose(): void;
  /** Reduced motion; the system setting when not given. */
  still?: boolean;
  /** The sheet and its own dismiss area, laid out over the whole screen. */
  children: ReactNode;
}) {
  const system = useReducedMotion();
  const quiet = still ?? system;
  const { mounted, visible } = usePresence(open, MOTION.exit, quiet);
  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onRequestClose} supportedOrientations={['portrait', 'landscape']}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: scrim }, presenceStyle(visible, { opacity: 0 }, quiet)]} />
      <Animated.View pointerEvents={open ? 'box-none' : 'none'} style={[StyleSheet.absoluteFill, presenceStyle(visible, { opacity: 0, y: 24, scale: 0.98 }, quiet)]}>
        {children}
      </Animated.View>
    </Modal>
  );
}
