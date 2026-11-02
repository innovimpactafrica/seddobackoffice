import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * Backoffice derrière une authentification : la session vit dans le navigateur,
 * toutes les routes sont donc rendues côté client (pas de pré-rendu ni de SSR).
 */
export const serverRoutes: ServerRoute[] = [
  {
    path: '**',
    renderMode: RenderMode.Client
  }
];
