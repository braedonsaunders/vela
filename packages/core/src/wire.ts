// The wire contract (protocol/v0) as core sees it. This is the one place core names the
// protocol's path, so moving it to packages/protocol changes only these lines.
export type * from '../../../protocol/v0/types';
export type { SkinDocument } from '../../../protocol/v0/skin';
