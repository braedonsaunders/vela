// Written by `bun tools/screen-schema.ts write`: every built-in page document beside this file
// (<experience>/<page>.json), bundled with the app. packages/skin/src/resolve/builtin.ts addresses them as
// vela:<experience>/<page>. Do not edit; add or remove a JSON file and run the tool.
import type { ScreenDocument } from '../../screen';
import doc_listen_albums from './listen/albums.json';
import doc_listen_duplicates from './listen/duplicates.json';
import doc_listen_home from './listen/home.json';
import doc_listen_import from './listen/import.json';
import doc_listen_library from './listen/library.json';
import doc_listen_liked from './listen/liked.json';
import doc_listen_nowPlaying from './listen/nowPlaying.json';
import doc_listen_playlist from './listen/playlist.json';
import doc_listen_queue from './listen/queue.json';
import doc_listen_rewind from './listen/rewind.json';
import doc_listen_search from './listen/search.json';
import doc_listen_shell from './listen/shell.json';
import doc_listen_title from './listen/title.json';
import doc_listen_visualizer from './listen/visualizer.json';

export const BUILTIN_DOCUMENTS: readonly ScreenDocument[] = [
  doc_listen_albums as unknown as ScreenDocument,
  doc_listen_duplicates as unknown as ScreenDocument,
  doc_listen_home as unknown as ScreenDocument,
  doc_listen_import as unknown as ScreenDocument,
  doc_listen_library as unknown as ScreenDocument,
  doc_listen_liked as unknown as ScreenDocument,
  doc_listen_nowPlaying as unknown as ScreenDocument,
  doc_listen_playlist as unknown as ScreenDocument,
  doc_listen_queue as unknown as ScreenDocument,
  doc_listen_rewind as unknown as ScreenDocument,
  doc_listen_search as unknown as ScreenDocument,
  doc_listen_shell as unknown as ScreenDocument,
  doc_listen_title as unknown as ScreenDocument,
  doc_listen_visualizer as unknown as ScreenDocument,
];
