import { HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DriversService, WalletDetail, WalletEntry } from './drivers.service';

const ENTRY_TYPES: Record<string, string> = {
  ADJUSTMENT: 'Ajustement Seddo',
  TOPUP: 'Rechargement',
  COMMISSION: 'Commission',
  CASH_COMMISSION: 'Commission course espèces',
  HOLD: 'Réservation',
  RELEASE: 'Libération',
  REFUND: 'Remboursement'
};

type Dialog = { kind: 'adjust' } | { kind: 'cash'; block: boolean };

/**
 * Onglet « Portefeuille » de la fiche chauffeur : le disponible couvre les commissions des courses en espèces.
 * La Finance (et l'Admin) ajuste le solde après une réclamation et bloque ou débloque les espèces.
 */
@Component({
  selector: 'app-driver-wallet',
  imports: [DatePipe],
  templateUrl: './driver-wallet.html',
  styleUrls: ['./chauffeurs-shared.css', './driver-wallet.css']
})
export class DriverWallet {
  private readonly service = inject(DriversService);

  readonly driverId = input.required<string>();
  /** Ajustement et blocage : Admin et Finance ; les autres rôles consultent. */
  readonly canManage = input(false);

  protected readonly wallet = signal<WalletDetail | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');

  protected readonly dialog = signal<Dialog | null>(null);
  protected readonly direction = signal<'credit' | 'debit'>('credit');
  protected readonly amount = signal('');
  protected readonly reason = signal('');
  protected readonly dialogError = signal('');
  protected readonly busy = signal(false);

  constructor() {
    effect(() => {
      const id = this.driverId();
      untracked(() => this.load(id));
    });
  }

  protected load(id = this.driverId()): void {
    this.loading.set(true);
    this.error.set('');
    this.service.wallet(id).subscribe({
      next: w => {
        if (id !== this.driverId()) return;
        this.wallet.set(w);
        this.loading.set(false);
      },
      error: err => {
        if (id !== this.driverId()) return;
        this.loading.set(false);
        this.error.set(
          err instanceof HttpErrorResponse && err.status === 404
            ? "Ce chauffeur n'a pas encore de portefeuille."
            : this.message(err, 'Impossible de charger le portefeuille.')
        );
      }
    });
  }

  protected money(value: number): string {
    return `${value.toLocaleString('fr-FR')} F`;
  }

  protected signed(value: number): string {
    return `${value > 0 ? '+' : value < 0 ? '−' : ''}${this.money(Math.abs(value))}`;
  }

  protected entryType(entry: WalletEntry): string {
    return ENTRY_TYPES[entry.type] ?? entry.type;
  }

  protected entryRef(entry: WalletEntry): string | null {
    return entry.ride?.ref ?? entry.ride?.id ?? entry.topup?.ref ?? entry.topup?.id ?? null;
  }

  protected openAdjust(): void {
    this.direction.set('credit');
    this.amount.set('');
    this.open({ kind: 'adjust' });
  }

  protected openCash(block: boolean): void {
    this.open({ kind: 'cash', block });
  }

  private open(dialog: Dialog): void {
    this.reason.set('');
    this.dialogError.set('');
    this.notice.set('');
    this.dialog.set(dialog);
  }

  protected close(): void {
    if (!this.busy()) this.dialog.set(null);
  }

  /** Montant saisi, signé selon crédit ou débit ; null si invalide. */
  protected signedAmount(): number | null {
    const n = Number(this.amount().replace(/\s/g, '').replace(',', '.'));
    if (!this.amount().trim() || !Number.isInteger(n) || n <= 0) return null;
    return this.direction() === 'credit' ? n : -n;
  }

  protected submit(): void {
    const dialog = this.dialog();
    if (!dialog) return;
    const reason = this.reason().trim();
    const id = this.driverId();
    let request;
    let done: string;
    if (dialog.kind === 'adjust') {
      const amount = this.signedAmount();
      if (amount === null) return this.dialogError.set('Saisissez un montant entier positif en F CFA.');
      if (!reason) return this.dialogError.set('Le motif est obligatoire.');
      request = this.service.adjustWallet(id, amount, reason);
      done = `Portefeuille ${amount > 0 ? 'crédité' : 'débité'} de ${this.money(Math.abs(amount))}.`;
    } else {
      if (!reason) return this.dialogError.set('Le motif est obligatoire.');
      request = this.service.setCashBlocked(id, dialog.block, reason);
      done = dialog.block ? 'Courses en espèces bloquées pour ce chauffeur.' : 'Courses en espèces débloquées.';
    }

    this.busy.set(true);
    this.dialogError.set('');
    request.subscribe({
      next: w => {
        this.busy.set(false);
        this.dialog.set(null);
        this.wallet.set(w);
        this.notice.set(done);
      },
      error: err => {
        this.busy.set(false);
        this.dialogError.set(this.message(err, "L'opération a échoué."));
      }
    });
  }

  private message(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) return 'Impossible de joindre le serveur.';
      if (err.status === 403) return "Vous n'avez pas les droits pour cette action.";
      const message = (err.error as { message?: string | string[] } | null)?.message;
      if (Array.isArray(message) && message.length) return message.join(' ');
      if (typeof message === 'string' && message) return message;
    }
    return fallback;
  }
}
