import { TIMEZONE, type Task } from './types';

export const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
export function localDate(now: Date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIMEZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}
export function dueLabel(t: Task) {
  return t.dueDate
    ? `${t.dueDate.split('-').reverse().join('/')}${t.dueTime ? ` às ${t.dueTime}` : ''}`
    : 'sem prazo';
}
export function isOverdue(t: Task, now = new Date()) {
  if (!t.dueDate) return false;
  return t.dueTime
    ? new Date(`${t.dueDate}T${t.dueTime}:00-03:00`) < now
    : t.dueDate < localDate(now);
}
