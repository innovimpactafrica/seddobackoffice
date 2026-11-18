import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_ENDPOINTS } from './api-endpoints';
import { ApiService } from './api.service';

/**
 * Compteurs « en attente » affichés dans la sidebar (GET /v1/admin/badges).
 * `null` = rubrique hors du rôle connecté (pas de pastille).
 */
export interface AdminBadges {
  /** Courses avec incident */
  rides: number | null;
  /** Dossiers chauffeurs à valider */
  drivers: number | null;
  /** Demandes de remboursement à valider */
  payments: number | null;
  /** Versements en échec + changements de numéro à valider */
  payouts: number | null;
  /** Écarts du relevé */
  reconciliation: number | null;
  /** Réclamations ouvertes */
  tickets: number | null;
  /** Alertes SOS non résolues */
  sos: number | null;
}

export type BadgeKey = keyof AdminBadges;

@Injectable({ providedIn: 'root' })
export class BadgesService {
  private readonly api = inject(ApiService);

  get(): Observable<AdminBadges> {
    return this.api.get<AdminBadges>(API_ENDPOINTS.badges);
  }
}
