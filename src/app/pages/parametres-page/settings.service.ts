import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_ENDPOINTS } from '../../core/api/api-endpoints';
import { ApiService } from '../../core/api/api.service';

export type MapsPlatform = 'android' | 'ios' | 'web';

/** Clés Google Maps des apps ; null = non configurée. */
export interface AppParams {
  maps: Record<MapsPlatform, string | null>;
}

/** Valeur JSON d'un paramètre : nombre, booléen, texte, liste de nombres ou montant par catégorie. */
export type SettingValue = number | boolean | string | number[] | Record<string, number>;

/** Paramètre global (GET /settings). */
export interface Setting {
  key: string;
  value: SettingValue;
  group: string;
  label: string;
  description: string;
  unit: string | null;
  updatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly api = inject(ApiService);

  list(): Observable<Setting[]> {
    return this.api.get<Setting[]>(API_ENDPOINTS.settings.list);
  }

  /** Même type de valeur que l'actuelle ; motif obligatoire (journal d'audit). */
  update(key: string, value: SettingValue, reason: string): Observable<{ key: string; value: SettingValue }> {
    return this.api.put(API_ENDPOINTS.settings.update(key), { value, reason });
  }

  appParams(): Observable<AppParams> {
    return this.api.get<AppParams>(API_ENDPOINTS.settings.appParams);
  }

  /**
   * Seules les plateformes envoyées changent ; "" retire la clé. Pris en compte par les apps
   * à leur prochain démarrage (cache 5 min), sans redéploiement.
   */
  updateAppParams(keys: Partial<Record<MapsPlatform, string>>, reason: string): Observable<AppParams> {
    return this.api.put<AppParams>(API_ENDPOINTS.settings.appParams, { ...keys, reason });
  }
}
