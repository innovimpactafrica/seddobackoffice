import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_ENDPOINTS } from '../../core/api/api-endpoints';
import { ApiService } from '../../core/api/api.service';
import { RideStatus } from '../courses-page/rides.service';
import { TicketStatus } from '../reclamations-page/tickets.service';

export type ClientStatus = 'ACTIVE' | 'BLOCKED';

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Ligne de la liste ; le téléphone arrive masqué (« +221 77 *** ** 47 »). */
export interface ClientListItem {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string;
  status: ClientStatus;
  /** Peut payer par Orange Money. */
  omEligible: boolean;
  rating: string | null;
  /** Inscrit depuis la mini app Max it. */
  maxit: boolean;
  rides: number;
  createdAt: string;
}

export interface ClientRide {
  id: string;
  ref: string;
  status: RideStatus;
  price: number;
  cancelFee: number;
  createdAt: string;
}

/** Réclamation : format supposé (liste vide dans la seule réponse reçue), proche de celui des courses. */
export interface ClientTicket {
  id: string;
  ref?: string | null;
  status: TicketStatus | string;
  category?: string | null;
  createdAt?: string | null;
}

export interface ClientDetail {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string;
  status: ClientStatus;
  lang: string;
  omEligible: boolean;
  rating: string | null;
  createdAt: string;
  recentRides: ClientRide[];
  tickets: ClientTicket[];
}

@Injectable({ providedIn: 'root' })
export class ClientsService {
  private readonly api = inject(ApiService);

  list(params: { page: number; pageSize: number; status?: ClientStatus; q?: string }): Observable<Paged<ClientListItem>> {
    return this.api.get<Paged<ClientListItem>>(API_ENDPOINTS.clients.list, params);
  }

  detail(id: string): Observable<ClientDetail> {
    return this.api.get<ClientDetail>(API_ENDPOINTS.clients.detail(id));
  }

  /** Ferme aussi les sessions du client. */
  block(id: string, reason: string): Observable<{ id: string; status: ClientStatus }> {
    return this.api.post(API_ENDPOINTS.clients.block(id), { reason });
  }

  unblock(id: string, reason: string): Observable<{ id: string; status: ClientStatus }> {
    return this.api.post(API_ENDPOINTS.clients.unblock(id), { reason });
  }

  revealPhone(id: string, reason: string): Observable<{ phone: string }> {
    return this.api.post(API_ENDPOINTS.clients.revealPhone(id), { reason });
  }
}

export function clientName(c: { firstName: string | null; lastName: string | null }): string {
  return [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
}
