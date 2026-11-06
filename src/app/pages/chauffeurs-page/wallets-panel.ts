import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnDestroy, OnInit, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { driverName, DriversService, WalletFilter, WalletListItem } from './drivers.service';

/** Liste des portefeuilles (menu Portefeuilles) ; un clic ouvre la fiche portefeuille du chauffeur. */
@Component({
  selector: 'app-wallets-panel',
  imports: [DatePipe],
  templateUrl: './wallets-panel.html',
  styleUrls: ['./chauffeurs-shared.css', './wallets-panel.css']
})
export class WalletsPanel implements OnInit, OnDestroy {
  private readonly service = inject(DriversService);

  readonly openWallet = output<WalletListItem>();

  protected readonly wallets = signal<WalletListItem[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly filter = signal<WalletFilter | ''>('');
  protected readonly search = signal('');

  protected readonly filters: { code: WalletFilter | ''; label: string }[] = [
    { code: '', label: 'Tous' },
    { code: 'below_reserve', label: 'Sous la réserve' },
    { code: 'blocked', label: 'Espèces bloquées' }
  ];

  /** Totaux de la liste affichée. */
  protected readonly totals = computed(() =>
    this.wallets().reduce((t, w) => ({ balance: t.balance + w.balance, reserved: t.reserved + w.reserved }), { balance: 0, reserved: 0 })
  );

  private searchTimer?: ReturnType<typeof setTimeout>;
  private seq = 0;

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    clearTimeout(this.searchTimer);
  }

  protected name(w: WalletListItem): string {
    return driverName(w) || 'Chauffeur sans nom';
  }

  protected money(value: number): string {
    return `${value.toLocaleString('fr-FR')} F`;
  }

  protected setFilter(filter: WalletFilter | ''): void {
    this.filter.set(filter);
    this.load();
  }

  protected onSearch(value: string): void {
    this.search.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.load(), 350);
  }

  protected load(): void {
    const seq = ++this.seq;
    this.loading.set(true);
    this.error.set('');
    this.service.wallets({ q: this.search().trim() || undefined, filter: this.filter() || undefined }).subscribe({
      next: list => {
        if (seq !== this.seq) return;
        this.wallets.set(list);
        this.loading.set(false);
      },
      error: err => {
        if (seq !== this.seq) return;
        this.loading.set(false);
        this.error.set(err instanceof HttpErrorResponse && err.status === 0 ? 'Impossible de joindre le serveur.' : 'Impossible de charger les portefeuilles.');
      }
    });
  }
}
