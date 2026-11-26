import { VelaError } from '../adapter/errors';
import { guideProgrammeKey } from './timeshift';
import type { GuideApi } from './guide';
import type { GuideWindowRequest, GuideWindowResponse } from '../wire';

function validate(query: GuideWindowRequest, answer: GuideWindowResponse) {
  if (Date.parse(answer.from) !== Date.parse(query.from) || Date.parse(answer.until) !== Date.parse(query.until)
    || !Number.isFinite(Date.parse(answer.validUntil)) || !answer.revision || !Array.isArray(answer.channels) || answer.channels.length !== query.channelIds.length
    || answer.channels.some((row, index) => row.channelId !== query.channelIds[index]
      || !['ready', 'unavailable'].includes(row.state) || !Array.isArray(row.programmes)
      || row.programmes.some(p => p.channelId !== row.channelId))) throw new Error('Incomplete guide window');
}

function merge(query: GuideWindowRequest, answers: GuideWindowResponse[]): GuideWindowResponse {
  return { from: query.from, until: query.until, revision: answers.map(answer => answer.revision).join('|'),
    validUntil: new Date(Math.min(...answers.map(answer => Date.parse(answer.validUntil)))).toISOString(),
    channels: query.channelIds.map(channelId => {
      const rows = answers.flatMap(answer => answer.channels.filter(row => row.channelId === channelId));
      const archiveDays = rows.findLast(row => row.archiveDays !== undefined)?.archiveDays;
      return { channelId, ...(archiveDays === undefined ? {} : { archiveDays }), state: rows.some(row => row.state === 'unavailable') ? 'unavailable' : 'ready',
        programmes: [...new Map(rows.flatMap(row => row.programmes).map(p => [guideProgrammeKey(p), p])).values()]
          .sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id)) };
    }),
  };
}

/** Split a too-dense response, never accept a partial row as loaded. Absent capability uses pages. */
export async function readGuideWindow(api: Pick<GuideApi, 'guideWindow'>, query: GuideWindowRequest, depth = 0): Promise<GuideWindowResponse | null> {
  if (!api.guideWindow) return null;
  const count = () => {
    if (process.env.EXPO_PUBLIC_VELA_GUIDE_DIAGNOSTICS !== '1') return;
    const root = globalThis as typeof globalThis & { __velaGuideQueries?: number };
    root.__velaGuideQueries = (root.__velaGuideQueries ?? 0) + 1;
  };
  try {
    const answer = await api.guideWindow(query);
    if (answer) { validate(query, answer); count(); }
    return answer;
  } catch (error) {
    count();
    if (!(error instanceof VelaError) || error.status !== 400 || error.detail.code !== 'guide_window_too_dense' || depth >= 8) throw error;
    const hint = error.detail.suggest;
    const from = Date.parse(query.from), until = Date.parse(query.until);
    const timeLimit = hint?.maxWindowMinutes && hint.maxWindowMinutes > 0 ? hint.maxWindowMinutes * 60000 : 0;
    let queries: GuideWindowRequest[];
    if (query.channelIds.length > 1 && (!timeLimit || timeLimit >= until - from || (hint?.maxChannels ?? 0) < query.channelIds.length)) {
      const size = Math.max(1, Math.min(query.channelIds.length - 1, Math.floor(hint?.maxChannels || query.channelIds.length / 2)));
      queries = Array.from({ length: Math.ceil(query.channelIds.length / size) }, (_, i) => ({ ...query, channelIds: query.channelIds.slice(i * size, (i + 1) * size) }));
    } else {
      if (until - from <= 60000) throw error;
      const step = Math.max(60000, Math.min(timeLimit || (until - from) / 2, (until - from) / 2));
      queries = Array.from({ length: Math.ceil((until - from) / step) }, (_, i) => ({ ...query, from: new Date(from + i * step).toISOString(), until: new Date(Math.min(until, from + (i + 1) * step)).toISOString() }));
    }
    // Limit recursive fan-out; requests still share the parent channel/time promise in the cache.
    const answers: GuideWindowResponse[] = [];
    for (const part of queries) {
      const answer = await readGuideWindow(api, part, depth + 1);
      if (!answer) throw error;
      answers.push(answer);
    }
    return merge(query, answers);
  }
}
