import React, { useState } from 'react';
import { TextInput } from 'react-native';
import { msg } from '@vela/core';
import { useVela } from '@vela/core/react';
import type { RemoteSubtitle } from '@vela/core';
import type { CommandInput } from './context';
import type { PlayerLook } from './look';
import { ChoiceRow, MenuHeading } from './menu';

export function SubtitleSearch({ look, send }: { look: PlayerLook; send(command: CommandInput): void }) {
  const vela = useVela();
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState('en');
  const [results, setResults] = useState<RemoteSubtitle[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (!vela.playback.subtitleSearchAvailable) return null;
  const search = async () => {
    if (busy) return;
    setBusy(true); setMessage(msg('player.subtitleSearch.searching')); setResults([]);
    try { const found = await vela.playback.searchSubtitles(language.trim()); setResults(found); setMessage(found.length ? '' : msg('player.subtitleSearch.none')); }
    catch (e) { setMessage(e instanceof Error ? e.message : msg('player.subtitleSearch.failed')); }
    finally { setBusy(false); }
  };
  const download = async (id: string) => {
    if (busy) return;
    setBusy(true); setMessage(msg('player.subtitleSearch.downloading'));
    try { const trackId = await vela.playback.downloadSubtitle(id); if (trackId) { send({ type: 'subtitle', trackId }); setOpen(false); setMessage(''); } else setMessage(msg('player.subtitleSearch.indexing')); }
    catch (e) { setMessage(e instanceof Error ? e.message : msg('player.subtitleSearch.downloadFailed')); }
    finally { setBusy(false); }
  };
  return <>
    <ChoiceRow look={look} name={msg('player.subtitleSearch.open')} selected={false} enabled={!busy} onChoose={() => { setOpen(true); void search(); }} />
    {open ? <>
      <TextInput accessibilityLabel={msg('player.subtitleSearch.language')} value={language} onChangeText={setLanguage} onSubmitEditing={() => void search()} style={[look.text(16, 500, look.ink), { padding: 12, backgroundColor: look.control, borderRadius: 12 }]} />
      <ChoiceRow look={look} name={msg('player.subtitleSearch.search')} selected={false} enabled={!busy} onChoose={() => void search()} />
      {[...new Set(results.map(r => r.language))].sort().map(lang => <React.Fragment key={lang}><MenuHeading look={look} text={lang} />{results.filter(r => r.language === lang).map(r => <ChoiceRow key={r.id} look={look} name={r.name} selected={false} enabled={!busy} onChoose={() => void download(r.id)} />)}</React.Fragment>)}
    </> : null}
    {message ? <MenuHeading look={look} text={message} /> : null}
  </>;
}
