import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import {
  CommissionException,
  NewCommissionRule,
  TariffCategory,
  TariffHistoryItem,
  TariffsOverview,
  TariffsService,
  UpdateTariffsBody
} from './tariffs.service';

type Dialog =
  | { kind: 'save' }
  | { kind: 'add' }
  | { kind: 'delete'; rule: CommissionException }
  | { kind: 'category'; category: TariffCategory };

@Component({
  selector: 'app-tarification-page',
  imports: [DatePipe, DecimalPipe],
  templateUrl: './tarification-page.html',
  styleUrl: './tarification-page.css'
})
export class TarificationPage implements OnInit {
  private readonly service = inject(TariffsService);

  protected readonly overview = signal<TariffsOverview | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');

  protected readonly history = signal<TariffHistoryItem[]>([]);
  protected readonly historyTotal = signal(0);
  protected readonly historyLoading = signal(false);
  protected readonly page = signal(1);
  protected readonly pageSize = signal(10);
  protected readonly search = signal('');

  protected readonly pageSizes = [10, 25, 50];
  protected readonly lastPage = computed(() => Math.max(1, Math.ceil(this.historyTotal() / this.pageSize())));
  protected readonly rangeStart = computed(() => (this.historyTotal() === 0 ? 0 : (this.page() - 1) * this.pageSize() + 1));
  protected readonly rangeEnd = computed(() => Math.min(this.page() * this.pageSize(), this.historyTotal()));

  /** La recherche porte sur la page d'historique affichée. */
  protected readonly visibleHistory = computed(() => {
    const q = this.search().trim().toLowerCase();
    if (!q) return this.history();
    return this.history().filter(h => [h.by, h.change, h.reason ?? ''].some(v => v.toLowerCase().includes(q)));
  });

  /** Taux par défaut saisi (la modification est enregistrée avec un motif). */
  protected readonly rateDraft = signal('');
  protected readonly rateChanged = computed(() => {
    const data = this.overview();
    const value = Number(this.rateDraft().replace(',', '.'));
    return !!data && this.rateDraft().trim() !== '' && value !== data.commission.defaultRate;
  });

  /** Zone dont on affiche et modifie les prix (null = tarif par défaut). */
  protected readonly zoneId = signal<string | null>(null);
  /** Prix saisis : code de catégorie → clé de ligne → texte. */
  protected readonly priceDraft = signal<Record<string, Record<string, string>>>({});

  /** Catégories dont au moins un prix diffère de la valeur en vigueur, avec toutes leurs valeurs. */
  protected readonly changedPrices = computed(() => {
    const data = this.overview();
    const draft = this.priceDraft();
    const result: Record<string, Record<string, number>> = {};
    if (!data) return result;
    for (const category of data.tariffs.categories) {
      const values: Record<string, number> = {};
      let changed = false;
      for (const row of data.tariffs.rows) {
        const current = row.values[category.code];
        const typed = this.parsePrice(draft[category.code]?.[row.key] ?? '');
        values[row.key] = typed ?? current;
        if (typed !== null && typed !== current) changed = true;
      }
      if (changed) result[category.code] = values;
    }
    return result;
  });

  protected readonly hasInvalidPrice = computed(() =>
    Object.values(this.priceDraft()).some(rows => Object.values(rows).some(v => this.parsePrice(v) === null))
  );

  protected readonly changedCategories = computed(() => {
    const names = new Map((this.overview()?.tariffs.categories ?? []).map(c => [c.code, c.name]));
    return Object.keys(this.changedPrices()).map(code => names.get(code) ?? code);
  });

  protected readonly dirty = computed(() => this.rateChanged() || Object.keys(this.changedPrices()).length > 0);

  protected readonly dialog = signal<Dialog | null>(null);
  protected readonly reason = signal('');
  protected readonly dialogError = signal('');
  protected readonly busy = signal(false);
  protected readonly notice = signal('');

