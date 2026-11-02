import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { API_ENDPOINTS } from '../../core/api/api-endpoints';
import { ApiService } from '../../core/api/api.service';

export type ZoneType = 'SERVICE' | 'SPECIAL' | 'RESTRICTED';
export type ZoneStatus = 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
export type Scope = 'PICKUP' | 'DROPOFF' | 'BOTH';
export type OutOfZoneDropoff = 'REFUSE' | 'ALLOW';

/** Points GeoJSON : [lng, lat]. */
export type Ring = [number, number][];

export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: Ring[];
}

export interface MultiPolygonGeometry {
  type: 'MultiPolygon';
  coordinates: Ring[][];
}

export type ZoneGeometry = PolygonGeometry | MultiPolygonGeometry;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface OpeningHours {
  /** 1 = lundi … 7 = dimanche. */
  days: number[];
  from: string;
  /** Avant `from` : la plage passe minuit. */
  to: string;
}

/** Paramètres en vigueur ; seuls ceux du type de la zone sont renseignés. */
export interface ZoneSettings {
  // Zone de service
  enabledCategories?: string[];
  surgeMax?: number;
  driverSearchRadiusM?: number;
  openingHours?: OpeningHours[] | null;
  outOfZoneDropoff?: OutOfZoneDropoff;
  outOfZoneMaxKm?: number | null;
  interZoneSurcharge?: Record<string, number> | null;
  // Zone spéciale
  surcharges?: Record<string, number> | null;
  surchargeScope?: Scope | null;
  allowsOrderOutsideService?: boolean;
  pickupPoint?: LatLng | null;
  pickupMessage?: string | null;
  driverQueueEnabled?: boolean;
  queueArea?: unknown;
  // Zone restreinte
  restriction?: Scope | null;
  replacementPoint?: LatLng | null;
  replacementMessage?: string | null;
}

export interface Zone {
  id: string;
  code: string;
  name: string;
  type: ZoneType;
  status: ZoneStatus;
  color: string;
  priority: number;
  startsAt: string | null;
  endsAt: string | null;
  suspendedMessage: string | null;
  suspendedUntil: string | null;
  /** Ligne d'historique en vigueur (paramètres figés sur les courses). */
  historyId: string | null;
  geometry: ZoneGeometry | null;
  areaKm2: number | null;
  settings: ZoneSettings;
  neighborIds: string[];
  updatedAt: string | null;
}

/** Contour simplifié d'une zone active (GET /v1/zones/active, coloration des cartes). */
export interface ActiveZone {
  id: string;
  code: string;
  name: string;
  type: ZoneType;
  color: string;
  geometry: ZoneGeometry;
}

export interface ZoneFilters {
  type?: string;
  status?: string;
  q?: string;
}

/** Contour : un seul des trois champs. */
export interface ContourInput {
  geometry?: ZoneGeometry;
  kml?: string;
  circle?: { center: LatLng; radiusM: number };
}

export interface NewZone extends ContourInput {
  code: string;
  name: string;
  type: ZoneType;
  color?: string;
  priority?: number;
  startsAt?: string;
  endsAt?: string;
  settings?: ZoneSettings;
  reason: string;
}

export interface ZonePatch {
  reason: string;
  code?: string;
  name?: string;
  color?: string;
  priority?: number;
  startsAt?: string | null;
  endsAt?: string | null;
}

export interface ZoneStatusChange {
  reason: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  /** Changement programmé ; absent = immédiat. */
  at?: string;
  /** Suspension : message affiché au client. */
  message?: string;
  /** Suspension : réactivation automatique. */
  until?: string;
}

export interface SimulatePoint extends LatLng {
  address?: string;
}

/** Zone trouvée en un point (référence courte). */
export interface ZoneRef {
  id: string;
  code: string;
  name: string;
  type: ZoneType;
  color: string;
}

/** Résolution d'un point : zone de service, zones spéciales, zone restreinte. */
export interface ZoneResolution {
  servable: boolean;
  reason: 'OUT_OF_ZONE' | 'ZONE_SUSPENDED' | 'ZONE_CLOSED_HOURS' | 'RESTRICTED' | null;
  message: string | null;
  serviceZone: ZoneRef | null;
  specialZones: ZoneRef[];
  restrictedZone: ZoneRef | null;
}

/** Prix détaillé d'une catégorie. */
export interface PriceOption {
  category: string;
  grid: { id: string; label: string; zoneId: string | null } | null;
  baseFare: number;
  distancePart: number;
  durationPart: number;
  coefficient: number;
  bookingFee: number;
  /** Total des suppléments de zones spéciales. */
  zoneFee: number;
  surcharges: { code: string; name: string; amount: number }[];
  interZoneFee: number;
  returnFee: number;
  minimumFare: number;
  price: number;
}

