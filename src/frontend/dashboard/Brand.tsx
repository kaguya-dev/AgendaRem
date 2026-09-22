import { ListTodo } from 'lucide-react';

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand ${light ? 'light' : ''}`}>
      <span className="brand-mark">
        <ListTodo size={23} strokeWidth={2.2} />
      </span>
      <span>
        agenda<span className="brand-bold">magno</span>
        <small>ESPAÇO PARA O QUE IMPORTA</small>
      </span>
    </div>
  );
}
