'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Check, Code2, Grid2X2, LockKeyhole, ShieldCheck, Sparkles, Workflow, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

const copy = {
  es: {
    nav: ['El hub', 'Gobernanza', 'Ejemplos', 'Cómo funciona'], login: 'Acceder', start: 'Entrar al hub',
    badge: 'ENTERPRISE VIBE HUB', pill: 'Tu talento. Un solo espacio.', title: 'Empodera a tus citizen developers.',
    subtitle: 'Bajo el control y la', highlight: 'supervisión de IT.',
    lead: 'Transforma ideas de negocio en micro-herramientas. Crea con Studio, comparte con tu equipo y revisa cada entrega antes de publicarla en el catálogo.',
    note: 'Acceso con cuenta autorizada · Identidad y negocio en InsForge', secondary: 'Conocer el flujo',
    previewTitle: 'Un ciclo. Todo el control.', previewLabel: 'ESPACIO DE TRABAJO',
    previewFooter: 'Versiones y revisiones enlazadas.',
    cardTitle: 'De la idea al catálogo.',
    cardLead: 'Toda la iniciativa de tus empleados en un hub centralizado, con responsabilidades y estados explícitos.',
    features: ['Crear sin empezar de cero', 'Un catálogo que tu equipo entiende', 'IT como facilitador, no como barrera'],
    featureLead: [
      'Dashboards declarativos, conversación e iteraciones en Tektonik hub Studio. Preview aislada y versiones recuperables.',
      'Explora aplicaciones aprobadas por área, tecnología y madurez. Consulta responsables, versiones y métricas informativas.',
      'Envía fichas, solicita cambios, aprueba o rechaza con trazabilidad. El servidor y PostgreSQL verifican los permisos.',
    ],
    governance: 'GOBERNANZA POR DISEÑO', governanceTitle: 'La iniciativa del negocio. La supervisión de IT.',
    governanceLead: 'Cada entrega tiene autor, organización, versión y una decisión de revisión. Los checks de seguridad y datos son confirmaciones manuales, no una auditoría ni una certificación automática.',
    governanceNote: 'Identidad verificada en el servidor y aislamiento por organización con PostgreSQL + RLS.',
    steps: ['Crea una solución', 'Envía a revisión', 'Publica tras la aprobación'],
    stepLead: ['Diseña con componentes del catálogo Studio y datos de ejemplo.', 'Describe el propósito, impacto, tecnología y archivos asociados.', 'IT revisa la versión; las solicitudes de cambio vuelven al creador.'],
    examples: 'MICRO-APPS / EJEMPLOS', examplesTitle: 'Ideas pequeñas. Impacto compartido.',
    examplesLead: 'Ventas, operaciones y proyectos: tres escenarios ilustrativos que puedes adaptar en Studio.',
    examplesNames: ['Pipeline comercial', 'Control operativo', 'Seguimiento de proyectos'],
    examplesDesc: ['KPIs, oportunidades y evolución de ingresos.', 'Inventario, incidencias y cargas de trabajo.', 'Avance, responsables, tareas y plazos.'],
    how: 'CÓMO FUNCIONA', howTitle: 'Entra. Crea. Comparte.',
    howLead: 'Tu cuenta recibe una empresa y permisos asignados por administración: catálogo, creación, revisión o gestión global.',
    final: 'Convierte cada idea en una herramienta compartida.',
    finalLead: 'Crea, revisa y publica con identidad verificada y datos de negocio en InsForge.',
    terms: 'Alcance de la plataforma', privacy: 'Datos y privacidad', legalTitle: 'Alcance de Tektonik hub',
    legal: 'El acceso requiere una cuenta autorizada. Los permisos se verifican en el servidor y en PostgreSQL. Las revisiones son manuales y no acreditan certificaciones. Las métricas y precios son informativos; no hay facturación ni cobros integrados.',
    privacyTitle: 'Tus datos en Tektonik hub',
    privacyText: 'La identidad utiliza cookies de sesión y los datos de negocio se guardan en InsForge con permisos por organización. Los borradores Studio permanecen en el navegador y no se sincronizan entre dispositivos. La carga de binarios sigue pendiente. No introduzcas credenciales ni documentación corporativa en las peticiones de generación.',
  },
  en: {
    nav: ['The hub', 'Governance', 'Examples', 'How it works'], login: 'Sign in', start: 'Enter the hub',
    badge: 'ENTERPRISE VIBE HUB', pill: 'Your talent. One shared workspace.', title: 'Empower your citizen developers.',
    subtitle: 'With the control and', highlight: 'oversight of IT.',
    lead: 'Turn business ideas into micro-tools. Create with Studio, share with your team and review each submission before publishing it in the catalog.',
    note: 'Authorized accounts · Identity and business data in InsForge', secondary: 'Discover the workflow',
    previewTitle: 'One cycle. Full visibility.', previewLabel: 'WORKSPACE', previewFooter: 'Linked versions and reviews.',
    cardTitle: 'From idea to catalog.',
    cardLead: 'Bring employee initiative into a central hub, with explicit responsibilities and states.',
    features: ['Create without starting from scratch', 'A catalog your team understands', 'IT as an enabler, not a barrier'],
    featureLead: [
      'Declarative dashboards, conversation and iterations in Tektonik hub Studio. Isolated preview and recoverable versions.',
      'Explore approved applications by area, technology and maturity. Inspect owners, versions and informative metrics.',
      'Submit, request changes, approve or reject with traceability. The server and PostgreSQL verify permissions.',
    ],
    governance: 'GOVERNANCE BY DESIGN', governanceTitle: 'Business initiative. IT oversight.',
    governanceLead: 'Every submission has an author, organization, version and review decision. Security and data checks are manual confirmations, not automated audits or certifications.',
    governanceNote: 'Server-verified identity and organization isolation with PostgreSQL + RLS.',
    steps: ['Create a solution', 'Submit for review', 'Publish after approval'],
    stepLead: ['Design with Studio catalog components and sample data.', 'Describe purpose, impact, technology and associated files.', 'IT reviews the version; change requests return to the creator.'],
    examples: 'MICRO-APPS / EXAMPLES', examplesTitle: 'Small ideas. Shared impact.',
    examplesLead: 'Sales, operations and projects: three illustrative scenarios to adapt in Studio.',
    examplesNames: ['Sales pipeline', 'Operations control', 'Project tracking'],
    examplesDesc: ['KPIs, opportunities and revenue trends.', 'Inventory, incidents and workload.', 'Progress, owners, tasks and deadlines.'],
    how: 'HOW IT WORKS', howTitle: 'Enter. Create. Share.',
    howLead: 'Administration assigns your account an organization and permissions: catalog, creation, review or global management.',
    final: 'Turn every idea into a shared tool.',
    finalLead: 'Create, review and publish with verified identity and business data in InsForge.',
    terms: 'Platform scope', privacy: 'Data and privacy', legalTitle: 'Tektonik hub scope',
    legal: 'Access requires an authorized account. Permissions are verified by the server and PostgreSQL. Reviews are manual and do not certify compliance. Metrics and prices are informative; billing and payments are not integrated.',
    privacyTitle: 'Your data in Tektonik hub',
    privacyText: 'Identity uses session cookies and business data is stored in InsForge with organization-scoped permissions. Studio drafts remain in your browser and do not sync across devices. Binary uploads are not yet implemented. Do not include credentials or corporate documentation in generation requests.',
  },
};

