/**
 * Accès aux écrans du backoffice selon le rôle (codes renvoyés par l'API : ADMIN, OPS, FINANCE, SUPPORT, DIRECTION).
 *
 * L'API ne publie pas de liste d'écrans par rôle : cette table est déduite des descriptions de `/v1/admin/roles`.
 * Elle masque les menus et bloque la navigation ; la vraie sécurité reste les contrôles de l'API.
 */
const ALL = ['ADMIN', 'OPS', 'FINANCE', 'SUPPORT', 'DIRECTION'] as const;

export const ROUTE_ROLES: Record<string, readonly string[]> = {
  dashboard: ALL,
  courses: ['ADMIN', 'OPS', 'FINANCE', 'SUPPORT'],
  rapports: ['ADMIN', 'FINANCE', 'DIRECTION'],
  // La Finance y gère les portefeuilles (ajustements, blocage des espèces).
  chauffeurs: ['ADMIN', 'OPS', 'FINANCE', 'SUPPORT'],
  clients: ['ADMIN', 'OPS', 'SUPPORT'],
  // Consultation et simulation ouvertes à tous les rôles opérationnels (spécification des zones).
  zones: ['ADMIN', 'OPS', 'FINANCE', 'SUPPORT'],
  paiements: ['ADMIN', 'FINANCE'],
  versements: ['ADMIN', 'FINANCE'],
  rapprochement: ['ADMIN', 'FINANCE'],
  reclamations: ['ADMIN', 'SUPPORT'],
  'alertes-sos': ['ADMIN', 'OPS', 'SUPPORT'],
  communication: ['ADMIN', 'OPS', 'SUPPORT'],
  tarification: ['ADMIN'],
  commissions: ['ADMIN'],
  utilisateurs: ['ADMIN'],
  'journal-audit': ['ADMIN'],
  parametres: ['ADMIN']
};

const normalize = (path: string): string => path.replace(/^\/+/, '').split(/[/?#]/)[0];

/** Un chemin absent de la table est considéré comme public (ex. login). */
export function canAccessPath(roleCode: string | null | undefined, path: string): boolean {
  const allowed = ROUTE_ROLES[normalize(path)];
  if (!allowed) return true;
  return !!roleCode && allowed.includes(roleCode);
}

/** Premier écran accessible au rôle, utilisé pour rediriger quand l'accès est refusé. */
export function firstAllowedPath(roleCode: string | null | undefined): string {
  const path = Object.keys(ROUTE_ROLES).find(p => canAccessPath(roleCode, p));
  return `/${path ?? 'login'}`;
}
