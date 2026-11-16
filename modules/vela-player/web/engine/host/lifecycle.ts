import type { HostContext } from './state';
import { resetMedia } from './media';
export function disposeHost(context: HostContext) {
  context.lifecycle.disposed = true;
  context.session.controller.stop();
  clearInterval(context.lifecycle.timer);
  for (const remove of context.lifecycle.listeners) remove();
  context.lifecycle.listeners = [];
  resetMedia(context);
  context.session.current = undefined;
}
