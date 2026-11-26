// Self-contained rich block for B7 Playlist import (`packages/skin/src/blocks/import.tsx`).
import { importTruncatedNote } from './import-note';
import { importFileModeLabel, importFileTextLabel, importFormatName, importRefusalMessage, importSampleLinks, importUrlPlaceholder, SAMPLE_LINKS } from './import-copy';
// Exposes the URL/file import form, reading/matching progress bar, matched tracks with plain match
// badges ("Exact match" / "Matched by title & artist") and include/exclude toggles, unmatched tracks
// with inline release picker for ambiguous songs, and playlist save action over `@vela/core`'s
// `store.music` playlist import engine, independent of page code.
import { useEffect, useState } from 'react';
import { Platform, Text, TextInput, View, type ViewStyle } from 'react-native';
import {
  clock,
  msg,
  number,
  VelaError,
  type Card,
  type Loadable,
  type PlaylistImportFormat,
  type PlaylistImportMatchModel,
  type PlaylistImportModel,
  type PlaylistImportSources,
  type PlaylistImportUnmatchedModel,
} from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { FocusPressable as Pressable } from '../focus';
import { NO_RING, Glyph, useInteraction } from '../widgets/common/controls';
import { alpha, Cover, Progress, useMediaLook } from '../widgets/media/parts';

