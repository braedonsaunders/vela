// Widget `sentinel` (renderer 7): asks for the next page when it comes into view. `params.on`:
// `row` (inside a home row: that row's next items, reached 600 px before the row's end),
// `home` (home's next rows), `library` or `collection` (their next titles), each reached 800 px
// before the page's end. It fills its box and draws nothing; the document shows the loading
// state around it.
import { useRef } from 'react';
import { View, type HostInstance } from 'react-native';
import type { Action } from '../../../../../protocol/v0/skin';
import { useHost, type WidgetProps } from '../../host';
import { useInView, type Reach } from './in-view';

const ROW_REACH: Reach = { below: 0, after: 600 };
const PAGE_REACH: Reach = { below: 800, after: 0 };

/** The action each kind of sentinel asks with. */
const MORE: Record<string, Action> = {
  row: 'moreRow',
  home: 'moreRow',
  library: 'libraryMore',
  collection: 'collectionMore',
};

export function Sentinel({ params, ctx }: WidgetProps) {
  const host = useHost();
  const ref = useRef<HostInstance>(null);
  const on = params.on ?? 'row';
  const reach = on === 'row' ? ROW_REACH : PAGE_REACH;
  // A home sentinel asks for home's next rows (moreRow with no row); a row's names its row.
  const arg = on === 'row' ? (ctx.row?.id ?? '') : '';
  const ask = () => {
    const action = MORE[on];
    if (!action || (on === 'row' && !arg)) return;
    host.dispatch(action, arg);
  };
  useInView(ref, reach, ask);
  return (
    <View
      ref={ref}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={
        on === 'row'
          ? { alignSelf: 'stretch', minWidth: 1, flexGrow: 1 }
          : { alignSelf: 'stretch', minHeight: 1, flexGrow: 1 }
      }
    />
  );
}
