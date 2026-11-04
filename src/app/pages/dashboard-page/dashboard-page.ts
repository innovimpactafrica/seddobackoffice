import {
  AfterViewInit,
  Component,
  computed,
  ElementRef,
  inject,
  OnDestroy,
  PLATFORM_ID,
  signal,
  ViewChild
} from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { GoogleMapsLoader, mapsErrorMessage } from '../../core/maps/google-maps-loader';
import { DashboardService, DashboardSummary, LedgerBalances, LiveMap } from './dashboard.service';
import { ActiveZone, toPaths, ZonesService } from '../zones-page/zones.service';

const REFRESH_MS = 30_000;

const DRIVER_STATES: Record<string, string> = {
  FREE: 'Disponible',
  APPROACHING: 'En approche',
  ARRIVED: 'Arrivé',
  ON_RIDE: 'En course',
  IN_PROGRESS: 'En course'
};

const RIDE_STATUSES: Record<string, string> = {
  INCIDENT: 'incident',
  SEARCHING: 'en recherche',
  ACCEPTED: 'acceptée',
  APPROACHING: 'en approche',
  ARRIVED: 'arrivée',
  IN_PROGRESS: 'en cours'
};

const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

interface VehiclePosition {
  id: string;
  driverName: string;
  plate: string;
  lat: number;
  lng: number;
  rotation: number;
  status: string;
  busy: boolean;
  category: string;
  lastSeen: string;
}

interface Kpi {
  label: string;
  val: string;
  sub: string;
  warn?: boolean;
}

interface AlertRow {
  stripe: string;
  title: string;
  sub: string;
  btn: string;
  btnClass: string;
  link: string;
}

interface Line {
  label: string;
  montant: string;
}

