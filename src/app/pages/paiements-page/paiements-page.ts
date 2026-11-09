import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PaymentsService, RefundRequest, RefundStatus, Transaction, TxStatus, TxType } from './payments.service';

const TYPES: Record<TxType, string> = {
  CHARGE: 'Encaissement',
  REFUND: 'Remboursement',
  PAYOUT: 'Versement chauffeur'
};

const STATUSES: Record<TxStatus, { label: string; tone: string }> = {
  PENDING: { label: 'En attente', tone: 'wait' },
  SUCCESS: { label: 'Réussi', tone: 'ok' },
  FAILED: { label: 'Échoué', tone: 'err' },
  EXPIRED: { label: 'Expiré', tone: 'gray' }
};

/** Codes d'échec vus dans l'API ; les autres s'affichent tels quels. */
const FAILURES: Record<string, string> = {
  TIMEOUT: 'Délai de paiement dépassé',
  DECLINED: 'Refusé par le client ou Orange',
  INTOUCH_DEPOSIT_NOT_CONFIGURED: 'Dépôt Orange non configuré'
};

const REFUND_STATUSES: Record<RefundStatus, { label: string; tone: string }> = {
  PENDING: { label: 'À valider', tone: 'wait' },
  APPROVED: { label: 'Validée', tone: 'ok' },
  REJECTED: { label: 'Refusée', tone: 'gray' }
};

const SEARCH_DELAY_MS = 350;
const REFUND_PAGE_SIZE = 20;
/** Export : pages de 100, plafonné à 5 000 lignes. */
const EXPORT_PAGE_SIZE = 100;
const EXPORT_MAX_PAGES = 50;

type Tab = 'transactions' | 'refunds';
/** approve/reject : demande de remboursement ; retry : relance d'un remboursement Orange en échec. */
type Decision = { kind: 'approve' | 'reject'; request: RefundRequest } | { kind: 'retry'; tx: Transaction };

/**
 * Paiements Orange Money : transactions (encaissements, remboursements, versements) avec revérification
 * auprès d'Orange, et demandes de remboursement au-delà du seuil à valider ou refuser.
 */
@Component({
  selector: 'app-paiements-page',
  imports: [DatePipe],
  templateUrl: './paiements-page.html',
  styleUrl: './paiements-page.css'
})
export class PaiementsPage implements OnInit, OnDestroy {
  private readonly service = inject(PaymentsService);

  protected readonly tab = signal<Tab>('transactions');
  protected readonly notice = signal('');

  // ─── Transactions ───
  protected readonly types = Object.entries(TYPES).map(([code, label]) => ({ code: code as TxType, label }));
  protected readonly statuses = Object.entries(STATUSES).map(([code, s]) => ({ code: code as TxStatus, label: s.label }));
  protected readonly pageSizes = [20, 50, 100];

  protected readonly txs = signal<Transaction[]>([]);
  protected readonly txTotal = signal(0);
  protected readonly txPage = signal(1);
  protected readonly txPageSize = signal(20);
  protected readonly search = signal('');
  protected readonly type = signal<TxType | ''>('');
  protected readonly status = signal<TxStatus | ''>('');
  protected readonly txLoading = signal(false);
  protected readonly txError = signal('');
  /** Transaction en cours de revérification. */
  protected readonly rechecking = signal<string | null>(null);
  protected readonly exporting = signal(false);

  protected readonly txPages = computed(() => Math.max(1, Math.ceil(this.txTotal() / this.txPageSize())));
  protected readonly txRange = computed(() => this.rangeLabel(this.txPage(), this.txPageSize(), this.txs().length, this.txTotal()));

  // ─── Demandes de remboursement ───
  protected readonly refundFilters: { code: RefundStatus | ''; label: string }[] = [
    { code: 'PENDING', label: 'À valider' },
    { code: 'APPROVED', label: 'Validées' },
    { code: 'REJECTED', label: 'Refusées' },
    { code: '', label: 'Toutes' }
  ];
  protected readonly refunds = signal<RefundRequest[]>([]);
  protected readonly refundTotal = signal(0);
  protected readonly refundPage = signal(1);
  protected readonly refundStatus = signal<RefundStatus | ''>('PENDING');
  protected readonly refundLoading = signal(false);
  protected readonly refundError = signal('');
  /** Nombre de demandes à valider, pour le badge de l'onglet. */
  protected readonly pendingCount = signal(0);

  protected readonly refundPages = computed(() => Math.max(1, Math.ceil(this.refundTotal() / REFUND_PAGE_SIZE)));
  protected readonly refundRange = computed(() =>
    this.rangeLabel(this.refundPage(), REFUND_PAGE_SIZE, this.refunds().length, this.refundTotal())
  );

  // ─── Fenêtre Valider / Refuser ───
  protected readonly decision = signal<Decision | null>(null);
  protected readonly reason = signal('');
  protected readonly dialogError = signal('');
  protected readonly busy = signal(false);

