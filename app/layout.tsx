import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@/styles/globals.css';
export const metadata: Metadata = { applicationName: 'Tektonik hub', title: { default: 'Tektonik hub — Enterprise Vibe Hub', template: '%s | Tektonik hub' }, description: 'Espacio de trabajo para crear, revisar y compartir microaplicaciones con supervisión de IT e identidad verificada.', openGraph: { siteName: 'Tektonik hub', title: 'Tektonik hub — Enterprise Vibe Hub' } };
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="es"><head><link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" /><link href="https://fonts.googleapis.com/css2?family=Barlow:ital,wght@0,700;0,800;1,900&family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700;800&display=swap" rel="stylesheet" /></head><body>{children}</body></html>;
}
