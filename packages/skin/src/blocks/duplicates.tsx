// Self-contained rich block for B8b Duplicate recording review (`packages/skin/src/blocks/duplicates.tsx`).
// Exposes the duplicate recording groups list, release comparison rows, preferred release selection,
// and prefer-and-hide-others action over `@vela/core`'s `store.music` duplicates engine, independent
// of the removed `widgets/music` page code so the Listen experience documents reuse it unchanged.
import { useEffect, useState } from 'react';
import { Platform, Text, View, type ViewStyle } from 'react-native';
import {
  clock,
  msg,
  number,
  type Card,
  type DuplicateGroupModel,
  type DuplicateGroupsList,
  type Loadable,
  type RecordingReleasesModel,
} from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { FocusPressable as Pressable } from '../focus';
import { NO_RING, Glyph, useInteraction } from '../widgets/common/controls';
import { alpha, Cover, useMediaLook } from '../widgets/media/parts';
import { MediaGlyph } from '../widgets/media/icons';

const web = Platform.OS === 'web';
const transition = (properties: string, ms = 160): ViewStyle =>
  web ? ({ transitionProperty: properties, transitionDuration: `${ms}ms`, transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)' } as ViewStyle) : {};

/** Hook into `@vela/core`'s duplicate recording groups for `libraryId` (`store.music.duplicates`). */
export function useLibraryDuplicates(libraryId: string): {
  groups: DuplicateGroupsList['items'];
  more: boolean;
  load: Loadable<DuplicateGroupsList>['load'];
  available: boolean;
  loadMore(): void;
  refresh(): void;
} {
  const store = useVela();
  const entry = useVelaState(s => s.music.duplicates[libraryId]);
  useVelaState(s => s.home.load);
  const available = store.music.duplicatesAvailable;
  useEffect(() => {
    if (available && libraryId) void store.music.duplicates(libraryId);
  }, [store, available, libraryId]);
  return {
    groups: entry?.value?.items ?? [],
    more: !!entry?.value?.more,
    load: entry?.load ?? (available ? 'loading' : 'idle'),
    available,
    loadMore: () => void store.music.duplicates(libraryId, true),
    refresh: () => void store.music.duplicates(libraryId, false, true),
  };
}

/** Hook into `@vela/core`'s per-title recording release list (`GET /titles/:id/recording`). */
export function useTitleRecording(titleId: string | undefined): Loadable<RecordingReleasesModel> | undefined {
  const store = useVela();
  const entry = useVelaState(s => (titleId ? s.music.recordings[titleId] : undefined));
  useVelaState(s => s.home.load);
  const available = store.music.duplicatesAvailable;
  useEffect(() => {
    if (available && titleId) void store.music.recording(titleId);
  }, [store, available, titleId]);
  return entry;
}

export function DuplicatesCover({ size }: { size: number }) {
  const m = useMediaLook();
  return (
    <View style={[{ width: size, height: size, borderRadius: size > 100 ? 8 : 4, alignItems: 'center', justifyContent: 'center' },
      m.box({ 'background-image': `linear-gradient(135deg, #2d3a5c 0%, ${m.ui.accent} 62%, #1a2130 100%)`, ...(size > 100 ? { 'box-shadow': '0px 22px 48px -16px rgba(0,0,0,0.7)' } : {}) })]}>
      <Glyph symbol="layers" size={size * 0.4} color="#ffffff" />
    </View>
  );
}

export interface DuplicatesBlockProps {
  libraryId?: string;
  onPlayRelease?(release: Card, source: { id: string; name: string }): void;
  onOpenAlbum?(albumId: string): void;
}

/** Self-contained duplicate recording review rich block. */
export function DuplicatesBlock({
  libraryId = 'music',
  onPlayRelease,
  onOpenAlbum,
}: DuplicatesBlockProps) {
  const store = useVela();
  const m = useMediaLook();
  const { groups, load, more, loadMore, refresh } = useLibraryDuplicates(libraryId || 'music');
  const [notice, setNotice] = useState('');
  const [busyRecording, setBusyRecording] = useState('');

  const handlePreference = async (group: DuplicateGroupModel, preferred: Card, hideOthers: boolean) => {
    const targetLibrary = libraryId || 'music';
    setBusyRecording(group.recordingId);
    try {
      const otherIds = hideOthers ? group.cards.filter(c => c.id !== preferred.id).map(c => c.id) : undefined;
      const updated = await store.music.setDuplicatePreference(targetLibrary, group.recordingId, preferred.id, otherIds);
      if (updated) {
        setNotice(hideOthers && otherIds?.length
          ? msg('music.duplicates.mergedNotice', { count: number(otherIds.length) })
          : msg('music.duplicates.savedNotice', { title: preferred.name }));
      }
    } finally {
      setBusyRecording('');
    }
  };

  return (
    <View testID="duplicates-block">
      {notice ? (
        <View testID="music-duplicates-notice" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 12, marginBottom: 18, backgroundColor: alpha(m.ui.accent, 0.16), borderWidth: 1, borderColor: m.ui.accent }}>
          <Glyph symbol="check-circle" size={18} color={m.ui.accent} />
          <Text style={[m.text({ 'font-size': '14px', 'font-weight': '650', color: '$ui.ink' }), { flex: 1 }]}>{notice}</Text>
        </View>
      ) : null}

      {load === 'failed' && !groups.length ? (
        <View style={{ paddingVertical: 32, gap: 12, alignItems: 'flex-start' }}>
          <Text style={m.text({ 'font-size': '15px', color: '$ui.inkSecondary' })}>{msg('media.ui.loadFailed')}</Text>
          <Pressable onPress={refresh} accessibilityRole="button" style={[NO_RING, { height: 36, paddingHorizontal: 16, borderRadius: 18, justifyContent: 'center', backgroundColor: m.ui.control }]}>
            <Text style={m.text({ 'font-size': '13px', 'font-weight': '700', color: '$ui.ink' })}>{msg('media.ui.retry')}</Text>
          </Pressable>
        </View>
      ) : !groups.length && load === 'loading' ? (
        <View style={{ paddingVertical: 40 }} testID="music-duplicates-loading">
          <View style={{ height: 140, borderRadius: 16, backgroundColor: alpha(m.ui.ink, 0.06) }} />
        </View>
      ) : !groups.length ? (
        <View style={{ padding: 28, borderRadius: 16, backgroundColor: alpha(m.ui.ink, 0.05), borderWidth: 1, borderColor: m.ui.glassEdge }} testID="music-duplicates-empty">
          <Text style={m.text({ 'font-size': '15px', color: '$ui.inkSecondary' })}>{msg('music.duplicates.empty')}</Text>
        </View>
      ) : (
        <View style={{ gap: 20, marginTop: 8 }} testID="music-duplicates-groups">
          {groups.map(group => (
            <DuplicateGroupCard
              key={group.recordingId}
              group={group}
              busy={busyRecording === group.recordingId}
              onSelect={(card, hideOthers) => void handlePreference(group, card, hideOthers)}
              onPlayRelease={onPlayRelease}
              onOpenAlbum={onOpenAlbum}
            />
          ))}
          {more ? (
            <Pressable onPress={loadMore} accessibilityRole="button" style={[NO_RING, { alignSelf: 'center', paddingHorizontal: 18, paddingVertical: 12 }]} testID="music-duplicates-more">
              <Text style={m.text({ 'font-size': '14px', 'font-weight': '700', color: '$ui.inkSecondary' })}>{msg('music.seeMore')}</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

export function DuplicateGroupCard({
  group,
  busy,
  onSelect,
  onPlayRelease,
  onOpenAlbum,
}: {
  group: DuplicateGroupModel;
  busy: boolean;
  onSelect(card: Card, hideOthers: boolean): void;
  onPlayRelease?(release: Card, source: { id: string; name: string }): void;
  onOpenAlbum?(albumId: string): void;
}) {
  const m = useMediaLook();
  const lead = group.cards[0];
  if (!lead) return null;
  const preferredId = group.preferredTitleId || lead.id;

  return (
    <View testID={`music-duplicate-group-${group.recordingId}`}
      style={{ padding: m.small ? 14 : 20, borderRadius: 16, backgroundColor: alpha(m.ui.ink, 0.05), borderWidth: 1, borderColor: m.ui.glassEdge, gap: 14 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <View style={{ flex: 1, minWidth: 200, gap: 3 }}>
          <Text style={m.text({ 'font-family': '$ui.fontDisplay', 'font-size': '22px', 'font-weight': '700', color: '$ui.ink' })}>{lead.name}</Text>
          <Text style={m.text({ 'font-size': '14px', color: '$ui.inkSecondary' })}>
            {lead.media?.byline || ''} · {msg('music.duplicates.copies', { count: number(group.count) })}
          </Text>
        </View>
        <View
          {...(web ? ({ title: msg('music.duplicates.recordingId', { id: group.recordingId }) } as object) : {})}
          style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12, backgroundColor: alpha(m.ui.ink, 0.08), borderWidth: 1, borderColor: m.ui.glassEdge }}>
          <Text style={m.text({ 'font-size': '12px', 'font-weight': '700', color: '$ui.inkSecondary', 'font-variant-numeric': 'tabular-nums' })}>
            {msg('music.duplicates.copies', { count: number(group.count) })}
          </Text>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        {group.cards.map(release => {
          const isPreferred = release.id === preferredId;
          const album = release.media?.parents.find(p => p.role === 'album');
          const formatFact = release.media?.facts.find(f => f.label === 'Format' || f.label === 'Bitrate')?.value ?? '';
          const releaseFacts = [
            album?.name,
            release.yearLabel,
            release.media?.indexLabel,
            formatFact,
            release.media?.clockLabel || (release.durationSeconds ? clock(release.durationSeconds) : ''),
          ].filter(Boolean).join(' · ');

          return (
            <View key={release.id} testID={`music-duplicate-release-${release.id}`}
              style={{ flexDirection: m.small ? 'column' : 'row', alignItems: m.small ? 'stretch' : 'center', gap: 12, padding: 12, borderRadius: 12,
                backgroundColor: isPreferred ? alpha(m.ui.accent, 0.11) : alpha(m.ui.ink, 0.04),
                borderWidth: 1, borderColor: isPreferred ? m.ui.accent : m.ui.glassEdge }}>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <DuplicatePlayButton
                  label={`${msg('media.ui.play')} ${release.name}`}
                  onPress={() => onPlayRelease?.(release, { id: album?.id ?? release.id, name: album?.name ?? release.name })}
                />
                <Pressable onPress={() => album && onOpenAlbum?.(album.id)} accessibilityRole="link" style={NO_RING}>
                  <Cover uri={release.poster} shape="square" size={48} title={album?.name ?? release.name} accent={release.accent} lift={0.2} />
                </Pressable>
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                    <Pressable onPress={() => album && onOpenAlbum?.(album.id)} accessibilityRole="link" style={NO_RING}>
                      <Text numberOfLines={1} style={m.text({ 'font-size': '15px', 'font-weight': '700', color: '$ui.ink' })}>
                        {album?.name ?? release.name}
                      </Text>
                    </Pressable>
                    {isPreferred ? (
                      <View testID={`music-duplicate-preferred-badge-${release.id}`}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: m.ui.accent }}>
                        <Glyph symbol="checkmark" size={12} color={m.ui.onAccent} />
                        <Text style={m.text({ 'font-size': '11px', 'font-weight': '750', color: m.ui.onAccent })}>{msg('music.duplicates.preferred')}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text numberOfLines={2} style={m.text({ 'font-size': '13px', color: '$ui.inkSecondary' })}>{releaseFacts}</Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, justifyContent: m.small ? 'flex-end' : 'flex-start' }}>
                {!isPreferred ? (
                  <Pressable onPress={() => onSelect(release, false)} disabled={busy} testID={`music-duplicate-prefer-${release.id}`} accessibilityRole="button"
                    style={[NO_RING, { height: 34, paddingHorizontal: 14, borderRadius: 17, justifyContent: 'center', backgroundColor: m.ui.control, borderWidth: 1, borderColor: m.ui.glassEdge, opacity: busy ? 0.5 : 1 }]}>
                    <Text style={m.text({ 'font-size': '12px', 'font-weight': '700', color: '$ui.ink' })}>{msg('music.duplicates.setPreferred')}</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => onSelect(release, true)} disabled={busy} testID={`music-duplicate-merge-${release.id}`} accessibilityRole="button"
                  style={[NO_RING, { height: 34, paddingHorizontal: 14, borderRadius: 17, justifyContent: 'center', backgroundColor: isPreferred ? m.ui.accent : alpha(m.ui.accent, 0.18), borderWidth: 1, borderColor: m.ui.accent, opacity: busy ? 0.5 : 1 }]}>
                  <Text style={m.text({ 'font-size': '12px', 'font-weight': '700', color: isPreferred ? m.ui.onAccent : '$ui.ink' })}>{msg('music.duplicates.mergeAndHide')}</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function DuplicatePlayButton({ label, onPress, size = 36 }: { label: string; onPress(): void; size?: number }) {
  const m = useMediaLook();
  const { state, handlers } = useInteraction();
  const lit = state.hover || state.focus;
  return (
    <Pressable {...handlers} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={[NO_RING, { width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center',
        backgroundColor: m.ui.accent, transform: [{ scale: state.pressed ? 0.96 : lit ? 1.05 : 1 }] },
        m.box({ 'box-shadow': '0px 8px 20px -4px rgba(0, 0, 0, 0.55)' }), transition('transform', 140)]}>
      <MediaGlyph name="play" size={Math.round(size * 0.42)} color={m.ui.onAccent} />
    </Pressable>
  );
}
