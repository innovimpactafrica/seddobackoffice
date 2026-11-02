import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_ENDPOINTS } from '../../core/api/api-endpoints';
import { ApiService } from '../../core/api/api.service';

export interface AuditLogFilters {
  q?: string;
  entity?: string;
  action?: string;
  actorType?: string;
  outcome?: string;
  from?: string;
  to?: string;
}

export interface AuditLogQuery extends AuditLogFilters {
  page: number;
  pageSize: number;
}

/** Entrée du journal telle que renvoyée par l'API (champs optionnels : le schéma peut varier). */
export interface AuditLogItem {
  id?: string;
  createdAt?: string;
  at?: string;
  actorType?: string;
  actorId?: string | null;
  actorApp?: string | null;
  actorContact?: string | null;
  actorName?: string;
  actorLabel?: string;
  actor?: { name?: string; email?: string } | string | null;
  action: string;
  entity?: string;
  entityId?: string | null;
  outcome?: string;
  reason?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  errorCode?: string | null;
}

export interface AuditLogPage {
  items: AuditLogItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AuditActionCount {
  action: string;
  count: number;
}

@Injectable({ providedIn: 'root' })
export class AuditLogsService {
  private readonly api = inject(ApiService);

  list(query: AuditLogQuery): Observable<AuditLogPage> {
    return this.api.get<AuditLogPage>(API_ENDPOINTS.auditLogs.list, { ...query });
  }

  actions(): Observable<AuditActionCount[]> {
    return this.api.get<AuditActionCount[]>(API_ENDPOINTS.auditLogs.actions);
  }

  exportCsv(filters: AuditLogFilters): Observable<Blob> {
    return this.api.getBlob(API_ENDPOINTS.auditLogs.export, { ...filters });
  }
}
