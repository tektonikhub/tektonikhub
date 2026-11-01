import seed from '@/data.json';
import { Landing } from '@/components/layout/landing';
import '@/styles/landing.css';
export default function Home() { return <Landing counts={{ organizations: seed.organizations.length, apps: seed.apps.length, reviews: seed.reviews.length, approved: seed.apps.filter(app => app.reviewStatus === 'approved').length }} />; }