export function Landing() {
  const [language, setLanguage] = useState<'es' | 'en'>('es');
  const [legal, setLegal] = useState<'scope' | 'privacy' | null>(null);
  useEffect(() => { let active = true; void Promise.resolve().then(() => { try { if (active && localStorage.getItem('blkunit:lang') === 'en') { setLanguage('en'); document.documentElement.lang = 'en'; } } catch {} }); return () => { active = false; }; }, []);
  const toggleLanguage = () => { const next = language === 'es' ? 'en' : 'es'; setLanguage(next); document.documentElement.lang = next; try { localStorage.setItem('blkunit:lang', next); } catch {} };
  const t = copy[language];
  const icons = [Code2, Grid2X2, ShieldCheck];
  return <div className="landing">
    <a href="#landing-content" className="skip-link">{language === 'es' ? 'Saltar al contenido' : 'Skip to content'}</a>
    <header className="landing-header">
      <Link href="/" className="landing-wordmark"><span className="brand-logo">TH</span><span>Tektonik hub<small>{t.badge}</small></span></Link>
      <nav aria-label={language === 'es' ? 'Navegación de portada' : 'Homepage navigation'}>{['hub', 'governance', 'examples', 'how'].map((id, index) => <a key={id} href={`#${id}`}>{t.nav[index]}</a>)}</nav>
      <div className="toolbar"><Button variant="ghost" onClick={toggleLanguage} aria-label="ES / EN">{language.toUpperCase()}</Button><Link href="/login" className="btn btn-primary">{t.login}<ArrowUpRight size={15} /></Link></div>
    </header>
    <main id="landing-content">
      <section className="landing-hero landing-container">
        <div className="hero-copy"><span className="hero-pill"><Sparkles size={13} />{t.pill}</span><h1>{t.title}<span>{t.subtitle} <mark>{t.highlight}</mark></span></h1><p>{t.lead}</p><div className="hero-actions"><Link href="/login" className="btn btn-primary">{t.start}<ArrowRight size={17} /></Link><a href="#governance" className="btn btn-secondary">{t.secondary}</a></div><small>{t.note}</small></div>
        <div className="hero-dashboard">
          <div className="demo-window-header"><span><i /><i /><i /></span><span className="mono">Tektonik hub / WORKSPACE</span><span className="badge badge-success">STUDIO</span></div>
          <div className="hero-dashboard-content"><p className="eyebrow">{t.previewLabel}</p><h2>{t.previewTitle}</h2><div className="preview-flow">{t.steps.map((step, index) => <div key={step}><span className="preview-step">{index === 2 ? <Check size={15} /> : String(index + 1).padStart(2, '0')}</span><span><strong>{step}</strong><small>{t.stepLead[index]}</small></span>{index === 2 && <LockKeyhole size={16} />}</div>)}</div><p className="preview-footer"><ShieldCheck size={15} />{t.previewFooter}</p></div>
          <div className="floating-label"><Sparkles size={14} />React · Next.js · TypeScript</div>
        </div>
      </section>
      <section id="hub" className="landing-section landing-container"><p className="eyebrow">Tektonik hub / THE HUB</p><h2>{t.cardTitle}</h2><p className="section-lead">{t.cardLead}</p><div className="landing-features">{t.features.map((title, index) => { const Icon = icons[index]; return <article className="landing-feature" key={title}><span className="feature-icon"><Icon size={23} /></span><h3>{title}</h3><p>{t.featureLead[index]}</p></article>; })}</div></section>
      <section id="governance" className="landing-governance"><div className="landing-container"><div><p className="eyebrow">{t.governance}</p><h2>{t.governanceTitle}</h2><p className="section-lead">{t.governanceLead}</p><div className="governance-note"><LockKeyhole size={18} /><span>{t.governanceNote}</span></div></div><div className="governance-steps">{t.steps.map((step, index) => <article key={step}><span className="mono">0{index + 1}</span><div><h3>{step}</h3><p>{t.stepLead[index]}</p></div><ArrowRight size={17} /></article>)}</div></div></section>
      <section id="examples" className="landing-section landing-container"><p className="eyebrow">{t.examples}</p><h2>{t.examplesTitle}</h2><p className="section-lead">{t.examplesLead}</p><div className="landing-examples">{t.examplesNames.map((title, index) => <Link href={`/login?next=${encodeURIComponent('/studio')}`} className="example-card" key={title}><div className={`example-visual example-${index}`}><div className="mini-bars">{[45, 72, 55, 92, 68, 84].map((height, column) => <span key={column} style={{ height: `${height - index * 8}%` }} />)}</div><span className="mono">EXAMPLE / 0{index + 1}</span></div><div><span className="eyebrow">{['SALES', 'OPERATIONS', 'PROJECTS'][index]}</span><h3>{title}</h3><p>{t.examplesDesc[index]}</p><span className="example-link">Tektonik hub Studio<ArrowUpRight size={16} /></span></div></Link>)}</div></section>
      <section id="how" className="landing-section landing-container"><div className="landing-how"><div><p className="eyebrow">{t.how}</p><h2>{t.howTitle}</h2><p className="section-lead">{t.howLead}</p><Link className="btn btn-primary" href="/login">{t.start}<ArrowRight size={16} /></Link></div><div className="identity-cards">{['Employee', 'Developer', 'IT Admin', 'Superadmin'].map((role, index) => <article key={role}><span className="avatar">{['EM', 'DV', 'IT', 'SA'][index]}</span><span><strong>{role}</strong><small>{['Catálogo', 'Studio', 'Revisiones', 'Organizaciones'][index]}</small></span><Workflow size={18} /></article>)}</div></div></section>
      <section className="landing-final landing-container"><span className="hero-pill"><Sparkles size={13} />Tektonik hub</span><h2>{t.final}</h2><p>{t.finalLead}</p><Link href="/login" className="btn btn-primary">{t.start}<ArrowRight size={16} /></Link></section>
    </main>
    <footer className="landing-footer landing-container"><Link href="/" className="landing-wordmark"><span className="brand-logo">TH</span><strong>Tektonik hub</strong></Link><span className="mono">NEXT.JS / REACT / TYPESCRIPT / TAILWIND</span><div><button onClick={() => setLegal('scope')}>{t.terms}</button><button onClick={() => setLegal('privacy')}>{t.privacy}</button></div></footer>
    <Dialog open={legal !== null} onClose={() => setLegal(null)} title={legal === 'privacy' ? t.privacyTitle : t.legalTitle}><p>{legal === 'privacy' ? t.privacyText : t.legal}</p><Button onClick={() => setLegal(null)}>{language === 'es' ? 'Entendido' : 'Got it'}</Button></Dialog>
  </div>;
}