export interface SimulationResult {
  at: string;
  pickupZones: ZoneResolution;
  dropoffZones: ZoneResolution;
  /** Commande possible (le départ décide ; l'arrivée peut être hors zone avec retour à vide). */
  orderable: boolean;
  /** Points après déplacement éventuel vers un point de remplacement. */
  pickup: SimulatePoint;
  dropoff: SimulatePoint;
  adjustments: unknown[];
  pricingZone: ZoneRef | null;
  distanceM: number;
  durationS: number;
  routeSource: string;
  /** Itinéraire encodé (format Google). */
  polyline: string | null;
  /** Tronçons de l'itinéraire, en index de points de la polyline. */
  traffic: { from: number; to: number; speed: 'NORMAL' | 'SLOW' | 'TRAFFIC_JAM' | string }[];
  outOfZoneKm: number;
  options: PriceOption[];
}

/** Version du contour et des paramètres (une par modification). */
export interface ZoneVersion extends ZoneSettings {
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  areaKm2: number;
  by: string | null;
  reason: string | null;
  geometry: ZoneGeometry | null;
}

/** Ligne d'historique affichée : version ou changement de statut. */
export interface ZoneHistoryEntry {
  date: string | null;
  label: string;
  /** Détail des changements d'une version par rapport à la précédente. */
  changes: string[];
  reason: string | null;
  by: string | null;
  current: boolean;
  /** Changement de statut programmé, pas encore appliqué. */
  pending: { to: ZoneStatus; at: string } | null;
}

/** Changement de statut (immédiat ou programmé). */
export interface ZoneStatusEvent {
  id: string;
  from: ZoneStatus | null;
  to: ZoneStatus;
  /** Suspension : message affiché au client. */
  message: string | null;
  /** Suspension : réactivation automatique. */
  until: string | null;
  scheduledAt: string | null;
  appliedAt: string | null;
  cancelledAt: string | null;
  by: string | null;
  reason: string | null;
  createdAt: string;
}

/** Zone renvoyée après un changement de statut ; `scheduledAt` est renseigné si le changement est programmé. */
export type ZoneStatusResult = Zone & { scheduledAt: string | null };

type Raw = Record<string, any>;

@Injectable({ providedIn: 'root' })
export class ZonesService {
  private readonly api = inject(ApiService);

  /** Zones avec contour, surface et paramètres en vigueur ; les archivées seulement avec `status=ARCHIVED`. */
  list(filters: ZoneFilters = {}): Observable<Zone[]> {
    return this.api.get<Zone[]>(API_ENDPOINTS.zones.list, { ...filters }).pipe(map(zones => zones.map(toZone)));
  }

  /** Contours simplifiés des zones actives, pour colorer une carte. */
  active(): Observable<ActiveZone[]> {
    return this.api.get<{ zones: ActiveZone[] }>(API_ENDPOINTS.zones.active).pipe(map(res => res.zones));
  }

  detail(id: string): Observable<Zone> {
    return this.api.get<Zone>(API_ENDPOINTS.zones.detail(id)).pipe(map(toZone));
  }

  create(body: NewZone): Observable<Zone> {
    return this.api.post<Zone>(API_ENDPOINTS.zones.create, body).pipe(map(toZone));
  }

  patch(id: string, body: ZonePatch): Observable<Zone> {
    return this.api.patch<Zone>(API_ENDPOINTS.zones.detail(id), body).pipe(map(toZone));
  }

  /** Nouveau contour ; la zone renvoyée porte la nouvelle surface et la nouvelle ligne d'historique. */
  setGeometry(id: string, contour: ContourInput, reason: string): Observable<Zone> {
    return this.api.put<Zone>(API_ENDPOINTS.zones.geometry(id), { ...contour, reason }).pipe(map(toZone));
  }

  setSettings(id: string, settings: ZoneSettings, reason: string): Observable<unknown> {
    return this.api.put(API_ENDPOINTS.zones.settings(id), { ...settings, reason });
  }

  /** Remplace la liste des zones voisines (relation dans un seul sens) ; renvoie la zone à jour. */
  setNeighbors(id: string, neighborIds: string[], reason: string): Observable<Zone> {
    return this.api.put<Zone>(API_ENDPOINTS.zones.neighbors(id), { neighborIds, reason }).pipe(map(toZone));
  }

  /** Changement immédiat, ou programmé si `at` est futur (la zone garde alors son statut et `scheduledAt` est renseigné). */
  setStatus(id: string, body: ZoneStatusChange): Observable<ZoneStatusResult> {
    return this.api
      .post<ZoneStatusResult>(API_ENDPOINTS.zones.status(id), body)
      .pipe(map(res => ({ ...toZone(res), scheduledAt: res.scheduledAt ?? null })));
  }

  /** Zones trouvées et prix détaillé par catégorie, sans créer de course. */
  simulate(pickup: SimulatePoint, dropoff: SimulatePoint, at?: string): Observable<SimulationResult> {
    return this.api.post<SimulationResult>(API_ENDPOINTS.zones.simulate, { pickup, dropoff, ...(at ? { at } : {}) });
  }

  history(id: string): Observable<ZoneHistoryEntry[]> {
    return this.api
      .get<{ versions: ZoneVersion[]; statuses: ZoneStatusEvent[] }>(API_ENDPOINTS.zones.history(id))
      .pipe(map(res => toHistory(res.versions ?? [], res.statuses ?? [])));
  }
}

