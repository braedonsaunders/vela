import type { GuideChannel, GuideModel } from '@vela/core';

/** Relative clock copy/progress belongs to the details and marker, not grid geometry. */
const keys = new WeakMap<object, string>();
export function gridContentKey(model: GuideModel, rows: GuideChannel[]): string {
  let key = keys.get(rows);
  if (key === undefined) {
    key = JSON.stringify(rows.map(c => [c.id, c.number, c.name, c.logo, c.favorite, c.listed, c.listingsLoaded,
      c.programmes.map(p => [p.id, p.name, p.at, p.span, p.episode, p.tone])]));
    keys.set(rows, key);
  }
  return JSON.stringify([model.day, model.minutes, model.dayStarts, model.ticks, key]);
}

/** Minute steps only. Player reports and sub-minute projections cannot move the guide marker. */
export function guideMinute(minute: number): number {
  return minute < 0 ? -1 : Math.floor(minute);
}


/** Frozen row copy must never make a formerly airing programme tune on a later press. */
export function currentlyAiring(model: GuideModel | null, channelId: string, programmeId: string): boolean {
  return model?.channels.find(c => c.id === channelId)?.programmes.find(p => p.id === programmeId)?.airing ?? false;
}
