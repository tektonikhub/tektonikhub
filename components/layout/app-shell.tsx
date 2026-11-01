'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { Building2, Grid2X2, ShieldCheck, Sparkles, Users, Menu, Search, LogOut } from 'lucide-react';
import { useBLK } from '@/hooks/use-blk';
import { Button } from '@/components/ui/button';
import { studioRoles } from '@/lib/auth/policy';

export function AppShell({ children }: { children: ReactNode }) {
  const { data, user, org, repository, action, language, setLanguage } = useBLK();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); input.current?.focus(); }
      if (event.key === 'Escape' && mobileOpen) { setMobileOpen(false); menu.current?.focus(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mobileOpen]);
  const pending = data.apps.filter(app => app.orgId === org?.id && app.reviewStatus === 'pending_review').length;
  const nav = [
    { href: '/catalog', label: 'Catálogo de apps', icon: Grid2X2, show: true },
    { href: '/studio', label: 'Tektonik hub Studio', icon: Sparkles, show: Boolean(user && studioRoles.includes(user.role)) },
    { href: '/profile', label: 'Mi perfil y envíos', icon: Users, show: true },
    { href: '/company', label: 'Mi organización', icon: Building2, show: true },
    { href: '/admin', label: 'Oficina de IA', icon: ShieldCheck, show: ['admin', 'superadmin'].includes(user?.role ?? '') },
    { href: '/super-admin', label: 'Administración global', icon: Building2, show: user?.role === 'superadmin' },
  ];
  const doSearch = (event: FormEvent) => { event.preventDefault(); router.push(`/catalog?q=${encodeURIComponent(search.trim())}`); setMobileOpen(false); };
  const signOut = async () => { await action(() => repository.clearSession()); };
  return <div className="app-shell"><a className="skip-link" href="#main-content">Saltar al contenido</a><header className="top-bar">
    <div className="top-left"><button ref={menu} className="icon-button mobile-menu" aria-label="Abrir navegación" aria-expanded={mobileOpen} aria-controls="platform-navigation" onClick={() => setMobileOpen(value => !value)}><Menu size={20} /></button><Link className="brand-logo" href="/" aria-label="Tektonik hub inicio">TH</Link><div className="org-title"><strong>{org?.name ?? 'Tektonik hub'}</strong><span className="role-badge">{user?.role ?? 'LOCAL'}</span></div></div>
    <form className="shell-search" role="search" onSubmit={doSearch}><Search size={17} /><input ref={input} aria-label="Buscar herramienta" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar una herramienta…" /><kbd>⌘ K</kbd></form>
    <div className="top-right"><span className="local-indicator"><i />CUENTA VERIFICADA</span><Button variant="ghost" aria-label="Cambiar idioma" onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}>{language.toUpperCase()}</Button><Link href="/profile" className="avatar" aria-label="Abrir mi perfil">{user?.initials}</Link></div>
  </header><div className="app-body">{mobileOpen && <button className="sidebar-backdrop" aria-label="Cerrar navegación" onClick={() => setMobileOpen(false)} />}
    <aside id="platform-navigation" className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}><div className="sidebar-intro"><p className="eyebrow">ESPACIO DE TRABAJO</p><strong>Tu talento. Un solo hub.</strong><span className="muted">Crear · revisar · compartir</span></div><nav aria-label="Navegación principal"><p className="nav-label">Plataforma</p>{nav.filter(item => item.show).map(item => <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className={`nav-btn ${pathname === item.href ? 'active' : ''}`} aria-current={pathname === item.href ? 'page' : undefined}><span><item.icon size={18} />{item.label}</span>{item.href === '/admin' && pending > 0 && <span className="nav-count">{pending}</span>}</Link>)}</nav><div className="sidebar-footer"><Button variant="ghost" onClick={() => void signOut()}><LogOut size={15} />Cerrar sesión</Button><p>Datos en InsForge. La revisión manual no equivale a una certificación externa.</p><span className="mono">Tektonik hub / ENTERPRISE HUB</span></div></aside>
    <main id="main-content" className="main-content">{children}</main>
  </div></div>;
}
