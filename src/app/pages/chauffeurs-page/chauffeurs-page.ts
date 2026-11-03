import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { forkJoin, map, Observable } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { DocumentTypesPanel } from './document-types-panel';
import { DriverDossier } from './driver-dossier';
import { DriverWallet } from './driver-wallet';
import { DriverAction, DriverDetail, DriverPayout, DriverListItem, driverName, DriversService, DriverStatus } from './drivers.service';
import { SelfiesPanel } from './selfies-panel';
import { WalletsPanel } from './wallets-panel';
import { RIDE_STATUSES, RideStatus, RideStatusInfo } from '../courses-page/rides.service';

interface StatusInfo {
  label: string;
  css: string;
}

export const DRIVER_STATUSES: Record<DriverStatus, StatusInfo> = {
  DRAFT: { label: 'Inscription en cours', css: 'st-draft' },
  IN_REVIEW: { label: 'En vérification', css: 'st-verif' },
  DOCUMENT_TO_FIX: { label: 'Pièce à corriger', css: 'st-piece' },
  VALIDATED: { label: 'Validé', css: 'st-valide' },
  SUSPENDED: { label: 'Suspendu', css: 'st-suspendu' },
  REFUSED: { label: 'Refusé', css: 'st-refuse' },
  BANNED: { label: 'Banni', css: 'st-banni' }
};

const STATUS_ORDER: DriverStatus[] = ['IN_REVIEW', 'DOCUMENT_TO_FIX', 'DRAFT', 'VALIDATED', 'SUSPENDED', 'REFUSED', 'BANNED'];

interface ActionInfo {
  label: string;
  hint: string;
  danger: boolean;
  /** Message affiché une fois l'action faite. */
  done: string;
}

const ACTIONS: Record<DriverAction, ActionInfo> = {
  validate: { label: 'Valider', hint: 'Le chauffeur peut passer en ligne et recevoir des courses.', danger: false, done: 'Chauffeur validé.' },
  'request-fix': { label: 'Demander une correction', hint: 'Le dossier passe en « Pièce à corriger » ; le chauffeur est prévenu.', danger: false, done: 'Correction demandée : le chauffeur est prévenu.' },
  refuse: { label: 'Refuser le dossier', hint: "Le chauffeur ne peut pas rejoindre Seddo avec ce dossier.", danger: true, done: 'Dossier refusé.' },
  suspend: { label: 'Suspendre', hint: 'Le chauffeur passe hors ligne et ne reçoit plus de courses, sauf la course en cours.', danger: true, done: 'Chauffeur suspendu.' },
  reactivate: { label: 'Réactiver', hint: 'Le chauffeur peut de nouveau passer en ligne.', danger: false, done: 'Chauffeur réactivé.' },
  ban: { label: 'Bannir', hint: 'Exclusion définitive de la plateforme.', danger: true, done: 'Chauffeur banni.' }
};

/** Actions proposées selon le statut du dossier ; l'API reste juge (409 sinon). */
const ACTIONS_BY_STATUS: Record<DriverStatus, DriverAction[]> = {
  DRAFT: [],
  IN_REVIEW: ['validate', 'request-fix', 'refuse'],
  DOCUMENT_TO_FIX: ['validate', 'refuse'],
  VALIDATED: ['suspend', 'ban'],
  SUSPENDED: ['reactivate', 'ban'],
  REFUSED: [],
  BANNED: []
};

const PRESENCE: Record<string, string> = {
  ONLINE: 'en ligne',
  OFFLINE: 'hors ligne',
  ON_RIDE: 'en course',
  BUSY: 'en course'
};

const PAYOUT_STATUSES: Record<string, { label: string; css: string }> = {
  SUCCESS: { label: 'Versé', css: 'st-terminee' },
  PENDING: { label: 'En attente', css: 'st-encours' },
  FAILED: { label: 'Échoué', css: 'st-echoue' }
};

const SEARCH_DELAY_MS = 350;

type Tab = 'drivers' | 'selfies' | 'wallets' | 'types';
type FicheTab = 'activity' | 'dossier' | 'wallet';

