import { Component, computed, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';

type TxType = 'CHARGE' | 'REFUND' | 'PAYOUT';
type TxStatus = 'SUCCESS' | 'PENDING' | 'FAILED';

/** Appel à Orange Money ; forme prévue pour la future liste de l'API (pas encore d'endpoint). */
interface Transaction {
  orderId: string;
  type: TxType;
  rideRef: string;
  /** Numéro masqué : « 75 ••• 26 72 ». */
  msisdn: string;
  amount: number;
  status: TxStatus;
  createdAt: string;
}

const TYPES: Record<TxType, string> = {
  CHARGE: 'Encaissement',
  REFUND: 'Remboursement',
  PAYOUT: 'Versement chauffeur'
};

const STATUSES: Record<TxStatus, { label: string; css: string }> = {
  SUCCESS: { label: 'Réussi', css: 'st-ok' },
  PENDING: { label: 'En cours', css: 'st-wait' },
  FAILED: { label: 'Échoué', css: 'st-err' }
};

const PERIODS = [
  { days: 1, label: "Aujourd'hui" },
  { days: 7, label: '7 derniers jours' },
  { days: 30, label: '30 derniers jours' }
];

const SEARCH_DELAY_MS = 250;

@Component({
  selector: 'app-paiements-page',
  imports: [DatePipe, DecimalPipe],
  templateUrl: './paiements-page.html',
  styleUrl: './paiements-page.css'
})
export class PaiementsPage {
  protected readonly types = Object.entries(TYPES).map(([code, label]) => ({ code: code as TxType, label }));
  protected readonly statuses = Object.entries(STATUSES).map(([code, s]) => ({ code: code as TxStatus, label: s.label }));
  protected readonly periods = PERIODS;
  protected readonly pageSizes = [10, 20, 50];
  protected readonly typeLabels = TYPES;

  /** Données d'exemple tant que l'API ne publie pas la liste des transactions. */
  private readonly transactions = sampleTransactions();

  protected readonly search = signal('');
  protected readonly type = signal<TxType | ''>('');
  protected readonly status = signal<TxStatus | ''>('');
  protected readonly periodDays = signal(7);
  protected readonly currentPage = signal(1);
  protected readonly pageSize = signal(10);
  private searchTimer?: ReturnType<typeof setTimeout>;

  protected readonly range = computed(() => {
    const to = new Date();
    const from = new Date(to);
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - (this.periodDays() - 1));
    return { from, to };
  });

  protected readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase().replace(/\s|•/g, '');
    const { from } = this.range();
    return this.transactions.filter(
      t =>
        (!this.type() || t.type === this.type()) &&
        (!this.status() || t.status === this.status()) &&
        new Date(t.createdAt) >= from &&
        (!q || [t.orderId, t.rideRef, t.msisdn].some(v => v.toLowerCase().replace(/\s|•/g, '').includes(q)))
    );
  });

  /** Encaissements moins remboursements et versements réussis. */
  protected readonly netBalance = computed(() =>
    this.filtered()
      .filter(t => t.status === 'SUCCESS')
      .reduce((sum, t) => sum + (t.type === 'CHARGE' ? t.amount : -t.amount), 0)
  );

  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.pageSize())));
  protected readonly rows = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    return this.filtered().slice(start, start + this.pageSize());
  });
  protected readonly pages = computed(() => {
    const last = this.totalPages();
    const start = Math.max(1, Math.min(this.currentPage() - 1, last - 2));
    return Array.from({ length: Math.min(3, last) }, (_, i) => start + i);
  });
  protected readonly rangeLabel = computed(() => {
    const total = this.filtered().length;
    if (!total) return '0 sur 0';
    const start = (this.currentPage() - 1) * this.pageSize() + 1;
    return `${start}–${start + this.rows().length - 1} sur ${total.toLocaleString('fr-FR')}`;
  });

  protected statusInfo(status: TxStatus): { label: string; css: string } {
    return STATUSES[status];
  }

  protected onSearch(value: string): void {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.search.set(value);
      this.currentPage.set(1);
    }, SEARCH_DELAY_MS);
  }

  protected setType(value: string): void {
    this.type.set(value as TxType | '');
    this.currentPage.set(1);
  }

  protected setStatus(value: string): void {
    this.status.set(value as TxStatus | '');
    this.currentPage.set(1);
  }

  protected setPeriod(value: string): void {
    this.periodDays.set(Number(value));
    this.currentPage.set(1);
  }

  protected setPageSize(value: string): void {
    this.pageSize.set(Number(value));
    this.currentPage.set(1);
  }

  protected goTo(page: number): void {
    if (page >= 1 && page <= this.totalPages()) this.currentPage.set(page);
  }

  /** CSV de toute la sélection (pas seulement la page affichée), lisible par Excel (BOM, séparateur ;). */
  protected exportCsv(): void {
    const header = ['Référence Orange', 'Type', 'Course', 'Numéro', 'Montant (F)', 'Statut', 'Date'];
    const lines = this.filtered().map(t => [t.orderId, TYPES[t.type], t.rideRef, t.msisdn, String(t.amount), STATUSES[t.status].label, new Date(t.createdAt).toLocaleString('fr-FR')]);
    const csv = [header, ...lines].map(cols => cols.map(c => `"${c.replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `paiements-orange-money-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    // Révoquer tout de suite peut annuler le téléchargement dans Chrome.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Jeu d'exemple stable (même tirage à chaque chargement), sur les 30 derniers jours. */
function sampleTransactions(): Transaction[] {
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)];
  const prefixes = ['70', '75', '76', '77', '78'];
  const now = Date.now();
  const list: Transaction[] = [];
  let ride = 1850;
  for (let i = 0; i < 240; i++) {
    const createdAt = new Date(now - i * 2.9 * 3_600_000 - Math.floor(rand() * 3_000_000));
    const r = rand();
    const type: TxType = r < 0.52 ? 'CHARGE' : r < 0.95 ? 'PAYOUT' : 'REFUND';
    const s = rand();
    const status: TxStatus = i < 2 && s < 0.5 ? 'PENDING' : s < 0.94 ? 'SUCCESS' : 'FAILED';
    // Un versement est la part chauffeur (environ 80 % du prix), d'où un solde net positif.
    const price = Math.round((1000 + rand() * 4800) / 50) * 50;
    const amount = type === 'CHARGE' ? price : type === 'PAYOUT' ? Math.round((price * 0.8) / 10) * 10 : Math.round(500 + rand() * 2500);
    const pad = (n: number) => String(n).padStart(2, '0');
    const d = createdAt;
    const stamp = `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}.${pad(d.getHours())}${pad(d.getMinutes())}`;
    const hex = Math.floor(rand() * 0xffff).toString(16).toUpperCase().padStart(4, '0');
    list.push({
      orderId: `CI${stamp}.${hex}`,
      type,
      rideRef: `SD-${ride - Math.floor(rand() * 20)}`,
      msisdn: `${pick(prefixes)} ••• ${pad(Math.floor(rand() * 100))} ${pad(Math.floor(rand() * 100))}`,
      amount,
      status,
      createdAt: createdAt.toISOString()
    });
    if (rand() < 0.6) ride--;
  }
  return list;
}
