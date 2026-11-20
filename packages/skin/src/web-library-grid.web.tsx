import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { View } from 'react-native';
import { gridOffsets, gridRowAt, gridWindow } from './web-grid-layout';

export interface Props {
  grid: { gap: number; count?: number; min?: number };
  rowGap: number;
  length: number;
  getItem(index: number): ReactElement;
  drawn?(): void;
}

function scrollParent(node: HTMLElement): HTMLElement {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    if (/^(auto|scroll)$/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return document.scrollingElement as HTMLElement;
}

function localTop(track: HTMLElement, scroller: HTMLElement): number {
  const top = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
  return top - track.getBoundingClientRect().top;
}

function controls(row: HTMLElement): HTMLElement[] {
  return Array.from(row.querySelectorAll<HTMLElement>('button, a[href], [tabindex], input, select, textarea'))
    .filter(control => control.tabIndex >= 0 && !control.matches(':disabled, [aria-disabled="true"]') && control.getClientRects().length);
}

/** Keep real cells in the viewport plus overscan. A measured row contributes its real height
 * even after it unmounts. The last focused row stays available for return from a title or menu. */
export function WebLibraryGrid({ grid, rowGap, length, getItem, drawn }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const parents = useRef<HTMLElement | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const rows = useRef(new Map<number, HTMLDivElement>());
  const pendingFocus = useRef<{ row: number; backwards: boolean } | null>(null);
  const [width, setWidth] = useState(0);
  const [range, setRange] = useState({ start: 0, end: 3 });
  const [pinned, setPinned] = useState(-1);
  const [measurements, setMeasurements] = useState<{ width: number; heights: ReadonlyMap<number, number> }>({ width: 0, heights: new Map() });
  const columns = grid.count ?? Math.max(1, Math.floor((width + grid.gap) / ((grid.min ?? 160) + grid.gap)));
  const cell = Math.max(0, Math.floor(((width - 1 - grid.gap * (columns - 1)) / columns) * 100) / 100);
  const rowCount = Math.ceil(length / columns);
  const offsets = useMemo(() => {
    const heights = measurements.width === width ? measurements.heights : new Map<number, number>();
    const estimate = heights.values().next().value ?? Math.max(64, cell * 1.5 + 48);
    return gridOffsets(rowCount, heights, estimate, rowGap);
  }, [rowCount, measurements, width, cell, rowGap]);
  const geometry = useRef({ offsets, columns });
  const currentWidth = useRef(width);
  currentWidth.current = width;

  useLayoutEffect(() => {
    const node = track.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const scroller = parents.current = scrollParent(node);
    const target = scroller === document.scrollingElement ? window : scroller;
    let frame = 0;
    const update = () => {
      const actual = Math.round(node.getBoundingClientRect().width);
      if (actual <= 0 || !node.getClientRects().length) return;
      if (actual !== currentWidth.current) setWidth(actual);
      const next = gridWindow(geometry.current.offsets, localTop(node, scroller), scroller.clientHeight);
      setRange(old => old.start === next.start && old.end === next.end ? old : next);
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; update(); });
    };
    const resize = new ResizeObserver(entries => {
      const actual = currentWidth.current;
      const changed = entries.filter(entry => entry.target !== node && entry.target !== scroller && entry.contentRect.height > 0);
      if (changed.length) setMeasurements(old => {
        const heights = new Map(old.width === actual ? old.heights : undefined);
        let dirty = old.width !== actual;
        for (const entry of changed) {
          const index = Number((entry.target as HTMLElement).dataset.velaGridRow);
          const height = entry.contentRect.height;
          if (heights.get(index) !== height && rows.current.get(index) === entry.target) {
            heights.set(index, height);
            dirty = true;
          }
        }
        return dirty ? { width: actual, heights } : old;
      });
      schedule();
    });
    observer.current = resize;
    resize.observe(node);
    if (scroller !== node) resize.observe(scroller);
    for (const row of rows.current.values()) resize.observe(row);
    target.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    update();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      observer.current = null;
      target.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);

  useLayoutEffect(() => {
    const previous = geometry.current;
    geometry.current = { offsets, columns };
    const node = track.current, scroller = parents.current;
    if (!node || !scroller || !width) return;
    let top = localTop(node, scroller);
    if (previous.columns === columns && top > 0 && top < (previous.offsets.at(-1) ?? 0)) {
      const row = gridRowAt(previous.offsets, top);
      const delta = (offsets[row] ?? previous.offsets[row]!) - previous.offsets[row]!;
      if (delta) { scroller.scrollTop += delta; top = localTop(node, scroller); }
    }
    const next = gridWindow(offsets, top, scroller.clientHeight);
    setRange(old => old.start === next.start && old.end === next.end ? old : next);
  }, [offsets, columns, width]);

  useLayoutEffect(() => {
    if (width && (!length || measurements.width === width)) drawn?.();
  }, [width, length, measurements.width, drawn]);

  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    const row = rows.current.get(pending.row);
    if (!row) return;
    pendingFocus.current = null;
    const targets = controls(row);
    (pending.backwards ? targets.at(-1) : targets[0])?.focus();
  });

  const tab = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>('[data-vela-grid-row]');
    if (!row || !event.currentTarget.contains(row)) return;
    const index = Number(row.dataset.velaGridRow);
    const desired = index + (event.shiftKey ? -1 : 1);
    if (desired < 0 || desired >= rowCount || rows.current.has(desired)) return;
    const targets = controls(row);
    if (target !== (event.shiftKey ? targets[0] : targets.at(-1))) return;
    event.preventDefault();
    pendingFocus.current = { row: desired, backwards: event.shiftKey };
    setPinned(desired);
  };

  const visible = Array.from({ length: Math.max(0, Math.min(rowCount, range.end) - range.start) }, (_, i) => range.start + i);
  if (pinned >= 0 && pinned < rowCount && !visible.includes(pinned)) visible.push(pinned);
  visible.sort((a, b) => a - b);
  return <div ref={track} data-vela-library-grid="" data-vela-grid-items={length} onKeyDown={tab}
    onFocusCapture={event => {
      const row = (event.target as HTMLElement).closest<HTMLElement>('[data-vela-grid-row]');
      if (row) setPinned(Number(row.dataset.velaGridRow));
    }}
    style={{ position: 'relative', alignSelf: 'stretch', height: width ? offsets.at(-1) : 0, overflowAnchor: 'none' }}>
    {width > 0 && visible.map(index =>
      <div key={index} data-vela-grid-row={index}
        ref={node => {
          const previous = rows.current.get(index);
          if (previous) observer.current?.unobserve(previous);
          if (node) { rows.current.set(index, node); observer.current?.observe(node); }
          else rows.current.delete(index);
        }}
        style={{ position: 'absolute', top: offsets[index], insetInline: 0, display: 'flex', columnGap: grid.gap }}>
        {Array.from({ length: Math.min(columns, length - index * columns) }, (_, column) => {
          const item = getItem(index * columns + column);
          return <View key={item.key} style={{ width: cell, flexShrink: 0 }}>{item}</View>;
        })}
      </div>
    )}
  </div>;
}