@Component({
  selector: 'app-dashboard-page',
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.css'
})
export class DashboardPage implements AfterViewInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly service = inject(DashboardService);
  private readonly zonesService = inject(ZonesService);
  private readonly mapsLoader = inject(GoogleMapsLoader);

  @ViewChild('gmapContainer') private gmapContainer?: ElementRef<HTMLDivElement>;

  private googleMap?: any;
  private markers: any[] = [];
  private zonePolygons: any[] = [];
  private activeZones: ActiveZone[] = [];
  private timer?: ReturnType<typeof setInterval>;

  protected readonly summary = signal<DashboardSummary | null>(null);
  protected readonly balances = signal<LedgerBalances | null>(null);
  protected readonly liveMap = signal<LiveMap | null>(null);
  protected readonly error = signal('');
  protected readonly selectedVehicle = signal<VehiclePosition | null>(null);
  protected readonly gmapLoaded = signal(false);
  protected readonly now = signal(new Date());

  protected readonly headerDatetime = computed(() => {
    const d = this.now();
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} · ${time} · données en direct`;
  });

  protected readonly vehicles = computed<VehiclePosition[]>(() =>
    (this.liveMap()?.drivers ?? []).map(d => ({
      id: d.driverId,
      driverName: d.name ?? 'Chauffeur sans nom',
      plate: d.plate,
      lat: d.lat,
      lng: d.lng,
      rotation: d.heading ?? 0,
      status: DRIVER_STATES[d.state] ?? d.state,
      busy: d.state !== 'FREE',
      category: d.category,
      lastSeen: this.formatAge(d.lastSeenS)
    }))
  );

  protected readonly kpiList = computed<Kpi[]>(() => {
    const s = this.summary();
    const b = this.balances();
    if (!s) return [];
    const active = this.total(s.activeRides);
    const online = this.total(s.driversOnline);
    return [
      {
        label: "Courses aujourd'hui",
        val: this.num(s.today.orders),
        sub: `${s.today.completed} terminée(s) · ${s.today.unserved} non servie(s)`
      },
      {
        label: 'Courses en cours',
        val: this.num(active),
        sub: this.breakdown(s.activeRides, status => RIDE_STATUSES[status] ?? status.toLowerCase()) || 'Aucune course en cours'
      },
      {
        label: 'Chauffeurs en ligne',
        val: this.num(online),
        sub: this.breakdown(s.driversOnline, category => category) || 'Aucun chauffeur en ligne'
      },
      {
        label: 'Échecs de paiement',
        val: `${s.today.paymentFailureRate} %`,
        sub: `dont ${s.today.insufficientFunds} pour solde insuffisant`
      },
      {
        label: 'Solde compte OM Seddo',
        val: this.money(b?.omMerchantCash ?? s.omMerchantBalance),
        sub: b?.lowBalanceAlert ? `Ne couvre pas les dettes (${this.money(b.owed)})` : b ? `Couvre les dettes (${this.money(b.owed)})` : '',
        warn: b?.lowBalanceAlert
      }
    ];
  });

  protected readonly alerts = computed<AlertRow[]>(() => {
    const s = this.summary();
    const b = this.balances();
    if (!s) return [];
    const rows: AlertRow[] = [];
    if (s.alerts.openSos) {
      rows.push({ stripe: '#C42B25', title: `${s.alerts.openSos} alerte(s) SOS ouverte(s)`, sub: 'À traiter immédiatement', btn: 'Ouvrir', btnClass: 'btn-r', link: '/alertes-sos' });
    }
    if (s.alerts.incidents) {
      rows.push({ stripe: '#C42B25', title: `${s.alerts.incidents} course(s) en incident`, sub: 'Course signalée par le chauffeur ou le client', btn: 'Voir', btnClass: 'btn-r', link: '/courses' });
    }
    if (b?.lowBalanceAlert) {
      rows.push({ stripe: '#B26A00', title: 'Compte OM insuffisant', sub: `${this.money(b.omMerchantCash)} disponibles pour ${this.money(b.owed)} dus`, btn: 'Voir', btnClass: 'btn-s', link: '/paiements' });
    }
    if (s.alerts.failedDisbursements) {
      rows.push({ stripe: '#B26A00', title: `${s.alerts.failedDisbursements} versement(s) en échec`, sub: 'À relancer ou à traiter manuellement', btn: 'Voir', btnClass: 'btn-s', link: '/versements' });
    }
    if (s.alerts.pendingRefundRequests) {
      rows.push({ stripe: '#B26A00', title: `${s.alerts.pendingRefundRequests} demande(s) de remboursement`, sub: 'En attente de validation', btn: 'Voir', btnClass: 'btn-s', link: '/reclamations' });
    }
    if (s.alerts.openTickets) {
      rows.push({ stripe: '#2852A8', title: `${s.alerts.openTickets} réclamation(s) ouverte(s)`, sub: 'Délai de première réponse cible : 2 h', btn: 'Voir', btnClass: 'btn-s', link: '/reclamations' });
    }
    return rows;
  });

  protected readonly todayLines = computed<Line[]>(() => {
    const t = this.summary()?.today;
    if (!t) return [];
    return [
      { label: 'Commandes', montant: this.num(t.orders) },
      { label: 'Terminées', montant: this.num(t.completed) },
      { label: 'Non servies', montant: this.num(t.unserved) },
      { label: 'Volume encaissé (courses terminées)', montant: this.money(t.gmv) },
      { label: 'Commission Seddo', montant: this.money(t.commission) }
    ];
  });

  protected readonly ledgerLines = computed<Line[]>(() => {
    const b = this.balances();
    if (!b) return [];
    return [
      { label: 'Cash compte OM', montant: this.money(b.omMerchantCash) },
      { label: 'Courses en attente de règlement', montant: this.money(b.ridePending) },
      { label: 'Dû aux chauffeurs', montant: this.money(b.driverPayable) },
      { label: 'Remboursable aux clients', montant: this.money(b.clientRefundable) },
      { label: 'Revenu Seddo', montant: this.money(b.seddoRevenue) },
      { label: 'Total des dettes', montant: this.money(b.owed) }
    ];
  });

  protected readonly mapBadge = computed(() => {
    const map = this.liveMap();
    if (!map) return 'Carte live';
    return `Carte live · ${map.drivers.length} chauffeur(s) · ${map.waiting.length} en attente · ${map.active.length} en cours`;
  });

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.refresh();
    this.initGoogleMaps();
    this.timer = setInterval(() => this.refresh(), REFRESH_MS);
    // Les contours changent rarement : chargés une fois, sans rafraîchissement.
    this.zonesService.active().subscribe({
      next: zones => {
        this.activeZones = zones;
        this.renderZones();
      },
      error: () => (this.activeZones = [])
    });
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private refresh(): void {
    this.now.set(new Date());
    this.service.summary().subscribe({
      next: data => {
        this.summary.set(data);
        this.error.set('');
      },
      error: () => this.error.set('Impossible de charger le tableau de bord.')
    });
    this.service.balances().subscribe({ next: data => this.balances.set(data), error: () => this.balances.set(null) });
    this.service.liveMap().subscribe({
      next: data => {
        this.liveMap.set(data);
        this.renderMarkers();
      },
      error: () => this.liveMap.set(null)
    });
  }

  private initGoogleMaps(): void {
    const win = window as any;

    // Gestion gracieuse en cas d'erreur d'autorisation de clé (ex: restrictions de domaine)
    win.gm_authFailure = () => {
      console.warn('Google Maps authentication notice : basculement automatique sur la vue cartographique vectorielle Dakar.');
      this.gmapLoaded.set(false);
    };

    // Clé lue dans Paramètres › Clés Google Maps ; sans clé ou hors ligne, le fallback stylisé Dakar prend le relais.
    this.mapsLoader.load().then(
      () => this.renderGoogleMaps(),
      err => {
        console.warn('Google Maps non chargé :', mapsErrorMessage(err));
        this.gmapLoaded.set(false);
      }
    );
  }

  private renderGoogleMaps(): void {
    const container = this.gmapContainer?.nativeElement;
    const win = window as any;
    if (!container || !win.google || !win.google.maps) return;

    try {
      const mapStyles = [
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c9e2f4' }] },
        { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f7f4ee' }] },
        { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
        { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#fee5d3' }] },
        { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#fed7bc' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] }
      ];

      this.googleMap = new win.google.maps.Map(container, {
        center: { lat: 14.7167, lng: -17.4677 },
        zoom: 12.4,
        disableDefaultUI: true,
        zoomControl: true,
        styles: mapStyles
      });
      this.gmapLoaded.set(true);
      this.renderZones();
      this.renderMarkers();
    } catch {
      this.gmapLoaded.set(false);
    }
  }

  /** Colore les zones actives sous les véhicules ; une zone restreinte est plus marquée. */
  private renderZones(): void {
    const g = (window as any).google?.maps;
    if (!this.googleMap || !g) return;
    this.zonePolygons.forEach(p => p.setMap(null));
    this.zonePolygons = this.activeZones.flatMap(zone =>
      toPaths(zone.geometry).map(
        paths =>
          new g.Polygon({
            map: this.googleMap,
            paths,
            strokeColor: zone.color,
            strokeOpacity: 0.8,
            strokeWeight: 1.5,
            fillColor: zone.color,
            fillOpacity: zone.type === 'RESTRICTED' ? 0.25 : 0.08,
            clickable: false,
            zIndex: zone.type === 'RESTRICTED' ? 3 : zone.type === 'SPECIAL' ? 2 : 1
          })
      )
    );
  }

  /** Remplace les marqueurs Google Maps par les positions reçues de l'API. */
  private renderMarkers(): void {
    const win = window as any;
    if (!this.googleMap || !win.google?.maps) return;

    this.markers.forEach(m => m.setMap(null));
    const carSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="15" viewBox="0 0 32 18">
        <rect x="2" y="1" width="28" height="16" rx="4" fill="#141210" stroke="#fff" stroke-width="1.5"/>
        <rect x="7" y="3" width="7" height="12" rx="2" fill="#fff" opacity="0.85"/>
        <rect x="18" y="3" width="7" height="12" rx="2" fill="#fff" opacity="0.6"/>
        <circle cx="6" cy="1" r="1.5" fill="#ff5a00"/>
        <circle cx="26" cy="1" r="1.5" fill="#ff5a00"/>
      </svg>
    `;
    this.markers = this.vehicles().map(v => {
      const marker = new win.google.maps.Marker({
        position: { lat: v.lat, lng: v.lng },
        map: this.googleMap,
        title: `${v.driverName} (${v.plate})`,
        icon: {
          url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(carSvg),
          scaledSize: new win.google.maps.Size(28, 15),
          anchor: new win.google.maps.Point(14, 7.5)
        }
      });
      marker.addListener('click', () => this.selectVehicle(v));
      return marker;
    });
  }

  protected selectVehicle(v: VehiclePosition): void {
    this.selectedVehicle.set(v);
    this.googleMap?.panTo({ lat: v.lat, lng: v.lng });
  }

  private total(counts: Record<string, number>): number {
    return Object.values(counts).reduce((sum, n) => sum + n, 0);
  }

  private breakdown(counts: Record<string, number>, label: (key: string) => string): string {
    return Object.entries(counts)
      .map(([key, n]) => `${n} ${label(key)}`)
      .join(' · ');
  }

  private num(value: number): string {
    return value.toLocaleString('fr-FR');
  }

  private money(value: number): string {
    return `${value.toLocaleString('fr-FR')} F`;
  }

  private formatAge(seconds: number): string {
    if (seconds < 60) return `à l'instant`;
    if (seconds < 3600) return `il y a ${Math.floor(seconds / 60)} min`;
    if (seconds < 86400) return `il y a ${Math.floor(seconds / 3600)} h`;
    return `il y a ${Math.floor(seconds / 86400)} j`;
  }
}
