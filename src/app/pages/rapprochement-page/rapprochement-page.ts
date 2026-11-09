import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  MissingTransaction,
  ReconciliationService,
  StatementDetail,
  StatementLine,
  StatementListItem
} from './reconciliation.service';

const PAGE_SIZE = 20;

/** Lignes traitées : tout autre code de correspondance est un écart ouvert. */
const CLOSED = ['MATCHED', 'EXPLAINED', 'REFUNDED'];

const MATCH_LABELS: Record<string, { label: string; tone: 'green' | 'gray' | 'blue' | 'red' }> = {
  MATCHED: { label: 'Rapprochée', tone: 'green' },
  EXPLAINED: { label: 'Expliquée', tone: 'gray' },
  REFUNDED: { label: 'Remboursée', tone: 'blue' },
  UNMATCHED: { label: 'Absente du grand livre', tone: 'red' },
  AMOUNT_MISMATCH: { label: 'Montant différent', tone: 'red' }
};

type LineFilter = 'open' | 'all' | 'matched' | 'closed';
type Dialog = { kind: 'explain' | 'refund'; line: StatementLine };

/**
 * Rapprochement : import du relevé marchand Orange Money (CSV), rapprochement automatique par l'API,
 * puis traitement des écarts ligne par ligne (expliquer ou rembourser). L'URL garde le relevé ouvert (?id=…).
 */
@Component({
  selector: 'app-rapprochement-page',
  imports: [DatePipe],
  templateUrl: './rapprochement-page.html',
  styleUrl: './rapprochement-page.css'
})
export class RapprochementPage implements OnInit, OnDestroy {
  private readonly service = inject(ReconciliationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  // ─── Liste des relevés ───
  protected readonly statements = signal<StatementListItem[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly search = signal('');
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly importing = signal(false);

  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));
  protected readonly range = computed(() => {
    const start = (this.page() - 1) * PAGE_SIZE;
    return this.total() ? `${start + 1}–${start + this.statements().length} sur ${this.total()}` : '0 relevé';
  });
  protected readonly openGapsOnPage = computed(() => this.statements().reduce((n, s) => n + s.openGaps, 0));
  protected readonly lastImport = computed(() => this.statements()[0] ?? null);

  // ─── Détail d'un relevé ───
  protected readonly selectedId = signal<string | null>(null);
  protected readonly detail = signal<StatementDetail | null>(null);
  protected readonly detailLoading = signal(false);
  protected readonly detailError = signal('');
  protected readonly lineFilter = signal<LineFilter>('all');

  protected readonly lineCounts = computed(() => {
    const lines = this.detail()?.lines ?? [];
    return {
      open: lines.filter(l => this.isOpen(l)).length,
      all: lines.length,
      matched: lines.filter(l => l.match === 'MATCHED').length,
      closed: lines.filter(l => l.match === 'EXPLAINED' || l.match === 'REFUNDED').length
    };
  });
  protected readonly visibleLines = computed(() => {
    const lines = this.detail()?.lines ?? [];
    switch (this.lineFilter()) {
      case 'open': return lines.filter(l => this.isOpen(l));
      case 'matched': return lines.filter(l => l.match === 'MATCHED');
      case 'closed': return lines.filter(l => l.match === 'EXPLAINED' || l.match === 'REFUNDED');
      default: return lines;
    }
  });
  /** Nom de l'importateur : le détail ne renvoie que son identifiant, la liste donne son nom. */
  protected readonly importedByName = computed(() => {
    const id = this.selectedId();
    return this.statements().find(s => s.id === id)?.importedBy ?? null;
  });

  protected readonly lineFilters: { code: LineFilter; label: string }[] = [
    { code: 'open', label: 'À traiter' },
    { code: 'all', label: 'Toutes' },
    { code: 'matched', label: 'Rapprochées' },
    { code: 'closed', label: 'Expliquées ou remboursées' }
  ];

  // ─── Fenêtre Expliquer / Rembourser ───
  protected readonly dialog = signal<Dialog | null>(null);
  protected readonly reason = signal('');
  protected readonly dialogError = signal('');
  protected readonly busy = signal(false);

  private searchTimer?: ReturnType<typeof setTimeout>;
  private listSeq = 0;
  private detailSeq = 0;

  ngOnInit(): void {
    this.load();
    const id = this.route.snapshot.queryParamMap.get('id');
    if (id) this.open(id);
  }

  ngOnDestroy(): void {
    clearTimeout(this.searchTimer);
  }

  // ─── Liste ───

  protected load(): void {
    const seq = ++this.listSeq;
    this.loading.set(true);
    this.error.set('');
    this.service.statements({ page: this.page(), pageSize: PAGE_SIZE, q: this.search().trim() || undefined }).subscribe({
      next: res => {
        if (seq !== this.listSeq) return;
        this.statements.set(res.items);
        this.total.set(res.total);
        this.loading.set(false);
      },
      error: err => {
        if (seq !== this.listSeq) return;
        this.loading.set(false);
        this.error.set(this.message(err, 'Impossible de charger les relevés.'));
      }
    });
  }