  /** Formulaire « Ajouter une exception ». */
  protected readonly addScope = signal('CATEGORY');
  protected readonly addCategory = signal('');
  protected readonly addZone = signal('');
  protected readonly addDays = signal('30');
  protected readonly addRate = signal('');
  protected readonly addFrom = signal('');
  protected readonly addTo = signal('');

  protected readonly scopes = [
    { code: 'CATEGORY', label: 'Catégorie de véhicule' },
    { code: 'NEW_DRIVERS', label: 'Nouveaux chauffeurs' },
    { code: 'ZONE', label: 'Zone' }
  ];

  protected readonly zones = computed(() => (this.overview()?.zones ?? []).filter(z => z.id !== null));

  ngOnInit(): void {
    this.loadOverview();
    this.loadHistory();
  }

  private loadOverview(): void {
    this.service.overview(this.zoneId()).subscribe({
      next: data => {
        this.applyOverview(data);
        this.loading.set(false);
      },
      error: err => {
        this.error.set(this.message(err));
        this.loading.set(false);
      }
    });
  }

  /** Affiche l'écran renvoyé par l'API et remet les champs de saisie à ses valeurs. */
  private applyOverview(data: TariffsOverview): void {
    this.overview.set(data);
    this.zoneId.set(data.tariffs.zone.id);
    this.rateDraft.set(String(data.commission.defaultRate));
    const draft: Record<string, Record<string, string>> = {};
    for (const category of data.tariffs.categories) {
      draft[category.code] = {};
      for (const row of data.tariffs.rows) draft[category.code][row.key] = String(row.values[category.code] ?? '');
    }
    this.priceDraft.set(draft);
  }

  protected selectZone(id: string): void {
    this.zoneId.set(id || null);
    this.notice.set('');
    this.loadOverview();
  }

  protected setPrice(code: string, key: string, value: string): void {
    this.priceDraft.update(draft => ({ ...draft, [code]: { ...draft[code], [key]: value } }));
  }

  protected isPriceChanged(code: string, key: string, current: number): boolean {
    const typed = this.parsePrice(this.priceDraft()[code]?.[key] ?? '');
    return typed !== null && typed !== current;
  }

  protected openSave(): void {
    this.openDialog({ kind: 'save' });
  }

  protected openDelete(rule: CommissionException): void {
    this.openDialog({ kind: 'delete', rule });
  }

  protected openCategory(category: TariffCategory): void {
    this.openDialog({ kind: 'category', category });
  }

  protected openAdd(): void {
    const data = this.overview();
    this.addScope.set('CATEGORY');
    this.addCategory.set(data?.tariffs.categories[0]?.code ?? '');
    this.addZone.set(this.zones()[0]?.id ?? '');
    this.addDays.set('30');
    this.addRate.set('');
    this.addFrom.set('');
    this.addTo.set('');
    this.openDialog({ kind: 'add' });
  }

  protected closeDialog(): void {
    if (this.busy()) return;
    this.dialog.set(null);
  }

  private openDialog(dialog: Dialog): void {
    this.reason.set('');
    this.dialogError.set('');
    this.dialog.set(dialog);
  }

