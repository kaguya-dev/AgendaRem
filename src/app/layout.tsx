import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AgendaMagno · Seu dia, com clareza',
  description: 'Suas tarefas e seu assistente, no notebook e no celular.',
  applicationName: 'AgendaMagno',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg' },
  appleWebApp: { capable: true, title: 'AgendaMagno', statusBarStyle: 'default' },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: '#2d6c59' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
