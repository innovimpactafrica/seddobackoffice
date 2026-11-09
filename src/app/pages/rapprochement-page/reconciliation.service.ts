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

/** Relevé importé (GET /finance/statements). */
export interface StatementListItem {
  id: string;
  filename: string;
  periodFrom: string;
  periodTo: string;
  lineCount: number;
  /** Nom de la personne qui a importé. */
  importedBy: string;
  importedAt: string;
  openGaps: number;
}

/** Correspondance d'une ligne du relevé avec le grand livre. Valeurs vues : MATCHED, REFUNDED, EXPLAINED ; les autres sont des écarts ouverts. */
export type LineMatch = 'MATCHED' | 'REFUNDED' | 'EXPLAINED' | string;

export interface StatementLine {
  id: string;
  occurredAt: string;
  /** Référence Orange de l'opération. */
  providerRef: string;
  /** Commande Seddo (ex. SD-1211-C1), null si inconnue. */
  orderId: string | null;
  /** IN = encaissement, OUT = décaissement. */
  direction: 'IN' | 'OUT' | string;
  amount: number;
  msisdn: string | null;
  match: LineMatch;
  transactionId: string | null;
  /** Montant côté grand livre Seddo, null si aucune transaction trouvée. */
  ledgerAmount: number | null;
  explanation: string | null;
}

/** Transaction Seddo absente du relevé ; forme non encore observée (liste vide dans les exemples). */
export type MissingTransaction = Record<string, unknown>;

/** Détail d'un relevé (GET /finance/statements/{id}) ; l'en-tête est en snake_case côté API. */
export interface StatementDetail {
  statement: {
    id: string;
    filename: string;
    period_from: string;
    period_to: string;
    line_count: number;
    /** Identifiant (et non nom) de la personne qui a importé. */
    imported_by: string;
    imported_at: string;
  };
  summary: {
    matched: number;
    openGaps: number;
    unexplainedAmount: number;
    missingInStatement: number;
  };
  lines: StatementLine[];
  missingInStatement: MissingTransaction[];
}

@Injectable({ providedIn: 'root' })
export class ReconciliationService {
  private readonly api = inject(ApiService);

  statements(params: { page: number; pageSize: number; q?: string }): Observable<Paged<StatementListItem>> {
    return this.api.get<Paged<StatementListItem>>(API_ENDPOINTS.reconciliation.statements, params);
  }

  statement(id: string): Observable<StatementDetail> {
    return this.api.get<StatementDetail>(API_ENDPOINTS.reconciliation.statement(id));
  }

  /** Import du CSV Orange Money ; le rapprochement automatique est fait par l'API. Réponse non documentée. */
  importStatement(file: File): Observable<unknown> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.api.post<unknown>(API_ENDPOINTS.reconciliation.statements, form);
  }

  /** Écart expliqué (frais, opération manuelle…) : il sort des écarts ouverts. */
  explain(lineId: string, reason: string): Observable<unknown> {
    return this.api.post(API_ENDPOINTS.reconciliation.explainLine(lineId), { reason });
  }

  /** Rembourse un encaissement reçu sans course correspondante. */
  refund(lineId: string, reason: string): Observable<unknown> {
    return this.api.post(API_ENDPOINTS.reconciliation.refundLine(lineId), { reason });
  }
}
