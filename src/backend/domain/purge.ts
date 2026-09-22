import type { State } from './types';

export function purge(original: State, now = new Date()): { state: State; removed: number[] } {
  const state = structuredClone(original);
  const removed = state.tasks
    .filter((t) => t.trashedAt && t.purgeAt && t.purgeAt <= now.toISOString())
    .map((t) => t.id);
  state.tasks = state.tasks.filter((t) => !removed.includes(t.id));
  state.history = state.history.filter((h) => !removed.includes(h.taskId));
  for (const op of state.operations)
    if (op.changes.some((c) => removed.includes(c.taskId))) {
      op.changes = [];
      op.undoable = false;
    }
  for (const ctx of state.conversations) {
    ctx.taskIds = ctx.taskIds.filter((id) => !removed.includes(id));
    // Pending commands and queries can contain deleted task text. Expire them on purge.
    if (removed.length) {
      delete ctx.pending;
      delete ctx.lastQuery;
    }
  }
  if (removed.length) state.settings.revision++;
  // Undo lasts 24h. Keep only a content-free barrier for each old channel.
  const cutoff = new Date(now.getTime() - 86400000).toISOString();
  state.operations = state.operations.filter(
    (o, i, all) => o.at >= cutoff || !all.slice(i + 1).some((later) => later.channel === o.channel),
  );
  for (const op of state.operations)
    if (op.at < cutoff) {
      op.changes = [];
      op.undoable = false;
    }
  return { state, removed };
}
