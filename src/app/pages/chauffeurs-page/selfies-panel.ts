import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, OnDestroy, OnInit, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { catchError, forkJoin, map, Observable, of } from 'rxjs';
import { DailySelfie, driverName, DriversService, SelfieStatus } from './drivers.service';

const STATUS_TABS: { code: SelfieStatus; label: string }[] = [
  { code: 'PENDING', label: 'À vérifier' },
  { code: 'APPROVED', label: 'Validés' },
  { code: 'REJECTED', label: 'Refusés' }
];

const PAGE_SIZE = 20;

/** Photo affichée dans la comparaison : URL locale, ou message si elle n'a pas pu être chargée. */
interface Photo {
  url: string | null;
  error: string;
}

@Component({
  selector: 'app-selfies-panel',
  imports: [DatePipe],
  templateUrl: './selfies-panel.html',
  styleUrls: ['./chauffeurs-shared.css', './selfies-panel.css']
})
export class SelfiesPanel implements OnInit, OnDestroy {
  private readonly service = inject(DriversService);

  /** Admin et Ops : valider ou refuser. */
  readonly canReview = input(false);
  readonly openDriver = output<string>();

  protected readonly tabs = STATUS_TABS;
  protected readonly status = signal<SelfieStatus>('PENDING');
  protected readonly search = signal('');
  protected readonly page = signal(1);
  protected readonly items = signal<DailySelfie[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');

  protected readonly reviewing = signal<DailySelfie | null>(null);
  protected readonly selfie = signal<Photo | null>(null);
  protected readonly reference = signal<Photo | null>(null);
  protected readonly rejecting = signal(false);
  protected readonly reason = signal('');
  protected readonly reviewError = signal('');
  protected readonly busy = signal(false);

  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));
  private searchTimer?: ReturnType<typeof setTimeout>;
  private seq = 0;

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    clearTimeout(this.searchTimer);
    this.releasePhotos();
  }

  protected name(s: DailySelfie): string {
    return driverName(s) || 'Chauffeur sans nom';
  }

  protected setStatus(status: SelfieStatus): void {
    this.status.set(status);
    this.page.set(1);
    this.load();
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
    if (page < 1 || page > this.totalPages()) return;
    this.page.set(page);
    this.load();
  }

  protected load(): void {
    const seq = ++this.seq;
    this.loading.set(true);
    this.error.set('');
    this.service.selfies({ page: this.page(), pageSize: PAGE_SIZE, status: this.status(), q: this.search().trim() || undefined }).subscribe({
      next: res => {
        if (seq !== this.seq) return;
        this.items.set(res.items);
        this.total.set(res.total);
        this.loading.set(false);
      },
      error: err => {
        if (seq !== this.seq) return;
        this.loading.set(false);
        this.error.set(this.message(err, 'Impossible de charger les selfies.'));
      }
    });
  }

  /** Charge les deux photos à la demande : chaque consultation est tracée au journal d'audit. */
  protected openReview(s: DailySelfie): void {
    this.releasePhotos();
    this.reviewing.set(s);
    this.rejecting.set(false);
    this.reason.set('');
    this.reviewError.set('');
    this.notice.set('');
    this.selfie.set(null);
    this.reference.set(null);
    const photo = (blob$: ReturnType<DriversService['selfieFile']>) =>
      blob$.pipe(
        map((blob): Photo => ({ url: URL.createObjectURL(blob), error: '' })),
        catchError(err => of<Photo>({ url: null, error: this.message(err, 'Photo indisponible.') }))
      );
    forkJoin({
      selfie: photo(this.service.selfieFile(s.id)),
      reference: s.referenceDocumentId ? photo(this.service.selfieReference(s.id)) : of<Photo>({ url: null, error: 'Pas de photo de référence au dossier.' })
    }).subscribe(({ selfie, reference }) => {
      if (this.reviewing()?.id !== s.id) {
        [selfie.url, reference.url].forEach(u => u && URL.revokeObjectURL(u));
        return;
      }
      this.selfie.set(selfie);
      this.reference.set(reference);
    });
  }

  protected closeReview(): void {
    if (this.busy()) return;
    this.reviewing.set(null);
    this.releasePhotos();
  }

  protected approve(): void {
    const s = this.reviewing();
    if (!s) return;
    this.submit(this.service.approveSelfie(s.id), `Selfie de ${this.name(s)} validé.`);
  }

  protected reject(): void {
    const s = this.reviewing();
    if (!s) return;
    const reason = this.reason().trim();
    if (!reason) return this.reviewError.set('Le motif est obligatoire.');
    this.submit(this.service.rejectSelfie(s.id, reason), res =>
      // L'API ne coupe pas une course en cours, et rien à faire si le chauffeur était déjà hors ligne.
      res.driverSetOffline
        ? `Selfie de ${this.name(s)} refusé : le chauffeur est passé hors ligne et doit reprendre un selfie.`
        : `Selfie de ${this.name(s)} refusé : le chauffeur devra reprendre un selfie avant de repasser en ligne (il n'était pas en ligne, ou termine une course).`
    );
  }

  private submit<T>(request: Observable<T>, done: string | ((res: T) => string)): void {
    this.busy.set(true);
    this.reviewError.set('');
    request.subscribe({
      next: res => {
        this.busy.set(false);
        this.reviewing.set(null);
        this.releasePhotos();
        this.notice.set(typeof done === 'string' ? done : done(res));
        this.load();
      },
      error: err => {
        this.busy.set(false);
        const code = (err as HttpErrorResponse)?.error?.code ?? (err as HttpErrorResponse)?.error?.message;
        this.reviewError.set(
          code === 'SELFIE_ALREADY_REVIEWED'
            ? 'Ce selfie a déjà été contrôlé ou remplacé par un nouveau selfie.'
            : this.message(err, "Le contrôle n'a pas pu être enregistré.")
        );
      }
    });
  }

  private releasePhotos(): void {
    for (const p of [this.selfie(), this.reference()]) if (p?.url) URL.revokeObjectURL(p.url);
    this.selfie.set(null);
    this.reference.set(null);
  }

  private message(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) return 'Impossible de joindre le serveur.';
      if (err.status === 403) return 'Votre rôle ne permet pas cette action.';
      if (err.status === 404) return 'Photo introuvable.';
      const body = err.error as { message?: string | string[] } | null;
      if (Array.isArray(body?.message) && body.message.length) return body.message.join(' ');
      if (typeof body?.message === 'string' && body.message) return body.message;
    }
    return fallback;
  }
}
