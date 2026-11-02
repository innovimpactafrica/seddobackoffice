import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_ENDPOINTS } from '../../core/api/api-endpoints';
import { ApiService } from '../../core/api/api.service';

/** Période : dates `AAAA-MM-JJ`, `to` exclue. */
export interface ReportPeriod {
  from: string;
  to: string;
}

export interface ReportSummary {
  from: string;
  to: string;
  currency: string;
  rides: {
    orders: number;
    completed: number;
    noDriver: number;
    cancelled: number;
    /** Montant des courses terminées (F). */
    gmv: number;
    commission: number;
    driverEarnings: number;
    /** Délai moyen d'arrivée du chauffeur, en secondes. */
    avgPickupS: number | null;
    /** Chaîne décimale entre 0 et 1 (« 0.4935 »). */
    servedRate: string | null;
  };
  money: {
    refunded: number;
    paidOut: number;
    /** 95 % des versements arrivent en moins de… secondes. */
    payoutP95S: number | null;
    refundP95S: number | null;
  };
  /** Demandes de prix (estimations) sur la période. */
  quoteRequests: number;
  rating: {
    avgDriverRating: string | null;
    ratings: number;
  };
}

@Injectable({ providedIn: 'root' })
export class ReportsService {
  private readonly api = inject(ApiService);

  summary(period: ReportPeriod): Observable<ReportSummary> {
    return this.api.get<ReportSummary>(API_ENDPOINTS.reports.summary, { ...period });
  }

  /** CSV des courses de la période (séparateur « ; »). */
  ridesCsv(period: ReportPeriod): Observable<Blob> {
    return this.api.getBlob(API_ENDPOINTS.reports.ridesCsv, { ...period });
  }
}
