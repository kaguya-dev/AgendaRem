import type { Metadata, Viewport } from 'next';
import { THEME_SCRIPT } from '@/frontend/dashboard/theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'AgendaRem · Seu dia, com clareza',
  description: 'Suas tarefas e seu assistente, no notebook e no celular.',
  applicationName: 'AgendaRem',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg' },
  appleWebApp: { capable: true, title: 'AgendaRem', statusBarStyle: 'default' },
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
        <script
          dangerouslySetInnerHTML={{
            __html: `${THEME_SCRIPT};if(location.port==='3000'&&'serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(function(r){for(var i=0;i<r.length;i++)r[i].unregister()});if('caches' in window){caches.keys().then(function(k){for(var i=0;i<k.length;i++)caches.delete(k[i])})}}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
