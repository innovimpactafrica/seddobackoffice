import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_ENDPOINTS } from '../../core/api/api-endpoints';
import { ApiService } from '../../core/api/api.service';

export interface DashboardSummary {
  /** Courses en cours par statut (ex. `INCIDENT`). */
  activeRides: Record<string, number>;
  /** Chauffeurs en ligne par catégorie (ex. `ECO`). */
  driversOnline: Record<string, number>;
  today: {
    orders: number;
    completed: number;
    unserved: number;
    gmv: number;
    commission: number;
    paymentFailureRate: number;
    insufficientFunds: number;
  };
  omMerchantBalance: number;
  alerts: {
    openSos: number;
    failedDisbursements: number;
    incidents: number;
    openTickets: number;
    pendingRefundRequests: number;
  };
  currency: string;
}

export interface LedgerBalances {
  currency: string;
  omMerchantCash: number;
  ridePending: number;
  driverPayable: number;
  clientRefundable: number;
  seddoRevenue: number;
  /** Total des dettes de Seddo (chauffeurs, clients). */
  owed: number;
  /** Vrai quand le compte OM ne couvre pas les dettes. */
  lowBalanceAlert: boolean;
}

export interface LiveDriver {
  driverId: string;
  name: string | null;
  plate: string;
  category: string;
  lat: number;
  lng: number;
  heading: number | null;
  state: string;
  /** Secondes écoulées depuis la dernière position reçue. */
  lastSeenS: number;
}

export interface LiveRide {
  id: string;
  ref: string;
  status: string;
  category: string;
  driver_id: string | null;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  ageS: number;
}

export interface LiveMap {
  drivers: LiveDriver[];
  waiting: LiveRide[];
  active: LiveRide[];
}

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly api = inject(ApiService);

  summary(): Observable<DashboardSummary> {
    return this.api.get<DashboardSummary>(API_ENDPOINTS.dashboard.summary);
  }

  balances(): Observable<LedgerBalances> {
    return this.api.get<LedgerBalances>(API_ENDPOINTS.dashboard.balances);
  }

  liveMap(): Observable<LiveMap> {
    return this.api.get<LiveMap>(API_ENDPOINTS.dashboard.liveMap);
  }
}
