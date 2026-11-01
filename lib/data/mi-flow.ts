import type { App, Dataset, Organization } from '@/lib/domain/types';

export function approvedCatalogApps(data: Dataset, org: Organization | null): App[] {
  if (!org || !['active', 'active-amber'].includes(org.status)) return [];
  return data.apps.filter(app => app.orgId === org.id && app.reviewStatus === 'approved');
}

export function searchFlowApps(apps: App[], data: Dataset, query: string, area: string, favoritesOnly: boolean): App[] {
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
  const search = normalize(query);
  const entries = new Map(data.myFlow.map(entry => [entry.appId, entry]));
  return apps.filter(app => (!area || app.area === area)
    && (!favoritesOnly || entries.get(app.id)?.favorite)
    && normalize([app.title, app.desc, app.tagline, ...app.tags, ...app.tech,
      data.categories.find(category => category.id === app.area)?.label || app.area,
      data.users.find(user => user.id === app.authorId)?.name || ''].join(' ')).includes(search));
}

export function flowOrbitPage(apps: App[], selectedId: string | null) {
  const index = Math.max(0, apps.findIndex(app => app.id === selectedId));
  const start = Math.floor(index / 8) * 8;
  return { apps: apps.slice(start, start + 8), index, start };
}
