// Apple TV's search screen: the system's search field and keyboard (UISearchController in a
// UISearchContainerViewController, @vela/search-native), with the skin's search results drawn
// below them from the search store, as home draws them elsewhere. Typing (on the TV, by
// dictation or on the iPhone remote keyboard) searches once it pauses; Return searches at once
// and moves focus into the results when there are any.
//
// Menu steps back: from the results to the keyboard (natively), from the keyboard out of search
// (onLeave). A Back pill at the top left of the results is the visible way out.
import { router, useIsFocused, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { msg } from '@vela/core';
import { ScreenActive, SkinRoute, useReturnFocus } from '@vela/skin';
import { PX } from '@vela/skin/src/css';
import { HostContext, InheritedContext } from '@vela/skin/src/host';
import { resolveUi } from '@vela/skin/src/resolve/ui';
import { searchDoneFocus } from '@vela/skin/src/widgets/search/focus-policy';
import { SearchBack } from '@vela/skin/src/widgets/search/search-back';
import { NativeSearchView, liveQuery, resultsFocus } from '@vela/search-native';
import { useSearchReturn } from './search-return';
import { useNativeDismissal } from './native-dismissal';
import { useVela } from './vela';

export const appleTvSearch = NativeSearchView !== undefined;

export function AppleTvSearch() {
  const vela = useVela();
  const { store } = vela;
  const host = vela.host('search', 'search');
  const isCurrent = useIsFocused();
  // Back from a title opened here puts focus back on its card.
  useReturnFocus(isCurrent);
  useSearchReturn(store, isCurrent, host?.env.query);
  // Leaving pops the route, which dismisses the screen, back to where search was opened from.
  const navigation = useNavigation();
  const leaving = useRef(false);
  const leave = useCallback(() => {
    if (leaving.current || !navigation.isFocused()) return;
    leaving.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [navigation]);
  useNativeDismissal();
  const back = useMemo(() => <SearchBack onPress={leave} />, [leave]);
  const live = useMemo(() => liveQuery(text => store.search.setQuery(text)), [store]);
  // The field opens empty, so a query left from elsewhere would show results for nothing typed.
  useEffect(() => {
    if (store.getState().search.query !== '') store.search.clear();
    return () => {
      live.cancel();
      store.search.clear();
    };
  }, [live, store]);

  // Return asks for focus in the results once they have answered for the submitted text.
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const view = host?.env.search;
  useEffect(() => {
    if (submitted === null) return;
    const grouped = view?.query === submitted && view.sections ? searchDoneFocus(submitted, view) : undefined;
    const next = grouped ? (grouped.to === 'wait' ? 'wait' : 'focus') : resultsFocus(submitted, view);
    if (next === 'wait') return;
    setSubmitted(null);
    if (next === 'focus') setFocusRequest(request => request + 1);
  }, [submitted, view]);

  const [area, setArea] = useState<{ width: number; height: number } | null>(null);
  const ui = useMemo(() => resolveUi(vela.doc?.document.ui), [vela.doc]);
  // Drawn outside the shell, the results take the text the shell's root gives its routes.
  const text = useMemo(() => ({ rows: { color: ui.ink, 'font-family': ui.font }, fontSize: 16 * PX }), [ui]);
  if (!NativeSearchView) return null;
  const tree = vela.doc?.routes.search;
  const placeholder = host?.env.home?.descriptiveAvailable ? msg('ui.searchPlaceholderDescriptive') : msg('ui.searchPlaceholder');
  const query = host?.env.query ?? '';
  return (
    <ScreenActive.Provider value={isCurrent}>
      {/* Covered by a title page, neither the keyboard nor the results take focus: the native
          view disables its subtree (`active`). A FocusBoundary here left focus stranded after
          the title page closed (the remote's presses reached nothing). */}
      <View style={{ flex: 1, backgroundColor: ui.page }}>
        <NativeSearchView
          style={{ flex: 1 }}
          placeholder={placeholder}
          active={isCurrent}
          focusResults={focusRequest}
          onChangeText={event => {
            setSubmitted(null);
            live.change(event.nativeEvent.text);
          }}
          onSubmit={event => {
            live.submit(event.nativeEvent.text);
            // tvOS moves focus into results already drawn; ask only when it could not yet.
            if (!event.nativeEvent.focused) setSubmitted(event.nativeEvent.text);
          }}
          onLeave={leave}
          onResultsLayout={event => setArea({ width: event.nativeEvent.width, height: event.nativeEvent.height })}
        >
          <View collapsable={false} style={{ position: 'absolute', left: 0, top: 0, width: area?.width ?? 0, height: area?.height ?? 0 }}>
            {/* Results never take focus by themselves: it stays on the keyboard while typing. Back
                leads them, and stands alone before anything is typed. The native view gives this
                scroll the keyboard's height as its top inset. */}
            {!host || !area ? null : tree && query.trim() !== '' ? (
              <InheritedContext.Provider value={text}><SkinRoute host={host} node={tree} openingFocus={false} lead={back} /></InheritedContext.Provider>
            ) : (
              <HostContext.Provider value={host}><ScrollView style={{ flex: 1 }}>{back}</ScrollView></HostContext.Provider>
            )}
          </View>
        </NativeSearchView>
      </View>
    </ScreenActive.Provider>
  );
}
