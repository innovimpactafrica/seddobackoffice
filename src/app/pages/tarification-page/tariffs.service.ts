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
