// The platform symbols documents name (`symbol: 'play-fill'`), as 24x24 path data drawn in the
// text colour. Vela's own geometry; a document may instead give its own `paths`. The roles from
// `filter` down are the compiled skins' shapes (Exact's symbol table at exact-client-final).
export const SYMBOLS: Record<string, { paths: string[]; stroke?: boolean }> = {
  // Plugin screens (the kit and plugin documents; Sports' glyphs).
  grid: { paths: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'], stroke: true },
  /** Add to multiview on a plugin screen: four rounded 8x8 tiles (Sports' GridMark). */
  tiles: { paths: ['M4.5 3h5a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 3 9.5v-5A1.5 1.5 0 0 1 4.5 3z', 'M14.5 3h5a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 13 9.5v-5A1.5 1.5 0 0 1 14.5 3z', 'M4.5 13h5a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 3 19.5v-5A1.5 1.5 0 0 1 4.5 13z', 'M14.5 13h5a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 13 19.5v-5A1.5 1.5 0 0 1 14.5 13z'], stroke: true },
  'eye-off': { paths: ['M3 3l18 18', 'M10.6 5.1A10.4 10.4 0 0 1 12 5c6 0 9.5 7 9.5 7a17.6 17.6 0 0 1-3 3.9', 'M6.6 6.6C3.9 8.4 2.5 12 2.5 12S6 19 12 19a9.7 9.7 0 0 0 4.4-1', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'], stroke: true },
  'rating-tomato': { paths: ['M12 8c-5-3-9 0-9 5 0 4 4 7 9 7s9-3 9-7c0-5-4-8-9-5z', 'M12 8V4m-4 2 4 2 4-2'], stroke: true },
  'rating-splat': { paths: ['M9 8 8 3l4 4 4-3-1 5 6-1-4 4 3 4-5-1-1 5-3-4-5 3 1-5-5-3z', 'M20 4v1M4 20v1'], stroke: true },
  'rating-certified': { paths: ['M12 8c-5-3-9 0-9 5 0 4 4 7 9 7s9-3 9-7c0-5-4-8-9-5z', 'M12 8V4m-4 2 4 2 4-2', 'm9 14 2 2 4-4'], stroke: true },
  'rating-popcorn': { paths: ['m4 10 2 11h12l2-11zM9 13l1 5m5-5-1 5', 'M5 10a3 3 0 0 1 4-4 3 3 0 0 1 6 0 3 3 0 0 1 4 4'], stroke: true },
  bell: { paths: ['M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z', 'M10 21h4'], stroke: true },
  star: { paths: ['M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z'], stroke: true },
  tv: { paths: ['M3.5 6.5h17v11h-17z', 'M8.5 21h7', 'M9 2.5l3 4 3-4'], stroke: true },
  trophy: { paths: ['M8 4h8v5a4 4 0 0 1-8 0z', 'M8 6H5a3 3 0 0 0 3 4', 'M16 6h3a3 3 0 0 1-3 4', 'M12 13v4', 'M8.5 20h7'], stroke: true },
  'play-fill': { paths: ['M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z'] },
  play: { paths: ['M7.5 5.2v13.6L19 12z'], stroke: true },
  pause: { paths: ['M8 5v14M16 5v14'], stroke: true },
  /** Start a paused slideshow again: a turning arrow round a small play mark (not the play glyph). */
  autoplay: { paths: ['M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4', 'M10.5 9.2v5.6l4.4-2.8z'], stroke: true },
  close: { paths: ['M6 6l12 12M18 6L6 18'], stroke: true },
  /** Add (a server, in the profile menu). */
  plus: { paths: ['M12 5v14M5 12h14'], stroke: true },
  /** A programme that plays again from the channel's archive: a turning-back arrow. */
  replay: { paths: ['M4 10a8 8 0 1 1 1 8M4 4v6h6'], stroke: true },
  'thumbs-up': { paths: ['M7 10v10H3V10zM7 10l5-7 1.5 1v5H20a1 1 0 0 1 1 1.2l-2 8a2 2 0 0 1-2 1.8H7'], stroke: true },
  'thumbs-down': { paths: ['M7 14V4H3v10zM7 14l5 7 1.5-1v-5H20a1 1 0 0 0 1-1.2l-2-8A2 2 0 0 0 17 4H7'], stroke: true },
  checkmark: { paths: ['M4.5 12.5l5 5L19.5 7'], stroke: true },
  'check-circle': { paths: ['M21 11.1V12a9 9 0 1 1-5.3-8.2M21 5l-10 10-3-3'], stroke: true },
  circle: { paths: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z'], stroke: true },
  search: { paths: ['M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5L20 20'], stroke: true },
  lock: { paths: ['M6.5 11h11v9h-11zM8.5 11V8a3.5 3.5 0 0 1 7 0v3'], stroke: true },
  'forward-chevron': { paths: ['M9 5l7 7-7 7'], stroke: true },
  back: { paths: ['M15 5l-7 7 7 7'], stroke: true },
  alert: { paths: ['M12 3.5l9.5 16.5h-19zM12 10v4.5M12 17.4v.1'], stroke: true },
  info: { paths: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.4v.1'], stroke: true },
  external: { paths: ['M14 4h6v6M20 4l-9 9M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6'], stroke: true },
  copy: { paths: ['M8 8h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h2'], stroke: true },
  smartphone: { paths: ['M8 2.5h8a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5zM11 18.5h2'], stroke: true },
  'sign-out': { paths: ['M14 4H6v16h8M10 12h10M17 8.5l3.5 3.5-3.5 3.5'], stroke: true },
  heart: { paths: ['M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z'], stroke: true },
  'heart-fill': { paths: ['M12 20.5s-8-4.8-8-10.6A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8 2.9c0 5.8-8 10.6-8 10.6z'] },
  bookmark: { paths: ['M7 3.5h10a1 1 0 0 1 1 1V21l-6-4-6 4V4.5a1 1 0 0 1 1-1z'], stroke: true },
  'bookmark-fill': { paths: ['M7 3h10a1.5 1.5 0 0 1 1.5 1.5V22L12 17.7 5.5 22V4.5A1.5 1.5 0 0 1 7 3z'] },
  restart: { paths: ['M4.2 9A8.5 8.5 0 1 1 4 15M4.2 9V4.5M4.2 9h4.5'], stroke: true },
  remove: { paths: ['M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5'], stroke: true },
  /** Four tiles: Live TV multiview. */
  multiview: { paths: ['M3.5 5.5h7.5v6H3.5zM13 5.5h7.5v6H13zM3.5 13.5h7.5v6H3.5zM13 13.5h7.5v6H13z'], stroke: true },
  download: { paths: ['M12 3v12M7 10l5 5 5-5M4 16v4h16v-4'], stroke: true },
  'playlist-add': { paths: ['M4 6h15M4 11h15M4 16h7M17 14v7M13.5 17.5h7'], stroke: true },
  'star-fill': { paths: ['M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1-4.5-4.2 6.1-.8z'] },
  sort: { paths: ['M7 4v16M3.5 16.5L7 20l3.5-3.5M17 20V4M13.5 7.5L17 4l3.5 3.5'], stroke: true },
  calendar: { paths: ['M4 6h16v14H4zM4 10h16M8 3.5V7M16 3.5V7'], stroke: true },
  speaker: { paths: ['M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11'], stroke: true },
  'speaker-mute': { paths: ['M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5'], stroke: true },
  layers: { paths: ['M12 3.5l9 4.5-9 4.5L3 8zM3 12.5l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5'], stroke: true },
  filter: { paths: ['M4 7h16M7 12h10M10 17h4'], stroke: true },
  sliders: { paths: ['M4 6h10M18 6h2M14 4v4M4 12h4M12 12h8M8 10v4M4 18h12M16 16v4'], stroke: true },
  sparkles: {
    paths: ['M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8zM18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z'],
    stroke: true,
  },
  home: { paths: ['M3 10l9-7 9 7M5 9v12h5v-7h4v7h5V9'], stroke: true },
  menu: { paths: ['M4 6h16M4 12h16M4 18h16'], stroke: true },
  person: {
    paths: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM15 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM6 19v-1a6 4 0 0 1 12 0v1'],
    stroke: true,
  },
  radio: {
    paths: [
      'M4 9h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM6 9l12-5',
      'M10.5 14.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM14 13h4M14 16h4',
    ],
    stroke: true,
  },
  list: { paths: ['M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01'], stroke: true },
  /** Music: play this next (a list with an arrow into its top). */
  'play-next': { paths: ['M11 6h10M11 11h10M4 16h17M4 21h17', 'M3.5 4.5l4 3.5-4 3.5z'], stroke: true },
  /** Music: add to the end of the queue. */
  queue: { paths: ['M4 6h16M4 11h16M4 16h9M18 14v7M14.5 17.5h7'], stroke: true },
  /** Music: an artist (a head and a microphone line). */
  artist: { paths: ['M14 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM3.5 20.5v-1a6.5 5 0 0 1 10-4.2M17.5 11.5v7M17.5 18.5a2 2 0 1 1-2-2h2M17.5 11.5l3 1'], stroke: true },
  /** Music: an album (a sleeve with its record). */
  album: { paths: ['M3.5 4.5h11v15h-11zM14.5 7.5a4.5 4.5 0 1 1 0 9M9 12h.01'], stroke: true },
  /** Music: lyrics (a speech mark with lines). */
  lyrics: { paths: ['M4.5 5.5h15a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-4.5 3.5V16.5h-1a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM8 9.5h8M8 13h5'], stroke: true },
  /** Music: your library (a stack of sleeves on a shelf). */
  library: { paths: ['M4.5 4v16M9 4v16M13.5 4.5l5.5 15'], stroke: true },
  /** More actions: three dots. */
  more: { paths: ['M5 10.3a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4zM12 10.3a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4zM19 10.3a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4z'] },
  clock: { paths: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2'], stroke: true },
  /** Collapse or expand the library: a panel with its edge. */
  sidebar: { paths: ['M4 4.5h16v15H4zM9.5 4.5v15'], stroke: true },
  /** Expand to full screen. */
  expand: { paths: ['M14.5 4H20v5.5M20 4l-6.5 6.5M9.5 20H4v-5.5M4 20l6.5-6.5'], stroke: true },
};
