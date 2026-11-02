import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_ENDPOINTS } from '../../core/api/api-endpoints';
import { ApiService } from '../../core/api/api.service';

export type RideStatus =
  | 'PAYMENT_PENDING'
  | 'PAYMENT_FAILED'
  | 'SEARCHING'
  | 'NO_DRIVER'
  | 'ACCEPTED'
  | 'DRIVER_ARRIVED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED_BY_CLIENT'
  | 'CANCELLED_BY_DRIVER'
  | 'CANCELLED_BY_ADMIN'
  | 'NO_SHOW'
  | 'INCIDENT';

export interface RideStatusInfo {
  label: string;
  css: string;
}

/** Libellé et classe CSS (st-encours, st-terminee, st-aucun, st-echoue, st-incident) par statut. */
export const RIDE_STATUSES: Record<RideStatus, RideStatusInfo> = {
  PAYMENT_PENDING: { label: 'Paiement en attente', css: 'st-encours' },
  PAYMENT_FAILED: { label: 'Paiement échoué', css: 'st-echoue' },
  SEARCHING: { label: 'Recherche en cours', css: 'st-encours' },
  NO_DRIVER: { label: 'Aucun chauffeur', css: 'st-aucun' },
  ACCEPTED: { label: 'Acceptée', css: 'st-encours' },
  DRIVER_ARRIVED: { label: 'Chauffeur arrivé', css: 'st-encours' },
  IN_PROGRESS: { label: 'En cours', css: 'st-encours' },
  COMPLETED: { label: 'Terminée', css: 'st-terminee' },
  CANCELLED_BY_CLIENT: { label: 'Annulée par le client', css: 'st-aucun' },
  CANCELLED_BY_DRIVER: { label: 'Annulée par le chauffeur', css: 'st-aucun' },
  CANCELLED_BY_ADMIN: { label: 'Annulée par Seddo', css: 'st-aucun' },
  NO_SHOW: { label: 'Client absent', css: 'st-aucun' },
  INCIDENT: { label: 'Incident', css: 'st-incident' }
};

export interface RideListItem {
  id: string;
  ref: string;
  status: RideStatus;
  category: string;
  price: number;
  commission: number;
  cancelFee: number;
  pickupAddress: string | null;
  dropoffAddress: string | null;
  clientName: string | null;
  clientPhone: string | null;
  driverName: string | null;
  driverPhone: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface RidesPage {
  items: RideListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RideListQuery {
  page: number;
  pageSize: number;
  /** Recherche libre : référence, téléphone. */
  q?: string;
  status?: string;
  /** Dates `AAAA-MM-JJ`. */
  from?: string;
  to?: string;
}

export interface RideRecord {
  id: string;
  ref: string;
  category: string;
  status: RideStatus;
  pickup_address: string | null;
  dropoff_address: string | null;
  distance_m: number | null;
  quoted_price: number;
  final_price: number | null;
  commission_rate: string;
  commission_amount: number;
  driver_amount: number;
  cancel_fee: number;
  cancel_reason: string | null;
  client_name: string | null;
  client_phone: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  plate: string | null;
  make: string | null;
  model: string | null;
  color: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface RideEvent {
  type: string;
  from: string | null;
  to: string | null;
  actorType: string;
  actorId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface RideTransaction {
  id: string;
  type: string;
  amount: number;
  status: string;
  orderId: string;
  providerRef: string | null;
  failureReason: string | null;
  attempts: number;
  held: boolean;
  createdAt: string;
  confirmedAt: string | null;
}

export interface RideDetail {
  ride: RideRecord;
  events: RideEvent[];
  transactions: RideTransaction[];
}

export type TicketCategory = 'PAYMENT' | 'REFUND' | 'LOST_ITEM' | 'DRIVER_BEHAVIOR' | 'CLIENT_BEHAVIOR' | 'SAFETY' | 'PRICE' | 'APP' | 'OTHER';
export type TicketPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface NewRideTicket {
  category: TicketCategory;
  description: string;
  priority: TicketPriority;
}

export interface RideTicket {
  id: string;
  ref: string;
  status: string;
  category: string;
  priority: string;
}

@Injectable({ providedIn: 'root' })
export class RidesService {
  private readonly api = inject(ApiService);

  list(query: RideListQuery): Observable<RidesPage> {
    return this.api.get<RidesPage>(API_ENDPOINTS.rides.list, { ...query });
  }

  detail(id: string): Observable<RideDetail> {
    return this.api.get<RideDetail>(API_ENDPOINTS.rides.detail(id));
  }

  /** Annule la course avec remboursement intégral du client. */
  cancel(id: string, reason: string): Observable<{ status: RideStatus }> {
    return this.api.post(API_ENDPOINTS.rides.cancel(id), { reason });
  }

  /** Remboursement manuel : direct sous le seuil, sinon demande à valider par la Finance. */
  refund(id: string, amount: number, reason: string): Observable<unknown> {
    return this.api.post(API_ENDPOINTS.rides.refund(id), { amount, reason });
  }

  openTicket(id: string, body: NewRideTicket): Observable<RideTicket> {
    return this.api.post<RideTicket>(API_ENDPOINTS.rides.ticket(id), body);
  }

  /** Clôture forcée (incident, fin oubliée) : répartition et versement comme une fin normale. */
  forceComplete(id: string, reason: string): Observable<unknown> {
    return this.api.post(API_ENDPOINTS.rides.forceComplete(id), { reason });
  }
}