const web = Platform.OS === 'web';
const transition = (properties: string, ms = 160): ViewStyle =>
  web ? ({ transitionProperty: properties, transitionDuration: `${ms}ms`, transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)' } as ViewStyle) : {};

export const SAMPLE_SPOTIFY_URL = SAMPLE_LINKS.spotify!;
export const SAMPLE_DEEZER_URL = SAMPLE_LINKS.deezer!;
export const SAMPLE_M3U = `#EXTM3U
#EXTINF:228,The Hollow Lanterns - Paper Boats
The Hollow Lanterns - Paper Boats.flac
#EXTINF:241,The Hollow Lanterns - Salt in the Lamplight
The Hollow Lanterns - Salt in the Lamplight.flac
#EXTINF:214,Mira Kestrel - Glasshouse
Mira Kestrel - Glasshouse.flac
#EXTINF:198,Cedar & Wire - Late Tram Home (Live at the Corner Booth)
Cedar & Wire - Late Tram Home (Live at the Corner Booth).flac
#EXTINF:265,The Hollow Lanterns - Harbour Lights
The Hollow Lanterns - Harbour Lights.flac`;

/** Hook into `@vela/core`'s playlist import state and, unless `poll` is false, poll a running job
 * (`store.music.pollPlaylistImport`). One mounted hook polls; others on the same screen only read. */
export function usePlaylistImport({ poll = true }: { poll?: boolean } = {}): {
  job: PlaylistImportModel | null | undefined;
  load: Loadable<PlaylistImportModel | null>['load'];
  error: string;
  /** The server's refusal code for the last start or poll ("unsupported_link"), when it gave one. */
  code: string | undefined;
  available: boolean;
  /** What this server's import reads; null when it offers no import. */
  sources: PlaylistImportSources | null;
} {
  const store = useVela();
  const state = useVelaState(s => s.music.playlistImport);
  useVelaState(s => s.home.load);
  const available = store.music.playlistImportAvailable;
  const job = state.value;
  useEffect(() => {
    // Every poll answers a new job, so this re-arms after each one, including answers whose
    // progress has not moved yet.
    if (!poll || !available || !job || (job.state !== 'reading' && job.state !== 'matching')) return;
    const timer = setTimeout(() => {
      void store.music.pollPlaylistImport(job.id);
    }, 900);
    return () => clearTimeout(timer);
  }, [store, poll, available, job]);
  return {
    job,
    load: state.load,
    error: state.error,
    code: state.code,
    available,
    sources: store.music.playlistImportSources,
  };
}

export function ImportCover({ size }: { size: number }) {
  const m = useMediaLook();
  return (
    <View style={[{ width: size, height: size, borderRadius: size > 100 ? 8 : 4, alignItems: 'center', justifyContent: 'center' },
      m.box({ 'background-image': `linear-gradient(135deg, #1b5e4b 0%, ${m.ui.accent} 58%, #1d283a 100%)`, ...(size > 100 ? { 'box-shadow': '0px 22px 48px -16px rgba(0,0,0,0.7)' } : {}) })]}>
      <Glyph symbol="playlist-add" size={size * 0.4} color="#ffffff" />
    </View>
  );
}

export interface PlaylistImportBlockProps {
  libraryId?: string;
  onSaved?(playlistId: string): void;
  onNameChange?(name: string): void;
}

/** Self-contained playlist import rich block: URL/file form, live matching progress, matched/unmatched tracks and save action. */
export function PlaylistImportBlock({
  libraryId = 'music',
  onSaved,
  onNameChange,
}: PlaylistImportBlockProps) {
  const store = useVela();
  const m = useMediaLook();
  const { job, load, error, code, sources } = usePlaylistImport();
  const links = sources?.links ?? [];
  const files = sources?.files ?? [];
  const [chosenMode, setMode] = useState<'url' | 'file'>('url');
  const mode = !links.length ? 'file' : !files.length ? 'url' : chosenMode;
  const [url, setUrl] = useState('');
  const [fileName, setFileName] = useState('Harbour & Midnight');
  const [chosenFormat, setFormat] = useState<PlaylistImportFormat | null>(null);
  const format: PlaylistImportFormat = chosenFormat ?? files[0] ?? 'm3u';
  const [fileText, setFileText] = useState('');
  const [playlistName, setPlaylistName] = useState('');
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveCode, setSaveCode] = useState<string | null>(null);

  useEffect(() => {
    const nextName = job?.name ?? '';
    if (nextName) setPlaylistName(nextName);
    onNameChange?.(nextName);
    setExcluded(new Set());
    setChosen({});
    setSaveCode(null);
  }, [job?.id, job?.name]);

  const updatePlaylistName = (next: string) => {
    setPlaylistName(next);
    onNameChange?.(next);
  };

  const startUrl = async (targetUrl?: string) => {
    const clean = (targetUrl ?? url).trim();
    if (!clean) return;
    if (targetUrl) setUrl(targetUrl);
    await store.music.startPlaylistImport(libraryId || 'music', { url: clean });
  };

  const startFile = async () => {
    const text = fileText.trim();
    if (!text) return;
    const name = fileName.trim() || 'Imported Playlist';
    await store.music.startPlaylistImport(libraryId || 'music', {
      file: { name: `${name}.${format}`, format, text },
    });
  };

  const pickWebFile = () => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = [
      ...(files.includes('m3u') ? ['.m3u', '.m3u8', 'text/plain', 'audio/x-mpegurl'] : []),
      ...(files.includes('csv') ? ['.csv', 'text/csv'] : []),
    ].join(',');
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const lower = file.name.toLowerCase();
      const detected: PlaylistImportFormat = lower.endsWith('.csv') ? 'csv' : 'm3u';
      // A format the server does not list is kept, so the refusal names the formats it does read.
      setFormat(detected);
      setFileName(file.name.replace(/\.(m3u8?|csv|txt)$/i, '') || 'Imported Playlist');
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') setFileText(reader.result);
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const toggleExclude = (idx: number) => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const chooseRelease = (idx: number, candidateId: string | null) => {
    setChosen(prev => {
      const key = String(idx);
      const next = { ...prev };
      if (!candidateId || next[key] === candidateId) {
        delete next[key];
      } else {
        next[key] = candidateId;
      }
      return next;
    });
  };

  const savePlaylist = async () => {
    if (!job || saving) return;
    setSaving(true);
    setSaveCode(null);
    try {
      const created = await store.music.savePlaylistImport(job.id, {
        name: playlistName.trim() || job.name,
        exclude: [...excluded],
        choose: chosen,
      });
      if (created) {
        await store.playlists.load();
        await store.playlists.open(created.id, false, true);
        store.music.resetPlaylistImport();
        onSaved?.(created.id);
      }
    } catch (failure) {
      setSaveCode(failure instanceof VelaError ? failure.detail.code : '');
    } finally {
      setSaving(false);
    }
  };

  const chosenCount = Object.keys(chosen).filter(k => !excluded.has(Number(k))).length;
  const includedCount = (job?.matched.length ?? 0) - excluded.size + chosenCount;

  if (!job) {
    if (!sources || (!links.length && !files.length)) return null;
    return (
      <View style={{ gap: 20, maxWidth: 760, marginTop: 8 }} testID="music-import-form">
        {links.length && files.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
            <ImportChip label={msg('music.import.modeUrl')} on={mode === 'url'} onPress={() => setMode('url')} />
            <ImportChip label={importFileModeLabel(sources)} on={mode === 'file'} onPress={() => setMode('file')} />
          </View>
        ) : null}

        {mode === 'url' ? (
          <View style={{ padding: m.small ? 16 : 22, borderRadius: 16, backgroundColor: alpha(m.ui.ink, 0.05), borderWidth: 1, borderColor: m.ui.glassEdge, gap: 14 }}>
            <Text style={m.text({ 'font-size': '12px', 'font-weight': '700', 'letter-spacing': '0.12em', 'text-transform': 'uppercase', color: '$ui.inkQuiet' })}>
              {msg('music.import.urlLabel')}
            </Text>
            <TextInput
              testID="music-import-url-input"
              value={url}
              onChangeText={setUrl}
              placeholder={importUrlPlaceholder(sources)}
              placeholderTextColor={m.ui.inkQuiet}
              onSubmitEditing={() => void startUrl()}
              accessibilityLabel={msg('music.import.urlLabel')}
              style={[m.text({ 'font-size': '15px', color: '$ui.ink' }), { minHeight: 48, borderRadius: 12, paddingHorizontal: 14, backgroundColor: alpha(m.ui.ink, 0.06), borderWidth: 1, borderColor: m.ui.glassEdge }, NO_RING]}
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {importSampleLinks(sources).map(sample => (
                  <ImportChip key={sample.source} label={sample.label} on={url === sample.url} onPress={() => void startUrl(sample.url)} />
                ))}
              </View>
              <ImportPrimaryButton label={msg('music.import.start')} disabled={!url.trim() || load === 'loading'} onPress={() => void startUrl()} testID="music-import-start" />
            </View>
          </View>
        ) : (
          <View style={{ padding: m.small ? 16 : 22, borderRadius: 16, backgroundColor: alpha(m.ui.ink, 0.05), borderWidth: 1, borderColor: m.ui.glassEdge, gap: 14 }}>
            <View style={m.small ? { gap: 12 } : { flexDirection: 'row', alignItems: 'flex-end', gap: 16 }}>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={m.text({ 'font-size': '12px', 'font-weight': '700', 'letter-spacing': '0.12em', 'text-transform': 'uppercase', color: '$ui.inkQuiet' })}>
                  {msg('music.import.fileNameLabel')}
                </Text>
                <TextInput
                  testID="music-import-file-name"
                  value={fileName}
                  onChangeText={setFileName}
                  placeholder={msg('music.import.fileNamePlaceholder')}
                  placeholderTextColor={m.ui.inkQuiet}
                  accessibilityLabel={msg('music.import.fileNameLabel')}
                  style={[m.text({ 'font-size': '15px', color: '$ui.ink' }), { minHeight: 44, borderRadius: 10, paddingHorizontal: 12, backgroundColor: alpha(m.ui.ink, 0.06), borderWidth: 1, borderColor: m.ui.glassEdge }, NO_RING]}
                />
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {files.length > 1 ? files.map(listed => (
                  <ImportChip key={listed} label={importFormatName(listed)} on={format === listed} onPress={() => setFormat(listed)} />
                )) : null}
                {Platform.OS === 'web' ? (
                  <ImportChip label={msg('music.import.pickFile')} on={false} onPress={pickWebFile} />
                ) : null}
              </View>
            </View>

            <View style={{ gap: 6 }}>
              <Text style={m.text({ 'font-size': '12px', 'font-weight': '700', 'letter-spacing': '0.12em', 'text-transform': 'uppercase', color: '$ui.inkQuiet' })}>
                {importFileTextLabel(sources)}
              </Text>
              <TextInput
                testID="music-import-file-text"
                value={fileText}
                onChangeText={setFileText}
                multiline
                placeholder={msg('music.import.fileTextPlaceholder')}
                placeholderTextColor={m.ui.inkQuiet}
                accessibilityLabel={importFileTextLabel(sources)}
                style={[m.text({ 'font-size': '13px', 'line-height': '1.45', color: '$ui.ink' }), { minHeight: 136, borderRadius: 12, padding: 12, textAlignVertical: 'top', backgroundColor: alpha(m.ui.ink, 0.06), borderWidth: 1, borderColor: m.ui.glassEdge }, NO_RING]}
              />
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              {files.includes('m3u') ? (
                <ImportChip label={msg('music.import.loadSample')} on={false} onPress={() => { setFormat('m3u'); setFileName('Coastal M3U Mix'); setFileText(SAMPLE_M3U); }} />
              ) : <View />}
              <ImportPrimaryButton label={msg('music.import.start')} disabled={!fileText.trim() || load === 'loading'} onPress={() => void startFile()} testID="music-import-file-start" />
            </View>
          </View>
        )}

        {load === 'failed' || error ? (
          <ImportNotice text={code ? (importRefusalMessage(code, sources) || msg('music.import.failed')) : (error || msg('music.import.failed'))} />
        ) : null}
      </View>
    );
  }

  return (
    <ImportResultView
      job={job}
      playlistName={playlistName}
      onPlaylistName={updatePlaylistName}
      excluded={excluded}
      onToggleExclude={toggleExclude}
      chosen={chosen}
      onChooseRelease={chooseRelease}
      includedCount={includedCount}
      saving={saving}
      saveProblem={saveCode === null ? '' : (importRefusalMessage(saveCode, sources) || msg('music.import.saveFailed'))}
      onSave={() => void savePlaylist()}
      onReset={() => store.music.resetPlaylistImport()}
    />
  );
}

