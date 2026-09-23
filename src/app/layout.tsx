import type { Metadata, Viewport } from 'next';
import { THEME_SCRIPT } from '@/frontend/dashboard/theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'AgendaMagna · Seu dia, com clareza',
  description: 'Suas tarefas e seu assistente, no notebook e no celular.',
  applicationName: 'AgendaMagna',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg' },
  appleWebApp: { capable: true, title: 'AgendaMagna', statusBarStyle: 'default' },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#4A8FD4' },
    { media: '(prefers-color-scheme: dark)', color: '#140D12' },
  ],
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
