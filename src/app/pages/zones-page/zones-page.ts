import { AfterViewInit, Component, computed, ElementRef, inject, OnDestroy, PLATFORM_ID, signal, ViewChild } from '@angular/core';
import { DatePipe, DecimalPipe, NgTemplateOutlet, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { GoogleMapsLoader, mapsErrorMessage } from '../../core/maps/google-maps-loader';
import { AuthService } from '../../auth/auth.service';
import {
  ContourInput,
  LatLng,
  OpeningHours,
  Ring,
  Scope,
  Zone,
  ZoneGeometry,
  ZoneHistoryEntry,
  ZoneSettings,
  ZonesService,
  PriceOption,
  SimulationResult,
  ZoneResolution,
  toPaths,
  ZoneStatus,
  ZoneStatusChange,
  ZoneType
} from './zones.service';

type MapMode = 'view' | 'draw' | 'simulate';
type DrawMethod = 'polygon' | 'circle' | 'import';
type StatusFilter = '' | ZoneStatus;

type Dialog =
  | { kind: 'create' }
  | { kind: 'identity'; zone: Zone }
  | { kind: 'settings'; zone: Zone }
  | { kind: 'neighbors'; zone: Zone }
  | { kind: 'status'; zone: Zone; status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED' };

interface SettingsForm {
  categories: string[];
  surgeMax: string;
  radiusM: string;
  permanent: boolean;
  slots: OpeningHours[];
  outOfZone: 'REFUSE' | 'ALLOW';
  outMaxKm: string;
  interZone: Record<string, string>;
  surcharges: Record<string, string>;
  surchargeScope: Scope;
  allowsOutside: boolean;
  pickupLat: string;
  pickupLng: string;
  pickupMessage: string;
  queue: boolean;
  restriction: Scope;
  replLat: string;
  replLng: string;
  replMessage: string;
}

const TYPE_LABELS: Record<ZoneType, string> = {
  SERVICE: 'Service',
  SPECIAL: 'Spéciale',
  RESTRICTED: 'Restreinte'
};

const TYPE_HINTS: Record<ZoneType, string> = {
  SERVICE: 'Délimite où l’on peut commander : grille, commission, horaires, catégories, dispatch.',
  SPECIAL: 'Ajoute un supplément, un point de rendez-vous ou une file d’attente (aéroport, gare, événement).',
  RESTRICTED: 'Interdit la prise en charge et/ou la dépose, et propose un point de remplacement (port, emprise militaire).'
};

const STATUS_LABELS: Record<ZoneStatus, string> = {
  DRAFT: 'Brouillon',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspendue',
  ARCHIVED: 'Archivée'
};

const STATUS_PILLS: Record<ZoneStatus, string> = {
  DRAFT: 'pill-gray',
  ACTIVE: 'pill-green',
  SUSPENDED: 'pill-yellow',
  ARCHIVED: 'pill-dark'
};

const SCOPE_LABELS: Record<Scope, string> = {
  PICKUP: 'Au départ',
  DROPOFF: 'À l’arrivée',
  BOTH: 'Départ et arrivée'
};

const RESTRICTION_LABELS: Record<Scope, string> = {
  PICKUP: 'Prise en charge interdite',
  DROPOFF: 'Dépose interdite',
  BOTH: 'Prise en charge et dépose interdites'
};

const CATEGORIES = [
  { code: 'ECO', label: 'Eco' },
  { code: 'CONFORT', label: 'Confort' }
];

const DAYS = [
  { n: 1, label: 'L' },
  { n: 2, label: 'M' },
  { n: 3, label: 'M' },
  { n: 4, label: 'J' },
  { n: 5, label: 'V' },
  { n: 6, label: 'S' },
  { n: 7, label: 'D' }
];

const DAY_NAMES = ['', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

const ERROR_CODES: Record<string, string> = {
  ZONE_CODE_TAKEN: 'Ce code est déjà utilisé par une autre zone.',
  ZONE_OVERLAP: 'Le contour chevauche une autre zone de service.',
  INVALID_GEOMETRY: 'Contour invalide : au moins 3 points, sans lignes qui se croisent.',
  INVALID_ZONE_SETTINGS: 'Paramètres invalides pour ce type de zone.'
};

const DAKAR: LatLng = { lat: 14.7167, lng: -17.4677 };

/** Couleur d'un tronçon d'itinéraire selon le trafic. */
const TRAFFIC_COLORS: Record<string, string> = {
  NORMAL: '#2f6fd6',
  SLOW: '#e8a317',
  TRAFFIC_JAM: '#b3261e'
};

@Component({
  selector: 'app-zones-page',
  imports: [DatePipe, DecimalPipe, NgTemplateOutlet, RouterLink],
  templateUrl: './zones-page.html',
  styleUrl: './zones-page.css'
})
export class ZonesPage implements AfterViewInit, OnDestroy {
  private readonly service = inject(ZonesService);
  private readonly auth = inject(AuthService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly mapsLoader = inject(GoogleMapsLoader);

  @ViewChild('mapEl', { static: true }) private mapEl?: ElementRef<HTMLDivElement>;

  protected readonly typeLabels = TYPE_LABELS;
  protected readonly typeHints = TYPE_HINTS;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly scopeLabels = SCOPE_LABELS;
  protected readonly restrictionLabels = RESTRICTION_LABELS;
  protected readonly categories = CATEGORIES;
  protected readonly days = DAYS;
  protected readonly types: ZoneType[] = ['SERVICE', 'SPECIAL', 'RESTRICTED'];
  protected readonly scopes: Scope[] = ['PICKUP', 'DROPOFF', 'BOTH'];

  // ─── Données ────────────────────────────────────────────────────────────────
  protected readonly zones = signal<Zone[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly notice = signal('');

  protected readonly search = signal('');
  protected readonly typeFilter = signal('');
  protected readonly statusFilter = signal<StatusFilter>('');

  protected readonly selectedId = signal<string | null>(null);
  protected readonly history = signal<ZoneHistoryEntry[]>([]);
  /** Changements de statut programmés et pas encore appliqués, du plus proche au plus lointain. */
  protected readonly pendingChanges = computed(() =>
    this.history()
      .flatMap(h => (h.pending ? [{ ...h.pending, reason: h.reason }] : []))
      .sort((a, b) => a.at.localeCompare(b.at))
  );
  protected readonly historyLoading = signal(false);
  protected readonly historyError = signal('');

  protected readonly selected = computed(() => this.zones().find(z => z.id === this.selectedId()) ?? null);

  protected readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const type = this.typeFilter();
    const status = this.statusFilter();
    return this.zones().filter(
      z =>
        (!type || z.type === type) &&
        (!status || z.status === status) &&
        (!q || z.code.toLowerCase().includes(q) || z.name.toLowerCase().includes(q))
    );
  });

  /** Compteurs des onglets de statut (les archivées sont chargées à part). */
  protected readonly counts = computed(() => {
    const result: Record<string, number> = { '': 0, DRAFT: 0, ACTIVE: 0, SUSPENDED: 0 };
    for (const z of this.zones()) {
      if (z.status === 'ARCHIVED') continue;
      result[''] += 1;
      result[z.status] += 1;
    }
    return result;
  });

  protected readonly statusTabs: { code: StatusFilter; label: string }[] = [
    { code: '', label: 'Toutes' },
    { code: 'ACTIVE', label: 'Actives' },
    { code: 'DRAFT', label: 'Brouillons' },
    { code: 'SUSPENDED', label: 'Suspendues' },
    { code: 'ARCHIVED', label: 'Archivées' }
  ];

  /** Zones dont les chauffeurs peuvent être sollicités : service puis spéciales (une zone restreinte n'a pas de chauffeurs). */
  protected readonly neighborCandidates = computed(() =>
    this.zones()
      .filter(z => z.type !== 'RESTRICTED' && z.status !== 'ARCHIVED')
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'SERVICE' ? -1 : 1))
  );

  // ─── Droits (spécification : Admin gère tout, Opérations suspend et crée les zones temporaires) ──
  private readonly role = computed(() => this.auth.currentUser()?.roleCode ?? '');
  protected readonly canManage = computed(() => this.role() === 'ADMIN');
  protected readonly canSuspend = computed(() => ['ADMIN', 'OPS'].includes(this.role()));
  protected readonly canTemporary = computed(() => ['ADMIN', 'OPS'].includes(this.role()));
  protected readonly canCreate = computed(() => this.canManage() || this.canTemporary());

  protected isTemporary(z: Zone): boolean {
    return !!(z.startsAt || z.endsAt);
  }

  /** Contour, paramètres et statut : Admin, ou Opérations pour une zone temporaire. */
  protected canEdit(z: Zone): boolean {
    return z.status !== 'ARCHIVED' && (this.canManage() || (this.canTemporary() && this.isTemporary(z)));
  }

  // ─── Carte ──────────────────────────────────────────────────────────────────
  protected readonly mapMode = signal<MapMode>('view');
  protected readonly mapReady = signal(false);
  protected readonly mapError = signal('');

  private gmap?: any;
  private polygons: any[] = [];
  private pointMarkers: any[] = [];
  private drawPolygon?: any;
  private drawCircle?: any;
  private importLayers: any[] = [];
  private simMarkers: any[] = [];
  private routeLines: any[] = [];
  private mapClickListener?: any;
  private fitted = false;

  // ─── Contour ────────────────────────────────────────────────────────────────
  protected readonly drawZone = signal<Zone | null>(null);
  protected readonly drawMethod = signal<DrawMethod>('polygon');
  protected readonly drawPoints = signal(0);
  protected readonly circleLat = signal('');
  protected readonly circleLng = signal('');
  protected readonly circleRadius = signal('1500');
  protected readonly importName = signal('');
  protected readonly importText = signal('');
  protected readonly importIsKml = signal(false);
  protected readonly drawReason = signal('');
  protected readonly drawError = signal('');

  // ─── Simulation ─────────────────────────────────────────────────────────────
  protected readonly simPickup = signal<LatLng | null>(null);
  protected readonly simDropoff = signal<LatLng | null>(null);
  protected readonly simAt = signal('');
  protected readonly simResult = signal<SimulationResult | null>(null);
  protected readonly simError = signal('');
  protected readonly simBusy = signal(false);

  // ─── Fenêtres ───────────────────────────────────────────────────────────────
  protected readonly dialog = signal<Dialog | null>(null);
  protected readonly reason = signal('');
  protected readonly dialogError = signal('');
  protected readonly busy = signal(false);

  // Création et identité
  protected readonly fCode = signal('');
  protected readonly fName = signal('');
  protected readonly fType = signal<ZoneType>('SERVICE');
  protected readonly fColor = signal('#FF5F00');
  protected readonly fPriority = signal('0');
  protected readonly fTemporary = signal(false);
  protected readonly fStartsAt = signal('');
  protected readonly fEndsAt = signal('');

  // Statut
  protected readonly fAt = signal('');
  protected readonly fMessage = signal('');
  protected readonly fUntil = signal('');

  // Voisines
  protected readonly fNeighbors = signal<string[]>([]);

  // Paramètres
  protected readonly form = signal<SettingsForm>(this.emptyForm());

  ngAfterViewInit(): void {
    this.load();
    if (isPlatformBrowser(this.platformId)) this.initMap();
  }

  ngOnDestroy(): void {
    this.mapClickListener?.remove();
  }

  // ─── Chargement ─────────────────────────────────────────────────────────────

  protected load(): void {
    this.loading.set(true);
    this.error.set('');
    const status = this.statusFilter() === 'ARCHIVED' ? 'ARCHIVED' : undefined;
    this.service.list({ status }).subscribe({
      next: zones => {
        this.zones.set(zones);
        this.loading.set(false);
        if (this.selectedId() && !zones.some(z => z.id === this.selectedId())) this.selectedId.set(null);
        this.renderZones();
        if (!this.fitted) this.fitTo(zones);
      },
      error: err => {
        this.error.set(this.message(err, 'Impossible de charger les zones.'));
        this.loading.set(false);
      }
    });
  }

  protected setStatusFilter(code: StatusFilter): void {
    const reload = (code === 'ARCHIVED') !== (this.statusFilter() === 'ARCHIVED');
    this.statusFilter.set(code);
    if (reload) {
      this.selectedId.set(null);
      this.load();
    } else {
      this.renderZones();
    }
  }

  protected setTypeFilter(value: string): void {
    this.typeFilter.set(value);
    this.renderZones();
  }

  protected setSearch(value: string): void {
    this.search.set(value);
    this.renderZones();
  }

  protected select(zone: Zone | null): void {
    if (this.mapMode() !== 'view') return;
    this.selectedId.set(zone?.id ?? null);
    this.history.set([]);
    this.historyError.set('');
    this.renderZones();
    if (zone) {
      this.fitTo([zone]);
      this.loadHistory(zone.id);
    }
  }

  private loadHistory(id: string): void {
    this.historyLoading.set(true);
    this.service.history(id).subscribe({
      next: entries => {
        this.history.set(entries);
        this.historyLoading.set(false);
      },
      error: err => {
        this.historyError.set(this.message(err, "Impossible de charger l'historique."));
        this.historyLoading.set(false);
      }
    });
  }

  /** Recharge la liste et l'historique après une action, en gardant la zone sélectionnée. */
  private refresh(done: string): void {
    this.notice.set(done);
    this.load();
    const id = this.selectedId();
    if (id) this.loadHistory(id);
  }

  // ─── Affichage ──────────────────────────────────────────────────────────────

  protected statusPill(status: ZoneStatus): string {
    return STATUS_PILLS[status] ?? 'pill-gray';
  }

  protected categoryLabel(code: string): string {
    return CATEGORIES.find(c => c.code === code)?.label ?? code;
  }

  protected categoriesText(codes: string[] | undefined): string {
    return codes?.length ? codes.map(c => this.categoryLabel(c)).join(', ') : '—';
  }

  protected amounts(values: Record<string, number> | null | undefined): string {
    const entries = Object.entries(values ?? {}).filter(([, v]) => v !== null && v !== undefined);
    if (!entries.length) return '—';
    return entries.map(([k, v]) => `${this.categoryLabel(k)} ${Number(v).toLocaleString('fr-FR')} F`).join(' · ');
  }

  protected hours(slots: OpeningHours[] | null | undefined): string {
    if (!slots?.length) return 'Ouverte en permanence';
    return slots
      .map(s => {
        const d = [...s.days].map(Number).sort((a, b) => a - b);
        const consecutive = d.length > 2 && d.every((n, i) => i === 0 || n === d[i - 1] + 1);
        const days = d.length === 7 ? 'tous les jours' : consecutive ? `${DAY_NAMES[d[0]]} → ${DAY_NAMES[d[d.length - 1]]}` : d.map(n => DAY_NAMES[n]).join(' ');
        return `${days} ${s.from}–${s.to}`;
      })
      .join(' · ');
  }

  protected point(p: LatLng | null | undefined): string {
    return p ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : '—';
  }

  /** Voisines de la zone (une voisine archivée ou inconnue de la liste reste affichée par son identifiant). */
  protected neighborsOf(z: Zone): { id: string; name: string; color: string; inactive: boolean }[] {
    return z.neighborIds.map(id => {
      const n = this.zones().find(zone => zone.id === id);
      return n
        ? { id, name: n.name, color: n.color, inactive: n.status !== 'ACTIVE' }
        : { id, name: `Zone ${id.slice(0, 8)}…`, color: '#b9b2aa', inactive: true };
    });
  }

  /** Zones qui sollicitent les chauffeurs de celle-ci (sens inverse de la relation). */
  protected solicitedBy(z: Zone): Zone[] {
    return this.zones().filter(other => other.id !== z.id && other.neighborIds.includes(z.id));
  }

  // ─── Carte Google Maps ──────────────────────────────────────────────────────

  private initMap(): void {
    const win = window as any;
    const previous = win.gm_authFailure;
    win.gm_authFailure = () => {
      previous?.();
      this.mapReady.set(false);
      this.mapError.set('Carte Google Maps indisponible (clé refusée). Le cercle et l’import de fichier restent utilisables.');
    };
    // Clé lue dans Paramètres › Clés Google Maps (aucune clé en dur).
    this.mapsLoader.load().then(
      () => this.renderMap(),
      err => this.mapError.set(`${mapsErrorMessage(err)} Le cercle et l’import de fichier restent utilisables.`)
    );
  }

  private renderMap(): void {
    const win = window as any;
    const container = this.mapEl?.nativeElement;
    if (!container || !win.google?.maps) return;
    try {
      this.gmap = new win.google.maps.Map(container, {
        center: DAKAR,
        zoom: 11,
        disableDefaultUI: true,
        zoomControl: true,
        clickableIcons: false,
        styles: [
          { featureType: 'poi', stylers: [{ visibility: 'off' }] },
          { featureType: 'transit', stylers: [{ visibility: 'off' }] },
          { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c9e2f4' }] },
          { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f7f4ee' }] },
          { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
          { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#fed7bc' }] }
        ]
      });
      this.mapClickListener = this.gmap.addListener('click', (e: any) => this.onMapClick({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
      this.mapReady.set(true);
      this.renderZones();
      if (this.zones().length) this.fitTo(this.zones());
    } catch {
      this.mapError.set('La carte n’a pas pu être affichée.');
    }
  }

  /** Dessine les zones filtrées ; la zone sélectionnée est mise en avant. */
  private renderZones(): void {
    const g = (window as any).google?.maps;
    if (!this.gmap || !g) return;
    this.polygons.forEach(p => p.setMap(null));
    this.pointMarkers.forEach(m => m.setMap(null));
    this.polygons = [];
    this.pointMarkers = [];

    const selectedId = this.selectedId();
    const interactive = this.mapMode() === 'view';
    const editingId = this.mapMode() === 'draw' ? this.drawZone()?.id : null;

    for (const zone of this.filtered()) {
      if (!zone.geometry || zone.id === editingId) continue;
      const isSelected = zone.id === selectedId;
      const muted = zone.status === 'DRAFT' || zone.status === 'ARCHIVED';
      const color = zone.status === 'SUSPENDED' ? '#8c8379' : zone.color;
      const typeOrder = zone.type === 'RESTRICTED' ? 3 : zone.type === 'SPECIAL' ? 2 : 1;
      for (const paths of toPaths(zone.geometry)) {
        const polygon = new g.Polygon({
          map: this.gmap,
          paths,
          strokeColor: color,
          strokeOpacity: muted ? 0.55 : 0.95,
          strokeWeight: isSelected ? 3 : 1.6,
          fillColor: color,
          fillOpacity: isSelected ? 0.32 : muted ? 0.06 : zone.type === 'RESTRICTED' ? 0.28 : 0.16,
          clickable: interactive,
          zIndex: typeOrder + (isSelected ? 10 : 0)
        });
        polygon.addListener('click', () => this.select(zone));
        this.polygons.push(polygon);
      }
    }

    const sel = this.selected();
    if (sel && this.mapMode() === 'view') {
      const points: [LatLng | null | undefined, string][] = [
        [sel.settings.pickupPoint, sel.settings.pickupMessage || 'Point de rendez-vous'],
        [sel.settings.replacementPoint, sel.settings.replacementMessage || 'Point de remplacement']
      ];
      for (const [position, title] of points) {
        if (position) this.pointMarkers.push(new g.Marker({ map: this.gmap, position, title, label: { text: 'P', color: '#fff', fontWeight: '700' } }));
      }
    }
  }

  private fitTo(zones: Zone[]): void {
    const g = (window as any).google?.maps;
    if (!this.gmap || !g) return;
    const bounds = new g.LatLngBounds();
    let any = false;
    for (const z of zones) {
      if (!z.geometry) continue;
      for (const paths of toPaths(z.geometry)) for (const ring of paths) for (const p of ring) {
        bounds.extend(p);
        any = true;
      }
    }
    if (!any) return;
    this.gmap.fitBounds(bounds, 40);
    this.fitted = true;
  }

  private onMapClick(p: LatLng): void {
    const mode = this.mapMode();
    if (mode === 'draw') {
      const method = this.drawMethod();
      // Le chemin d'un polygone n'accepte que des LatLng : un { lat, lng } brut n'est pas redessiné.
      if (method === 'polygon') this.drawPolygon?.getPath().push(new (window as any).google.maps.LatLng(p.lat, p.lng));
      if (method === 'circle') {
        this.circleLat.set(p.lat.toFixed(6));
        this.circleLng.set(p.lng.toFixed(6));
        this.renderCircle();
      }
    } else if (mode === 'simulate') {
      if (!this.simPickup() || this.simDropoff()) {
        this.simPickup.set(p);
        this.simDropoff.set(null);
      } else {
        this.simDropoff.set(p);
      }
      this.simResult.set(null);
      this.renderSimMarkers();
    } else {
      this.select(null);
    }
  }

  // ─── Contour ────────────────────────────────────────────────────────────────

  protected startDraw(zone: Zone): void {
    this.closeSimulate();
    this.selectedId.set(zone.id);
    this.drawZone.set(zone);
    this.drawError.set('');
    this.drawReason.set('');
    this.importName.set('');
    this.importText.set('');
    this.circleLat.set('');
    this.circleLng.set('');
    this.mapMode.set('draw');
    this.setDrawMethod(this.mapReady() ? 'polygon' : 'circle');
    this.renderZones();
  }

  protected setDrawMethod(method: DrawMethod): void {
    this.drawMethod.set(method);
    this.drawError.set('');
    this.clearDrawLayers();
    const g = (window as any).google?.maps;
    if (method === 'polygon' && this.gmap && g) {
      // Contour existant repris comme point de départ (premier polygone).
      const existing = this.drawZone()?.geometry ? toPaths(this.drawZone()!.geometry!)[0]?.[0] ?? [] : [];
      this.drawPolygon = new g.Polygon({
        map: this.gmap,
        // Toujours un tableau de chemins : `[]` seul donnerait zéro chemin, et getPath() renverrait undefined
        // (cas d'une zone sans contour, juste après sa création).
        paths: [existing],
        editable: true,
        draggable: false,
        strokeColor: '#ff5a00',
        strokeWeight: 2,
        fillColor: '#ff5a00',
        fillOpacity: 0.18,
        zIndex: 50
      });
      const path = this.drawPolygon.getPath();
      const sync = () => this.drawPoints.set(path.getLength());
      ['insert_at', 'remove_at', 'set_at'].forEach(evt => path.addListener(evt, sync));
      // Clic droit sur un sommet : le supprime.
      this.drawPolygon.addListener('rightclick', (e: any) => {
        if (e.vertex !== undefined && e.vertex !== null) path.removeAt(e.vertex);
      });
      sync();
    }
    if (method === 'circle') this.renderCircle();
  }

  protected undoPoint(): void {
    const path = this.drawPolygon?.getPath();
    if (path?.getLength()) path.pop();
  }

  protected clearPoints(): void {
    this.drawPolygon?.getPath().clear();
  }

  protected renderCircle(): void {
    const g = (window as any).google?.maps;
    const center = this.circleCenter();
    const radius = Number(this.circleRadius());
    if (!this.gmap || !g) return;
    if (!center || !(radius > 0)) {
      this.drawCircle?.setMap(null);
      this.drawCircle = undefined;
      return;
    }
    if (!this.drawCircle) {
      this.drawCircle = new g.Circle({
        map: this.gmap,
        strokeColor: '#ff5a00',
        strokeWeight: 2,
        fillColor: '#ff5a00',
        fillOpacity: 0.18,
        clickable: false,
        zIndex: 50
      });
    }
    this.drawCircle.setCenter(center);
    this.drawCircle.setRadius(radius);
  }

  private circleCenter(): LatLng | null {
    const lat = Number(this.circleLat());
    const lng = Number(this.circleLng());
    if (this.circleLat().trim() === '' || this.circleLng().trim() === '' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }

  protected async onImportFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.drawError.set('');
    const text = await file.text();
    const isKml = /\.kml$/i.test(file.name) || text.trimStart().startsWith('<');
    this.importName.set(file.name);
    this.importText.set(text);
    this.importIsKml.set(isKml);
    this.clearDrawLayers();
    if (!isKml) {
      const geometry = parseGeoJson(text);
      if (!geometry) return this.drawError.set('Fichier GeoJSON illisible : un Polygon ou MultiPolygon est attendu.');
      const g = (window as any).google?.maps;
      if (this.gmap && g) {
        for (const paths of toPaths(geometry)) {
          this.importLayers.push(new g.Polygon({ map: this.gmap, paths, strokeColor: '#ff5a00', strokeWeight: 2, fillColor: '#ff5a00', fillOpacity: 0.18, clickable: false, zIndex: 50 }));
        }
        this.fitTo([{ geometry } as Zone]);
      }
    }
  }

  private buildContour(): ContourInput | string {
    switch (this.drawMethod()) {
      case 'polygon': {
        const path = this.drawPolygon?.getPath();
        const points: LatLng[] = path ? path.getArray().map((ll: any) => ({ lat: ll.lat(), lng: ll.lng() })) : [];
        if (points.length < 3) return 'Placez au moins 3 points sur la carte.';
        const ring: Ring = points.map(p => [round(p.lng), round(p.lat)]);
        ring.push(ring[0]);
        return { geometry: { type: 'Polygon', coordinates: [ring] } };
      }
      case 'circle': {
        const center = this.circleCenter();
        const radiusM = Number(this.circleRadius());
        if (!center) return 'Indiquez le centre du cercle (clic sur la carte ou coordonnées).';
        if (!(radiusM > 0)) return 'Indiquez un rayon en mètres.';
        return { circle: { center, radiusM } };
      }
      default: {
        if (!this.importText()) return 'Choisissez un fichier GeoJSON ou KML.';
        if (this.importIsKml()) return { kml: this.importText() };
        const geometry = parseGeoJson(this.importText());
        return geometry ? { geometry } : 'Fichier GeoJSON illisible : un Polygon ou MultiPolygon est attendu.';
      }
    }
  }

  protected saveDraw(): void {
    const zone = this.drawZone();
    if (!zone) return;
    const reason = this.drawReason().trim();
    if (!reason) return this.drawError.set('Le motif est obligatoire.');
    const contour = this.buildContour();
    if (typeof contour === 'string') return this.drawError.set(contour);
    this.drawError.set('');
    this.busy.set(true);
    this.service.setGeometry(zone.id, contour, reason).subscribe({
      next: () => {
        this.busy.set(false);
        this.cancelDraw();
        this.refresh('Contour enregistré.');
      },
      error: err => {
        this.busy.set(false);
        const body = err instanceof HttpErrorResponse ? (err.error as { code?: string; message?: unknown } | null) : null;
        // Le nouveau contour crée une ligne d'historique : l'API y revérifie les paramètres du type.
        this.drawError.set(
          body?.code === 'INVALID_ZONE_SETTINGS' || body?.message === 'INVALID_ZONE_SETTINGS'
            ? "Les paramètres de cette zone sont incomplets pour son type. Renseignez-les (bouton « Paramètres »), puis enregistrez de nouveau le contour."
            : this.message(err, "Le contour n'a pas pu être enregistré.")
        );
      }
    });
  }

  protected cancelDraw(): void {
    this.clearDrawLayers();
    this.drawZone.set(null);
    this.mapMode.set('view');
    this.renderZones();
  }

  private clearDrawLayers(): void {
    this.drawPolygon?.setMap(null);
    this.drawCircle?.setMap(null);
    this.importLayers.forEach(l => l.setMap(null));
    this.drawPolygon = undefined;
    this.drawCircle = undefined;
    this.importLayers = [];
    this.drawPoints.set(0);
  }

  // ─── Simulation ─────────────────────────────────────────────────────────────

  protected openSimulate(): void {
    if (this.mapMode() === 'draw') this.cancelDraw();
    this.mapMode.set('simulate');
    this.simResult.set(null);
    this.simError.set('');
    this.renderZones();
    this.renderSimMarkers();
  }

  protected closeSimulate(): void {
    if (this.mapMode() !== 'simulate') return;
    this.simMarkers.forEach(m => m.setMap(null));
    this.simMarkers = [];
    this.simResult.set(null);
    this.renderRoute();
    this.mapMode.set('view');
    this.renderZones();
  }

  protected setSimCoord(which: 'pickup' | 'dropoff', field: 'lat' | 'lng', value: string): void {
    const target = which === 'pickup' ? this.simPickup : this.simDropoff;
    const n = Number(value.replace(',', '.'));
    const current = target() ?? { lat: NaN, lng: NaN };
    target.set({ ...current, [field]: value.trim() === '' ? NaN : n });
    this.simResult.set(null);
    this.renderRoute();
    this.renderSimMarkers();
  }

  protected coord(p: LatLng | null, field: 'lat' | 'lng'): string {
    const v = p?.[field];
    return v === undefined || Number.isNaN(v) ? '' : String(round(v));
  }

  private renderSimMarkers(): void {
    const g = (window as any).google?.maps;
    if (!this.gmap || !g) return;
    this.simMarkers.forEach(m => m.setMap(null));
    this.simMarkers = [];
    const points: [LatLng | null, string, string][] = [
      [this.simPickup(), 'A', '#1f7a45'],
      [this.simDropoff(), 'B', '#b3261e']
    ];
    for (const [p, label, color] of points) {
      if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      this.simMarkers.push(
        new g.Marker({
          map: this.gmap,
          position: p,
          label: { text: label, color: '#fff', fontWeight: '700' },
          icon: { path: g.SymbolPath.CIRCLE, scale: 11, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 }
        })
      );
    }
  }

  protected runSimulate(): void {
    const a = this.simPickup();
    const b = this.simDropoff();
    const valid = (p: LatLng | null): p is LatLng => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng);
    if (!valid(a) || !valid(b)) return this.simError.set('Placez le départ (A) et l’arrivée (B) sur la carte ou saisissez leurs coordonnées.');
    this.simError.set('');
    this.simBusy.set(true);
    const at = this.simAt() ? new Date(this.simAt()).toISOString() : undefined;
    this.service.simulate(a, b, at).subscribe({
      next: res => {
        this.simResult.set(res);
        this.simBusy.set(false);
        this.renderRoute();
      },
      error: err => {
        this.simError.set(this.message(err, 'La simulation a échoué.'));
        this.simBusy.set(false);
      }
    });
  }

  /** Zones trouvées en un point, en clair (« Dakar et banlieue · Aéroport AIBD (spéciale) »). */
  protected resolutionZones(r: ZoneResolution): string {
    const names = [
      r.serviceZone?.name,
      ...r.specialZones.map(z => `${z.name} (spéciale)`),
      r.restrictedZone ? `${r.restrictedZone.name} (restreinte)` : null
    ].filter(Boolean);
    return names.length ? names.join(' · ') : 'Hors zone';
  }

  /** Détail du prix d'une catégorie, dans l'ordre de calcul de la spécification. */
  protected priceLines(o: PriceOption, res: SimulationResult): { label: string; value: number; hint?: string }[] {
    const km = (res.distanceM / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
    const min = Math.round(res.durationS / 60);
    const lines: { label: string; value: number; hint?: string }[] = [
      { label: 'Prise en charge', value: o.baseFare },
      { label: 'Distance', value: o.distancePart, hint: `${km} km` },
      { label: 'Durée', value: o.durationPart, hint: `${min} min` }
    ];
    if (o.coefficient !== 1) lines.push({ label: 'Coefficient de demande', value: 0, hint: `× ${o.coefficient}` });
    for (const s of o.surcharges) lines.push({ label: s.name, value: s.amount, hint: 'supplément de zone' });
    if (o.interZoneFee) lines.push({ label: 'Supplément inter-zones', value: o.interZoneFee });
    if (o.returnFee) lines.push({ label: 'Retour à vide', value: o.returnFee, hint: `${res.outOfZoneKm} km hors zone` });
    if (o.bookingFee) lines.push({ label: 'Réservation', value: o.bookingFee });
    return lines;
  }

  /** Le prix minimum de la zone a-t-il été retenu à la place du prix calculé ? */
  protected minimumApplied(o: PriceOption): boolean {
    const computed = (o.baseFare + o.distancePart + o.durationPart) * o.coefficient + o.zoneFee + o.interZoneFee + o.returnFee + o.bookingFee;
    return o.minimumFare >= computed;
  }

  /** Itinéraire de la simulation, coloré par tronçon selon le trafic. */
  private renderRoute(): void {
    const g = (window as any).google?.maps;
    this.routeLines.forEach(l => l.setMap(null));
    this.routeLines = [];
    const res = this.simResult();
    if (!this.gmap || !g?.geometry || !res?.polyline) return;
    const path: any[] = g.geometry.encoding.decodePath(res.polyline);
    const segments = res.traffic.length ? res.traffic : [{ from: 0, to: path.length - 1, speed: 'NORMAL' }];
    // Tracé blanc dessous pour détacher l'itinéraire des zones colorées.
    this.routeLines.push(new g.Polyline({ map: this.gmap, path, strokeColor: '#fff', strokeWeight: 7, strokeOpacity: 1, zIndex: 60, clickable: false }));
    for (const s of segments) {
      this.routeLines.push(
        new g.Polyline({
          map: this.gmap,
          path: path.slice(s.from, s.to + 1),
          strokeColor: TRAFFIC_COLORS[s.speed] ?? TRAFFIC_COLORS['NORMAL'],
          strokeWeight: 4,
          strokeOpacity: 1,
          zIndex: 61,
          clickable: false
        })
      );
    }
    const bounds = new g.LatLngBounds();
    path.forEach(p => bounds.extend(p));
    this.gmap.fitBounds(bounds, 60);
  }

  protected simJson(): string {
    return JSON.stringify(this.simResult(), null, 2);
  }

  // ─── Fenêtres ───────────────────────────────────────────────────────────────

  protected openCreate(): void {
    this.fCode.set('');
    this.fName.set('');
    this.fType.set(this.canManage() ? 'SERVICE' : 'SPECIAL');
    this.fColor.set('#FF5F00');
    this.fPriority.set('0');
    this.fTemporary.set(!this.canManage());
    this.fStartsAt.set('');
    this.fEndsAt.set('');
    // L'API revalide les paramètres du type à chaque nouveau contour : une zone créée sans eux ne peut plus être tracée.
    this.fillForm({});
    this.openDialog({ kind: 'create' });
  }

  protected openIdentity(zone: Zone): void {
    this.fCode.set(zone.code);
    this.fName.set(zone.name);
    this.fColor.set(zone.color);
    this.fPriority.set(String(zone.priority));
    this.fTemporary.set(this.isTemporary(zone));
    this.fStartsAt.set(toLocalInput(zone.startsAt));
    this.fEndsAt.set(toLocalInput(zone.endsAt));
    this.openDialog({ kind: 'identity', zone });
  }

  protected openStatus(zone: Zone, status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED'): void {
    this.fAt.set('');
    this.fMessage.set(status === 'SUSPENDED' ? 'Service momentanément indisponible dans ce secteur.' : '');
    this.fUntil.set('');
    this.openDialog({ kind: 'status', zone, status });
  }

  protected openNeighbors(zone: Zone): void {
    this.fNeighbors.set([...zone.neighborIds]);
    this.openDialog({ kind: 'neighbors', zone });
  }

  protected toggleNeighbor(id: string, checked: boolean): void {
    this.fNeighbors.update(list => (checked ? [...list, id] : list.filter(n => n !== id)));
  }

  protected openSettings(zone: Zone): void {
    this.fillForm(zone.settings);
    this.openDialog({ kind: 'settings', zone });
  }

  private fillForm(s: ZoneSettings): void {
    const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
    const perCategory = (values: Record<string, number> | null | undefined) =>
      Object.fromEntries(CATEGORIES.map(c => [c.code, str(values?.[c.code])]));
    this.form.set({
      categories: s.enabledCategories?.length ? [...s.enabledCategories] : CATEGORIES.map(c => c.code),
      surgeMax: str(s.surgeMax ?? 1.5),
      radiusM: str(s.driverSearchRadiusM ?? 3000),
      permanent: !s.openingHours?.length,
      slots: s.openingHours?.length ? s.openingHours.map(h => ({ days: h.days.map(Number), from: h.from, to: h.to })) : [{ days: [1, 2, 3, 4, 5, 6, 7], from: '06:00', to: '02:00' }],
      outOfZone: s.outOfZoneDropoff ?? 'REFUSE',
      outMaxKm: str(s.outOfZoneMaxKm),
      interZone: perCategory(s.interZoneSurcharge),
      surcharges: perCategory(s.surcharges),
      surchargeScope: s.surchargeScope ?? 'BOTH',
      allowsOutside: !!s.allowsOrderOutsideService,
      pickupLat: str(s.pickupPoint?.lat),
      pickupLng: str(s.pickupPoint?.lng),
      pickupMessage: s.pickupMessage ?? '',
      queue: !!s.driverQueueEnabled,
      restriction: s.restriction ?? 'BOTH',
      replLat: str(s.replacementPoint?.lat),
      replLng: str(s.replacementPoint?.lng),
      replMessage: s.replacementMessage ?? ''
    });
  }

  protected setForm<K extends keyof SettingsForm>(key: K, value: SettingsForm[K]): void {
    this.form.update(f => ({ ...f, [key]: value }));
  }

  protected setFormAmount(key: 'interZone' | 'surcharges', category: string, value: string): void {
    this.form.update(f => ({ ...f, [key]: { ...f[key], [category]: value } }));
  }

  protected toggleCategory(code: string, checked: boolean): void {
    this.form.update(f => ({ ...f, categories: checked ? [...f.categories, code] : f.categories.filter(c => c !== code) }));
  }

  protected toggleSlotDay(index: number, day: number): void {
    this.form.update(f => ({
      ...f,
      slots: f.slots.map((s, i) => (i !== index ? s : { ...s, days: s.days.includes(day) ? s.days.filter(d => d !== day) : [...s.days, day].sort() }))
    }));
  }

  protected setSlotTime(index: number, field: 'from' | 'to', value: string): void {
    this.form.update(f => ({ ...f, slots: f.slots.map((s, i) => (i === index ? { ...s, [field]: value } : s)) }));
  }

  protected addSlot(): void {
    this.form.update(f => ({ ...f, slots: [...f.slots, { days: [6, 7], from: '08:00', to: '22:00' }] }));
  }

  protected removeSlot(index: number): void {
    this.form.update(f => ({ ...f, slots: f.slots.filter((_, i) => i !== index) }));
  }

  protected closeDialog(): void {
    if (this.busy()) return;
    this.dialog.set(null);
  }

  private openDialog(dialog: Dialog): void {
    this.reason.set('');
    this.dialogError.set('');
    this.notice.set('');
    this.dialog.set(dialog);
  }

  protected submit(): void {
    const dialog = this.dialog();
    if (!dialog) return;
    const reason = this.reason().trim();
    if (!reason) return this.dialogError.set('Le motif est obligatoire.');

    let request: Observable<unknown>;
    let done: string;
    switch (dialog.kind) {
      case 'create': {
        const body = this.buildIdentity();
        if (typeof body === 'string') return this.dialogError.set(body);
        const settings = this.buildSettings(this.fType());
        if (typeof settings === 'string') return this.dialogError.set(settings);
        request = this.service.create({ ...body, type: this.fType(), settings, reason });
        done = 'Zone créée en brouillon. Dessinez maintenant son contour.';
        break;
      }
      case 'identity': {
        const body = this.buildIdentity();
        if (typeof body === 'string') return this.dialogError.set(body);
        request = this.service.patch(dialog.zone.id, {
          ...body,
          startsAt: body.startsAt ?? null,
          endsAt: body.endsAt ?? null,
          reason
        });
        done = 'Zone modifiée.';
        break;
      }
      case 'status': {
        const body: ZoneStatusChange = { reason, status: dialog.status };
        if (this.fAt()) {
          // Une date passée est appliquée immédiatement par l'API : on l'empêche pour éviter une activation surprise.
          const at = new Date(this.fAt());
          if (at.getTime() <= Date.now()) return this.dialogError.set('La date programmée est passée. Laissez le champ vide pour un changement immédiat.');
          body.at = at.toISOString();
        }
        if (dialog.status === 'SUSPENDED') {
          if (!this.fMessage().trim()) return this.dialogError.set('Le message affiché aux clients est obligatoire.');
          body.message = this.fMessage().trim();
          if (this.fUntil()) {
            const until = new Date(this.fUntil());
            const start = body.at ? new Date(body.at) : new Date();
            if (until <= start) return this.dialogError.set('La réactivation automatique doit être postérieure au début de la suspension.');
            body.until = until.toISOString();
          }
        }
        const target = STATUS_LABELS[dialog.status].toLowerCase();
        done = `Zone ${target}.`;
        request = this.service.setStatus(dialog.zone.id, body).pipe(
          tap(res => {
            const { scheduledAt, ...zone } = res;
            this.zones.update(list => list.map(z => (z.id === zone.id ? zone : z)));
            if (scheduledAt && zone.status !== dialog.status) {
              done = `Changement programmé : la zone sera ${target} le ${new Date(scheduledAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}.`;
            }
          })
        );
        break;
      }
      case 'neighbors': {
        const unchanged =
          this.fNeighbors().length === dialog.zone.neighborIds.length && this.fNeighbors().every(id => dialog.zone.neighborIds.includes(id));
        if (unchanged) return this.dialogError.set('Aucun changement à enregistrer.');
        // La zone renvoyée est appliquée tout de suite, sans attendre le rechargement de la liste.
        request = this.service
          .setNeighbors(dialog.zone.id, this.fNeighbors(), reason)
          .pipe(tap(zone => this.zones.update(list => list.map(z => (z.id === zone.id ? zone : z)))));
        done = 'Zones voisines enregistrées.';
        break;
      }
      default: {
        const settings = this.buildSettings(dialog.zone.type);
        if (typeof settings === 'string') return this.dialogError.set(settings);
        request = this.service.setSettings(dialog.zone.id, settings, reason);
        done = 'Paramètres enregistrés.';
      }
    }

    this.dialogError.set('');
    this.busy.set(true);
    request.subscribe({
      next: res => {
        this.busy.set(false);
        this.dialog.set(null);
        if (dialog.kind === 'create') {
          const created = res as Zone;
          if (created?.id) {
            this.selectedId.set(created.id);
            this.zones.update(list => [...list, created]);
            this.startDraw(created);
          }
        }
        this.refresh(done);
      },
      error: err => {
        this.busy.set(false);
        this.dialogError.set(this.message(err, "L'opération a échoué."));
      }
    });
  }

  private buildIdentity(): { code: string; name: string; color: string; priority: number; startsAt?: string; endsAt?: string } | string {
    const code = this.fCode().trim().toUpperCase();
    const name = this.fName().trim();
    if (!/^[A-Z0-9_-]{2,16}$/.test(code)) return 'Code : 2 à 16 caractères (lettres, chiffres, - ou _).';
    if (!name) return 'Le nom est obligatoire.';
    const priority = Number(this.fPriority());
    if (!Number.isInteger(priority)) return 'La priorité doit être un nombre entier.';
    const body: { code: string; name: string; color: string; priority: number; startsAt?: string; endsAt?: string } = {
      code,
      name,
      color: this.fColor().toUpperCase(),
      priority
    };
    if (this.fTemporary()) {
      if (!this.fStartsAt() || !this.fEndsAt()) return 'Une zone temporaire a une date de début et une date de fin.';
      if (this.fEndsAt() <= this.fStartsAt()) return 'La fin doit être postérieure au début.';
      body.startsAt = new Date(this.fStartsAt()).toISOString();
      body.endsAt = new Date(this.fEndsAt()).toISOString();
    } else if (!this.canManage()) {
      return 'Votre rôle permet seulement de créer des zones temporaires.';
    }
    return body;
  }

  private buildSettings(type: ZoneType): ZoneSettings | string {
    const f = this.form();
    const num = (v: string) => Number(v.replace(',', '.'));
    const amounts = (values: Record<string, string>): Record<string, number> | string => {
      const result: Record<string, number> = {};
      for (const [k, v] of Object.entries(values)) {
        if (v.trim() === '') continue;
        if (!(num(v) >= 0)) return 'Les montants doivent être des nombres positifs.';
        result[k] = num(v);
      }
      return result;
    };
    const point = (lat: string, lng: string, label: string): LatLng | null | string => {
      if (lat.trim() === '' && lng.trim() === '') return null;
      const p = { lat: num(lat), lng: num(lng) };
      return Number.isFinite(p.lat) && Number.isFinite(p.lng) ? p : `${label} : latitude et longitude attendues.`;
    };

    if (type === 'SERVICE') {
      if (!f.categories.length) return 'Proposez au moins une catégorie.';
      const surgeMax = num(f.surgeMax);
      if (!(surgeMax >= 1)) return 'Le coefficient maximum doit être supérieur ou égal à 1.';
      const radius = num(f.radiusM);
      if (!(radius > 0)) return 'Le rayon de recherche doit être positif.';
      if (!f.permanent && f.slots.some(s => !s.days.length || !s.from || !s.to)) return 'Chaque plage horaire a au moins un jour, une heure de début et de fin.';
      const interZone = amounts(f.interZone);
      if (typeof interZone === 'string') return interZone;
      const maxKm = f.outMaxKm.trim() === '' ? null : num(f.outMaxKm);
      if (maxKm !== null && !(maxKm > 0)) return 'La distance maximale hors zone doit être positive.';
      return {
        enabledCategories: f.categories,
        surgeMax,
        driverSearchRadiusM: radius,
        openingHours: f.permanent ? null : f.slots,
        outOfZoneDropoff: f.outOfZone,
        outOfZoneMaxKm: f.outOfZone === 'ALLOW' ? maxKm : null,
        interZoneSurcharge: interZone
      };
    }

    if (type === 'SPECIAL') {
      const surcharges = amounts(f.surcharges);
      if (typeof surcharges === 'string') return surcharges;
      const pickupPoint = point(f.pickupLat, f.pickupLng, 'Point de rendez-vous');
      if (typeof pickupPoint === 'string') return pickupPoint;
      if (!Object.keys(surcharges).length && !pickupPoint && !f.queue) return 'Renseignez au moins un supplément, un point de rendez-vous ou la file d’attente.';
      return {
        surcharges,
        surchargeScope: f.surchargeScope,
        allowsOrderOutsideService: f.allowsOutside,
        pickupPoint,
        pickupMessage: f.pickupMessage.trim() || null,
        driverQueueEnabled: f.queue
      };
    }

    const replacementPoint = point(f.replLat, f.replLng, 'Point de remplacement');
    if (typeof replacementPoint === 'string') return replacementPoint;
    if (!replacementPoint) return 'Indiquez le point de remplacement proposé au client.';
    return {
      restriction: f.restriction,
      replacementPoint,
      replacementMessage: f.replMessage.trim() || null
    };
  }

  private message(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) return 'Impossible de joindre le serveur.';
      const body = err.error as { message?: string | string[]; code?: string; error?: string } | null;
      const code = body?.code ?? (typeof body?.message === 'string' && ERROR_CODES[body.message] ? body.message : undefined);
      if (code && ERROR_CODES[code]) return ERROR_CODES[code];
      if (Array.isArray(body?.message) && body.message.length) return body.message.join(' ');
      if (typeof body?.message === 'string' && body.message) return body.message;
      if (err.status === 403) return "Votre rôle ne permet pas cette action.";
    }
    return fallback;
  }

  private emptyForm(): SettingsForm {
    return {
      categories: [], surgeMax: '', radiusM: '', permanent: true, slots: [], outOfZone: 'REFUSE', outMaxKm: '',
      interZone: {}, surcharges: {}, surchargeScope: 'BOTH', allowsOutside: false, pickupLat: '', pickupLng: '',
      pickupMessage: '', queue: false, restriction: 'BOTH', replLat: '', replLng: '', replMessage: ''
    };
  }
}

/** Polygon ou MultiPolygon d'un fichier GeoJSON (géométrie, Feature ou FeatureCollection). */
function parseGeoJson(text: string): ZoneGeometry | null {
  try {
    let value = JSON.parse(text);
    if (value?.type === 'FeatureCollection') value = value.features?.[0];
    if (value?.type === 'Feature') value = value.geometry;
    return value?.type === 'Polygon' || value?.type === 'MultiPolygon' ? value : null;
  } catch {
    return null;
  }
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** ISO → valeur d'un champ datetime-local (heure locale). */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
