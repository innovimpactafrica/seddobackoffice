import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_ENDPOINTS } from '../api/api-endpoints';
import { ApiService } from '../api/api.service';

/** Pourquoi la carte n'a pas pu être chargée. */
export type MapsLoadError = 'NO_KEY' | 'PARAMS_UNREACHABLE' | 'SCRIPT_UNREACHABLE';

const SCRIPT_ID = 'google-maps-sdk';

/**
 * Charge le SDK Google Maps avec la clé « web » configurée dans Paramètres › Clés Google Maps
 * (GET /v1/app/params, public). Aucune clé n'est codée en dur : changer la clé dans le
 * backoffice suffit, elle est prise en compte au prochain chargement de la page.
 * Le SDK n'est injecté qu'une fois ; les appels suivants partagent la même promesse.
 */
@Injectable({ providedIn: 'root' })
export class GoogleMapsLoader {
  private readonly api = inject(ApiService);
  private pending?: Promise<any>;

  load(): Promise<any> {
    const win = window as any;
    if (win.google?.maps) return Promise.resolve(win.google.maps);
    // Un échec n'est pas mémorisé : un nouvel essai relit la clé (elle a pu être ajoutée entre-temps).
    this.pending ??= this.fetchKeyAndInject().catch(err => {
      this.pending = undefined;
      throw err;
    });
    return this.pending;
  }

  private async fetchKeyAndInject(): Promise<any> {
    let key: string | null | undefined;
    try {
      const params = await firstValueFrom(this.api.get<{ maps?: { web?: string | null } }>(API_ENDPOINTS.app.params));
      key = params?.maps?.web?.trim();
    } catch {
      throw 'PARAMS_UNREACHABLE' satisfies MapsLoadError;
    }
    if (!key) throw 'NO_KEY' satisfies MapsLoadError;

    document.getElementById(SCRIPT_ID)?.remove();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=geometry`;
      script.async = true;
      script.onload = () => resolve((window as any).google?.maps);
      script.onerror = () => {
        script.remove();
        reject('SCRIPT_UNREACHABLE' satisfies MapsLoadError);
      };
      document.head.appendChild(script);
    });
  }
}

/** Message à afficher à la place de la carte. */
export function mapsErrorMessage(err: unknown): string {
  switch (err as MapsLoadError) {
    case 'NO_KEY':
      return 'Aucune clé Google Maps web configurée (Paramètres › Clés Google Maps).';
    case 'PARAMS_UNREACHABLE':
      return 'Impossible de lire la clé Google Maps depuis l’API.';
    default:
      return 'Carte Google Maps injoignable.';
  }
}
