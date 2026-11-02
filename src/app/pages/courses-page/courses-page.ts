import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable, tap } from 'rxjs';
import { RIDE_STATUSES as STATUSES, RideDetail, RideEvent, RideListItem, RideStatus, RideStatusInfo as StatusInfo, RidesService, TicketCategory, TicketPriority } from './rides.service';

/** Statuts pour lesquels l'annulation avec remboursement a un sens. */
const CANCELLABLE: RideStatus[] = ['PAYMENT_PENDING', 'SEARCHING', 'ACCEPTED', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'INCIDENT'];
/** Statuts éligibles à la clôture forcée (incident, fin oubliée). */
const FORCE_COMPLETABLE: RideStatus[] = ['IN_PROGRESS', 'INCIDENT'];
/** Statuts soldés : le remboursement manuel n'est accepté que sur une course soldée. */
const REFUNDABLE: RideStatus[] = ['COMPLETED', 'NO_SHOW', 'CANCELLED_BY_CLIENT', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_ADMIN'];

const TICKET_CATEGORIES: { code: TicketCategory; label: string }[] = [
  { code: 'PAYMENT', label: 'Paiement' },
  { code: 'REFUND', label: 'Remboursement' },
  { code: 'LOST_ITEM', label: 'Objet perdu' },
  { code: 'DRIVER_BEHAVIOR', label: 'Comportement du chauffeur' },
  { code: 'CLIENT_BEHAVIOR', label: 'Comportement du client' },
  { code: 'SAFETY', label: 'Sécurité' },
  { code: 'PRICE', label: 'Prix' },
  { code: 'APP', label: 'Application' },
  { code: 'OTHER', label: 'Autre' }
];

const TICKET_PRIORITIES: { code: TicketPriority; label: string }[] = [
  { code: 'LOW', label: 'Basse' },
  { code: 'NORMAL', label: 'Normale' },
  { code: 'HIGH', label: 'Haute' },
  { code: 'URGENT', label: 'Urgente' }
];

const PERIODS = [
  { days: 1, label: "Aujourd'hui" },
  { days: 7, label: '7 derniers jours' },
  { days: 30, label: '30 derniers jours' },
  { days: 90, label: '90 derniers jours' },
  { days: 0, label: 'Toute la période' }
];

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const SEARCH_DELAY_MS = 350;

interface TimelineEvent {
  heure: string;
  texteL1: string;
  texteL2?: string;
  orange?: boolean;
}

interface TransactionRow {
  type: string;
  ref: string;
  montant: string;
  statut: string;
  failed: boolean;
}

type RideAction = 'cancel' | 'force' | 'refund' | 'ticket';

const fmt = (n: number): string => n.toLocaleString('fr-FR') + ' F';

@Component({
  selector: 'app-courses-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './courses-page.html',
  styleUrl: './courses-page.css'
})
export class CoursesPage implements OnInit, OnDestroy {
  private readonly service = inject(RidesService);
  private searchTimer?: ReturnType<typeof setTimeout>;
  private listSeq = 0;

  protected readonly pageSizes = [10, 20, 50];
  protected readonly periods = PERIODS;
  protected readonly statusOptions = Object.entries(STATUSES).map(([code, s]) => ({ code, label: s.label }));

  protected readonly rides = signal<RideListItem[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(false);
  protected readonly error = signal('');

  protected readonly search = signal('');
  protected readonly status = signal('');
  protected readonly periodDays = signal(7);
  protected readonly currentPage = signal(1);
  protected readonly pageSize = signal(20);

  protected readonly selectedId = signal<string | null>(null);
  protected readonly detail = signal<RideDetail | null>(null);
  protected readonly detailLoading = signal(false);
  protected readonly detailError = signal('');

  /** Fenêtre de motif pour l'annulation / la clôture forcée. */
  protected readonly action = signal<RideAction | null>(null);
  protected readonly reason = signal('');
  protected readonly refundAmount = signal('');
  protected readonly ticketCategory = signal<TicketCategory>('OTHER');
  protected readonly ticketPriority = signal<TicketPriority>('NORMAL');
  protected readonly ticketCategories = TICKET_CATEGORIES;
  protected readonly ticketPriorities = TICKET_PRIORITIES;
  protected readonly actionError = signal('');
  protected readonly busy = signal(false);
  protected readonly notice = signal('');

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
    const end = Math.min(start + this.rides().length - 1, total);
    return `${start}-${end} sur ${total}`;
  });
  protected readonly periodLabel = computed(() => {
    const { from } = this.range();
    return from ? `${this.shortDate(from)} – ${this.shortDate(this.isoDay(new Date()))}` : 'Toutes les dates';
  });

  protected readonly selected = computed(() => this.rides().find(r => r.id === this.selectedId()) ?? null);
  protected readonly canCancel = computed(() => CANCELLABLE.includes(this.detail()?.ride.status as RideStatus));
  protected readonly canRefund = computed(() => REFUNDABLE.includes(this.detail()?.ride.status as RideStatus));
  protected readonly canForce =computed(() => FORCE_COMPLETABLE.includes(this.detail()?.ride.status as RideStatus));

  protected readonly summary = computed(() => {
    const d = this.detail();
    if (!d) return null;
    const r = d.ride;
    const charged = d.transactions.filter(t => t.type === 'CHARGE' && t.status === 'SUCCESS').reduce((s, t) => s + t.amount, 0);
    const refunded = d.transactions.filter(t => t.type === 'REFUND' && t.status === 'SUCCESS').reduce((s, t) => s + t.amount, 0);
    const done = r.status === 'COMPLETED';
    const km = r.distance_m ? ` · ${(r.distance_m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km` : '';
    const vehicle = [r.make, r.model, r.color].filter(Boolean).join(' ');
    return {
      description: `${r.category}${km} · taux de commission figé : ${Number(r.commission_rate)} %`,
      client: [r.client_name, r.client_phone].filter(Boolean).join(' · ') || '—',
      driver: r.driver_name || r.driver_phone ? [r.driver_name, r.driver_phone, r.plate, vehicle].filter(Boolean).join(' · ') : null,
      trajet: `${r.pickup_address ?? '—'} → ${r.dropoff_address ?? '—'}`,
      prixPaye: fmt(charged),
      commissionTaux: `${Number(r.commission_rate)} %`,
      commissionSeddo: done ? fmt(r.commission_amount) : '—',
      partChauffeur: done ? fmt(r.driver_amount) : '—',
      rembourse: fmt(refunded),
      cancelReason: r.cancel_reason,
      events: d.events.map(e => this.toTimeline(e)),
      transactions: d.transactions.map<TransactionRow>(t => ({
        type: t.type,
        ref: t.orderId,
        montant: fmt(t.amount),
        statut: t.status === 'SUCCESS' ? 'Réussi' : t.status === 'FAILED' ? 'Échoué' : t.status,
        failed: t.status === 'FAILED'
      }))
    };
  });

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    clearTimeout(this.searchTimer);
  }

  protected statusInfo(status: RideStatus): StatusInfo {
    return STATUSES[status] ?? { label: status, css: 'st-aucun' };
  }

  protected load(): void {
    const seq = ++this.listSeq;
    const { from, to } = this.range();
    this.loading.set(true);
    this.error.set('');
    this.service
      .list({
        page: this.currentPage(),
        pageSize: this.pageSize(),
        q: this.search().trim(),
        status: this.status(),
        from,
        to
      })
      .subscribe({
        next: res => {
          if (seq !== this.listSeq) return;
          this.rides.set(res.items);
          this.total.set(res.total);
          this.loading.set(false);
        },
        error: err => {
          if (seq !== this.listSeq) return;
          this.rides.set([]);
          this.total.set(0);
          this.error.set(this.message(err, 'Impossible de charger les courses.'));
          this.loading.set(false);
        }
      });
  }

  protected onSearch(value: string): void {
    this.search.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.resetAndLoad(), SEARCH_DELAY_MS);
  }

  protected onStatus(value: string): void {
    this.status.set(value);
    this.resetAndLoad();
  }

  protected onPeriod(value: string): void {
    this.periodDays.set(Number(value));
    this.resetAndLoad();
  }

  protected onPageSize(value: string): void {
    this.pageSize.set(Number(value));
    this.resetAndLoad();
  }

  protected goTo(page: number): void {
    const next = Math.min(Math.max(page, 1), this.totalPages());
    if (next === this.currentPage()) return;
    this.currentPage.set(next);
    this.load();
  }

  private resetAndLoad(): void {
    this.currentPage.set(1);
    this.load();
  }

  protected selectCourse(id: string): void {
    if (this.selectedId() === id) return this.closeDrawer();
    this.selectedId.set(id);
    this.loadDetail(id);
  }

  protected closeDrawer(): void {
    this.selectedId.set(null);
    this.detail.set(null);
    this.detailError.set('');
  }

  private loadDetail(id: string): void {
    this.detail.set(null);
    this.detailError.set('');
    this.detailLoading.set(true);
    this.service.detail(id).subscribe({
      next: res => {
        if (this.selectedId() !== id) return;
        this.detail.set(res);
        this.detailLoading.set(false);
      },
      error: err => {
        if (this.selectedId() !== id) return;
        this.detailError.set(this.message(err, 'Impossible de charger le détail de la course.'));
        this.detailLoading.set(false);
      }
    });
  }

  protected openAction(action: RideAction): void {
    this.reason.set('');
    this.refundAmount.set('');
    this.ticketCategory.set('OTHER');
    this.ticketPriority.set('NORMAL');
    this.actionError.set('');
    this.action.set(action);
  }

  protected closeAction(): void {
    if (this.busy()) return;
    this.action.set(null);
  }

  protected submitAction(): void {
    const action = this.action();
    const id = this.selectedId();
    const reason = this.reason().trim();
    if (!action || !id) return;
    if (!reason) {
      this.actionError.set(action === 'ticket' ? 'La description est obligatoire.' : 'Le motif est obligatoire.');
      return;
    }

    let request: Observable<unknown>;
    let done: string;
    switch (action) {
      case 'cancel':
        request = this.service.cancel(id, reason);
        done = 'Course annulée, le client sera remboursé.';
        break;
      case 'force':
        request = this.service.forceComplete(id, reason);
        done = 'Course clôturée.';
        break;
      case 'refund': {
        const amount = Number(this.refundAmount().replace(/\s/g, '').replace(',', '.'));
        if (!Number.isFinite(amount) || amount <= 0) {
          this.actionError.set('Saisissez un montant supérieur à 0.');
          return;
        }
        request = this.service.refund(id, amount, reason);
        done = `Remboursement de ${fmt(amount)} enregistré (validation Finance requise au-delà du seuil).`;
        break;
      }
      default:
        request = this.service
          .openTicket(id, { category: this.ticketCategory(), description: reason, priority: this.ticketPriority() })
          .pipe(tap(ticket => (done = `Ticket ${ticket.ref} ouvert.`)));
        done = 'Ticket ouvert.';
    }

    this.actionError.set('');
    this.busy.set(true);
    request.subscribe({
      next: () => {
        this.busy.set(false);
        this.action.set(null);
        this.notice.set(done);
        this.load();
        this.loadDetail(id);
      },
      error: err => {
        this.actionError.set(this.message(err, "L'opération a échoué."));
        this.busy.set(false);
      }
    });
  }

  protected formatDate(value: string | null): string {
    const d = value ? new Date(value) : null;
    if (!d || isNaN(d.getTime())) return '—';
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${this.time(d)}`;
  }

  private time(d: Date): string {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  private shortDate(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    return `${d} ${MONTHS[m - 1]} ${y}`;
  }

  /** Période filtrée : `to` est exclusif côté jour, on prend donc demain pour inclure aujourd'hui. */
  private range(): { from?: string; to?: string } {
    const days = this.periodDays();
    if (!days) return {};
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - (days - 1));
    const to = new Date(now);
    to.setDate(to.getDate() + 1);
    return { from: this.isoDay(from), to: this.isoDay(to) };
  }

  private isoDay(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private toTimeline(e: RideEvent): TimelineEvent {
    const heure = this.time(new Date(e.createdAt));
    const p = e.payload ?? {};
    const amount = typeof p['amount'] === 'number' ? fmt(p['amount']) : '';
    const orderId = typeof p['orderId'] === 'string' ? p['orderId'] : undefined;
    const label = (code: string | null): string => (code && STATUSES[code as RideStatus]?.label) || code || '—';
    switch (e.type) {
      case 'RIDE_CREATED':
        return { heure, texteL1: `Commande${typeof p['price'] === 'number' ? ` - devis ${fmt(p['price'])}` : ''}` };
      case 'PAYMENT_INITIATED':
        return { heure, texteL1: `Paiement initié${amount ? ` · ${amount}` : ''}`, texteL2: orderId, orange: true };
      case 'STATUS_CHANGED':
        return { heure, texteL1: `${label(e.from)} → ${label(e.to)}`, texteL2: orderId, orange: e.actorType === 'ORANGE' };
      case 'REFUND_ORDERED':
        return { heure, texteL1: `Remboursement ordonné${amount ? ` · ${amount}` : ''}`, texteL2: orderId, orange: true };
      case 'REFUND_PAID':
        return { heure, texteL1: `Remboursement versé${amount ? ` · ${amount}` : ''}`, texteL2: orderId, orange: true };
      default:
        return { heure, texteL1: e.type };
    }
  }

  private message(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) return 'Impossible de joindre le serveur.';
      if (error.status === 403) return "Vous n'avez pas le droit d'effectuer cette action.";
      const body = (error.error as { message?: string | string[] } | null)?.message;
      if (Array.isArray(body) && body.length) return body.join(' ');
      if (typeof body === 'string' && body) return body;
    }
    return fallback;
  }
}
