import { pageCatalog, type PageDefinition, type Surface } from '../mocks/page-catalog.js';

export function getNavigation(surface: Surface): readonly PageDefinition[] {
  return pageCatalog.filter((page) => page.surface === surface);
}

export function resolveRoute(path: string): PageDefinition | undefined {
  const normalizedPath = path.length > 1 ? path.replace(/\/$/, '') : path;
  return pageCatalog.find((page) => page.path === normalizedPath);
}
