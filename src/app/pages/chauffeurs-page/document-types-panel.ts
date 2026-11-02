import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { DocumentType, DocumentTypePatch, DriversService } from './drivers.service';

const STEPS: { n: 2 | 3; label: string }[] = [
  { n: 2, label: 'Vos documents' },
  { n: 3, label: 'Votre véhicule' }
];

interface TypeForm {
  code: string;
  label: string;
  instruction: string;
  step: 2 | 3;
  required: boolean;
  needsExpiry: boolean;
  sortOrder: string;
  active: boolean;
}

@Component({
  selector: 'app-document-types-panel',
  templateUrl: './document-types-panel.html',
  styleUrls: ['./chauffeurs-shared.css', './document-types-panel.css']
})
export class DocumentTypesPanel implements OnInit {
  private readonly service = inject(DriversService);

  /** Admin uniquement. */
  readonly canEdit = input(false);

  protected readonly steps = STEPS;
  protected readonly types = signal<DocumentType[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly showInactive = signal(false);

  /** null = fenêtre fermée ; `editing` null = ajout. */
  protected readonly dialogOpen = signal(false);
  protected readonly editing = signal<DocumentType | null>(null);
  protected readonly form = signal<TypeForm>(this.emptyForm());
  protected readonly reason = signal('');
  protected readonly dialogError = signal('');
  protected readonly busy = signal(false);

  protected readonly byStep = computed(() => {
    const visible = this.types().filter(t => t.active || this.showInactive());
    return STEPS.map(s => ({ ...s, types: visible.filter(t => t.step === s.n).sort((a, b) => a.sortOrder - b.sortOrder) }));
  });
  protected readonly inactiveCount = computed(() => this.types().filter(t => !t.active).length);

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set('');
    this.service.documentTypes().subscribe({
      next: list => {
        this.types.set(list);
        this.loading.set(false);
      },
      error: err => {
        this.loading.set(false);
        this.error.set(this.message(err, 'Impossible de charger les types de pièces.'));
      }
    });
  }

  protected openCreate(): void {
    this.editing.set(null);
    this.form.set(this.emptyForm());
    this.openDialog();
  }

  protected openEdit(t: DocumentType): void {
    this.editing.set(t);
    this.form.set({ ...t, sortOrder: String(t.sortOrder) });
    this.openDialog();
  }

  protected setField<K extends keyof TypeForm>(key: K, value: TypeForm[K]): void {
    this.form.update(f => ({ ...f, [key]: value }));
  }

  protected closeDialog(): void {
    if (!this.busy()) this.dialogOpen.set(false);
  }

  protected submit(): void {
    const f = this.form();
    const reason = this.reason().trim();
    const label = f.label.trim();
    const instruction = f.instruction.trim();
    if (!label) return this.dialogError.set('Le libellé est obligatoire.');
    if (!instruction) return this.dialogError.set('La consigne est obligatoire.');
    const sortOrder = f.sortOrder.trim() === '' ? undefined : Number(f.sortOrder);
    if (sortOrder !== undefined && !Number.isInteger(sortOrder)) return this.dialogError.set("L'ordre doit être un nombre entier.");
    if (!reason) return this.dialogError.set('Le motif est obligatoire.');

    const current = this.editing();
    let request: Observable<unknown>;
    let done: string;
    if (current) {
      // N'envoie que ce qui change, pour un journal d'audit lisible.
      const patch: DocumentTypePatch = { reason };
      if (label !== current.label) patch.label = label;
      if (instruction !== current.instruction) patch.instruction = instruction;
      if (f.step !== current.step) patch.step = f.step;
      if (f.required !== current.required) patch.required = f.required;
      if (f.needsExpiry !== current.needsExpiry) patch.needsExpiry = f.needsExpiry;
      if (sortOrder !== undefined && sortOrder !== current.sortOrder) patch.sortOrder = sortOrder;
      if (f.active !== current.active) patch.active = f.active;
      if (Object.keys(patch).length === 1) return this.dialogError.set('Aucune modification.');
      request = this.service.updateDocumentType(current.code, patch);
      done = `« ${label} » modifié.`;
    } else {
      const code = f.code.trim().toUpperCase();
      if (!/^[A-Z0-9_]{2,40}$/.test(code)) return this.dialogError.set('Le code : majuscules, chiffres et _ uniquement (ex. RESIDENCE_CERTIFICATE).');
      if (this.types().some(t => t.code === code)) return this.dialogError.set('Ce code existe déjà.');
      request = this.service.createDocumentType({ code, label, instruction, step: f.step, required: f.required, needsExpiry: f.needsExpiry, sortOrder, reason });
      done = `« ${label} » ajouté : il apparaît aussitôt dans l'inscription des chauffeurs.`;
    }

    this.busy.set(true);
    this.dialogError.set('');
    request.subscribe({
      next: () => {
        this.busy.set(false);
        this.dialogOpen.set(false);
        this.notice.set(done);
        this.load();
      },
      error: err => {
        this.busy.set(false);
        this.dialogError.set(this.message(err, "L'enregistrement a échoué."));
      }
    });
  }

  private openDialog(): void {
    this.reason.set('');
    this.dialogError.set('');
    this.notice.set('');
    this.dialogOpen.set(true);
  }

  private emptyForm(): TypeForm {
    return { code: '', label: '', instruction: '', step: 2, required: false, needsExpiry: false, sortOrder: '', active: true };
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
