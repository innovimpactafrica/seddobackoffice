import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { Observable } from 'rxjs';
import {
  BulkRetryResult,
  PaymentsService,
  PayoutMsisdnRequest,
  RefundStatus,
  Transaction,
  TxStatus
} from '../paiements-page/payments.service';

/** Statuts vus côté versement (un versement retenu garde son statut, avec held = true). */
const STATUSES: Record<TxStatus, { label: string; tone: string }> = {
  PENDING: { label: 'En file', tone: 'wait' },
  SUCCESS: { label: 'Versé', tone: 'ok' },
  FAILED: { label: 'Échoué', tone: 'err' },
  EXPIRED: { label: 'Expiré', tone: 'gray' }
};

const FAILURES: Record<string, string> = {
  INTOUCH_DEPOSIT_NOT_CONFIGURED: 'Dépôt Orange non configuré',
  TIMEOUT: 'Délai dépassé côté Orange',
  DECLINED: 'Refusé par Orange'
};

const REQUEST_STATUSES: Record<string, { label: string; tone: string }> = {
  PENDING: { label: 'À valider', tone: 'wait' },
  APPROVED: { label: 'Validée', tone: 'ok' },
  REJECTED: { label: 'Refusée', tone: 'gray' }
};

const SEARCH_DELAY_MS = 350;
const REQUEST_PAGE_SIZE = 20;

type Tab = 'payouts' | 'msisdn';

/** Fenêtre de confirmation commune : toutes les actions demandent un motif. */
interface ActionDialog {
  title: string;
  facts: { label: string; value: string }[];
  text: string;
  confirm: string;
  danger?: boolean;
  run: (reason: string) => Observable<unknown>;
  done: (res: unknown) => void;
}

/** Vue lisible d'une demande de changement de numéro (forme de l'API non encore observée). */
interface MsisdnRow {
  id: string;
  driver: string;
  newMsisdn: string;
  oldMsisdn: string;
  holder: string;
  reason: string;
  requestedBy: string;
  createdAt: string | null;
  decidedAt: string | null;
  status: string;
}

/**
 * Versements chauffeurs : dépôts Orange Money de la part chauffeur après chaque course (transactions PAYOUT),
 * relance des dépôts en échec (un par un ou en groupe), retenue pendant un litige, et validation
 * des changements de numéro de versement.
 */
@Component({
  selector: 'app-versements-page',
  imports: [DatePipe],
  templateUrl: './versements-page.html',
  styleUrl: './versements-page.css'
})
export class VersementsPage implements OnInit, OnDestroy {
  private readonly service = inject(PaymentsService);

  protected readonly tab = signal<Tab>('payouts');
  protected readonly notice = signal('');
  /** Détail des refus d'une relance groupée. */
  protected readonly bulkFailures = signal<string[]>([]);

  // ─── Versements ───
  protected readonly statusFilters: { code: TxStatus | ''; label: string }[] = [
    { code: '', label: 'Tous' },
    { code: 'FAILED', label: 'Échoués' },
    { code: 'PENDING', label: 'En file' },
    { code: 'SUCCESS', label: 'Versés' }
  ];
  protected readonly pageSizes = [20, 50, 100];

