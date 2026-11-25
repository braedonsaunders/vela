// Vela's built-in page documents (docs/experiences.md): bundled with the app from
// packages/protocol/fixtures/experiences/<experience>/<page>.json (the generated index), owner
// `vela`, addressed by id as plugin screens are: `vela:<experience>/<page>`, the screen
// `vela.<experience>`. Core opens them without a fetch (Screens.provideDocuments), so they draw the
// same on Ether, Jellyfin and Plex. The lookup is open: a later plugin-defined experience is one
// more set of documents under its own id.
import type { ScreenDocument } from '../../../protocol/screen';
import { builtinHref, parseBuiltinHref, type ExperienceId } from '../../../protocol/experiences';
import { BUILTIN_DOCUMENTS } from '../../../protocol/fixtures/experiences';

export { builtinHref, parseBuiltinHref };

/** The screen id core opens a built-in experience's pages under. */
export const builtinScreenId = (experience: ExperienceId): string => `vela.${experience}`;

/** Documents by href, checked once: each is owned by Vela and names its experience and page. */
export function builtinIndex(documents: readonly ScreenDocument[]): Map<string, ScreenDocument> {
  const index = new Map<string, ScreenDocument>();
  for (const doc of documents) {
    if (doc.owner !== 'vela' || !doc.experience) throw new Error(`Built-in document ${doc.screen}/${doc.page} is not owned by vela with an experience`);
    const href = builtinHref(doc.experience, doc.page);
    if (index.has(href)) throw new Error(`Two built-in documents are ${href}`);
    index.set(href, doc);
  }
  return index;
}

let bundled: Map<string, ScreenDocument> | undefined;
const all = () => (bundled ??= builtinIndex(BUILTIN_DOCUMENTS));

/** The built-in document at `vela:<experience>/<page>`, or undefined (core's provideDocuments lookup). */
export function builtinDocument(href: string): ScreenDocument | undefined {
  return parseBuiltinHref(href) ? all().get(href) : undefined;
}

/** The pages an experience builds in, by page id (`shell` among them when it has one). */
export function experiencePages(experience: ExperienceId): Record<string, ScreenDocument> {
  return Object.fromEntries([...all().values()].filter(doc => doc.experience === experience).map(doc => [doc.page, doc]));
}

/** The experiences with built-in documents. */
export function builtinExperiences(): ExperienceId[] {
  return [...new Set([...all().values()].map(doc => doc.experience!))].sort();
}