/** Fenêtres de la fiche autres que le changement de statut. */
type FicheDialog = 'reveal' | 'payout';

@Component({
  selector: 'app-chauffeurs-page',
  imports: [DatePipe, DecimalPipe, SelfiesPanel, WalletsPanel, DocumentTypesPanel, DriverDossier, DriverWallet],
  templateUrl: './chauffeurs-page.html',
  styleUrls: ['./chauffeurs-shared.css', './chauffeurs-page.css']
})
export class ChauffeursPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(DriversService);
  private readonly auth = inject(AuthService);
  private searchTimer?: ReturnType<typeof setTimeout>;
  private listSeq = 0;

  protected readonly tab = signal<Tab>('drivers');
  protected readonly pageSizes = [10, 20, 50];
  protected readonly statusOrder = STATUS_ORDER;
  protected readonly statuses = DRIVER_STATUSES;
  protected readonly actions = ACTIONS;

  protected readonly drivers = signal<DriverListItem[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  /** Effectif par statut (l'API ne renvoie que le total de la requête : une requête légère par statut). */
  protected readonly counts = signal<Partial<Record<DriverStatus | 'ALL', number>>>({});

  protected readonly search = signal('');
  protected readonly status = signal<DriverStatus | ''>('');
  protected readonly currentPage = signal(1);
  protected readonly pageSize = signal(20);

  protected readonly selectedId = signal<string | null>(null);
  protected readonly detail = signal<DriverDetail | null>(null);
  protected readonly detailLoading = signal(false);
  protected readonly detailError = signal('');

  protected readonly action = signal<DriverAction | null>(null);
  protected readonly reason = signal('');
  protected readonly actionError = signal('');
  protected readonly busy = signal(false);
  protected readonly notice = signal('');

  protected readonly ficheDialog = signal<FicheDialog | null>(null);
  protected readonly fMsisdn = signal('');
  protected readonly fHolder = signal('');
  /** Numéro en clair, gardé seulement pour la fiche ouverte. */
  protected readonly revealedPhone = signal<string | null>(null);

  private readonly role = computed(() => this.auth.currentUser()?.roleCode ?? '');
  /** DRIVER_VALIDATE_SUSPEND : Admin et Ops. */
  protected readonly canAct = computed(() => ['ADMIN', 'OPS'].includes(this.role()));
  protected readonly isAdmin = computed(() => this.role() === 'ADMIN');
  /** Ajustement du portefeuille et blocage des espèces : Finance et Admin. */
  protected readonly canManageWallet = computed(() => ['ADMIN', 'FINANCE'].includes(this.role()));

  /** Onglet de la fiche choisi ; null = selon le contexte (dossier à examiner, portefeuille pour la Finance, sinon activité). */
  protected readonly ficheTab = signal<FicheTab | null>(null);
  protected readonly activeFicheTab = computed<FicheTab>(() => {
    const chosen = this.ficheTab();
    if (chosen) return chosen;
    if (this.role() === 'FINANCE') return 'wallet';
    return this.detail()?.status === 'VALIDATED' ? 'activity' : 'dossier';
  });
  /** PAYOUT_MSISDN_CHANGE : Admin (direct) ou Ops (demande), validé ensuite par la Finance. */
  protected readonly canRequestPayout = computed(() => ['ADMIN', 'OPS'].includes(this.role()));

  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  protected readonly pages = computed(() => {
    const last = this.totalPages();
    const start = Math.max(1, Math.min(this.currentPage() - 1, last - 2));
    return Array.from({ length: Math.min(3, last) }, (_, i) => start + i);
  });
  protected readonly rangeLabel = computed(() => {
    const total = this.total();
    if (total === 0) return '0 sur 0';
    const start = (this.currentPage() - 1) * this.pageSize() + 1;
    return `${start}-${start + this.drivers().length - 1} sur ${total}`;
  });

  protected readonly availableActions = computed(() => {
    const d = this.detail();
    return d && this.canAct() ? ACTIONS_BY_STATUS[d.status] ?? [] : [];
  });

  ngOnInit(): void {
    this.load();
    this.loadCounts();
    const id = this.route.snapshot.paramMap.get('id') || this.route.snapshot.queryParamMap.get('id');
    if (id) this.openDriver(id);
  }

  ngOnDestroy(): void {
    clearTimeout(this.searchTimer);
  }

  protected name(d: { firstName: string | null; lastName: string | null }): string {
    return driverName(d) || 'Sans nom';
  }

  protected initials(d: { firstName: string | null; lastName: string | null }): string {
    const n = driverName(d);
    if (!n) return '?';
    const parts = n.split(/\s+/);
    return ((parts[0][0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
  }

  protected statusInfo(status: DriverStatus): StatusInfo {
    return DRIVER_STATUSES[status] ?? { label: status, css: 'st-draft' };
  }

  protected presenceLabel(p: string): string {
    return PRESENCE[p] ?? p.toLowerCase();
  }

  protected rating(r: string | null): string {
    return r === null ? '—' : Number(r).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  protected percent(v: number | null): string {
    return v === null ? '—' : `${Math.round(v <= 1 ? v * 100 : v)} %`;
  }

  protected money(n: number | null | undefined): string {
    return n === null || n === undefined ? '—' : `${n.toLocaleString('fr-FR')} F`;
  }

  protected vehicleLine(v: { make?: string | null; model?: string | null; color?: string | null }): string {
    return [v.make, v.model, v.color].filter(Boolean).join(' ');
  }

  protected rideStatus(status: RideStatus): RideStatusInfo {
    return RIDE_STATUSES[status] ?? { label: status, css: 'st-aucun' };
  }

  protected payoutStatus(p: DriverPayout): { label: string; css: string } {
    if (p.held) return { label: 'Retenu', css: 'st-echoue' };
    return PAYOUT_STATUSES[p.status] ?? { label: p.status, css: 'st-aucun' };
  }

  protected setTab(tab: Tab): void {
    this.tab.set(tab);
    this.selectedId.set(null);
  }

  protected setStatus(status: DriverStatus | ''): void {
    this.status.set(status);
    this.currentPage.set(1);
    this.load();
  }

  protected onSearch(value: string): void {
    this.search.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.currentPage.set(1);
      this.load();
    }, SEARCH_DELAY_MS);
  }

  protected goTo(page: number): void {
    if (page < 1 || page > this.totalPages() || page === this.currentPage()) return;
    this.currentPage.set(page);
    this.load();
  }

  protected setPageSize(size: string): void {
    this.pageSize.set(Number(size));
    this.currentPage.set(1);
    this.load();
  }

  protected load(): void {
    const seq = ++this.listSeq;
    this.loading.set(true);
    this.error.set('');
    this.service
      .list({ page: this.currentPage(), pageSize: this.pageSize(), status: this.status() || undefined, q: this.search().trim() || undefined })
      .subscribe({
        next: res => {
          if (seq !== this.listSeq) return;
          this.drivers.set(res.items);
          this.total.set(res.total);
          this.loading.set(false);
        },
        error: err => {
          if (seq !== this.listSeq) return;
          this.loading.set(false);
          this.error.set(this.message(err, 'Impossible de charger les chauffeurs.'));
        }
      });
  }

  private loadCounts(): void {
    const count = (status?: DriverStatus) => this.service.list({ page: 1, pageSize: 1, status }).pipe(map(r => r.total));
    forkJoin([count(), ...STATUS_ORDER.map(s => count(s))]).subscribe({
      next: ([all, ...per]) => this.counts.set({ ALL: all, ...Object.fromEntries(STATUS_ORDER.map((s, i) => [s, per[i]])) }),
      error: () => this.counts.set({})
    });
  }

  protected openDriver(id: string, ficheTab: FicheTab | null = null): void {
    this.tab.set('drivers');
    this.ficheTab.set(ficheTab);
    this.selectedId.set(id);
    this.notice.set('');
    this.revealedPhone.set(null);
    this.loadDetail(id);
  }

  private loadDetail(id: string): void {
    this.detail.set(null);
    this.detailLoading.set(true);
    this.detailError.set('');
    this.service.detail(id).subscribe({
      next: d => {
        if (this.selectedId() !== id) return;
        this.detail.set(d);
        this.detailLoading.set(false);
      },
      error: err => {
        if (this.selectedId() !== id) return;
        this.detailLoading.set(false);
        this.detailError.set(this.message(err, 'Impossible de charger la fiche du chauffeur.'));
      }
    });
  }

  /** Une pièce refusée ou un rendez-vous changent le statut ou la liste. */
  protected onDossierChanged(): void {
    const id = this.selectedId();
    if (!id) return;
    this.service.detail(id).subscribe({ next: d => this.selectedId() === id && this.detail.set(d) });
    this.load();
    this.loadCounts();
  }

  protected openFicheDialog(kind: FicheDialog): void {
    this.reason.set('');
    this.actionError.set('');
    this.notice.set('');
    this.fMsisdn.set('');
    this.fHolder.set(kind === 'payout' && this.detail() ? driverName(this.detail()!) : '');
    this.ficheDialog.set(kind);
  }

  protected closeFicheDialog(): void {
    if (!this.busy()) this.ficheDialog.set(null);
  }

  protected submitFicheDialog(): void {
    const kind = this.ficheDialog();
    const d = this.detail();
    if (!kind || !d) return;
    const reason = this.reason().trim();
    if (!reason) return this.actionError.set('Le motif est obligatoire.');

    if (kind === 'reveal') {
      this.run(this.service.revealPhone(d.id, reason), res => {
        this.revealedPhone.set(res.phone);
        return "Numéro affiché : consultation inscrite au journal d'audit.";
      });
      return;
    }
    const digits = this.fMsisdn().replace(/[\s.-]/g, '').replace(/^\+?221/, '');
    if (!/^7[05678]\d{7}$/.test(digits)) return this.actionError.set('Numéro Orange Money attendu : 9 chiffres commençant par 70, 75, 76, 77 ou 78.');
    const holderName = this.fHolder().trim();
    if (!holderName) return this.actionError.set('Le titulaire du compte Orange Money est obligatoire.');
    this.run(this.service.requestPayoutMsisdn(d.id, { msisdn: this.fMsisdn().trim(), holderName, reason }), () =>
      'Demande de changement envoyée : le nouveau numéro sera utilisé une fois validé par la Finance.'
    );
  }

  private run<T>(request: Observable<T>, done: (res: T) => string): void {
    this.busy.set(true);
    this.actionError.set('');
    request.subscribe({
      next: res => {
        this.busy.set(false);
        this.ficheDialog.set(null);
        this.notice.set(done(res));
      },
      error: err => {
        this.busy.set(false);
        this.actionError.set(this.message(err, "L'action n'a pas pu être effectuée."));
      }
    });
  }

  protected backToList(): void {
    this.selectedId.set(null);
    this.detail.set(null);
  }

  protected openAction(action: DriverAction): void {
    this.action.set(action);
    this.reason.set('');
    this.actionError.set('');
  }

  protected closeAction(): void {
    if (!this.busy()) this.action.set(null);
  }

  protected submitAction(): void {
    const action = this.action();
    const d = this.detail();
    if (!action || !d) return;
    const reason = this.reason().trim();
    if (!reason) return this.actionError.set('Le motif est obligatoire.');
    this.busy.set(true);
    this.actionError.set('');
    this.service.act(d.id, action, reason).subscribe({
      next: res => {
        this.busy.set(false);
        this.action.set(null);
        this.notice.set(ACTIONS[action].done);
        // Statut renvoyé par l'API affiché aussitôt, sans vider la fiche ; le reste est rechargé en arrière-plan.
        this.detail.update(cur => (cur?.id === res.id ? { ...cur, status: res.status } : cur));
        this.onDossierChanged();
      },
      error: err => {
        this.busy.set(false);
        this.actionError.set(this.message(err, "L'action n'a pas pu être effectuée."));
      }
    });
  }

  private message(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) return 'Impossible de joindre le serveur.';
      if (err.status === 403) return 'Votre rôle ne permet pas cette action.';
      const body = err.error as { message?: string | string[] } | null;
      if (Array.isArray(body?.message) && body.message.length) return body.message.join(' ');
      if (typeof body?.message === 'string' && body.message) return body.message;
    }
    return fallback;
  }
}
