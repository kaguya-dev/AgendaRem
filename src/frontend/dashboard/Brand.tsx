import { ListTodo } from 'lucide-react';

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand ${light ? 'light' : ''}`}>
      <span className="brand-mark" style={{ overflow: 'hidden', padding: 0 }}>
        <img
          src="/icon.svg"
          alt="AgendaRem"
          width={36}
          height={38}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </span>
      <span>
        agenda<span className="brand-bold">rem</span>
        <small>ESPAÇO PARA O QUE IMPORTA</small>
      </span>
    </div>
  );
}