/**
 * Zone de l'API, complétée pour l'écran : `settings` et `neighborIds` toujours présents,
 * points de rendez-vous / remplacement ramenés à { lat, lng }.
 */
function toZone(zone: Zone): Zone {
  const settings = zone.settings ?? {};
  return {
    ...zone,
    settings: {
      ...settings,
      pickupPoint: toLatLng(settings.pickupPoint),
      replacementPoint: toLatLng(settings.replacementPoint)
    },
    neighborIds: zone.neighborIds ?? []
  };
}

/** Accepte { lat, lng } ou un point GeoJSON (format de stockage PostGIS). */
function toLatLng(value: unknown): LatLng | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Raw;
  if (typeof v['lat'] === 'number' && typeof v['lng'] === 'number') return { lat: v['lat'], lng: v['lng'] };
  if (v['type'] === 'Point' && Array.isArray(v['coordinates'])) return { lng: v['coordinates'][0], lat: v['coordinates'][1] };
  return null;
}


const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Brouillon',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspendue',
  ARCHIVED: 'Archivée'
};

/** Libellés des paramètres comparés d'une version à l'autre. */
const VERSION_FIELDS: [keyof ZoneVersion, string][] = [
  ['enabledCategories', 'catégories'],
  ['surgeMax', 'coefficient max.'],
  ['driverSearchRadiusM', 'rayon de recherche'],
  ['openingHours', 'horaires'],
  ['outOfZoneDropoff', 'arrivée hors zone'],
  ['outOfZoneMaxKm', 'distance max. hors zone'],
  ['interZoneSurcharge', 'supplément inter-zones'],
  ['surcharges', 'supplément'],
  ['surchargeScope', 'sens du supplément'],
  ['allowsOrderOutsideService', 'commande hors zone de service'],
  ['pickupPoint', 'point de rendez-vous'],
  ['pickupMessage', 'message de rendez-vous'],
  ['driverQueueEnabled', "file d'attente"],
  ['queueArea', "aire d'attente"],
  ['restriction', 'interdiction'],
  ['replacementPoint', 'point de remplacement'],
  ['replacementMessage', 'message de remplacement']
];

/**
 * Historique du plus récent au plus ancien : chaque version est comparée à la précédente
 * pour dire ce qui a changé (contour, paramètres) ; les statuts sont ajoutés tels quels.
 */
function toHistory(versions: ZoneVersion[], statuses: ZoneStatusEvent[]): ZoneHistoryEntry[] {
  const sorted = [...versions].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  const entries = sorted.map<ZoneHistoryEntry>((v, i) => {
    const previous = sorted[i - 1];
    const changes: string[] = [];
    if (previous) {
      if (!same(v.geometry, previous.geometry)) changes.push('contour');
      for (const [key, label] of VERSION_FIELDS) if (!same(v[key], previous[key])) changes.push(label);
    }
    const label = !previous
      ? 'Création'
      : changes.includes('contour') && changes.length === 1
        ? 'Contour modifié'
        : changes.includes('contour')
          ? 'Contour et paramètres modifiés'
          : changes.length
            ? 'Paramètres modifiés'
            : 'Nouvelle version';
    return {
      date: v.effectiveFrom,
      label,
      changes: changes.filter(c => c !== 'contour'),
      reason: v.reason,
      by: v.by,
      current: !v.effectiveTo,
      pending: null
    };
  });

  for (const s of statuses) {
    const pending = !!s.scheduledAt && !s.appliedAt && !s.cancelledAt;
    const state = s.cancelledAt ? ' (annulé)' : pending ? ' (programmé)' : '';
    const changes: string[] = [];
    if (s.to === 'SUSPENDED' && s.message) changes.push(`message : « ${s.message} »`);
    if (s.to === 'SUSPENDED' && s.until) changes.push(`réactivation automatique le ${formatDate(s.until)}`);
    if (s.scheduledAt && s.appliedAt) changes.push(`programmé pour le ${formatDate(s.scheduledAt)}`);
    entries.push({
      date: s.appliedAt ?? s.scheduledAt ?? s.createdAt,
      label: `Statut : ${s.from ? `${STATUS_LABELS[s.from] ?? s.from} → ` : ''}${STATUS_LABELS[s.to] ?? s.to}${state}`,
      changes,
      reason: s.reason,
      by: s.by,
      current: false,
      pending: pending ? { to: s.to, at: s.scheduledAt! } : null
    });
  }
  return entries.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

/** Date courte pour les libellés d'historique (heure locale). */
function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Polygones Google Maps (anneaux de { lat, lng }) d'un contour GeoJSON. */
export function toPaths(geometry: ZoneGeometry): LatLng[][][] {
  const polygons: Ring[][] = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  return polygons.map(rings =>
    rings.map(ring => {
      const points = ring.map(([lng, lat]) => ({ lat, lng }));
      const last = points[points.length - 1];
      // Google Maps ferme le polygone : on retire le point de fermeture GeoJSON.
      return points.length > 1 && last.lat === points[0].lat && last.lng === points[0].lng ? points.slice(0, -1) : points;
    })
  );
}
