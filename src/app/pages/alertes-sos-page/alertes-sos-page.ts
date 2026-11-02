import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { SosAlert, SosService, SosStatus } from './sos.service';

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const REFRESH_MS = 20_000;

const STATUSES: Record<SosStatus, { label: string; open: boolean }> = {
  OPEN: { label: 'Ouverte', open: true },
  ACKNOWLEDGED: { label: 'Prise en charge', open: true },
  RESOLVED: { label: 'Clos', open: false }
};

const PROCEDURE = [
  "Appeler la personne qui a déclenché l'alerte",
  "Appeler l'autre partie",
  "Prévenir le contact d'urgence",
  'Alerter la police (17) si le danger est confirmé'
];

type SosAction = 'acknowledge' | 'resolve';

@Component({
  selector: 'app-alertes-sos-page',
  imports: [],
  templateUrl: './alertes-sos-page.html',
  styleUrl: './alertes-sos-page.css'
})
export class AlertesSosPage implements OnInit, OnDestroy {
  private readonly service = inject(SosService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly platformId = inject(PLATFORM_ID);
  private timer?: ReturnType<typeof setInterval>;
  private seq = 0;

  protected readonly procedure = PROCEDURE;
  protected readonly statusOptions = (Object.keys(STATUSES) as SosStatus[]).map(code => ({ code, label: STATUSES[code].label }));

  protected readonly alerts = signal<SosAlert[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly statusFilter = signal('');
  protected readonly selectedId = signal<string | null>(null);

  /** Cases cochées de la procédure, par alerte (aide-mémoire local, non enregistré). */
  protected readonly checked = signal<Record<string, number[]>>({});

  protected readonly action = signal<SosAction | null>(null);
  protected readonly notes = signal('');
  protected readonly busy = signal(false);
  protected readonly dialogError = signal('');
  protected readonly notice = signal('');


  protected readonly selected = computed(() => this.alerts().find(a => a.id === this.selectedId()) ?? null);
  protected readonly openCount = computed(() => this.alerts().filter(a => STATUSES[a.status]?.open).length);
  protected readonly mapUrl = computed<SafeResourceUrl | null>(() => {
    const a = this.selected();
    if (!a || !isPlatformBrowser(this.platformId)) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(`https://maps.google.com/maps?q=${Number(a.lat)},${Number(a.lng)}&z=15&output=embed`);
  });

  ngOnInit(): void {
    this.load();
    if (isPlatformBrowser(this.platformId)) {
      this.timer = setInterval(() => this.load(true), REFRESH_MS);
    }
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }


  protected load(silent = false): void {
    const seq = ++this.seq;
    if (!silent) this.loading.set(true);
    this.service.list(1, 50, this.statusFilter()).subscribe({
      next: res => {
        if (seq !== this.seq) return;
        this.alerts.set(res.items);
        const current = this.selectedId();
        if (!current || !res.items.some(a => a.id === current)) this.selectedId.set(res.items[0]?.id ?? null);
        this.error.set('');
        this.loading.set(false);
      },
      error: err => {
        if (seq !== this.seq) return;
        if (!silent) this.alerts.set([]);
        this.error.set(this.message(err, 'Impossible de charger les alertes SOS.'));
        this.loading.set(false);
      }
    });
  }

  protected onStatus(value: string): void {
    this.statusFilter.set(value);
    this.load();
  }

  protected select(id: string): void {
    this.selectedId.set(id);
  }

  protected statusInfo(status: SosStatus): { label: string; open: boolean } {
    return STATUSES[status] ?? { label: status, open: false };
  }

  protected isStepDone(alert: SosAlert, index: number): boolean {
    return (this.checked()[alert.id] ?? []).includes(index);
  }

  protected toggleStep(alert: SosAlert, index: number): void {
    this.checked.update(map => {
      const done = map[alert.id] ?? [];
      return { ...map, [alert.id]: done.includes(index) ? done.filter(i => i !== index) : [...done, index] };
    });
  }

  protected openAction(action: SosAction): void {
    this.notes.set('');
    this.dialogError.set('');
    this.action.set(action);
  }

  protected closeAction(): void {
    if (this.busy()) return;
    this.action.set(null);
  }

  protected submit(): void {
    const action = this.action();
    const alert = this.selected();
    if (!action || !alert) return;
    const notes = this.notes().trim();
    if (action === 'resolve' && !notes) {
      this.dialogError.set('Le compte rendu est obligatoire pour clore une alerte.');
      return;
    }
    this.busy.set(true);
    this.dialogError.set('');
    const request = action === 'acknowledge' ? this.service.acknowledge(alert.id, notes) : this.service.resolve(alert.id, notes);
    request.subscribe({
      next: () => {
        this.busy.set(false);
        this.action.set(null);
        this.notice.set(action === 'acknowledge' ? 'Alerte prise en charge.' : 'Alerte clôturée.');
        this.load();
      },
      error: err => {
        this.dialogError.set(this.message(err, "L'opération a échoué."));
        this.busy.set(false);
      }
    });
  }

  protected who(alert: SosAlert): string {
    return alert.role === 'driver' ? 'chauffeur' : 'client';
  }

  protected formatDate(value: string | null): string {
    const d = value ? new Date(value) : null;
    if (!d || isNaN(d.getTime())) return '—';
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${time}`;
  }

  private message(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) return 'Impossible de joindre le serveur.';
      if (error.status === 403) return "Vous n'avez pas le droit d'effectuer cette action.";
      const body = (error.error as { message?: string | string[] } | null)?.message;
      if (Array.isArray(body) && body.length) return body.join(' ');
      if (typeof body === 'string' && body) return body;
    }
    return fallback;
  }
}
