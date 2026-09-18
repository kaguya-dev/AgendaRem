import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AgendaMagno · Seu dia, com clareza',
  description: 'Um lugar tranquilo para organizar suas tarefas e projetos.',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
