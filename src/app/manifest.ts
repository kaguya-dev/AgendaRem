import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AgendaMagna',
    short_name: 'AgendaMagna',
    description: 'Suas tarefas e seu assistente, no notebook e no celular.',
    lang: 'pt-BR',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f7f8fa',
    theme_color: '#2d6c59',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  };
}
