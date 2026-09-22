import type { Task } from '@/backend/domain';

export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bahia',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export const timestamp = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Bahia',
  }).format(new Date(value));
export const overdue = (t: Task) =>
  Boolean(
    t.dueDate &&
    (t.dueTime ? new Date(`${t.dueDate}T${t.dueTime}:00-03:00`) < new Date() : t.dueDate < today()),
  );
export const due = (t: Task) =>
  !t.dueDate
    ? 'Sem prazo'
    : `${t.dueDate === today() ? 'Hoje' : t.dueDate.split('-').slice(1).reverse().join('/') + (t.dueDate.slice(0, 4) !== today().slice(0, 4) ? '/' + t.dueDate.slice(0, 4) : '')}${t.dueTime ? ` · ${t.dueTime}` : ''}`;
export const labels: Record<string, string> = {
  assistant: 'Assistente',
  calendar: 'Calendário',
  archived: 'Grupos arquivados',
  all: 'Todas as tarefas',
  inbox: 'Caixa de entrada',
  today: 'Hoje',
  overdue: 'Atrasadas',
  no_date: 'Sem prazo',
  completed: 'Concluídas',
  trash: 'Lixeira',
};
export const statusLabels: Record<string, string> = {
  pending: 'Pendente',
  in_progress: 'Em andamento',
  completed: 'Concluída',
  processing: 'Processando',
  done: 'Concluído',
  clarification: 'Aguardando esclarecimento',
  failed: 'Falhou',
};
export const priorityLabels = { low: 'Baixa', normal: 'Normal', high: 'Alta' };
