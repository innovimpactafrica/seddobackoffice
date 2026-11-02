import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_ENDPOINTS } from '../../core/api/api-endpoints';
import { ApiService } from '../../core/api/api.service';

export interface AdminUserDto {
  id: string;
  email: string;
  name: string;
  role: string;
  roleLabel: string;
  twoFactor: string;
  twoFactorLabel: string;
  status: string;
  statusLabel: string;
  lastActivityAt: string | null;
  invitedAt: string | null;
  mustChangePassword: boolean;
  createdAt: string;
}

export interface AdminUsersPage {
  items: AdminUserDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RoleDto {
  code: string;
  label: string;
  description: string;
  configurable: boolean;
}

export interface PermissionDto {
  key: string;
  label: string;
  routes: string;
  accepts: string[];
  rights: Record<string, string>;
}

export interface RolesResponse {
  roles: RoleDto[];
  accessLabels: Record<string, string>;
  permissions: PermissionDto[];
  refundThreshold: number;
}

/** Compte renvoyé après invitation ; `temporaryPassword` n'est présent que sans envoi d'e-mail (dev, recette). */
export interface InvitedUserDto extends AdminUserDto {
  temporaryPassword?: string;
}

export interface InviteUserBody {
  email: string;
  name: string;
  role: string;
}

export interface UpdateUserBody {
  role: string;
  active: boolean;
}

@Injectable({ providedIn: 'root' })
export class AdminUsersService {
  private readonly api = inject(ApiService);

  list(page = 1, pageSize = 100): Observable<AdminUsersPage> {
    return this.api.get<AdminUsersPage>(API_ENDPOINTS.users.list, { page, pageSize });
  }

  roles(): Observable<RolesResponse> {
    return this.api.get<RolesResponse>(API_ENDPOINTS.users.roles);
  }

  /**
   * Droits d'une action sensible ; seuls les rôles envoyés changent (l'Admin a toujours tous les droits).
   * Appliqué par l'API dans les 30 secondes. Renvoie le tableau complet à jour.
   */
  updatePermission(key: string, rights: Record<string, string>, reason: string): Observable<RolesResponse> {
    return this.api.put<RolesResponse>(API_ENDPOINTS.users.permission(key), { rights, reason });
  }

  update(id: string, body: UpdateUserBody): Observable<AdminUserDto> {
    return this.api.patch<AdminUserDto>(API_ENDPOINTS.users.update(id), body);
  }

  invite(body: InviteUserBody): Observable<InvitedUserDto> {
    return this.api.post<InvitedUserDto>(API_ENDPOINTS.users.invite, body);
  }

  resendInvitation(id: string): Observable<InvitedUserDto> {
    return this.api.post<InvitedUserDto>(API_ENDPOINTS.users.resendInvitation(id));
  }

  reset2fa(id: string): Observable<AdminUserDto> {
    return this.api.post<AdminUserDto>(API_ENDPOINTS.users.reset2fa(id));
  }
}