  protected submit(): void {
    const dialog = this.dialog();
    if (!dialog) return;
    const reason = this.reason().trim();
    if (!reason) {
      this.dialogError.set('Le motif est obligatoire.');
      return;
    }

    let request: Observable<unknown>;
    let done: string;
    let reloadOverview = true;
    switch (dialog.kind) {
      case 'delete':
        request = this.service.endCommissionRule(dialog.rule.id, reason);
        done = 'Exception terminée.';
        break;
      case 'category':
        request = this.service.setCategoryActive(dialog.category.code, !dialog.category.active, reason);
        done = dialog.category.active ? 'Catégorie désactivée.' : 'Catégorie activée.';
        break;
      case 'save': {
        const body: UpdateTariffsBody = { reason };
        if (this.rateChanged()) {
          const rate = this.parseRate(this.rateDraft());
          if (rate === null) return this.dialogError.set('Le taux doit être compris entre 0 et 100.');
          body.defaultCommissionRate = rate;
        }
        if (this.hasInvalidPrice()) return this.dialogError.set('Les prix doivent être des nombres positifs.');
        if (Object.keys(this.changedPrices()).length) body.prices = this.changedPrices();
        if (this.zoneId()) body.zoneId = this.zoneId()!;
        reloadOverview = false;
        request = this.service.save(body).pipe(
          tap(res => {
            this.applyOverview(res);
            done = res.changes.join('\n');
          })
        );
        done = 'Modifications enregistrées.';
        break;
      }
      default: {
        const body = this.buildException(reason);
        if (typeof body === 'string') return this.dialogError.set(body);
        request = this.service.createCommissionRule(body);
        done = 'Exception ajoutée.';
      }
    }

    this.dialogError.set('');
    this.busy.set(true);
    request.subscribe({
      next: () => {
        this.busy.set(false);
        this.dialog.set(null);
        this.notice.set(done);
        this.error.set('');
        if (reloadOverview) this.loadOverview();
        this.page.set(1);
        this.loadHistory();
      },
      error: err => {
        this.busy.set(false);
        this.dialogError.set(this.apiMessage(err));
      }
    });
  }

  private parsePrice(value: string): number | null {
    const price = Number(value.replace(',', '.'));
    return value.trim() !== '' && Number.isFinite(price) && price >= 0 ? price : null;
  }

  private parseRate(value: string): number | null {
    const rate = Number(value.replace(',', '.'));
    return value.trim() !== '' && Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : null;
  }

  /** Corps de la requête, ou le message d'erreur à afficher si le formulaire est incomplet. */
  private buildException(reason: string): NewCommissionRule | string {
    const rate = this.parseRate(this.addRate());
    if (rate === null) return 'Le taux doit être compris entre 0 et 100.';
    const scope = this.addScope();
    const body: NewCommissionRule = { reason, scope, rate };

    if (scope === 'CATEGORY') {
      if (!this.addCategory()) return 'Choisissez une catégorie.';
      body.category = this.addCategory();
    } else if (scope === 'ZONE') {
      if (!this.addZone()) return 'Choisissez une zone.';
      body.zoneId = this.addZone();
    } else {
      const days = Number(this.addDays());
      if (!Number.isInteger(days) || days < 1) return 'Indiquez une durée en jours.';
      body.newDriverDays = days;
    }

    if (this.addFrom()) body.validFrom = `${this.addFrom()}T00:00:00.000Z`;
    if (this.addTo()) body.validTo = `${this.addTo()}T23:59:59.000Z`;
    if (this.addFrom() && this.addTo() && this.addTo() < this.addFrom()) {
      return 'La fin doit être postérieure au début.';
    }
    return body;
  }

  private apiMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) return 'Impossible de joindre le serveur.';
      const message = (err.error as { message?: string | string[] } | null)?.message;
      if (Array.isArray(message) && message.length) return message.join(' ');
      if (typeof message === 'string' && message) return message;
      if (err.status === 403) return "Vous n'avez pas les droits pour cette action.";
    }
    return "L'opération a échoué.";
  }

  protected loadHistory(): void {
    this.historyLoading.set(true);
    this.service.history(this.page(), this.pageSize()).subscribe({
      next: res => {
        this.history.set(res.items);
        this.historyTotal.set(res.total);
        this.historyLoading.set(false);
      },
      error: err => {
        this.error.set(this.message(err));
        this.historyLoading.set(false);
      }
    });
  }

  protected goTo(page: number): void {
    this.page.set(Math.min(Math.max(1, page), this.lastPage()));
    this.loadHistory();
  }

  protected setPageSize(size: number): void {
    this.pageSize.set(size);
    this.page.set(1);
    this.loadHistory();
  }

  protected formatValue(value: number | undefined, unit: string): string {
    if (value === undefined) return '—';
    return unit === '×' ? String(value).replace('.', ',') : String(value);
  }

  private message(err: unknown): string {
    if (err instanceof HttpErrorResponse && err.status === 0) return 'Impossible de joindre le serveur.';
    return 'Impossible de charger les tarifs.';
  }
}
