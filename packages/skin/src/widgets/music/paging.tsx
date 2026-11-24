// Reading on as the viewer scrolls: the shell's page scroller says how near its end it is, and a
// paged list (every album a search matches) asks for its next page when the end comes into
// reach, on a pointer, a touch screen and a TV alike (a TV's focus scrolls the page). A list
// shorter than the page asks at once, so a first page that does not fill the screen continues.
import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { msg } from '@vela/core';
import { FocusPressable as Pressable } from '../../focus';
import { NO_RING, useInteraction } from '../common/controls';
import { useMediaLook } from '../media/parts';
import { musicTV } from './layout';
import { canResume, createScrollMemory, nearEnd, type ScrollMetrics } from './scroll-end';

type Listener = (metrics: ScrollMetrics) => void;
/** What the page scroller is asked to do: go back to where the viewer left the page. */
interface Scroller { scrollTo(options: { y: number; animated: boolean }): void }

export interface PageScroll {
  /** Hand these to the page's ScrollView. */
  handlers: {
    onScroll(event: NativeSyntheticEvent<NativeScrollEvent>): void;
    onLayout(event: LayoutChangeEvent): void;
    onContentSizeChange(width: number, height: number): void;
    scrollEventThrottle: number;
    onScrollBeginDrag(): void;
    onScrollEndDrag(event: NativeSyntheticEvent<NativeScrollEvent>): void;
    onMomentumScrollEnd(event: NativeSyntheticEvent<NativeScrollEvent>): void;
    ref(scroller: Scroller | null): void;
  };
  subscribe(listener: Listener): () => void;
  metrics(): ScrollMetrics;
}

/** The page last scrolled, for the shell that replaces this one on a fold or a resize. */
const memory = createScrollMemory();

/** The page scroller's metrics, for the shell to own and its pages to read; a new page (`page`,
 * its key) starts a new scroller at its top, and the same page in a new shell where it was. */
export function usePageScroll(page: string): PageScroll {
  return useMemo(() => {
    const listeners = new Set<Listener>();
    // The same page in a new scroller (the shell changing form on a fold or a resize) is put back
    // where the viewer left it once its content is tall enough; a drag first leaves it where the
    // viewer takes it. A shell's scroll state can outlive its scroller (the wide shell stands while
    // the compact one draws), so each scroller that attaches reads the memory afresh.
    let resume = 0;
    let scroller: Scroller | null = null;
    const now: ScrollMetrics = { offset: 0, viewport: 0, content: 0 };
    const tell = () => {
      if (scroller && canResume(resume, now)) { scroller.scrollTo({ y: resume, animated: false }); now.offset = resume; resume = 0; }
      for (const listener of [...listeners]) listener({ ...now });
    };
    const keep = (event: NativeSyntheticEvent<NativeScrollEvent>) => memory.keep(page, event.nativeEvent.contentOffset.y);
    return {
      handlers: {
        onScroll: event => { now.offset = event.nativeEvent.contentOffset.y; now.viewport = event.nativeEvent.layoutMeasurement.height || now.viewport; now.content = event.nativeEvent.contentSize.height || now.content; tell(); },
        onLayout: event => { now.viewport = event.nativeEvent.layout.height; tell(); },
        onContentSizeChange: (_width, height) => { now.content = height; tell(); },
        scrollEventThrottle: 64,
        // Kept where the viewer leaves it, not on every scroll event: a scroller being resized
        // away (the window changing as the device folds) reports its clamped offset first.
        onScrollBeginDrag: () => { resume = 0; },
        onScrollEndDrag: keep,
        onMomentumScrollEnd: keep,
        ref: value => {
          if (value && value !== scroller) { resume = memory.resume(page); Object.assign(now, { offset: 0, viewport: 0, content: 0 }); }
          scroller = value;
          tell();
        },
      },
      subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
      metrics: () => ({ ...now }),
    };
  }, [page]);
}

export const PageScrollContext = createContext<PageScroll | null>(null);

/**
 * The end of a paged list: while there is more, reading on when the page's end comes into reach;
 * "Loading more…" while a page is read, and a retry when one fails. Outside a page scroller
 * (nothing to watch) it reads on at once, as there is no end to wait for.
 */
export function PageEnd({ more, loading, failed, onMore, testID, failedLabel }: { more: boolean; loading: boolean; failed: boolean; onMore(): void; testID?: string; failedLabel?: string }) {
  const scroll = useContext(PageScrollContext);
  const m = useMediaLook();
  const tv = musicTV();
  const ask = useRef(onMore);
  ask.current = onMore;
  const waiting = more && !loading && !failed;
  useEffect(() => {
    if (!waiting) return;
    if (!scroll) { ask.current(); return; }
    const check = (metrics: ScrollMetrics) => { if (nearEnd(metrics)) ask.current(); };
    // The page just drawn may not have reported its new height yet: look once it has laid out,
    // and on every scroll or size change after.
    const settled = setTimeout(() => check(scroll.metrics()), 300);
    const stop = scroll.subscribe(check);
    return () => { clearTimeout(settled); stop(); };
  }, [scroll, waiting]);
  if (!more && !failed) return null;
  const quiet = m.text({ 'font-size': tv ? '18px' : '14px', color: '$ui.inkQuiet' });
  return (
    <View style={{ paddingVertical: 24, alignItems: 'center', gap: 10 }} testID={testID}>
      {failed ? <Text style={quiet}>{failedLabel ?? msg('music.moreFailed')}</Text> : <Text style={quiet}>{msg('music.loadingMore')}</Text>}
      {failed ? <RetryChip onPress={onMore} /> : null}
    </View>
  );
}

function RetryChip({ onPress }: { onPress(): void }) {
  const m = useMediaLook();
  const tv = musicTV();
  const { state, handlers } = useInteraction();
  const lit = state.hover || state.focus;
  return (
    <Pressable {...handlers} onPress={onPress} accessibilityRole="button" testID="music-page-retry"
      style={[NO_RING, { height: tv ? 48 : 34, paddingHorizontal: 16, borderRadius: 999, justifyContent: 'center', backgroundColor: lit ? m.ui.controlHover : m.ui.control,
        borderWidth: tv ? 2 : 1, borderColor: tv && state.focus ? m.ui.ink : m.ui.glassEdge }]}>
      <Text style={m.text({ 'font-size': tv ? '18px' : '13px', 'font-weight': '650', color: '$ui.ink' })}>{msg('ui.tryAgain')}</Text>
    </Pressable>
  );
}
