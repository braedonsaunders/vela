import type { GuideChannel, GuideModel } from '@vela/core';

const rowKeys = new WeakMap<GuideChannel, string>();
export function rowContentKey(channel: GuideChannel): string {
  let key = rowKeys.get(channel);
  if (key === undefined) {
    key = JSON.stringify([channel.id, channel.number, channel.name, channel.logo, channel.favorite, channel.listed, channel.listingsLoaded, channel.listingsUnavailable,
      channel.programmes.map(p => [p.id, p.name, p.at, p.span, p.episode, p.tone])]);
    rowKeys.set(channel, key);
  }
  return key;
}

/** Relative clock copy/progress belongs to the details and marker, not grid geometry. */
const keys = new WeakMap<object, string>();
export function gridContentKey(model: GuideModel, rows: GuideChannel[]): string {
  let key = keys.get(rows);
  if (key === undefined) {
    key = JSON.stringify(rows.map(rowContentKey));
    keys.set(rows, key);
  }
  return JSON.stringify([model.day, model.minutes, model.dayStarts, model.loadedRanges, model.ticks, key]);
}

/** Minute steps only. Player reports and sub-minute projections cannot move the guide marker. */
export function guideMinute(minute: number): number {
  return minute < 0 ? -1 : Math.floor(minute);
}


/** Frozen row copy must never make a formerly airing programme tune on a later press. */
export function currentlyAiring(model: GuideModel | null, channelId: string, programmeId: string): boolean {
  return model?.channels.find(c => c.id === channelId)?.programmes.find(p => p.id === programmeId)?.airing ?? false;
}

const headers = new WeakMap<GuideModel, string>();
function gridHeader(model: GuideModel): string {
  let key = headers.get(model);
  if (key === undefined) {
    key = JSON.stringify([model.day, model.minutes, model.dayStarts, model.loadedRanges, model.ticks]);
    headers.set(model, key);
  }
  return key;
}

/** Compare shared rows first; never serialize a 10,000-channel lineup on each focus step. */
export function sameGridContent(a: GuideModel, aRows: GuideChannel[], b: GuideModel, bRows: GuideChannel[]): boolean {
  if (gridHeader(a) !== gridHeader(b) || aRows.length !== bRows.length) return false;
  if (aRows === bRows) return true;
  return aRows.every((row, index) => row === bRows[index] || rowContentKey(row) === rowContentKey(bRows[index]!));
}