/** A refusal or failure under the form or the save bar. */
function ImportNotice({ text }: { text: string }) {
  const m = useMediaLook();
  return (
    <View testID="music-import-error" accessibilityRole="alert" style={{ padding: 16, borderRadius: 12, backgroundColor: alpha(m.ui.live, 0.14), borderWidth: 1, borderColor: alpha(m.ui.live, 0.4) }}>
      <Text style={m.text({ 'font-size': '14px', 'font-weight': '650', color: '$ui.ink' })}>{text}</Text>
    </View>
  );
}

export { importTruncatedNote } from './import-note';
export function ImportResultView({
  job,
  playlistName,
  onPlaylistName,
  excluded,
  onToggleExclude,
  chosen = {},
  onChooseRelease,
  includedCount,
  saving,
  saveProblem = '',
  onSave,
  onReset,
}: {
  job: PlaylistImportModel;
  playlistName: string;
  onPlaylistName(name: string): void;
  excluded: Set<number>;
  onToggleExclude(index: number): void;
  chosen?: Record<string, string>;
  onChooseRelease?(index: number, candidateId: string | null): void;
  includedCount: number;
  saving: boolean;
  /** Why the last save was refused, if it was. */
  saveProblem?: string;
  onSave(): void;
  onReset(): void;
}) {
  const m = useMediaLook();
  const inProgress = job.state === 'reading' || job.state === 'matching';
  const fraction = job.total > 0 ? Math.min(1, Math.max(0, job.done / job.total)) : 0;

  return (
    <View style={{ gap: 24, marginTop: 10 }} testID="music-import-results">
      {inProgress ? (
        <View testID="music-import-progress" style={{ padding: 20, borderRadius: 16, backgroundColor: alpha(m.ui.ink, 0.06), borderWidth: 1, borderColor: m.ui.glassEdge, gap: 12, maxWidth: 680 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={m.text({ 'font-size': '15px', 'font-weight': '700', color: '$ui.ink' })}>
              {job.state === 'reading' ? msg('music.import.reading') : msg('music.import.matching', { done: number(job.done), total: number(job.total) })}
            </Text>
            <Text style={m.text({ 'font-size': '13px', color: '$ui.inkQuiet', 'font-variant-numeric': 'tabular-nums' })}>
              {number(job.done)} / {number(job.total)}
            </Text>
          </View>
          <Progress fraction={fraction} height={6} />
        </View>
      ) : null}

      {job.truncated && !inProgress ? (
        <Text testID="music-import-truncated" accessibilityRole="alert" style={[m.text({ 'font-size': '14px', color: '$ui.inkSecondary' }), { maxWidth: 680 }]}>
          {importTruncatedNote(job)}
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 14, padding: m.small ? 14 : 18, borderRadius: 16, backgroundColor: alpha(m.ui.ink, 0.05), borderWidth: 1, borderColor: m.ui.glassEdge }}>
        <View style={{ flex: 1, minWidth: 220, gap: 6 }}>
          <Text style={m.text({ 'font-size': '12px', 'font-weight': '700', 'letter-spacing': '0.12em', 'text-transform': 'uppercase', color: '$ui.inkQuiet' })}>
            {msg('music.playlistName')}
          </Text>
          <TextInput
            testID="music-import-save-name"
            value={playlistName}
            onChangeText={onPlaylistName}
            accessibilityLabel={msg('music.playlistName')}
            style={[m.text({ 'font-size': '16px', 'font-weight': '650', color: '$ui.ink' }), { minHeight: 42, borderRadius: 10, paddingHorizontal: 12, backgroundColor: alpha(m.ui.ink, 0.06), borderWidth: 1, borderColor: m.ui.glassEdge }, NO_RING]}
          />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <ImportChip label={msg('music.import.startOver')} on={false} onPress={onReset} />
          <ImportPrimaryButton
            label={saving ? msg('music.import.saving') : msg('music.import.savePlaylist', { count: number(includedCount) })}
            disabled={inProgress || saving || includedCount <= 0}
            onPress={onSave}
            testID="music-import-save"
          />
        </View>
      </View>

      {saveProblem ? <ImportNotice text={saveProblem} /> : null}

      <View style={{ gap: 10 }} testID="music-import-matched">
        <Text accessibilityRole="header" style={m.text({ 'font-family': '$ui.fontDisplay', 'font-size': '24px', color: '$ui.ink' })}>
          {msg('music.import.matchedHeading', { count: number(job.matched.length) })}
        </Text>
        <View style={{ gap: 4 }}>
          {job.matched.map(match => (
            <MatchedTrackRow key={match.index} match={match} included={!excluded.has(match.index)} onToggle={() => onToggleExclude(match.index)} />
          ))}
        </View>
      </View>

      {job.unmatched.length ? (
        <View style={{ gap: 10 }} testID="music-import-unmatched">
          <Text accessibilityRole="header" style={m.text({ 'font-family': '$ui.fontDisplay', 'font-size': '24px', color: '$ui.ink' })}>
            {msg('music.import.unmatchedHeading', { count: number(job.unmatched.length) })}
          </Text>
          <View style={{ gap: 8 }}>
            {job.unmatched.map(item => (
              <UnmatchedTrackRow
                key={item.index}
                item={item}
                chosenId={chosen[String(item.index)]}
                onChoose={candidateId => onChooseRelease?.(item.index, candidateId)}
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function MatchedTrackRow({ match, included, onToggle }: { match: PlaylistImportMatchModel; included: boolean; onToggle(): void }) {
  const m = useMediaLook();
  const { state, handlers } = useInteraction();
  const lit = state.hover || state.focus;
  const card = match.card;
  const album = card.media?.parents.find(p => p.role === 'album')?.name || match.source.album || '';
  const badge = msg(`music.import.matchBy.${match.by}`);
  const tooltip = match.source.isrc ? `${badge} (${match.source.isrc})` : badge;
  return (
    <Pressable
      {...handlers}
      {...(web ? ({ title: tooltip } as object) : {})}
      onPress={onToggle}
      testID={`music-import-match-${match.index}`}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: included }}
      accessibilityLabel={`${card.name}, ${card.media?.byline ?? match.source.artist}, ${badge}`}
      style={[
        NO_RING,
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 10,
          backgroundColor: lit ? m.ui.control : alpha(m.ui.ink, 0.04),
          opacity: included ? 1 : 0.52,
          borderWidth: m.tv ? 2 : 0,
          borderColor: m.tv && state.focus ? m.ui.ink : 'transparent',
        },
        transition('background-color, opacity', 120),
      ]}>
      <View style={{ width: 26, height: 26, borderRadius: 6, alignItems: 'center', justifyContent: 'center',
        backgroundColor: included ? m.ui.accent : 'transparent', borderWidth: 1.5, borderColor: included ? m.ui.accent : m.ui.inkQuiet }}>
        {included ? <Glyph symbol="checkmark" size={15} color={m.ui.onAccent} /> : null}
      </View>
      <View pointerEvents="none">
        <Cover uri={card.poster} shape="square" size={44} title={card.name} accent={card.accent} lift={0.2} />
      </View>
      <View pointerEvents="none" style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text numberOfLines={1} style={m.text({ 'font-size': '15px', 'font-weight': '650', color: '$ui.ink' })}>{card.name}</Text>
        <Text numberOfLines={1} style={m.text({ 'font-size': '13px', color: '$ui.inkSecondary' })}>
          {[card.media?.byline || match.source.artist, album].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <View pointerEvents="none" style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: match.by === 'isrc' ? alpha(m.ui.accent, 0.18) : alpha(m.ui.ink, 0.08) }}>
        <Text style={m.text({ 'font-size': '11px', 'font-weight': '700', color: match.by === 'isrc' ? m.ui.accent : '$ui.inkSecondary' })}>
          {badge}
        </Text>
      </View>
      {!m.small ? (
        <Text style={[m.text({ 'font-size': '13px', color: '$ui.inkQuiet', 'font-variant-numeric': 'tabular-nums' }), { width: 46, textAlign: 'right' }]}>
          {card.media?.clockLabel || (card.durationSeconds ? clock(card.durationSeconds) : '')}
        </Text>
      ) : null}
    </Pressable>
  );
}

function UnmatchedTrackRow({
  item,
  chosenId,
  onChoose,
}: {
  item: PlaylistImportUnmatchedModel;
  chosenId?: string;
  onChoose?(candidateId: string | null): void;
}) {
  const m = useMediaLook();
  const isAmbiguous = item.reason === 'ambiguous' && item.candidates.length > 0;
  const [pickerOpen, setPickerOpen] = useState(false);
  const chosenCard: Card | undefined = chosenId ? item.candidates.find(c => c.id === chosenId) : undefined;
  const reason = chosenCard ? msg('music.import.releaseChosen') : msg(`music.import.reason.${item.reason}`);
  const tooltip = item.source.isrc ? `${reason} (${item.source.isrc})` : reason;

  return (
    <View
      testID={`music-import-unmatched-${item.index}`}
      {...(web ? ({ title: tooltip } as object) : {})}
      style={{
        borderRadius: 12,
        backgroundColor: chosenCard ? alpha(m.ui.accent, 0.08) : alpha(m.ui.ink, 0.03),
        borderWidth: 1,
        borderColor: chosenCard ? m.ui.accent : m.ui.glassEdge,
        overflow: 'hidden',
      }}>
      <Pressable
        disabled={!isAmbiguous}
        onPress={() => setPickerOpen(open => !open)}
        testID={isAmbiguous ? `music-import-ambiguous-toggle-${item.index}` : undefined}
        accessibilityRole={isAmbiguous ? 'button' : undefined}
        accessibilityLabel={`${item.source.title}, ${item.source.artist}, ${reason}`}
        style={[
          NO_RING,
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingHorizontal: 12,
            paddingVertical: 10,
          },
        ]}>
        <View style={{ width: 26, height: 26, borderRadius: 6, alignItems: 'center', justifyContent: 'center',
          backgroundColor: chosenCard ? m.ui.accent : 'transparent' }}>
          {chosenCard ? (
            <Glyph symbol="checkmark" size={15} color={m.ui.onAccent} />
          ) : (
            <Glyph symbol={isAmbiguous ? 'layers' : 'alert'} size={16} color={isAmbiguous ? m.ui.accent : m.ui.inkQuiet} />
          )}
        </View>
        {chosenCard ? (
          <View pointerEvents="none">
            <Cover uri={chosenCard.poster} shape="square" size={40} title={chosenCard.name} accent={chosenCard.accent} lift={0.15} />
          </View>
        ) : null}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text numberOfLines={1} style={m.text({ 'font-size': '15px', 'font-weight': '650', color: chosenCard ? '$ui.ink' : '$ui.inkSecondary' })}>
            {chosenCard ? chosenCard.name : item.source.title}
          </Text>
          <Text numberOfLines={1} style={m.text({ 'font-size': '13px', color: '$ui.inkQuiet' })}>
            {chosenCard
              ? [chosenCard.media?.byline || item.source.artist, chosenCard.media?.parents.find(p => p.role === 'album')?.name, chosenCard.yearLabel].filter(Boolean).join(' · ')
              : [item.source.artist, item.source.album].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: chosenCard ? alpha(m.ui.accent, 0.2) : alpha(m.ui.ink, 0.08) }}>
            <Text style={m.text({ 'font-size': '11px', 'font-weight': '700', color: chosenCard ? m.ui.accent : '$ui.inkSecondary' })}>
              {isAmbiguous && !chosenCard ? `${reason} · ${msg('music.import.chooseRelease')}` : reason}
            </Text>
          </View>
          {isAmbiguous ? (
            <Glyph symbol={pickerOpen ? 'chevron-up' : 'chevron-down'} size={15} color={m.ui.inkSecondary} />
          ) : null}
        </View>
      </Pressable>

      {isAmbiguous && pickerOpen ? (
        <View
          testID={`music-import-picker-${item.index}`}
          style={{
            paddingHorizontal: 12,
            paddingBottom: 12,
            paddingTop: 6,
            gap: 6,
            borderTopWidth: 1,
            borderTopColor: m.ui.glassEdge,
            backgroundColor: alpha(m.ui.ink, 0.02),
          }}>
          {item.candidates.map(candidate => {
            const selected = candidate.id === chosenId;
            const album = candidate.media?.parents.find(p => p.role === 'album')?.name ?? '';
            const formatFact = candidate.media?.facts.find(f => f.label === 'Format')?.value ?? '';
            const details = [
              album,
              candidate.yearLabel,
              formatFact,
              candidate.media?.clockLabel || (candidate.durationSeconds ? clock(candidate.durationSeconds) : ''),
            ].filter(Boolean).join(' · ');

            return (
              <Pressable
                key={candidate.id}
                onPress={() => onChoose?.(selected ? null : candidate.id)}
                testID={`music-import-candidate-${item.index}-${candidate.id}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={`${candidate.name}, ${details}`}
                style={[
                  NO_RING,
                  {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    padding: 10,
                    borderRadius: 10,
                    backgroundColor: selected ? alpha(m.ui.accent, 0.16) : alpha(m.ui.ink, 0.05),
                    borderWidth: 1,
                    borderColor: selected ? m.ui.accent : m.ui.glassEdge,
                  },
                ]}>
                <Cover uri={candidate.poster} shape="square" size={40} title={album || candidate.name} accent={candidate.accent} lift={0.15} />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text numberOfLines={1} style={m.text({ 'font-size': '14px', 'font-weight': '700', color: '$ui.ink' })}>
                    {album || candidate.name}
                  </Text>
                  <Text numberOfLines={1} style={m.text({ 'font-size': '12px', color: '$ui.inkSecondary' })}>
                    {details}
                  </Text>
                </View>
                <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: selected ? m.ui.accent : m.ui.control }}>
                  <Text style={m.text({ 'font-size': '11px', 'font-weight': '750', color: selected ? m.ui.onAccent : '$ui.ink' })}>
                    {selected ? msg('music.import.releaseChosen') : msg('music.import.chooseRelease')}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function ImportChip({ label, on, onPress }: { label: string; on: boolean; onPress(): void }) {
  const m = useMediaLook();
  const { state, handlers } = useInteraction();
  const lit = state.hover || state.focus;
  return (
    <Pressable {...handlers} onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={label}
      style={[NO_RING, { height: 34, paddingHorizontal: 14, borderRadius: 17, justifyContent: 'center',
        backgroundColor: on ? m.ui.ink : lit ? m.ui.controlHover : m.ui.control,
        borderWidth: m.tv ? 2 : 0, borderColor: m.tv && state.focus ? m.ui.accent : 'transparent' },
        transition('background-color', 120)]}>
      <Text style={m.text({ 'font-size': '13px', 'font-weight': '650', color: on ? m.ui.inkInverse : '$ui.ink' })}>{label}</Text>
    </Pressable>
  );
}

function ImportPrimaryButton({ label, onPress, disabled, testID }: { label: string; onPress(): void; disabled?: boolean; testID?: string }) {
  const m = useMediaLook();
  return (
    <Pressable onPress={onPress} disabled={disabled} testID={testID} accessibilityRole="button" accessibilityLabel={label}
      style={[NO_RING, { height: 40, paddingHorizontal: 20, borderRadius: 20, justifyContent: 'center', alignItems: 'center', backgroundColor: m.ui.accent, opacity: disabled ? 0.45 : 1 }, transition('opacity', 120)]}>
      <Text style={m.text({ 'font-size': '14px', 'font-weight': '750', color: m.ui.onAccent })}>{label}</Text>
    </Pressable>
  );
}
