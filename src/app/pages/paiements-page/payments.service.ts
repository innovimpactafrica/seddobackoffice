import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_ENDPOINTS } from '../../core/api/api-endpoints';
import { ApiService } from '../../core/api/api.service';

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type TxType = 'CHARGE' | 'REFUND' | 'PAYOUT';
export type TxStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED';

/** Appel à Orange Money (GET /finance/transactions). */
export interface Transaction {
  id: string;
  type: TxType;
  amount: number;
  status: TxStatus;
  /** Commande envoyée à Orange : SD-1366-C1 (encaissement), SD-1320-P1 (versement)… */
  orderId: string;
  /** Référence Orange, connue une fois l'opération confirmée. */
  providerRef: string | null;
  /** Code d'échec : TIMEOUT, DECLINED, INTOUCH_DEPOSIT_NOT_CONFIGURED… */
  failureReason: string | null;
  /** Tentatives de dépôt (remboursements et versements). */
  attempts: number;
  /** Versement retenu pendant un litige. */
  held: boolean;
  /** Numéro masqué : « +221 78 *** ** 19 ». */
  msisdn: string | null;
  rideRef: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

/** Résultat de POST /transactions/{id}/recheck : statut avant et après l'interrogation d'Orange. */
export interface RecheckResult {
  id: string;
  before: TxStatus;
  status: TxStatus;
}

export type RefundStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/** Demande de remboursement au-delà du seuil (GET /finance/refund-requests). */
export interface RefundRequest {
  id: string;
  rideRef: string;
  rideId: string;
  amount: number;
  reason: string;
  status: RefundStatus;
  /** Nom de la personne qui a demandé. */
  requestedBy: string;
  createdAt: string;
  decidedAt: string | null;
}

/** Résultat de la relance groupée : une entrée par transaction, refus expliqué par l'API. */
export interface BulkRetryResult {
  retried: number;
  results: { id: string; ok: boolean; error?: string }[];
}

/** Demande de changement de numéro de versement ; forme non encore observée, lue avec des replis. */
export type PayoutMsisdnRequest = Record<string, unknown> & { id: string; status?: RefundStatus | string };

@Injectable({ providedIn: 'root' })
export class PaymentsService {
  private readonly api = inject(ApiService);

  transactions(params: { page: number; pageSize: number; q?: string; type?: TxType; status?: TxStatus }): Observable<Paged<Transaction>> {
    return this.api.get<Paged<Transaction>>(API_ENDPOINTS.payments.transactions, params);
  }

  /** Interroge Orange pour un encaissement en attente ou expiré et applique le résultat. */
  recheck(id: string): Observable<RecheckResult> {
    return this.api.post<RecheckResult>(API_ENDPOINTS.payments.recheck(id));
  }

  /** Relance un dépôt en échec (remboursement ou versement). Réponse non documentée. */
  retry(id: string, reason: string): Observable<unknown> {
    return this.api.post(API_ENDPOINTS.payments.retry(id), { reason });
  }

  /** Relance plusieurs dépôts ; chaque refus est détaillé dans `results`. */
  bulkRetry(ids: string[], reason: string): Observable<BulkRetryResult> {
    return this.api.post<BulkRetryResult>(API_ENDPOINTS.payments.bulkRetry, { ids, reason });
  }

  /** Retient un versement pendant un litige. */
  hold(id: string, reason: string): Observable<unknown> {
    return this.api.post(API_ENDPOINTS.payments.hold(id), { reason });
  }

  release(id: string, reason: string): Observable<unknown> {
    return this.api.post(API_ENDPOINTS.payments.release(id), { reason });
  }

  payoutMsisdnRequests(params: { page: number; pageSize: number; q?: string; status?: RefundStatus }): Observable<Paged<PayoutMsisdnRequest>> {
    return this.api.get<Paged<PayoutMsisdnRequest>>(API_ENDPOINTS.payments.payoutMsisdnRequests, params);
  }

  /** Validation par une autre personne que le demandeur (contrôlé par l'API). */
  approvePayoutMsisdn(id: string, reason: string): Observable<unknown> {
    return this.api.post(API_ENDPOINTS.payments.approvePayoutMsisdn(id), { reason });
  }

  rejectPayoutMsisdn(id: string, reason: string): Observable<unknown> {
    return this.api.post(API_ENDPOINTS.payments.rejectPayoutMsisdn(id), { reason });
  }

  refundRequests(params: { page: number; pageSize: number; q?: string; status?: RefundStatus }): Observable<Paged<RefundRequest>> {
    return this.api.get<Paged<RefundRequest>>(API_ENDPOINTS.payments.refundRequests, params);
  }

  /** Valide la demande : le dépôt Orange Money est ordonné. 409 ALREADY_DECIDED si déjà traitée. */
  approveRefund(id: string, reason: string): Observable<unknown> {
    return this.api.post(API_ENDPOINTS.payments.approveRefund(id), { reason });
  }

  rejectRefund(id: string, reason: string): Observable<unknown> {
    return this.api.post(API_ENDPOINTS.payments.rejectRefund(id), { reason });
  }
}