  protected onSearch(value: string): void {
    this.search.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.page.set(1);
      this.load();
    }, 350);
  }

  protected goTo(page: number): void {
    if (page < 1 || page > this.pageCount() || page === this.page()) return;
    this.page.set(page);
    this.load();
  }

  /** Import du CSV choisi ; ouvre ensuite le relevé créé si l'API renvoie son identifiant. */
  protected onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.importing.set(true);
    this.notice.set('');
    this.error.set('');
    this.service.importStatement(file).subscribe({
      next: res => {
        this.importing.set(false);
        this.notice.set(`Relevé « ${file.name} » importé et rapproché.`);
        this.page.set(1);
        this.load();
        const r = res as { id?: string; statement?: { id?: string } } | null;
        const id = r?.statement?.id ?? r?.id;
        if (typeof id === 'string') this.open(id);
      },
      error: err => {
        this.importing.set(false);
        this.error.set(this.message(err, `Le relevé « ${file.name} » n’a pas pu être importé.`));
      }
    });
  }

  // ─── Détail ───

  protected open(id: string): void {
    this.selectedId.set(id);
    this.detail.set(null);
    this.syncUrl(id);
    this.loadDetail(true);
  }

  protected back(): void {
    this.selectedId.set(null);
    this.detail.set(null);
    this.syncUrl(null);
  }

  protected loadDetail(chooseFilter = false): void {
    const id = this.selectedId();
    if (!id) return;
    const seq = ++this.detailSeq;
    this.detailLoading.set(true);
    this.detailError.set('');
    this.service.statement(id).subscribe({
      next: d => {
        if (seq !== this.detailSeq) return;
        this.detail.set(d);
        this.detailLoading.set(false);
        // À l'ouverture : les écarts d'abord s'il en reste.
        if (chooseFilter) this.lineFilter.set(d.lines.some(l => this.isOpen(l)) ? 'open' : 'all');
      },
      error: err => {
        if (seq !== this.detailSeq) return;
        this.detailLoading.set(false);
        this.detailError.set(this.message(err, 'Impossible de charger ce relevé.'));
      }
    });
  }

  protected isOpen(line: StatementLine): boolean {
    return !CLOSED.includes(line.match);
  }

  protected matchLabel(match: string): string {
    return MATCH_LABELS[match]?.label ?? 'À traiter';
  }

  protected matchTone(match: string): string {
    return 'pill pill-' + (MATCH_LABELS[match]?.tone ?? 'red');
  }

  protected amountDiffers(line: StatementLine): boolean {
    return line.ledgerAmount !== null && line.ledgerAmount !== line.amount;
  }

  /**
   * Rembourser : règle de l'API (409 NOT_REFUNDABLE sinon) — seul un encaissement inconnu
   * (sans transaction Seddo) dont on connaît le numéro client peut être remboursé.
   */
  protected canRefund(line: StatementLine): boolean {
    return this.isOpen(line) && line.direction === 'IN' && !line.transactionId && !!line.msisdn;
  }

  protected direction(d: string): string {
    return d === 'IN' ? 'Encaissement' : d === 'OUT' ? 'Décaissement' : d;
  }

  /** Période du relevé : une seule date si début et fin tombent le même jour. */
  protected samePeriodDay(from: string, to: string): boolean {
    return from.slice(0, 10) === to.slice(0, 10);
  }

  /** Transaction absente du relevé : forme non documentée, on lit les champs usuels. */
  protected missing(tx: MissingTransaction): { date: string | null; ref: string; order: string; type: string; amount: number | null; status: string } {
    const str = (...keys: string[]) => {
      for (const k of keys) if (typeof tx[k] === 'string' && tx[k]) return tx[k] as string;
      return '';
    };
    const amount = tx['amount'];
    return {
      date: str('occurredAt', 'createdAt', 'at') || null,
      ref: str('providerRef', 'reference', 'id') || '—',
      order: str('orderId', 'rideRef', 'ref') || '—',
      type: { CHARGE: 'Encaissement', REFUND: 'Remboursement', PAYOUT: 'Versement' }[str('type')] ?? (str('type') || '—'),
      amount: typeof amount === 'number' ? amount : null,
      status: str('status') || '—'
    };
  }

  // ─── Expliquer / Rembourser ───

  protected openDialog(kind: Dialog['kind'], line: StatementLine): void {
    this.notice.set('');
    this.reason.set('');
    this.dialogError.set('');
    this.dialog.set({ kind, line });
  }

  protected closeDialog(): void {
    if (!this.busy()) this.dialog.set(null);
  }

  protected confirmDialog(): void {
    const d = this.dialog();
    if (!d) return;
    const reason = this.reason().trim();
    if (!reason) return this.dialogError.set(d.kind === 'explain' ? 'Indiquez l’explication de l’écart.' : 'Le motif est obligatoire.');
    this.busy.set(true);
    this.dialogError.set('');
    const call = d.kind === 'explain' ? this.service.explain(d.line.id, reason) : this.service.refund(d.line.id, reason);
    call.subscribe({
      next: () => {
        this.busy.set(false);
        this.dialog.set(null);
        this.notice.set(
          d.kind === 'explain'
            ? `Écart ${d.line.providerRef} expliqué.`
            : `Remboursement de ${this.money(d.line.amount)} ordonné pour ${d.line.providerRef}.`
        );
        this.loadDetail();
        this.load();
      },
      error: err => {
        this.busy.set(false);
        this.dialogError.set(this.message(err, 'L’opération a échoué.'));
      }
    });
  }

  // ─── Utilitaires ───

  protected money(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : `${value.toLocaleString('fr-FR')} F`;
  }

  private syncUrl(id: string | null): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { id }, replaceUrl: true });
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
