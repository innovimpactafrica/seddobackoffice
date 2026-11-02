import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { forkJoin, map, Observable } from 'rxjs';
import { RIDE_STATUSES, RideStatus } from '../courses-page/rides.service';
import { TICKET_CATEGORIES, TICKET_STATUSES } from '../reclamations-page/tickets.service';
import { ClientDetail, ClientListItem, clientName, ClientsService, ClientStatus, ClientTicket } from './clients.service';

const STATUS_LABELS: Record<ClientStatus, string> = {
  ACTIVE: 'Actif',
  BLOCKED: 'Bloqué'
};

/** Classes de RIDE_STATUSES (page Courses) → pastilles du volet. */
const RIDE_BADGES: Record<string, string> = {
  'st-encours': 'badge-encours',
  'st-terminee': 'badge-terminee',
  'st-echoue': 'badge-err',
  'st-incident': 'badge-err'
};

/** Classes de TICKET_STATUSES (page Réclamations) → pastilles du volet. */
const TICKET_BADGES: Record<string, string> = {
  'pill-amber': 'badge-nouveau',
  'pill-blue': 'badge-encours',
  'pill-green': 'badge-terminee'
};

const LANGS: Record<string, string> = { fr: 'Français', wo: 'Wolof', en: 'Anglais' };

const SEARCH_DELAY_MS = 350;

type ClientAction = 'block' | 'unblock' | 'reveal';

const ACTIONS: Record<ClientAction, { title: string; hint: string; confirm: string }> = {
  block: {
    title: 'Bloquer',
    hint: "Le client ne peut plus commander et ses sessions sont fermées : il est déconnecté de l'app.",
    confirm: 'Bloquer le compte'
  },
  unblock: { title: 'Débloquer', hint: 'Le client peut de nouveau se connecter et commander.', confirm: 'Débloquer' },
  reveal: { title: 'Afficher le numéro', hint: "La consultation est inscrite au journal d'audit avec votre motif.", confirm: 'Afficher' }
};

