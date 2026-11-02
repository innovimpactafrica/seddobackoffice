import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_ENDPOINTS } from '../../core/api/api-endpoints';
import { ApiService } from '../../core/api/api.service';

export type SosStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

export interface SosAlert {
  id: string;
  status: SosStatus;
  /** Qui a déclenché l'alerte : `driver` ou `client`. */
  role: string;
  lat: number;
  lng: number;
  rideId: string;
  rideRef: string;
  name: string | null;
  phone: string | null;
  handledBy: string | null;
  notes: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface SosPage {
  items: SosAlert[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable({ providedIn: 'root' })
export class SosService {
  private readonly api = inject(ApiService);

  list(page: number, pageSize: number, status?: string, q?: string): Observable<SosPage> {
    return this.api.get<SosPage>(API_ENDPOINTS.sos.list, { page, pageSize, status, q });
  }

  /** Prend en charge une alerte ouverte. */
  acknowledge(id: string, notes?: string): Observable<unknown> {
    return this.api.post(API_ENDPOINTS.sos.acknowledge(id), notes ? { notes } : {});
  }

  /** Clôt l'alerte avec un compte rendu. */
  resolve(id: string, notes?: string): Observable<unknown> {
    return this.api.post(API_ENDPOINTS.sos.resolve(id), notes ? { notes } : {});
  }
}
