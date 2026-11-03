import { Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { NewPricingRule, PricingAmounts, PricingRule, TariffsService, TimeSlot } from './tariffs.service';

type GridState = 'current' | 'scheduled' | 'old';
type GridFilter = GridState | 'all';

const GRID_STATES: Record<GridState, { label: string; pill: string }> = {
  current: { label: 'En vigueur', pill: 'pill-green' },
  scheduled: { label: 'Programmée', pill: 'pill-blue' },
  old: { label: 'Remplacée', pill: 'pill-gray' }
};

const DAYS = [
  { n: 1, short: 'Lun' },
  { n: 2, short: 'Mar' },
  { n: 3, short: 'Mer' },
  { n: 4, short: 'Jeu' },
  { n: 5, short: 'Ven' },
  { n: 6, short: 'Sam' },
  { n: 7, short: 'Dim' }
];

const AMOUNT_FIELDS: { key: keyof PricingAmounts; label: string; unit: string }[] = [
  { key: 'baseFare', label: 'Prise en charge', unit: 'F' },
  { key: 'perKm', label: 'Prix par km', unit: 'F' },
  { key: 'perMin', label: 'Prix par minute', unit: 'F' },
  { key: 'minimumFare', label: 'Course minimum', unit: 'F' },
  { key: 'cancelFee', label: "Frais d'annulation", unit: 'F' },
  { key: 'noShowFee', label: "Frais d'absence client", unit: 'F' },
  { key: 'returnFeePerKm', label: 'Retour à vide par km', unit: 'F' },
  { key: 'bookingFee', label: 'Frais de réservation', unit: 'F' }
];

/** Champs du formulaire « Nouvelle grille », en texte tels que saisis. */
interface GridForm {
  zoneId: string;
  category: string;
  label: string;
  slots: TimeSlot[];
  amounts: Record<keyof PricingAmounts, string>;
  surgeMax: string;
  validFrom: string;
  validTo: string;
}

type Dialog = { kind: 'create' } | { kind: 'end'; rule: PricingRule };

/**
 * Grilles tarifaires (pricing-rules) : versions par zone, catégorie et plage horaire.
 * La carte « Tarifs » de la page modifie la grille Standard ; ce panneau montre toutes les versions
 * et permet d'ajouter une grille horaire (Nuit, Week-end…) ou de mettre fin à une grille.
 */
@Component({
  selector: 'app-pricing-rules-panel',
  imports: [DatePipe],
  templateUrl: './pricing-rules-panel.html',
  styleUrls: ['./tarification-shared.css', './pricing-rules-panel.css']
})
export class PricingRulesPanel implements OnInit {
  private readonly service = inject(TariffsService);

  readonly zones = input<{ id: string; name: string }[]>([]);
  readonly categories = input<{ code: string; name: string; active: boolean }[]>([]);
  /** Une grille a été créée ou terminée : la page recharge les tarifs et l'historique. */
  readonly changed = output<void>();

  protected readonly rules = signal<PricingRule[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');

  protected readonly filter = signal<GridFilter>('current');
  /** '' = toutes, 'default' = grille par défaut, sinon id de zone. */
  protected readonly zoneFilter = signal('');
  protected readonly categoryFilter = signal('');

  protected readonly states = GRID_STATES;
  protected readonly days = DAYS;
  protected readonly amountFields = AMOUNT_FIELDS;
  protected readonly filters: { code: GridFilter; label: string }[] = [
    { code: 'current', label: 'En vigueur' },
    { code: 'scheduled', label: 'Programmées' },
    { code: 'old', label: 'Remplacées' },
    { code: 'all', label: 'Toutes' }
  ];

  private readonly byZoneAndCategory = computed(() =>
    this.rules().filter(r => {
      const zone = this.zoneFilter();
      if (zone === 'default' && r.zoneId !== null) return false;
      if (zone && zone !== 'default' && r.zoneId !== zone) return false;
      return !this.categoryFilter() || r.category === this.categoryFilter();
    })
  );

  protected readonly counts = computed(() => {
    const counts: Record<GridFilter, number> = { current: 0, scheduled: 0, old: 0, all: 0 };
    for (const r of this.byZoneAndCategory()) {
      counts[this.state(r)]++;
      counts.all++;
    }
    return counts;
  });

  /** Tri : zone (défaut d'abord), catégorie, grille, puis la plus récente. */
  protected readonly visible = computed(() => {
    const filter = this.filter();
    return this.byZoneAndCategory()
      .filter(r => filter === 'all' || this.state(r) === filter)
      .sort(
        (a, b) =>
          (a.zoneName ?? '').localeCompare(b.zoneName ?? '') ||
          a.category.localeCompare(b.category) ||
          a.label.localeCompare(b.label) ||
          b.validFrom.localeCompare(a.validFrom)
      );
  });

  /** Libellés déjà utilisés, proposés à la saisie. */
  protected readonly labels = computed(() => [...new Set(['Standard', 'Nuit', 'Week-end', ...this.rules().map(r => r.label)])]);

  protected readonly dialog = signal<Dialog | null>(null);
  protected readonly form = signal<GridForm>(this.emptyForm());
  protected readonly reason = signal('');
  protected readonly dialogError = signal('');
  protected readonly busy = signal(false);

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.service.pricingRules().subscribe({
      next: list => {
        this.rules.set(list);
        this.error.set('');
        this.loading.set(false);
      },
      error: err => {
        const offline = err instanceof HttpErrorResponse && err.status === 0;
        this.error.set(offline ? 'Impossible de joindre le serveur.' : 'Impossible de charger les grilles tarifaires.');
        this.loading.set(false);
      }
    });
  }

  protected state(rule: PricingRule): GridState {
    if (rule.current) return 'current';
    const now = Date.now();
    if (new Date(rule.validFrom).getTime() > now && (!rule.validTo || new Date(rule.validTo).getTime() > now)) return 'scheduled';
    return 'old';
  }

  /** Une grille terminée par une date de fin s'affiche « Terminée », une version remplacée « Remplacée ». */
  protected stateLabel(rule: PricingRule): string {
    const state = this.state(rule);
    return state === 'old' && rule.validTo ? 'Terminée' : GRID_STATES[state].label;
  }

  protected categoryName(code: string): string {
    return this.categories().find(c => c.code === code)?.name ?? code;
  }

  protected slotsLabel(slots: TimeSlot[]): string {
    if (!slots.length) return 'Toute la journée';
    return slots.map(s => `${this.daysLabel(s.days)}, ${s.from}–${s.to}`).join(' · ');
  }

  private daysLabel(days: (number | string)[]): string {
    const set = [...new Set(days.map(Number))].sort((a, b) => a - b);
    if (set.length === 7) return 'Tous les jours';
    if (set.join() === '1,2,3,4,5') return 'Lun–Ven';
    if (set.join() === '6,7') return 'Week-end';
    return set.map(n => DAYS[n - 1]?.short ?? n).join(', ');
  }

  protected money(value: number): string {
    return `${value.toLocaleString('fr-FR')} F`;
  }

  protected surge(rule: PricingRule): string {
    return `× ${String(Number(rule.surgeMax)).replace('.', ',')}`;
  }

  protected canEnd(rule: PricingRule): boolean {
    return this.state(rule) !== 'old';
  }

  // ─── Fenêtres ───────────────────────────────────────────────────────────

  protected openCreate(): void {
    const form = this.emptyForm();
    form.category = this.categories().find(c => c.active)?.code ?? this.categories()[0]?.code ?? '';
    form.label = 'Nuit';
    form.slots = [{ days: [1, 2, 3, 4, 5, 6, 7], from: '22:00', to: '06:00' }];
    this.form.set(this.withCurrentAmounts(form));
    this.open({ kind: 'create' });
  }

  protected openEnd(rule: PricingRule): void {
    this.open({ kind: 'end', rule });
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

  protected setField<K extends keyof GridForm>(key: K, value: GridForm[K]): void {
    this.form.update(f => ({ ...f, [key]: value }));
  }

  /** Changer de zone ou de catégorie reprend les montants de la grille en vigueur correspondante. */
  protected setScope(key: 'zoneId' | 'category', value: string): void {
    this.form.update(f => this.withCurrentAmounts({ ...f, [key]: value }));
  }

  protected setAmount(key: keyof PricingAmounts, value: string): void {
    this.form.update(f => ({ ...f, amounts: { ...f.amounts, [key]: value } }));
  }

  protected toggleDay(index: number, day: number): void {
    this.updateSlot(index, s => ({ ...s, days: s.days.includes(day) ? s.days.filter(d => d !== day) : [...s.days, day].sort() }));
  }

  protected setSlotTime(index: number, key: 'from' | 'to', value: string): void {
    this.updateSlot(index, s => ({ ...s, [key]: value }));
  }

  protected addSlot(): void {
    this.form.update(f => ({ ...f, slots: [...f.slots, { days: [6, 7], from: '00:00', to: '23:59' }] }));
  }

  protected removeSlot(index: number): void {
    this.form.update(f => ({ ...f, slots: f.slots.filter((_, i) => i !== index) }));
  }

  private updateSlot(index: number, change: (slot: TimeSlot) => TimeSlot): void {
    this.form.update(f => ({ ...f, slots: f.slots.map((s, i) => (i === index ? change(s) : s)) }));
  }

  protected submit(): void {
    const dialog = this.dialog();
    if (!dialog) return;
    const reason = this.reason().trim();
    if (!reason) return this.dialogError.set('Le motif est obligatoire.');

    let request;
    let done: string;
    if (dialog.kind === 'end') {
      request = this.service.endPricingRule(dialog.rule.id, reason);
      done = `Grille « ${dialog.rule.label} » terminée.`;
    } else {
      const body = this.buildRule(reason);
      if (typeof body === 'string') return this.dialogError.set(body);
      request = this.service.createPricingRule(body);
      done = `Grille « ${body.label} » enregistrée.`;
    }

    this.busy.set(true);
    this.dialogError.set('');
    request.subscribe({
      next: () => {
        this.busy.set(false);
        this.dialog.set(null);
        this.notice.set(done);
        this.load();
        this.changed.emit();
      },
      error: err => {
        this.busy.set(false);
        this.dialogError.set(this.apiMessage(err));
      }
    });
  }

  /** Corps de la requête, ou le message à afficher si le formulaire est incomplet. */
  private buildRule(reason: string): NewPricingRule | string {
    const f = this.form();
    if (!f.category) return 'Choisissez une catégorie.';
    const label = f.label.trim();
    if (!label) return 'Indiquez le nom de la grille (ex. Nuit).';

    const amounts = {} as PricingAmounts;
    for (const field of AMOUNT_FIELDS) {
      const value = this.parseNumber(f.amounts[field.key]);
      if (value === null) return `« ${field.label} » doit être un montant positif.`;
      amounts[field.key] = value;
    }
    const surgeMax = this.parseNumber(f.surgeMax);
    if (surgeMax === null || surgeMax < 1) return 'La majoration maximale doit être au moins de 1.';

    for (const slot of f.slots) {
      if (!slot.days.length) return 'Chaque plage horaire doit avoir au moins un jour.';
      if (!slot.from || !slot.to || slot.from === slot.to) return 'Chaque plage horaire doit avoir une heure de début et de fin différentes.';
    }

    const body: NewPricingRule = { reason, category: f.category, label, timeSlots: f.slots, surgeMax, ...amounts };
    if (f.zoneId) body.zoneId = f.zoneId;
    if (f.validFrom) body.validFrom = new Date(f.validFrom).toISOString();
    if (f.validTo) body.validTo = new Date(f.validTo).toISOString();
    if (f.validFrom && f.validTo && f.validTo <= f.validFrom) return 'La fin doit être postérieure au début.';
    return body;
  }

  private emptyForm(): GridForm {
    const amounts = Object.fromEntries(AMOUNT_FIELDS.map(f => [f.key, ''])) as Record<keyof PricingAmounts, string>;
    return { zoneId: '', category: '', label: '', slots: [], amounts, surgeMax: '1.5', validFrom: '', validTo: '' };
  }

  /** Préremplit les montants avec la grille Standard en vigueur de la zone (sinon par défaut) et de la catégorie. */
  private withCurrentAmounts(form: GridForm): GridForm {
    const current = this.rules().filter(r => r.current && r.category === form.category);
    const source =
      current.find(r => r.zoneId === (form.zoneId || null) && r.label === 'Standard') ??
      current.find(r => r.zoneId === null && r.label === 'Standard');
    if (!source) return form;
    const amounts = Object.fromEntries(AMOUNT_FIELDS.map(f => [f.key, String(source[f.key] ?? '')])) as Record<keyof PricingAmounts, string>;
    return { ...form, amounts, surgeMax: String(Number(source.surgeMax)) };
  }

  private parseNumber(value: string): number | null {
    const n = Number(value.replace(',', '.'));
    return value.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
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
}
