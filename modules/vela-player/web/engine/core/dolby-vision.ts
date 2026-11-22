/** What the web engine does with a Dolby Vision original. Browsers expose no Dolby Vision display
 * path, so the best the engine can show is a backward-compatible base layer (HDR10, HLG or SDR),
 * tone-mapped or presented as HDR like any other title. A profile without such a base layer would
 * show the wrong colours, so it is refused and the server's fallback plays instead. */
export type DolbyVisionRoute =
  | { kind: 'none' }
  | { kind: 'base-layer'; profile: string; base: 'hdr10' | 'hlg' | 'sdr' }
  | { kind: 'refuse'; reason: string };

export interface DolbyVisionFacts {
  dvProfile?: number;
  dvBlSignalCompatibilityId?: number;
  colorTransfer?: string;
}

const pq = new Set(['smpte2084', 'pq']);
const hlg = new Set(['arib-std-b67', 'hlg']);

/** Profile names as the info card shows them: '8.1', '8.4', '5', '7'. */
export function dolbyVisionProfileName(profile: number, compatibility?: number) {
  return (profile === 8 || profile === 10) && compatibility ? `${profile}.${compatibility}` : String(profile);
}

/** The route for the server's (ffprobe's) Dolby Vision facts. Profile 8 and AV1 profile 10 carry
 * their base layer's signal compatibility id: 1 is HDR10, 4 HLG and 2 SDR, each checked against the
 * transfer the stream actually declares when it declares one. Profile 5 (IPTPQc2) has no compatible
 * base; profile 7 is dual-layer and stays refused until a real profile 7 title has been qualified. */
export function dolbyVisionRoute(facts: DolbyVisionFacts): DolbyVisionRoute {
  const profile = facts.dvProfile;
  if (profile === undefined || profile === null) return { kind: 'none' };
  const name = dolbyVisionProfileName(profile, facts.dvBlSignalCompatibilityId);
  const transfer = facts.colorTransfer?.toLowerCase();
  if (profile === 8 || profile === 10) {
    const compatibility = facts.dvBlSignalCompatibilityId;
    const base = compatibility === 1 ? 'hdr10' : compatibility === 4 ? 'hlg' : compatibility === 2 ? 'sdr' : null;
    if (!base) return { kind: 'refuse', reason: `Dolby Vision ${name} has no compatible base layer` };
    const declared = transfer && transfer !== 'unknown' ? transfer : null;
    if (declared && ((base === 'hdr10' && !pq.has(declared)) || (base === 'hlg' && !hlg.has(declared))))
      return { kind: 'refuse', reason: `Dolby Vision ${name} base layer declares ${declared}` };
    return { kind: 'base-layer', profile: name, base };
  }
  if (profile === 5) return { kind: 'refuse', reason: 'Dolby Vision 5 needs its RPU applied; this browser cannot' };
  return { kind: 'refuse', reason: `Dolby Vision ${name} is not qualified in the browser` };
}
