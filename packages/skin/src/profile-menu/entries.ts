// The profile menu's entries (docs/skin-schema.md: Profile menu): what the app offers a signed-in
// viewer, as data. Every skin's menu draws every entry here through its look (expand.ts), so an
// entry added to this list appears in every skin, in its default section, with nothing to edit in
// the skin documents.
import type { Condition, NodeBase, ProfileMenuEntryId, Press, Template } from '../../../protocol/skin';

export type ProfileMenuEntryKind =
  /** The viewer: who is signed in (the `header` part). */
  | 'header'
  /** A pressable row (the `row` part, Appearance the `picker` part). */
  | 'row'
  /** A compiled control the app draws (the server list). */
  | 'widget'
  /** The About line: which Vela this is, where it runs and the server (the `about` part). */
  | 'about';

export interface ProfileMenuEntry {
  id: ProfileMenuEntryId;
  kind: ProfileMenuEntryKind;
  /** Its name: the row's text and the control's accessible name. */
  label: Template;
  /** A platform symbol (icons.ts). */
  icon?: string;
  /** A second line, where the entry has one (Appearance: the skin's name). */
  detail?: Template;
  press?: Press;
  /** When the entry is offered (every condition must hold). */
  when: Condition[];
  /** Stable across skins: the e2e suites and the tests find entries by it. */
  testId: string;
  a11y?: NodeBase['a11y'];
  /** The section it joins when a look's arrangement names it nowhere. */
  section: ProfileMenuSectionId;
  /** A widget entry's compiled control. */
  widget?: { widget: string; params?: Record<string, string> };
}

export type ProfileMenuSectionId = 'viewer' | 'you' | 'servers' | 'session' | 'about';

/** The default arrangement, in order: who you are, what you do, where you watch, leaving, and which Vela this is. */
export const PROFILE_MENU_SECTIONS: { id: ProfileMenuSectionId; title?: Template; divider?: boolean }[] = [
  { id: 'viewer' },
  { id: 'you', divider: true },
  { id: 'servers', title: '{t:connect.servers}' },
  { id: 'session' },
  { id: 'about' },
];

export const PROFILE_MENU_ENTRIES: readonly ProfileMenuEntry[] = [
  { id: 'viewer', kind: 'header', label: '{env.viewer}', when: [], testId: 'profile-menu-viewer', section: 'viewer' },
  { id: 'switchProfile', kind: 'row', label: '{t:ui.switchProfile}', icon: 'person', press: { action: 'switchProfile' },
    when: [{ test: 'env.canSwitchProfile' }], testId: 'switch-profile', section: 'you' },
  { id: 'playlists', kind: 'row', label: '{t:ui.playlists}', icon: 'layers', press: { action: 'playlists' },
    when: [{ test: 'env.canPlaylists' }], testId: 'profile-playlists', section: 'you' },
  { id: 'downloads', kind: 'row', label: '{t:ui.downloads}', icon: 'download', press: { action: 'downloads' },
    when: [{ test: 'env.canDownloads' }], testId: 'server-downloads', section: 'you' },
  { id: 'manageLibraries', kind: 'row', label: '{t:ui.manageLibraries}', icon: 'library', press: { action: 'manageLibraries' },
    when: [{ test: 'env.canManageLibraries' }], testId: 'manage-libraries', section: 'you' },
  { id: 'appearance', kind: 'row', label: '{t:ui.appearance}', detail: '{env.skinName}', icon: 'sparkles', press: { action: 'openPicker' },
    when: [], testId: 'skin-picker', a11y: { haspopup: 'dialog' }, section: 'you' },
  // Your servers, the current one checked: choosing another switches, and each other one can be removed.
  { id: 'servers', kind: 'widget', label: '{t:connect.servers}', when: [], testId: 'profile-servers', section: 'servers',
    widget: { widget: 'serverSwitcher', params: { entries: 'servers' } } },
  { id: 'addServer', kind: 'row', label: '{t:connect.add}', icon: 'plus', press: { action: 'addServer' }, when: [], testId: 'server-add', section: 'servers' },
  { id: 'signOut', kind: 'row', label: '{t:ui.signOut}', icon: 'sign-out', press: { action: 'signOut' }, when: [], testId: 'sign-out', section: 'session' },
  { id: 'about', kind: 'about', label: '{env.aboutLine}', when: [{ test: 'env.aboutLine' }], testId: 'about-line', section: 'about' },
];

/** Entries a look may leave out (`hide`): the viewer, for a menu whose surroundings already show them. */
export const PROFILE_MENU_HIDEABLE: ReadonlySet<ProfileMenuEntryId> = new Set(['viewer']);

export const profileMenuEntry = (id: string) => PROFILE_MENU_ENTRIES.find(entry => entry.id === id);
