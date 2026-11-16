// The wire contract (protocol/v0) as core sees it. This is the one place core names the
// protocol's path, so moving it to packages/protocol changes only these lines.
export type * from '../../protocol/types';
export type { SkinDocument } from '../../protocol/skin';