  protected readonly payouts = signal<Transaction[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly pageSize = signal(20);
  protected readonly search = signal('');
  protected readonly status = signal<TxStatus | ''>('');
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly counts = signal<{ failed: number | null; pending: number | null; all: number | null }>({ failed: null, pending: null, all: null });
  protected readonly selected = signal<ReadonlySet<string>>(new Set());

  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  protected readonly range = computed(() => this.rangeLabel(this.page(), this.pageSize(), this.payouts().length, this.total()));
  /** Seuls les dépôts en échec et non retenus peuvent être relancés. */
  protected readonly retryable = computed(() => this.payouts().filter(p => this.canRetry(p)));
  protected readonly allSelected = computed(() => this.retryable().length > 0 && this.retryable().every(p => this.selected().has(p.id)));
  protected readonly selectedTotal = computed(() =>
    this.payouts().filter(p => this.selected().has(p.id)).reduce((s, p) => s + p.amount, 0)
  );

  // ─── Changements de numéro ───
  protected readonly requestFilters: { code: RefundStatus | ''; label: string }[] = [
    { code: 'PENDING', label: 'À valider' },
    { code: 'APPROVED', label: 'Validées' },
    { code: 'REJECTED', label: 'Refusées' },
    { code: '', label: 'Toutes' }
  ];
  protected readonly requests = signal<MsisdnRow[]>([]);
  protected readonly requestTotal = signal(0);
  protected readonly requestPage = signal(1);
  protected readonly requestStatus = signal<RefundStatus | ''>('PENDING');
  protected readonly requestLoading = signal(false);
  protected readonly requestError = signal('');
  protected readonly pendingRequests = signal(0);
  protected readonly requestPages = computed(() => Math.max(1, Math.ceil(this.requestTotal() / REQUEST_PAGE_SIZE)));
  protected readonly requestRange = computed(() =>
    this.rangeLabel(this.requestPage(), REQUEST_PAGE_SIZE, this.requests().length, this.requestTotal())
  );

  // ─── Fenêtre ───
  protected readonly dialog = signal<ActionDialog | null>(null);
  protected readonly reason = signal('');
  protected readonly dialogError = signal('');
  protected readonly busy = signal(false);

  private searchTimer?: ReturnType<typeof setTimeout>;
  private seq = 0;
  private requestSeq = 0;

  ngOnInit(): void {
    this.load();
    this.loadCounts();
    this.loadPendingRequests();
  }

  ngOnDestroy(): void {
    clearTimeout(this.searchTimer);
  }

  protected setTab(tab: Tab): void {
    this.tab.set(tab);
    this.notice.set('');
    this.bulkFailures.set([]);
    if (tab === 'msisdn' && !this.requests().length && !this.requestLoading()) this.loadRequests();
  }

  // ─── Versements ───

  protected load(): void {
    const seq = ++this.seq;
    this.loading.set(true);
    this.error.set('');
    this.service
      .transactions({ type: 'PAYOUT', page: this.page(), pageSize: this.pageSize(), q: this.search().trim() || undefined, status: this.status() || undefined })
      .subscribe({
        next: res => {
          if (seq !== this.seq) return;
          this.payouts.set(res.items);
          this.total.set(res.total);
          this.loading.set(false);
          // La sélection ne garde que les lignes encore relançables.
          const ids = new Set(res.items.filter(p => this.canRetry(p)).map(p => p.id));
          this.selected.update(s => new Set([...s].filter(id => ids.has(id))));
        },
        error: err => {
          if (seq !== this.seq) return;
          this.loading.set(false);
          this.error.set(this.message(err, 'Impossible de charger les versements.'));
        }
      });
  }

  /** Compteurs des indicateurs : un appel léger (pageSize=1) par statut. */
  private loadCounts(): void {
    const count = (status: TxStatus | undefined, key: 'failed' | 'pending' | 'all') =>
      this.service.transactions({ type: 'PAYOUT', page: 1, pageSize: 1, status }).subscribe({
        next: res => this.counts.update(c => ({ ...c, [key]: res.total })),
        error: () => {}
      });
    count('FAILED', 'failed');
    count('PENDING', 'pending');
    count(undefined, 'all');
  }

  protected onSearch(value: string): void {
    this.search.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.reset(), SEARCH_DELAY_MS);
  }

  protected setStatus(status: TxStatus | ''): void {
    this.status.set(status);
    this.reset();
  }

  protected setPageSize(value: string): void {
    this.pageSize.set(Number(value));
    this.reset();
  }

  protected goTo(page: number): void {
    if (page < 1 || page > this.pages() || page === this.page()) return;
    this.page.set(page);
    this.load();
  }

  private reset(): void {
    this.page.set(1);
    this.selected.set(new Set());
    this.load();
  }

  protected statusLabel(s: string): string {
    return STATUSES[s as TxStatus]?.label ?? s;
  }

  protected statusTone(s: string): string {
    return 'pill pill-' + (STATUSES[s as TxStatus]?.tone ?? 'gray');
  }

  protected failureLabel(code: string): string {
    return FAILURES[code] ?? code;
  }

  protected canRetry(p: Transaction): boolean {
    return p.status === 'FAILED' && !p.held;
  }

  /** Retenue possible tant que l'argent n'est pas parti. */
  protected canHold(p: Transaction): boolean {
    return !p.held && p.status !== 'SUCCESS';
  }

