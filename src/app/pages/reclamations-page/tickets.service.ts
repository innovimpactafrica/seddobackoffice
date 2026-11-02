import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_ENDPOINTS } from '../../core/api/api-endpoints';
import { ApiService } from '../../core/api/api.service';

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type TicketPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface TicketListItem {
  id: string;
  ref: string;
  category: string;
  status: TicketStatus;
  openerRole: string;
  openedBy: string | null;
  rideRef: string | null;
  assignee: string | null;
  createdAt: string;
  updatedAt: string;
  ageS: number;
}

export interface TicketsPage {
  items: TicketListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TicketDetail {
  id: string;
  ref: string;
  ride_id: string | null;
  opened_by: string | null;
  opener_role: string;
  category: string;
  description: string;
  status: TicketStatus;
  /** Identifiant de l'agent en charge. */
  assignee: string | null;
  resolution: string | null;
  refund_amount: number | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  priority: TicketPriority;
  created_by_admin: string | null;
  opener_name: string | null;
  opener_phone: string | null;
  ride_ref: string | null;
  ride_status: string | null;
}

export interface TicketMessage {
  id: string;
  authorType: 'ADMIN' | 'USER' | string;
  internal: boolean;
  body: string;
  adminName: string | null;
  userName: string | null;
  createdAt: string;
}

export interface TicketUpdate {
  status?: TicketStatus;
  assignee?: string;
  resolution?: string;
  priority?: TicketPriority;
}

@Injectable({ providedIn: 'root' })
export class TicketsService {
  private readonly api = inject(ApiService);

  list(page: number, pageSize: number, q?: string, status?: string): Observable<TicketsPage> {
    return this.api.get<TicketsPage>(API_ENDPOINTS.tickets.list, { page, pageSize, q, status });
  }

  detail(id: string): Observable<TicketDetail> {
    return this.api.get<TicketDetail>(API_ENDPOINTS.tickets.detail(id));
  }

  update(id: string, body: TicketUpdate): Observable<TicketDetail> {
    return this.api.patch<TicketDetail>(API_ENDPOINTS.tickets.detail(id), body);
  }

  messages(id: string): Observable<TicketMessage[]> {
    return this.api.get<TicketMessage[]>(API_ENDPOINTS.tickets.messages(id));
  }

  reply(id: string, body: string, internal: boolean): Observable<unknown> {
    return this.api.post(API_ENDPOINTS.tickets.messages(id), { body, internal });
  }

  warnDriver(id: string, message: string): Observable<unknown> {
    return this.api.post(API_ENDPOINTS.tickets.warnDriver(id), { message });
  }
}

/** Libellé et classe CSS (pill-amber, pill-blue, pill-green, pill-gray, pill-red) par statut. */
export const TICKET_STATUSES: Record<TicketStatus, { label: string; css: string }> = {
  OPEN: { label: 'Nouveau', css: 'pill-amber' },
  IN_PROGRESS: { label: 'En cours', css: 'pill-blue' },
  RESOLVED: { label: 'Résolu', css: 'pill-green' },
  CLOSED: { label: 'Clos', css: 'pill-gray' }
};

export const TICKET_PRIORITIES: Record<TicketPriority, { label: string; css: string }> = {
  LOW: { label: 'Basse', css: 'pill-blue' },
  NORMAL: { label: 'Normale', css: 'pill-gray' },
  HIGH: { label: 'Haute', css: 'pill-red' },
  URGENT: { label: 'Urgente', css: 'pill-red' }
};

export const TICKET_CATEGORIES: Record<string, string> = {
  PAYMENT: 'Paiement',
  REFUND: 'Remboursement non reçu',
  LOST_ITEM: 'Objet oublié',
  DRIVER_BEHAVIOR: 'Comportement chauffeur',
  CLIENT_BEHAVIOR: 'Comportement client',
  SAFETY: 'Sécurité',
  PRICE: 'Montant',
  APP: 'Application',
  OTHER: 'Autre'
};
