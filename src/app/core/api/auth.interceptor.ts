import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../auth/auth.service';
import { API_ENDPOINTS } from './api-endpoints';

const PUBLIC_ENDPOINTS: readonly string[] = [
  API_ENDPOINTS.auth.login,
  API_ENDPOINTS.auth.verify2fa,
  // Un mot de passe actuel erroné ne doit pas fermer la session.
  API_ENDPOINTS.auth.password
];

/** Ajoute le jeton Bearer aux appels API et déconnecte l'utilisateur si la session est expirée (401). */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiUrl)) return next(req);

  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.accessToken();
  const authReq = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  const isPublic = PUBLIC_ENDPOINTS.some(path => req.url.endsWith(path));

  return next(authReq).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && !isPublic) {
        auth.logout();
        void router.navigate(['/login']);
      }
      return throwError(() => error);
    })
  );
};
