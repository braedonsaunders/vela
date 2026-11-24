// "Search for subtitles…": a page of the subtitles menu that finds a subtitle the title lacks (from
// a subtitle site, or a server's AI translation) and adds it to the running session. The language
// is picked from a list, the viewer's languages first, never typed: it has to work with a remote.
import React, { useEffect, useRef, useState } from 'react';
import { languageLabel, msg, orderSubtitleLanguages, type RemoteSubtitle, type SubtitleLanguage } from '@vela/core';
import { useVela } from '@vela/core/react';
import type { CommandInput } from './context';
import type { PlayerLook } from './look';
import { ChoiceRow, MenuHeading, VersionChoiceRow } from './menu';
import { subtitleOfferFacts } from './subtitle-offers';

type Languages = { languages: SubtitleLanguage[]; preferred: string[] };

/** The languages a search takes on this session, or null while unknown or when the server has none. */
export function useSubtitleLanguages(): [Languages | null, (serverPreferred: readonly string[]) => void] {
  const vela = useVela();
  const [languages, setLanguages] = useState<Languages | null>(null);
  const available = vela.playback.subtitleSearchAvailable;
  const load = (serverPreferred: readonly string[] = []) => {
    vela.playback.subtitleLanguages(serverPreferred).then(setLanguages, () => setLanguages(null));
  };
  useEffect(() => { if (available) load(); else setLanguages(null); }, [available]);
  return [languages, load];
}

/** The subtitles menu's way in: shown only where the server can search. */
export function SubtitleSearchEntry({ look, enabled, onOpen }: { look: PlayerLook; enabled: boolean; onOpen(): void }) {
  const [languages] = useSubtitleLanguages();
  if (!languages) return null;
  return <ChoiceRow look={look} name={msg('player.subtitleSearch.open')} selected={false} enabled={enabled} onChoose={onOpen} testID="player-subtitle-search" />;
}

export function SubtitleSearch({ look, blocked, send, onClose }: { look: PlayerLook; blocked: boolean; send(command: CommandInput): void; onClose(): void }) {
  const vela = useVela();
  const [languages, reload] = useSubtitleLanguages();
  const [page, setPage] = useState<'results' | 'languages'>('results');
  const [language, setLanguage] = useState('');
  const [offers, setOffers] = useState<RemoteSubtitle[]>([]);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState('');
  const [message, setMessage] = useState('');
  const generation = useRef(0);

  const search = async (code?: string) => {
    const mine = ++generation.current;
    setBusy(true); setOffers([]); setMessage(msg('player.subtitleSearch.searching'));
    if (code) setLanguage(code);
    try {
      const found = await vela.playback.searchSubtitles(code);
      if (mine !== generation.current) return;
      setLanguage(found.language); setOffers(found.offers);
      setMessage(found.offers.length ? '' : msg('player.subtitleSearch.none'));
      if (found.preferred.length) reload(found.preferred);
    } catch (e) {
      if (mine === generation.current) setMessage(e instanceof Error && e.message ? e.message : msg('player.subtitleSearch.failed'));
    } finally {
      if (mine === generation.current) setBusy(false);
    }
  };
  // The first search is in the viewer's most preferred language, as the server knows it.
  useEffect(() => { void search(); }, []);

  const download = async (offer: RemoteSubtitle) => {
    if (busy) return;
    const mine = ++generation.current;
    setBusy(true); setDownloading(offer.id);
    setMessage(msg(offer.aiTranslated ? 'player.subtitleSearch.translating' : 'player.subtitleSearch.downloading'));
    try {
      const trackId = await vela.playback.downloadSubtitle(offer.id);
      // Selected even when the viewer has moved on in the menu: they asked for this subtitle.
      if (trackId) send({ type: 'subtitle', trackId });
      if (mine !== generation.current) return;
      if (trackId) onClose();
      else setMessage(msg('player.subtitleSearch.indexing'));
    } catch (e) {
      if (mine === generation.current) setMessage(e instanceof Error && e.message ? e.message : msg('player.subtitleSearch.downloadFailed'));
    } finally {
      if (mine === generation.current) { setBusy(false); setDownloading(''); }
    }
  };

  if (page === 'languages' && languages) {
    const { preferred, others } = orderSubtitleLanguages(languages.languages, languages.preferred);
    const row = (option: SubtitleLanguage) => (
      <ChoiceRow key={option.code} look={look} name={languageLabel(option.code, option.name)} selected={option.code === language} enabled
        onChoose={() => { setPage('results'); if (option.code !== language || !offers.length) void search(option.code); }} />
    );
    return <>
      <ChoiceRow look={look} name={`‹ ${msg('player.subtitleSearch.backToResults')}`} selected={false} enabled focus={!language} onChoose={() => setPage('results')} />
      {preferred.length ? <><MenuHeading look={look} text={msg('player.subtitleSearch.yourLanguages')} />{preferred.map(row)}</> : null}
      <MenuHeading look={look} text={msg('player.subtitleSearch.allLanguages')} />
      {others.map(row)}
    </>;
  }

  const current = languages?.languages.find(option => option.code === language);
  const shown = language ? languageLabel(language, current?.name) : '';
  return <>
    <ChoiceRow look={look} name={`‹ ${msg('player.subtitleSearch.back')}`} selected={false} enabled onChoose={onClose} testID="player-subtitle-search-back" />
    <ChoiceRow look={look} name={msg('player.subtitleSearch.language')} detail={shown ? `${shown} ›` : '›'} selected={false} focus
      enabled={!!languages && !downloading} onChoose={() => setPage('languages')} testID="player-subtitle-search-language" />
    {message ? <MenuHeading look={look} text={message} /> : null}
    {offers.length && shown ? <MenuHeading look={look} text={msg('player.subtitleSearch.results', { language: shown })} /> : null}
    {offers.map(offer => {
      const facts = subtitleOfferFacts(offer, language);
      return <VersionChoiceRow key={offer.id} look={look} name={offer.name} chips={facts.chips} status={facts.status}
        selected={false} pending={downloading === offer.id} enabled={!busy && !blocked} onChoose={() => void download(offer)} />;
    })}
  </>;
}
