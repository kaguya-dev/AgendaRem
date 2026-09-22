import type { Task } from './types';

export function nextDue(task: Task): string | null {
  const rule = task.recurrence;
  if (!rule || !task.dueDate) return null;
  const date = new Date(`${task.dueDate}T12:00:00Z`);
  if (rule.frequency === 'monthly') {
    const day = rule.monthDay ?? date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + rule.interval);
    const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, end));
  } else if (rule.frequency === 'weekly' && rule.weekdays?.length) {
    const start = date.getTime();
    const weekday = date.getUTCDay();
    for (let i = 1; i <= rule.interval * 7 + 7; i++) {
      date.setTime(start + i * 86400000);
      if (
        Math.floor((weekday + i) / 7) % rule.interval === 0 &&
        rule.weekdays.includes(date.getUTCDay())
      )
        break;
    }
  } else date.setUTCDate(date.getUTCDate() + rule.interval * (rule.frequency === 'weekly' ? 7 : 1));
  return date.toISOString().slice(0, 10);
}
