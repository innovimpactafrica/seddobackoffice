import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_ENDPOINTS } from '../../core/api/api-endpoints';
import { ApiService } from '../../core/api/api.service';

export interface CommissionException {
  id: string;
  scope: string;
  label: string;
  rate: number;
  period: string;
  validFrom: string;
  validTo: string | null;
}

export interface TariffCategory {
  code: string;
  name: string;
  active: boolean;
  inheritsDefault: boolean;
}

export type CommissionScope = 'GLOBAL' | 'CATEGORY' | 'ZONE' | 'NEW_DRIVERS';

/** Règle de commission telle que renvoyée par GET /commission-rules (en vigueur et passées). */
export interface CommissionRule {
  id: string;
  scope: CommissionScope;
  category: string | null;
  zoneId: string | null;
  zoneName: string | null;
  /** Taux en %, renvoyé en texte ("25.00"). */
  rate: string;
  validFrom: string;
  validTo: string | null;
  reason: string | null;
  active: boolean;
}

export interface VehicleCategory {
  code: string;
  name: string;
  seats: number;
  active: boolean;
  sortOrder: number;
}

/** Plage horaire d'une grille, heure de Dakar ; `to` avant `from` = passe minuit. */
export interface TimeSlot {
  /** 1 = lundi … 7 = dimanche. */
  days: number[];
  from: string;
  to: string;
}

/** Montants d'une grille tarifaire (F CFA, sauf surgeMax). */
export interface PricingAmounts {
  baseFare: number;
  perKm: number;
  perMin: number;
  minimumFare: number;
  cancelFee: number;
  noShowFee: number;
  returnFeePerKm: number;
  bookingFee: number;
}

/** Version de grille tarifaire (GET /pricing-rules) : en vigueur, programmée ou remplacée. */
export interface PricingRule extends PricingAmounts {
  id: string;
  zoneId: string | null;
  zoneName: string | null;
  zoneCode: string | null;
  category: string;
  /** Standard (toute la journée), Nuit, Week-end… */
  label: string;
  timeSlots: TimeSlot[];
  /** Multiplicateur de forte demande plafonné, en texte ("1.50"). */
  surgeMax: string;
  validFrom: string;
  validTo: string | null;
  reason: string | null;
  createdAt: string;
  current: boolean;
}

export interface NewPricingRule extends PricingAmounts {
  reason: string;
  /** Absent = grille par défaut (toutes zones). */
  zoneId?: string;
  category: string;
  label: string;
  timeSlots: TimeSlot[];
  surgeMax: number;
  validFrom?: string;
  validTo?: string;
}

export interface TariffRow {
  key: string;
  label: string;
  unit: string;
  values: Record<string, number>;
}

export interface TariffsOverview {
  commission: { defaultRate: number; exceptions: CommissionException[] };
  tariffs: {
    zone: { id: string | null; name: string };
    categories: TariffCategory[];
    rows: TariffRow[];
    formula: string;
  };
  zones: { id: string | null; name: string; kind: string | null }[];
}

export interface TariffHistoryItem {
  id: string;
  date: string;
  by: string;
  change: string;
  reason: string | null;
}

export interface TariffHistoryPage {
  items: TariffHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface NewCommissionRule {
  reason: string;
  scope: string;
  rate: number;
  category?: string;
  zoneId?: string;
  newDriverDays?: number;
  validFrom?: string;
  validTo?: string;
}

export interface UpdateTariffsBody {
  reason: string;
  defaultCommissionRate?: number;
  /** Zone des prix ; absent = tarif par défaut (toutes zones). */
  zoneId?: string;
  /** Valeurs complètes par catégorie (code → clé de ligne → montant). */
  prices?: Record<string, Record<string, number>>;
}

export interface UpdateTariffsResponse extends TariffsOverview {
  changes: string[];
}

@Injectable({ providedIn: 'root' })
export class TariffsService {
  private readonly api = inject(ApiService);

  overview(zoneId?: string | null): Observable<TariffsOverview> {
    return this.api.get<TariffsOverview>(API_ENDPOINTS.tariffs.overview, { zoneId });
  }

  save(body: UpdateTariffsBody): Observable<UpdateTariffsResponse> {
    return this.api.put<UpdateTariffsResponse>(API_ENDPOINTS.tariffs.overview, body);
  }

  createCommissionRule(body: NewCommissionRule): Observable<{ id: string }> {
    return this.api.post<{ id: string }>(API_ENDPOINTS.tariffs.commissionRules, body);
  }

  rules(): Observable<CommissionRule[]> {
    return this.api.get<CommissionRule[]>(API_ENDPOINTS.tariffs.commissionRules);
  }

  /** Corbeille d'une exception : fin de validité immédiate. 409 DEFAULT_RATE_REQUIRED pour le taux par défaut. */
  deleteCommissionRule(id: string, reason: string): Observable<unknown> {
    return this.api.delete(API_ENDPOINTS.tariffs.commissionRule(id), { reason });
  }

  categories(): Observable<VehicleCategory[]> {
    return this.api.get<VehicleCategory[]>(API_ENDPOINTS.tariffs.categories);
  }

  pricingRules(): Observable<PricingRule[]> {
    return this.api.get<PricingRule[]>(API_ENDPOINTS.tariffs.pricingRules);
  }

  /** Nouvelle version de grille : remplace la grille de même zone, catégorie et libellé ; les courses passées gardent la leur. */
  createPricingRule(body: NewPricingRule): Observable<{ id: string }> {
    return this.api.post<{ id: string }>(API_ENDPOINTS.tariffs.pricingRules, body);
  }

  endPricingRule(id: string, reason: string): Observable<{ id: string; ended: boolean }> {
    return this.api.post(API_ENDPOINTS.tariffs.endPricingRule(id), { reason });
  }

  /** Met fin à une règle de commission (ex. fin de promotion) ; les courses passées gardent leur taux. */
  endCommissionRule(id: string, reason: string): Observable<{ id: string; ended: boolean }> {
    return this.api.post(API_ENDPOINTS.tariffs.endCommissionRule(id), { reason });
  }

  setCategoryActive(code: string, active: boolean, reason: string): Observable<{ code: string; active: boolean }> {
    return this.api.patch(API_ENDPOINTS.tariffs.category(code), { reason, active });
  }

  history(page: number, pageSize: number): Observable<TariffHistoryPage> {
    return this.api.get<TariffHistoryPage>(API_ENDPOINTS.tariffs.history, { page, pageSize });
  }
}
