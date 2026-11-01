import Link from 'next/link';
export default function NotFound() { return <main className="empty-state"><p className="eyebrow">404 / Tektonik hub</p><h1>Esta página no existe</h1><Link className="btn btn-primary" href="/catalog">Volver al catálogo</Link></main>; }
