import { pageCatalog, type PageDefinition, type Surface } from '../mocks/page-catalog.js';

export function getNavigation(surface: Surface): readonly PageDefinition[] {
  return pageCatalog.filter((page) => page.surface === surface);
}

export function resolveRoute(path: string): PageDefinition | undefined {
  const normalizedPath = path.length > 1 ? path.replace(/\/$/, '') : path;
  return pageCatalog.find((page) => page.path === normalizedPath);
}

export type P11RecordRoute = { taskId: string | null };

export function resolveP11RecordRoute(path: string, search: string): P11RecordRoute | undefined {
  const normalizedPath = path.length > 1 ? path.replace(/\/$/, '') : path;
  if (normalizedPath !== '/h5/records') return undefined;

  const params = new URLSearchParams(search);
  const keys = [...params.keys()];
  if (!keys.includes('taskId')) return undefined;
  if (keys.length !== 1 || params.getAll('taskId').length !== 1) return { taskId: null };

  const taskId = params.get('taskId');
  if (!taskId || !taskId.trim() || taskId !== taskId.trim()) return { taskId: null };
  return { taskId };
}