@Component({
  selector: 'app-clients-page',
  imports: [DatePipe, DecimalPipe],
  templateUrl: './clients-page.html',
  styleUrl: './clients-page.css'
})
export class ClientsPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(ClientsService);
  private searchTimer?: ReturnType<typeof setTimeout>;
  private listSeq = 0;

  protected readonly pageSizes = [10, 20, 50];
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly actions = ACTIONS;

  protected readonly clients = signal<ClientListItem[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  /** Effectifs globaux (une requête légère par statut : l'API ne renvoie que le total de la requête). */
  protected readonly counts = signal<{ all: number; blocked: number } | null>(null);

  protected readonly search = signal('');
  protected readonly status = signal<ClientStatus | ''>('');
  protected readonly currentPage = signal(1);
  protected readonly pageSize = signal(20);

  protected readonly selectedId = signal<string | null>(null);
  protected readonly detail = signal<ClientDetail | null>(null);
  protected readonly detailLoading = signal(false);
  protected readonly detailError = signal('');
  protected readonly revealedPhone = signal<string | null>(null);

  protected readonly action = signal<ClientAction | null>(null);
  protected readonly reason = signal('');
  protected readonly actionError = signal('');
  protected readonly busy = signal(false);
  protected readonly notice = signal('');

  /** Ligne de la liste du client ouvert : seule source du nombre de courses et du canal. */
  protected readonly selectedRow = computed(() => this.clients().find(c => c.id === this.selectedId()) ?? null);

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
    return `${start}-${start + this.clients().length - 1} sur ${total}`;
  });

  ngOnInit(): void {
    this.load();
    this.loadCounts();
    const id = this.route.snapshot.queryParamMap.get('id');
    if (id) this.openClient(id);
  }

  ngOnDestroy(): void {
    clearTimeout(this.searchTimer);
  }

  protected name(c: { firstName: string | null; lastName: string | null }): string {
    return clientName(c) || 'Sans nom';
  }

  protected rating(r: string | null): string {
    return r === null ? '—' : '★ ' + Number(r).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  protected lang(code: string): string {
    return LANGS[code] ?? code;
  }

  protected rideLabel(status: RideStatus): string {
    return RIDE_STATUSES[status]?.label ?? status;
  }

  protected rideBadge(status: RideStatus): string {
    return RIDE_BADGES[RIDE_STATUSES[status]?.css] ?? 'badge-aucun';
  }

  protected ticketLabel(t: ClientTicket): string {
    return (TICKET_STATUSES as Record<string, { label: string }>)[t.status]?.label ?? t.status;
  }

  protected ticketBadge(t: ClientTicket): string {
    return TICKET_BADGES[(TICKET_STATUSES as Record<string, { css: string }>)[t.status]?.css] ?? 'badge-aucun';
  }

  protected ticketCategory(t: ClientTicket): string {
    return t.category ? TICKET_CATEGORIES[t.category] ?? t.category : 'Réclamation';
  }

  // ─── Liste ─────────────────────────────────────────────────────────────────

  protected onSearch(value: string): void {
    this.search.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.currentPage.set(1);
      this.load();
    }, SEARCH_DELAY_MS);
  }

  protected setStatus(value: string): void {
    this.status.set(value as ClientStatus | '');
    this.currentPage.set(1);
    this.load();
  }

  protected setPageSize(value: string): void {
    this.pageSize.set(Number(value));
    this.currentPage.set(1);
    this.load();
  }

  protected goTo(page: number): void {
    if (page < 1 || page > this.totalPages() || page === this.currentPage()) return;
    this.currentPage.set(page);
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
          this.clients.set(res.items);
          this.total.set(res.total);
          this.loading.set(false);
        },
        error: err => {
          if (seq !== this.listSeq) return;
          this.loading.set(false);
          this.error.set(this.message(err, 'Impossible de charger les clients.'));
        }
      });
  }

  private loadCounts(): void {
    forkJoin({
      all: this.service.list({ page: 1, pageSize: 1 }).pipe(map(r => r.total)),
      blocked: this.service.list({ page: 1, pageSize: 1, status: 'BLOCKED' }).pipe(map(r => r.total))
    }).subscribe({
      next: ({ all, blocked }) => this.counts.set({ all, blocked }),
      error: () => this.counts.set(null)
    });
  }

  // ─── Volet client ──────────────────────────────────────────────────────────

  protected selectClient(id: string): void {
    if (this.selectedId() === id) this.closeSlide();
    else this.openClient(id);
  }

  private openClient(id: string): void {
    this.selectedId.set(id);
    this.revealedPhone.set(null);
    this.notice.set('');
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
        this.detailError.set(this.message(err, 'Impossible de charger la fiche du client.'));
      }
    });
  }

  protected closeSlide(): void {
    this.selectedId.set(null);
    this.detail.set(null);
  }

  // ─── Actions ───────────────────────────────────────────────────────────────

  protected openAction(action: ClientAction): void {
    this.action.set(action);
    this.reason.set('');
    this.actionError.set('');
    this.notice.set('');
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

    if (action === 'reveal') {
      this.run(this.service.revealPhone(d.id, reason), res => {
        this.revealedPhone.set(res.phone);
        return '';
      });
      return;
    }
    const request = action === 'block' ? this.service.block(d.id, reason) : this.service.unblock(d.id, reason);
    this.run(request, res => {
      this.detail.update(cur => (cur?.id === res.id ? { ...cur, status: res.status } : cur));
      this.clients.update(list => list.map(c => (c.id === res.id ? { ...c, status: res.status } : c)));
      this.loadCounts();
      return res.status === 'BLOCKED' ? 'Compte bloqué : le client a été déconnecté.' : 'Compte débloqué.';
    });
  }

  private run<T>(request: Observable<T>, done: (res: T) => string): void {
    this.busy.set(true);
    this.actionError.set('');
    request.subscribe({
      next: res => {
        this.busy.set(false);
        this.action.set(null);
        this.notice.set(done(res));
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
