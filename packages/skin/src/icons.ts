// The platform symbols documents name (`symbol: 'play-fill'`), as 24x24 path data drawn in the
// text colour. Vela's own geometry; a document may instead give its own `paths`.
export const SYMBOLS: Record<string, { paths: string[]; stroke?: boolean }> = {
  'play-fill': { paths: ['M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z'] },
  play: { paths: ['M7.5 5.2v13.6L19 12z'], stroke: true },
  close: { paths: ['M6 6l12 12M18 6L6 18'], stroke: true },
  checkmark: { paths: ['M4.5 12.5l5 5L19.5 7'], stroke: true },
  search: { paths: ['M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5L20 20'], stroke: true },
  lock: { paths: ['M6.5 11h11v9h-11zM8.5 11V8a3.5 3.5 0 0 1 7 0v3'], stroke: true },
  'forward-chevron': { paths: ['M9 5l7 7-7 7'], stroke: true },
  back: { paths: ['M15 5l-7 7 7 7'], stroke: true },
  alert: { paths: ['M12 3.5l9.5 16.5h-19zM12 10v4.5M12 17.4v.1'], stroke: true },
  info: { paths: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.4v.1'], stroke: true },
  smartphone: { paths: ['M8 2.5h8a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5zM11 18.5h2'], stroke: true },
  'sign-out': { paths: ['M14 4H6v16h8M10 12h10M17 8.5l3.5 3.5-3.5 3.5'], stroke: true },
  heart: { paths: ['M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z'], stroke: true },
  'heart-fill': { paths: ['M12 20.5s-8-4.8-8-10.6A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8 2.9c0 5.8-8 10.6-8 10.6z'] },
  'star-fill': { paths: ['M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1-4.5-4.2 6.1-.8z'] },
  sort: { paths: ['M7 4v16M3.5 16.5L7 20l3.5-3.5M17 20V4M13.5 7.5L17 4l3.5 3.5'], stroke: true },
  calendar: { paths: ['M4 6h16v14H4zM4 10h16M8 3.5V7M16 3.5V7'], stroke: true },
  speaker: { paths: ['M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11'], stroke: true },
  'speaker-mute': { paths: ['M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5'], stroke: true },
  layers: { paths: ['M12 3.5l9 4.5-9 4.5L3 8zM3 12.5l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5'], stroke: true },
};
