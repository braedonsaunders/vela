// The web page's title for each route: what is on show, then the server's name, so tabs, history
// and screen readers can tell pages apart.
import { msg, type VelaState } from '@vela/core';

type Titles = Pick<VelaState, 'libraries' | 'titles' | 'collections' | 'rows'> & { search?: { query: string }; home?: Pick<VelaState['home'], 'value'> };

/** The route's own part of the title, or '' for Home. */
function pagePart(pathname: string, query: URLSearchParams, state: Titles): string {
  const [, first = '', id = ''] = pathname.split('/').map(part => { try { return decodeURIComponent(part); } catch { return part; } });
  // Home's search keeps its query in the store (and the address once typing pauses).
  const searching = state.search?.query.trim() || query.get('q') || '';
  switch (first) {
    case '': return searching ? msg('page.searchFor', { query: searching }) : '';
    case 'library': return state.libraries.value?.find(library => library.id === id)?.name ?? '';
    case 'title':
    case 'watch': return state.titles[id]?.value?.title[0]?.name ?? '';
    case 'collection': return state.collections[id]?.value?.name ?? '';
    case 'row': return state.rows[id]?.value?.name ?? '';
    case 'person': return query.get('name') ?? '';
    case 'search': return searching ? msg('page.searchFor', { query: searching }) : msg('ui.search');
    case 'live': return msg('ui.live');
    case 'screen': return state.home?.value?.screens.find(screen => screen.id === id)?.title ?? '';
    case 'playlists': return msg('page.playlists');
    case 'sign-in':
    case 'connect': return msg('ui.signIn');
    case 'player': return '';
    default: return msg('page.notFound');
  }
}

export function pageTitle(pathname: string, search: string, state: Titles, server: string): string {
  const part = pagePart(pathname, new URLSearchParams(search), state);
  return part && server ? msg('page.title', { page: part, server }) : part || server;
}
