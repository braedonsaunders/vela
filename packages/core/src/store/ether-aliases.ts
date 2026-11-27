import type { ServerRecord } from '../session/servers';

interface EtherEntry {
  record: ServerRecord;
  serverId: string;
  signedIn: boolean;
  working: boolean;
}

/** Entries are in saved order (oldest first). Only a live address can replace the saved one. */
export function etherAliasMerges(entries: readonly EtherEntry[], selectedId: string, preferredId?: string) {
  const groups = new Map<string, EtherEntry[]>();
  for (const entry of entries) {
    if (entry.record.kind !== 'ether' || !entry.serverId) continue;
    const group = groups.get(entry.serverId) ?? [];
    group.push(entry);
    groups.set(entry.serverId, group);
  }
  return [...groups.values()].filter(group => group.length > 1).flatMap(group => {
    const address = group.find(entry => entry.working && entry.record.id === preferredId)
      ?? group.findLast(entry => entry.working);
    if (!address) return [];
    const selected = group.find(entry => entry.record.id === selectedId);
    // Keep the signed-in record itself, so its credentials stay under the same key.
    const keep = (selected?.signedIn ? selected : undefined)
      ?? (address.signedIn ? address : undefined)
      ?? group.findLast(entry => entry.signedIn) ?? selected ?? address;
    return [{ address: address.record, keep: keep.record, aliases: group.filter(entry => entry !== keep).map(entry => entry.record) }];
  });
}