  private searchTimer?: ReturnType<typeof setTimeout>;
  private txSeq = 0;
  private refundSeq = 0;

  ngOnInit(): void {
    this.loadTransactions();
    this.loadPendingCount();
  }

  ngOnDestroy(): void {
    clearTimeout(this.searchTimer);
  }

  protected setTab(tab: Tab): void {
    this.tab.set(tab);
    this.notice.set('');
    if (tab === 'refunds' && !this.refunds().length && !this.refundLoading()) this.loadRefunds();
  }

  // ─── Transactions ───

  protected loadTransactions(): void {
    const seq = ++this.txSeq;
    this.txLoading.set(true);
    this.txError.set('');
    this.service.transactions({ ...this.txFilters(), page: this.txPage(), pageSize: this.txPageSize() }).subscribe({
      next: res => {
        if (seq !== this.txSeq) return;
        this.txs.set(res.items);
        this.txTotal.set(res.total);
        this.txLoading.set(false);
      },
      error: err => {
        if (seq !== this.txSeq) return;
        this.txLoading.set(false);
        this.txError.set(this.message(err, 'Impossible de charger les transactions.'));
      }
    });
  }

  protected onSearch(value: string): void {
    this.search.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.resetTransactions(), SEARCH_DELAY_MS);
  }

  protected setType(value: string): void {
    this.type.set(value as TxType | '');
    this.resetTransactions();
  }

  protected setStatus(value: string): void {
    this.status.set(value as TxStatus | '');
    this.resetTransactions();
  }

  protected setPageSize(value: string): void {
    this.txPageSize.set(Number(value));
    this.resetTransactions();
  }

  protected goToTx(page: number): void {
    if (page < 1 || page > this.txPages() || page === this.txPage()) return;
    this.txPage.set(page);
    this.loadTransactions();
  }

  protected typeLabel(type: string): string {
    return TYPES[type as TxType] ?? type;
  }

  protected statusLabel(status: string): string {
    return STATUSES[status as TxStatus]?.label ?? status;
  }

  protected statusTone(status: string): string {
    return 'pill pill-' + (STATUSES[status as TxStatus]?.tone ?? 'gray');
  }

  protected failureLabel(code: string): string {
    return FAILURES[code] ?? code;
  }

  /** Revérification : réservée aux encaissements en attente ou expirés (description de l'API). */
  protected canRecheck(t: Transaction): boolean {
    return t.type === 'CHARGE' && (t.status === 'PENDING' || t.status === 'EXPIRED');
  }

  protected recheck(t: Transaction): void {
    this.rechecking.set(t.id);
    this.notice.set('');
    this.txError.set('');
    this.service.recheck(t.id).subscribe({
      next: res => {
        this.rechecking.set(null);
        this.txs.update(list => list.map(x => (x.id === t.id ? { ...x, status: res.status } : x)));
        this.notice.set(
          res.status === res.before
            ? `${t.orderId} : Orange confirme le statut « ${this.statusLabel(res.status)} ».`
            : `${t.orderId} : statut mis à jour, ${this.statusLabel(res.before)} → ${this.statusLabel(res.status)}.`
        );
        // Un encaissement devenu réussi a pu changer d'autres données (course, grand livre) : on recharge.
        if (res.status !== res.before) this.loadTransactions();
      },
      error: err => {
        this.rechecking.set(null);
        this.txError.set(this.message(err, `La revérification de ${t.orderId} a échoué.`));
      }
    });
  }

  /** CSV de toute la sélection (toutes les pages), lisible par Excel (BOM, séparateur ;). */
  protected async exportCsv(): Promise<void> {
    this.exporting.set(true);
    this.txError.set('');
    try {
      const rows: Transaction[] = [];
      for (let page = 1; page <= EXPORT_MAX_PAGES; page++) {
        const res = await firstValueFrom(this.service.transactions({ ...this.txFilters(), page, pageSize: EXPORT_PAGE_SIZE }));
        rows.push(...res.items);
        if (rows.length >= res.total || !res.items.length) break;
      }
      const header = ['Date', 'Type', 'Course', 'Commande', 'Réf. Orange', 'Numéro', 'Montant (F)', 'Statut', 'Motif d’échec', 'Tentatives', 'Retenu', 'Confirmé le'];
      const lines = rows.map(t => [
        new Date(t.createdAt).toLocaleString('fr-FR'),
        this.typeLabel(t.type),
        t.rideRef ?? '',
        t.orderId,
        t.providerRef ?? '',
        t.msisdn ?? '',
        String(t.amount),
        this.statusLabel(t.status),
        t.failureReason ? this.failureLabel(t.failureReason) : '',
        String(t.attempts),
        t.held ? 'Oui' : '',
        t.confirmedAt ? new Date(t.confirmedAt).toLocaleString('fr-FR') : ''
      ]);
      this.download(`paiements-orange-money-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...lines]);
    } catch (err) {
      this.txError.set(this.message(err, 'L’export a échoué.'));
    } finally {
      this.exporting.set(false);
    }
  }

  private resetTransactions(): void {
    this.txPage.set(1);
    this.loadTransactions();
  }

  private txFilters(): { q?: string; type?: TxType; status?: TxStatus } {
    return { q: this.search().trim() || undefined, type: this.type() || undefined, status: this.status() || undefined };
  }

  // ─── Demandes de remboursement ───

  protected loadRefunds(): void {
    const seq = ++this.refundSeq;
    this.refundLoading.set(true);
    this.refundError.set('');
    this.service
      .refundRequests({ page: this.refundPage(), pageSize: REFUND_PAGE_SIZE, status: this.refundStatus() || undefined })
      .subscribe({
        next: res => {
          if (seq !== this.refundSeq) return;
          this.refunds.set(res.items);
          this.refundTotal.set(res.total);
          this.refundLoading.set(false);
          if (this.refundStatus() === 'PENDING') this.pendingCount.set(res.total);
        },
        error: err => {
          if (seq !== this.refundSeq) return;
          this.refundLoading.set(false);
          this.refundError.set(this.message(err, 'Impossible de charger les demandes de remboursement.'));
        }
      });
  }

  protected setRefundStatus(status: RefundStatus | ''): void {
    this.refundStatus.set(status);
    this.refundPage.set(1);
    this.loadRefunds();
  }

  protected goToRefund(page: number): void {
    if (page < 1 || page > this.refundPages() || page === this.refundPage()) return;
    this.refundPage.set(page);
    this.loadRefunds();
  }

  protected refundLabel(status: string): string {
    return REFUND_STATUSES[status as RefundStatus]?.label ?? status;
  }

  protected refundTone(status: string): string {
    return 'pill pill-' + (REFUND_STATUSES[status as RefundStatus]?.tone ?? 'gray');
  }

  protected openDecision(kind: 'approve' | 'reject', request: RefundRequest): void {
    this.openDialog({ kind, request });
  }

  /** Relance : remboursement en échec ; les versements se relancent depuis la page Versements. */
  protected canRetry(t: Transaction): boolean {
    return t.type === 'REFUND' && t.status === 'FAILED' && !t.held;
  }

  protected openRetry(tx: Transaction): void {
    this.openDialog({ kind: 'retry', tx });
  }

  private openDialog(d: Decision): void {
    this.notice.set('');
    this.reason.set('');
    this.dialogError.set('');
    this.decision.set(d);
  }

  protected closeDecision(): void {
    if (!this.busy()) this.decision.set(null);
  }

  protected confirmDecision(): void {
    const d = this.decision();
    if (!d) return;
    const reason = this.reason().trim();
    if (!reason) return this.dialogError.set('Le motif est obligatoire.');
    this.busy.set(true);
    this.dialogError.set('');
    if (d.kind === 'retry') {
      this.service.retry(d.tx.id, reason).subscribe({
        next: () => {
          this.busy.set(false);
          this.decision.set(null);
          this.notice.set(`Remboursement ${d.tx.orderId} relancé auprès d’Orange Money.`);
          this.loadTransactions();
        },
        error: err => {
          this.busy.set(false);
          this.dialogError.set(this.message(err, 'La relance a échoué.'));
        }
      });
      return;
    }
    const call = d.kind === 'approve' ? this.service.approveRefund(d.request.id, reason) : this.service.rejectRefund(d.request.id, reason);
    call.subscribe({
      next: () => {
        this.busy.set(false);
        this.decision.set(null);
        this.notice.set(
          d.kind === 'approve'
            ? `Remboursement de ${this.money(d.request.amount)} validé pour ${d.request.rideRef} : le dépôt Orange Money est ordonné.`
            : `Demande de remboursement de ${d.request.rideRef} refusée.`
        );
        this.loadRefunds();
        this.loadPendingCount();
      },
      error: err => {
        this.busy.set(false);
        // Déjà traitée par quelqu'un d'autre : la liste est périmée, on la recharge.
        if (err instanceof HttpErrorResponse && (err.error as { code?: string } | null)?.code === 'ALREADY_DECIDED') {
          this.decision.set(null);
          // Recharger d'abord : loadRefunds() efface le message d'erreur en démarrant.
          this.loadRefunds();
          this.loadPendingCount();
          this.refundError.set(`La demande de ${d.request.rideRef} a déjà été traitée. La liste est mise à jour.`);
          return;
        }
        this.dialogError.set(this.message(err, 'L’opération a échoué.'));
      }
    });
  }

  private loadPendingCount(): void {
    this.service.refundRequests({ page: 1, pageSize: 1, status: 'PENDING' }).subscribe({
      next: res => this.pendingCount.set(res.total),
      error: () => {}
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

  private download(filename: string, rows: string[][]): void {
    const csv = rows.map(cols => cols.map(c => `"${c.replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    // Révoquer tout de suite peut annuler le téléchargement dans Chrome.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
