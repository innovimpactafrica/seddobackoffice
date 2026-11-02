import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { canAccessPath, firstAllowedPath } from './access';

/**
 * Protège les routes privées : redirige vers /login si non authentifié, et vers le premier
 * écran autorisé si le rôle n'a pas accès à la page demandée.
 * La session vit dans le navigateur : côté serveur (SSR) on laisse passer,
 * sinon chaque rechargement de page serait redirigé avant l'hydratation.
 */
export const authGuard: CanActivateFn = route => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.isAuthenticated() || auth.mustChangePassword()) return router.createUrlTree(['/login']);

  const role = auth.currentUser()?.roleCode;
  return canAccessPath(role, route.routeConfig?.path ?? '') || router.createUrlTree([firstAllowedPath(role)]);
};

/** Protège la route publique /login : redirige vers l'écran d'accueil du rôle si déjà connecté. */
export const guestGuard: CanActivateFn = () => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;
  const auth = inject(AuthService);
  const router = inject(Router);
  // Un mot de passe provisoire reste sur /login, qui affiche l'étape de changement.
  return !auth.isAuthenticated() || auth.mustChangePassword() || router.createUrlTree([firstAllowedPath(auth.currentUser()?.roleCode)]);
};