  protected toggle(id: string): void {
    this.selected.update(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected toggleAll(): void {
    this.selected.set(this.allSelected() ? new Set() : new Set(this.retryable().map(p => p.id)));
  }

  protected askRetry(p: Transaction): void {
    this.open({
      title: 'Relancer le versement',
      facts: this.facts(p),
      text: `Un nouveau dépôt de ${this.money(p.amount)} est envoyé à Orange Money${p.failureReason ? ` (dernier échec : ${this.failureLabel(p.failureReason)})` : ''}.`,
      confirm: 'Relancer',
      run: reason => this.service.retry(p.id, reason),
      done: () => this.afterAction(`Versement ${p.orderId} relancé.`)
    });
  }

  protected askBulkRetry(): void {
    const rows = this.payouts().filter(p => this.selected().has(p.id));
    if (!rows.length) return;
    this.open({
      title: `Relancer ${rows.length} versement${rows.length > 1 ? 's' : ''}`,
      facts: [
        { label: 'Versements', value: String(rows.length) },
        { label: 'Montant total', value: this.money(this.selectedTotal()) }
      ],
      text: 'Un nouveau dépôt Orange Money est envoyé pour chaque versement. Ceux qui ne peuvent pas être relancés sont signalés un par un.',
      confirm: `Relancer ${rows.length}`,
      run: reason => this.service.bulkRetry(rows.map(p => p.id), reason),
      done: res => {
        const r = res as BulkRetryResult;
        const ref = (id: string) => rows.find(p => p.id === id)?.orderId ?? id;
        const failures = (r?.results ?? []).filter(x => !x.ok).map(x => `${ref(x.id)} : ${x.error ?? 'refusé'}`);
        this.selected.set(new Set());
        this.afterAction(`${r?.retried ?? 0} versement${(r?.retried ?? 0) > 1 ? 's' : ''} relancé${(r?.retried ?? 0) > 1 ? 's' : ''} sur ${rows.length}.`);
        this.bulkFailures.set(failures);
      }
    });
  }

  protected askHold(p: Transaction): void {
    this.open({
      title: 'Retenir le versement',
      facts: this.facts(p),
      text: 'Le versement n’est pas déposé tant qu’il est retenu, par exemple pendant une réclamation ou un litige sur la course.',
      confirm: 'Retenir',
      danger: true,
      run: reason => this.service.hold(p.id, reason),
      done: () => this.afterAction(`Versement ${p.orderId} retenu.`)
    });
  }

  protected askRelease(p: Transaction): void {
    this.open({
      title: 'Libérer le versement',
      facts: this.facts(p),
      text: 'Le versement reprend son cours normal.',
      confirm: 'Libérer',
      run: reason => this.service.release(p.id, reason),
      done: () => this.afterAction(`Versement ${p.orderId} libéré.`)
    });
  }

  private facts(p: Transaction): { label: string; value: string }[] {
    return [
      { label: 'Course', value: p.rideRef ?? p.orderId },
      { label: 'Montant', value: this.money(p.amount) },
      { label: 'Numéro', value: p.msisdn ?? '—' },
      { label: 'Tentatives', value: String(p.attempts) }
    ];
  }

  private afterAction(message: string): void {
    this.notice.set(message);
    this.bulkFailures.set([]);
    this.load();
    this.loadCounts();
  }

  // ─── Changements de numéro ───

  protected loadRequests(): void {
    const seq = ++this.requestSeq;
    this.requestLoading.set(true);
    this.requestError.set('');
    this.service
      .payoutMsisdnRequests({ page: this.requestPage(), pageSize: REQUEST_PAGE_SIZE, status: this.requestStatus() || undefined })
      .subscribe({
        next: res => {
          if (seq !== this.requestSeq) return;
          this.requests.set(res.items.map(r => this.toRow(r)));
          this.requestTotal.set(res.total);
          this.requestLoading.set(false);
          if (this.requestStatus() === 'PENDING') this.pendingRequests.set(res.total);
        },
        error: err => {
          if (seq !== this.requestSeq) return;
          this.requestLoading.set(false);
          this.requestError.set(this.message(err, 'Impossible de charger les demandes de changement de numéro.'));
        }
      });
  }

  private loadPendingRequests(): void {
    this.service.payoutMsisdnRequests({ page: 1, pageSize: 1, status: 'PENDING' }).subscribe({
      next: res => this.pendingRequests.set(res.total),
      error: () => {}
    });
  }

  protected setRequestStatus(status: RefundStatus | ''): void {
    this.requestStatus.set(status);
    this.requestPage.set(1);
    this.loadRequests();
  }

  protected goToRequest(page: number): void {
    if (page < 1 || page > this.requestPages() || page === this.requestPage()) return;
    this.requestPage.set(page);
    this.loadRequests();
  }

  protected requestLabel(s: string): string {
    return REQUEST_STATUSES[s]?.label ?? s;
  }

  protected requestTone(s: string): string {
    return 'pill pill-' + (REQUEST_STATUSES[s]?.tone ?? 'gray');
  }

  protected askDecision(kind: 'approve' | 'reject', r: MsisdnRow): void {
    this.open({
      title: kind === 'approve' ? 'Valider le nouveau numéro' : 'Refuser le changement de numéro',
      facts: [
        { label: 'Chauffeur', value: r.driver },
        { label: 'Nouveau numéro', value: r.newMsisdn },
        { label: 'Titulaire', value: r.holder },
        { label: 'Demandé par', value: r.requestedBy }
      ],
      text:
        kind === 'approve'
          ? 'Les prochains versements de ce chauffeur iront sur ce numéro. La validation doit être faite par une autre personne que le demandeur.'
          : 'Le chauffeur garde son numéro de versement actuel.',
      confirm: kind === 'approve' ? 'Valider le numéro' : 'Refuser',
      danger: kind === 'reject',
      run: reason => (kind === 'approve' ? this.service.approvePayoutMsisdn(r.id, reason) : this.service.rejectPayoutMsisdn(r.id, reason)),
      done: () => {
        this.notice.set(kind === 'approve' ? `Nouveau numéro de versement validé pour ${r.driver}.` : `Changement de numéro refusé pour ${r.driver}.`);
        this.loadRequests();
        this.loadPendingRequests();
      }
    });
  }

  /** Lecture tolérante : la forme exacte de la liste n'a pas encore été observée. */
  private toRow(r: PayoutMsisdnRequest): MsisdnRow {
    const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
    const driver = obj(r['driver']);
    const str = (src: Record<string, unknown>, ...keys: string[]) => {
      for (const k of keys) if (typeof src[k] === 'string' && src[k]) return src[k] as string;
      return '';
    };
    const fullName = (src: Record<string, unknown>) => [str(src, 'firstName'), str(src, 'lastName')].filter(Boolean).join(' ');
    return {
      id: r.id,
      driver: str(r, 'driverName') || fullName(r) || str(driver, 'name') || fullName(driver) || str(r, 'driverId') || '—',
      newMsisdn: str(r, 'msisdn', 'newMsisdn', 'requestedMsisdn') || '—',
      oldMsisdn: str(r, 'currentMsisdn', 'oldMsisdn', 'previousMsisdn') || str(driver, 'payoutMsisdn'),
      holder: str(r, 'holderName') || '—',
      reason: str(r, 'reason'),
      requestedBy: str(r, 'requestedBy', 'requestedByName') || '—',
      createdAt: str(r, 'createdAt', 'requestedAt') || null,
      decidedAt: str(r, 'decidedAt') || null,
      status: str(r, 'status') || 'PENDING'
    };
  }

  // ─── Fenêtre ───

  private open(d: ActionDialog): void {
    this.notice.set('');
    this.reason.set('');
    this.dialogError.set('');
    this.dialog.set(d);
  }

  protected closeDialog(): void {
    if (!this.busy()) this.dialog.set(null);
  }

  protected confirmDialog(): void {
    const d = this.dialog();
    if (!d) return;
    const reason = this.reason().trim();
    if (!reason) return this.dialogError.set('Le motif est obligatoire.');
    this.busy.set(true);
    this.dialogError.set('');
    d.run(reason).subscribe({
      next: res => {
        this.busy.set(false);
        this.dialog.set(null);
        d.done(res);
      },
      error: err => {
        this.busy.set(false);
        this.dialogError.set(this.message(err, 'L’opération a échoué.'));
      }
    });
  }

  // ─── Utilitaires ───

  protected money(value: number): string {
    return `${value.toLocaleString('fr-FR')} F`;
  }

  private rangeLabel(page: number, size: number, shown: number, total: number): string {
    if (!total) return '0 sur 0';
    const start = (page - 1) * size + 1;
    return `${start}–${start + shown - 1} sur ${total.toLocaleString('fr-FR')}`;
  }

  private message(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) return 'Impossible de joindre le serveur.';
      const m = (err.error as { message?: string | string[] } | null)?.message;
      if (Array.isArray(m) && m.length) return m.join(' ');
      if (typeof m === 'string' && m) return m;
    }
    return fallback;
  }
}
