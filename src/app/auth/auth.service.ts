import { computed, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api/api.service';
import { API_ENDPOINTS } from '../core/api/api-endpoints';

export interface AuthUser {
  name: string;
  shortName: string;
  role: string;
  /** Code du rôle renvoyé par l'API (ADMIN, OPS, FINANCE, SUPPORT, DIRECTION). */
  roleCode: string;
  email: string;
  initials: string;
}

export interface LoginChallenge {
  step: 'VERIFY_CODE';
  challengeToken: string;
  sentTo: string;
  expiresIn: number;
  /** Fourni par l'API hors production uniquement. */
  debugCode?: string;
}

/** GET /auth/me : profil à jour (rôle changé par un Admin, mot de passe à remplacer…). */
interface MeResponse {
  id: string;
  email: string;
  name: string;
  role: string;
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
  mustChangePassword: boolean;
}

interface TwoFactorResponse {
  accessToken: string;
  idleTimeoutS: number;
  admin: { id: string; email: string; name: string; role: string };
  mustChangePassword: boolean;
}

export interface AuthResult<T = void> {
  success: boolean;
  error?: string;
  data?: T;
}

interface StoredSession {
  token: string;
  user: AuthUser;
  /** Mot de passe provisoire : il doit être remplacé avant d'accéder au backoffice. */
  mustChangePassword?: boolean;
}

export const MIN_PASSWORD_LENGTH = 12;

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Admin',
  OPS: 'Opérations',
  FINANCE: 'Finance',
  SUPPORT: 'Support',
  DIRECTION: 'Direction'
};

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  private readonly platformId = inject(PLATFORM_ID);
  private static readonly STORAGE_KEY = 'seddo_bo_session';

  private readonly session = signal<StoredSession | null>(this.loadFromStorage());

  readonly currentUser = computed(() => this.session()?.user ?? null);
  readonly accessToken = computed(() => this.session()?.token ?? null);
  readonly isAuthenticated = computed(() => this.session() !== null);
  readonly mustChangePassword = computed(() => this.session()?.mustChangePassword === true);

  /** Étape 1 : e-mail + mot de passe → code de vérification envoyé à l'administrateur. */
  async login(email: string, password: string): Promise<AuthResult<LoginChallenge>> {
    try {
      const data = await firstValueFrom(
        this.api.post<LoginChallenge>(API_ENDPOINTS.auth.login, { email: email.trim(), password })
      );
      return { success: true, data };
    } catch (error) {
      return { success: false, error: this.errorMessage(error, 'Identifiants incorrects.') };
    }
  }

  /** Étape 2 : code reçu → jeton d'accès. */
  async verifyCode(challengeToken: string, code: string): Promise<AuthResult<{ mustChangePassword: boolean }>> {
    try {
      const res = await firstValueFrom(
        this.api.post<TwoFactorResponse>(API_ENDPOINTS.auth.verify2fa, { challengeToken, code })
      );
      const session: StoredSession = {
        token: res.accessToken,
        user: this.toUser(res.admin),
        mustChangePassword: res.mustChangePassword
      };
      this.session.set(session);
      this.persist(session);
      return { success: true, data: { mustChangePassword: res.mustChangePassword } };
    } catch (error) {
      return { success: false, error: this.errorMessage(error, 'Code invalide ou expiré.') };
    }
  }

  /** Remplace le mot de passe (provisoire ou non) ; lève l'obligation de changement une fois accepté. */
  async changePassword(current: string, next: string): Promise<AuthResult> {
    try {
      await firstValueFrom(this.api.post<{ changed: boolean }>(API_ENDPOINTS.auth.password, { current, next }));
      const session = this.session();
      if (session) {
        const updated: StoredSession = { ...session, mustChangePassword: false };
        this.session.set(updated);
        this.persist(updated);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: this.errorMessage(error, 'Le mot de passe n’a pas pu être modifié.') };
    }
  }

  /**
   * Déconnexion volontaire : invalide la session côté API puis ferme la session locale.
   * Si l'API est injoignable ou la session déjà expirée, la session locale est fermée quand même.
   */
  async signOut(): Promise<void> {
    try {
      if (this.session()) await firstValueFrom(this.api.post(API_ENDPOINTS.auth.logout));
    } catch {
      /* la session locale est fermée dans tous les cas */
    } finally {
      this.logout();
    }
  }

  /**
   * Relit le profil auprès de l'API (au chargement de l'application) : la session stockée peut dater d'avant
   * un changement de rôle ou de nom. Une session refusée (401) est fermée par l'intercepteur.
   */
  async refreshProfile(): Promise<void> {
    if (!this.session()) return;
    try {
      const me = await firstValueFrom(this.api.get<MeResponse>(API_ENDPOINTS.auth.me));
      const session = this.session();
      if (!session) return;
      const updated: StoredSession = { ...session, user: this.toUser(me), mustChangePassword: me.mustChangePassword };
      this.session.set(updated);
      this.persist(updated);
    } catch {
      /* hors ligne : la session stockée reste utilisée */
    }
  }

  /** Ferme uniquement la session locale (ex. jeton expiré : l'API l'a déjà invalidée). */
  logout(): void {
    this.session.set(null);
    this.persist(null);
  }

  private toUser(admin: { email: string; name: string; role: string }): AuthUser {
    const parts = admin.name.trim().split(/\s+/);
    const first = parts[0] ?? admin.email;
    const last = parts[parts.length - 1];
    const shortName = parts.length > 1 ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
    const initials = parts.length > 1
      ? (first.charAt(0) + last.charAt(0)).toUpperCase()
      : first.slice(0, 2).toUpperCase();
    return {
      name: admin.name,
      shortName,
      role: ROLE_LABELS[admin.role] ?? admin.role,
      roleCode: admin.role,
      email: admin.email,
      initials
    };
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) return "Impossible de joindre le serveur. Vérifiez votre connexion.";
      const message = (error.error as { message?: string | string[] } | null)?.message;
      if (Array.isArray(message) && message.length) return message.join(' ');
      if (typeof message === 'string' && message) return message;
      if (error.status === 429) return 'Trop de tentatives. Réessayez dans quelques instants.';
    }
    return fallback;
  }

  private loadFromStorage(): StoredSession | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    try {
      const raw = sessionStorage.getItem(AuthService.STORAGE_KEY);
      const session = raw ? (JSON.parse(raw) as StoredSession) : null;
      // Session d'une ancienne version (sans code de rôle) : reconnexion nécessaire.
      return session?.user?.roleCode ? session : null;
    } catch {
      return null;
    }
  }

  private persist(session: StoredSession | null): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      if (session) {
        sessionStorage.setItem(AuthService.STORAGE_KEY, JSON.stringify(session));
      } else {
        sessionStorage.removeItem(AuthService.STORAGE_KEY);
      }
    } catch {
      /* stockage indisponible : la session reste en mémoire */
    }
  }
}
