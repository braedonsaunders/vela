import { msg } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { FocusPressable } from '../focus';

interface Feedback {
  id: string;
  name: string;
  thumbsUp: boolean;
  session: number;
}

const FeedbackContext = createContext<{
  feedback: Feedback | null;
  show: (id: string, name: string, thumbsUp: boolean) => void;
  clear: (feedback: Feedback) => void;
}>({ feedback: null, show() {}, clear() {} });

export function WatchFeedbackProvider({ children, inTitle }: { children: ReactNode; inTitle: boolean }) {
  const session = useVelaState(state => state.auth.revision);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(current => current === feedback ? null : current), 12_000);
    return () => clearTimeout(timer);
  }, [feedback]);
  return <FeedbackContext.Provider value={{
    feedback: feedback?.session === session ? feedback : null,
    show: (id, name, thumbsUp) => setFeedback({ id, name, thumbsUp, session }),
    clear: entry => setFeedback(current => current === entry ? null : current),
  }}>
    {children}
    {!inTitle ? <View pointerEvents="box-none" style={styles.overlay}><WatchFeedbackToast /></View> : null}
  </FeedbackContext.Provider>;
}

export function useWatchFeedback() {
  return useContext(FeedbackContext).show;
}

export function WatchFeedbackToast({ title }: { title?: string }) {
  const vela = useVela();
  const { feedback, clear } = useContext(FeedbackContext);
  const [pending, setPending] = useState<Feedback | null>(null);
  const [failed, setFailed] = useState<Feedback | null>(null);
  if (!feedback || title && title !== feedback.id) return null;
  const undo = async () => {
    setPending(feedback);
    setFailed(null);
    try {
      await vela.catalogue.setTitleWatch(feedback.id, { notInterested: false, ...(feedback.thumbsUp ? { thumbsUp: true } : {}) });
      clear(feedback);
    } catch {
      setFailed(feedback);
    } finally {
      setPending(null);
    }
  };
  return <View style={styles.toast} testID="watch-feedback-toast">
    <Text accessibilityLiveRegion="polite" style={styles.label}>
      {msg(failed === feedback ? 'cardMenu.actionFailed' : 'cardMenu.notInterestedToast', { title: feedback.name })}
    </Text>
    <FocusPressable accessibilityRole="button" accessibilityLabel={msg('cardMenu.undo')} hasTVPreferredFocus={Platform.isTV}
      testID="watch-feedback-undo" disabled={pending === feedback} onPress={() => void undo()} style={styles.button}>
      <Text style={styles.undo}>{msg('cardMenu.undo')}</Text>
    </FocusPressable>
  </View>;
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', alignItems: 'center', padding: Platform.isTV ? 48 : 24 },
  toast: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 12, maxWidth: '100%',
    marginHorizontal: 'auto', padding: 10, paddingLeft: 16, backgroundColor: '#14151a', borderColor: '#636570', borderWidth: 1, borderRadius: 12 },
  label: { color: '#fff', fontSize: Platform.isTV ? 18 : 15, flexShrink: 1 },
  button: { paddingHorizontal: 16, minHeight: 44, justifyContent: 'center', backgroundColor: '#3d4050', borderRadius: 8 },
  undo: { fontWeight: '700', color: '#fff', fontSize: Platform.isTV ? 18 : 15 },
});
