import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, OnDestroy, output, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Dossier, DossierDocument, DocumentType, DriversService } from './drivers.service';

const DOC_STATUS: Record<string, { label: string; css: string }> = {
  PENDING: { label: 'À vérifier', css: 'pill-warn' },
  APPROVED: { label: 'Validée', css: 'pill-on' },
  REJECTED: { label: 'À reprendre', css: 'pill-err' },
  EXPIRED: { label: 'Expirée', css: 'pill-err' }
};

const EXPIRY_WARNING_DAYS = 30;

/** Pièce ouverte dans la visionneuse. */
interface Viewer {
  doc: DossierDocument;
  url: string | null;
  /** PDF : affiché dans un cadre, qui exige une URL marquée sûre. */
  frameUrl: SafeResourceUrl | null;
  error: string;
}

@Component({
  selector: 'app-driver-dossier',
  imports: [DatePipe],
  templateUrl: './driver-dossier.html',
  styleUrls: ['./chauffeurs-shared.css', './driver-dossier.css']
})
export class DriverDossier implements OnDestroy {
  private readonly service = inject(DriversService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly driverId = input.required<string>();
  /** Admin et Ops : contrôler les pièces, fixer le rendez-vous. */
  readonly canReview = input(false);
  /** Le statut du dossier peut avoir changé (pièce refusée → « Pièce à corriger »). */
  readonly changed = output<void>();

  protected readonly dossier = signal<Dossier | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  private readonly types = signal<DocumentType[]>([]);

  protected readonly viewer = signal<Viewer | null>(null);
  protected readonly rejecting = signal(false);
  protected readonly reason = signal('');
  protected readonly reviewError = signal('');
  protected readonly busy = signal(false);

  protected readonly appointmentOpen = signal(false);
  protected readonly fAt = signal('');
  protected readonly fPlace = signal('');
  protected readonly fNote = signal('');
  protected readonly appointmentError = signal('');

  protected readonly documents = computed(() => {
    const order = new Map(this.types().map(t => [t.code, t.sortOrder]));
    return [...(this.dossier()?.documents ?? [])].sort((a, b) => (order.get(a.type) ?? 999) - (order.get(b.type) ?? 999));
  });
  protected readonly toReview = computed(() => this.documents().filter(d => d.status === 'PENDING').length);

  constructor() {
    this.service.documentTypes().subscribe({ next: list => this.types.set(list), error: () => this.types.set([]) });
    effect(() => {
      const id = this.driverId();
      untracked(() => this.load(id));
    });
  }

  ngOnDestroy(): void {
    this.releaseViewer();
  }

  protected typeLabel(code: string, fallback?: string | null): string {
    return this.types().find(t => t.code === code)?.label ?? fallback ?? code;
  }

  protected docStatus(status: string): { label: string; css: string } {
    return DOC_STATUS[status] ?? { label: status, css: '' };
  }

  /** null, 'soon' (moins de 30 jours) ou 'past'. */
  protected expiry(doc: DossierDocument): 'soon' | 'past' | null {
    if (!doc.expiresAt) return null;
    const days = (new Date(doc.expiresAt).getTime() - Date.now()) / 86_400_000;
    return days < 0 ? 'past' : days < EXPIRY_WARNING_DAYS ? 'soon' : null;
  }

  protected load(id = this.driverId()): void {
    this.loading.set(true);
    this.error.set('');
    this.service.dossier(id).subscribe({
      next: d => {
        if (id !== this.driverId()) return;
        this.dossier.set(d);
        this.loading.set(false);
      },
      error: err => {
        if (id !== this.driverId()) return;
        this.loading.set(false);
        this.error.set(this.message(err, 'Impossible de charger le dossier.'));
      }
    });
  }

  // ─── Pièces ────────────────────────────────────────────────────────────────

  /** Le fichier n'est chargé qu'à l'ouverture : chaque consultation est tracée au journal d'audit. */
  protected openDocument(doc: DossierDocument): void {
    this.releaseViewer();
    this.viewer.set({ doc, url: null, frameUrl: null, error: '' });
    this.rejecting.set(false);
    this.reason.set('');
    this.reviewError.set('');
    this.notice.set('');
    this.service.documentFile(this.driverId(), doc.id).subscribe({
      next: blob => {
        if (this.viewer()?.doc.id !== doc.id) return;
        const url = URL.createObjectURL(blob);
        const frameUrl = blob.type === 'application/pdf' ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
        this.viewer.set({ doc, url, frameUrl, error: '' });
      },
      error: err => {
        if (this.viewer()?.doc.id !== doc.id) return;
        this.viewer.set({ doc, url: null, frameUrl: null, error: this.message(err, 'Fichier indisponible.') });
      }
    });
  }

  protected closeDocument(): void {
    if (this.busy()) return;
    this.releaseViewer();
  }

  protected approveDocument(): void {
    const v = this.viewer();
    if (!v) return;
    this.reviewDocument(this.service.approveDocument(this.driverId(), v.doc.id), `Pièce « ${this.typeLabel(v.doc.type, v.doc.label)} » validée.`);
  }

  protected rejectDocument(): void {
    const v = this.viewer();
    if (!v) return;
    const reason = this.reason().trim();
    if (!reason) return this.reviewError.set('Le motif est obligatoire : il est transmis au chauffeur.');
    this.reviewDocument(
      this.service.rejectDocument(this.driverId(), v.doc.id, reason),
      `Pièce « ${this.typeLabel(v.doc.type, v.doc.label)} » refusée : le dossier passe en « Pièce à corriger » et le chauffeur est prévenu.`
    );
  }

  private reviewDocument(request: ReturnType<DriversService['approveDocument']>, done: string): void {
    this.busy.set(true);
    this.reviewError.set('');
    request.subscribe({
      next: () => {
        this.busy.set(false);
        this.releaseViewer();
        this.notice.set(done);
        this.load();
        this.changed.emit();
      },
      error: err => {
        this.busy.set(false);
        this.reviewError.set(this.message(err, "Le contrôle n'a pas pu être enregistré."));
      }
    });
  }

  private releaseViewer(): void {
    const url = this.viewer()?.url;
    if (url) URL.revokeObjectURL(url);
    this.viewer.set(null);
  }

  // ─── Rendez-vous ───────────────────────────────────────────────────────────

  protected openAppointment(): void {
    const f = this.dossier()?.form;
    const preferred = f?.appointmentChangeRequest?.preferredAt;
    this.fAt.set(toLocalInput(preferred ?? f?.appointmentAt ?? null));
    this.fPlace.set(f?.appointmentPlace ?? '');
    this.fNote.set(f?.appointmentNote ?? 'Venir avec le véhicule et les originaux des pièces.');
    this.appointmentError.set('');
    this.notice.set('');
    this.appointmentOpen.set(true);
  }

  protected closeAppointment(): void {
    if (!this.busy()) this.appointmentOpen.set(false);
  }

  protected submitAppointment(): void {
    if (!this.fAt()) return this.appointmentError.set("Choisissez la date et l'heure du rendez-vous.");
    const at = new Date(this.fAt());
    if (at.getTime() <= Date.now()) return this.appointmentError.set('Le rendez-vous doit être dans le futur.');
    this.busy.set(true);
    this.appointmentError.set('');
    this.service
      .setAppointment(this.driverId(), {
        at: at.toISOString(),
        place: this.fPlace().trim() || undefined,
        note: this.fNote().trim() || undefined
      })
      .subscribe({
        next: res => {
          this.busy.set(false);
          this.appointmentOpen.set(false);
          this.notice.set(`Rendez-vous fixé${res.place ? ' à ' + res.place : ''} : le chauffeur est prévenu par SMS.`);
          this.load();
          this.changed.emit();
        },
        error: err => {
          this.busy.set(false);
          this.appointmentError.set(this.message(err, "Le rendez-vous n'a pas pu être enregistré."));
        }
      });
  }

  private message(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) return 'Impossible de joindre le serveur.';
      if (err.status === 403) return 'Votre rôle ne permet pas cette action.';
      if (err.status === 404) return 'Introuvable.';
      const body = err.error as { message?: string | string[] } | null;
      if (Array.isArray(body?.message) && body.message.length) return body.message.join(' ');
      if (typeof body?.message === 'string' && body.message) return body.message;
    }
    return fallback;
  }
}

/** ISO → valeur d'un champ datetime-local (heure locale). */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
