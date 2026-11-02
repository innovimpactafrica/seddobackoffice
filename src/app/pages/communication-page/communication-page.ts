import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, OnDestroy, OnInit, signal } from '@angular/core';
import {
  Campaign,
  CampaignAudience,
  CampaignChannel,
  CampaignOptions,
  CampaignPreview,
  CampaignsService
} from './campaigns.service';

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const PREVIEW_DELAY_MS = 400;
const SEARCH_DELAY_MS = 350;

const STATUSES: Record<string, { label: string; css: string }> = {
  SENT: { label: 'Envoyée', css: 'pill-green' },
  SCHEDULED: { label: 'Programmée', css: 'pill-amber' },
  CANCELLED: { label: 'Annulée', css: 'pill-gray' }
};

type SendMode = 'now' | 'schedule';

@Component({
  selector: 'app-communication-page',
  imports: [],
  templateUrl: './communication-page.html',
  styleUrl: './communication-page.css'
})
export class CommunicationPage implements OnInit, OnDestroy {
  private readonly service = inject(CampaignsService);
  private searchTimer?: ReturnType<typeof setTimeout>;
  private previewSeq = 0;
  private listSeq = 0;

  protected readonly pageSizes = [10, 20, 50];

  protected readonly options = signal<CampaignOptions | null>(null);
  protected readonly optionsError = signal('');

  protected readonly audienceType = signal('');
  protected readonly zoneId = signal('');
  protected readonly channels = signal<CampaignChannel[]>(['PUSH']);
  protected readonly body = signal('');
  protected readonly scheduling = signal(false);
  protected readonly scheduledAt = signal('');

  protected readonly preview = signal<CampaignPreview | null>(null);
  protected readonly previewLoading = signal(false);
  protected readonly previewError = signal('');

  protected readonly confirm = signal<SendMode | null>(null);
  protected readonly busy = signal(false);
  protected readonly dialogError = signal('');
  protected readonly notice = signal('');
  protected readonly actionError = signal('');
  protected readonly cancellingId = signal<string | null>(null);

  protected readonly campaigns = signal<Campaign[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly search = signal('');
  protected readonly page = signal(1);
  protected readonly pageSize = signal(10);

  protected readonly audienceOption = computed(() => this.options()?.audiences.find(a => a.type === this.audienceType()) ?? null);
  protected readonly maxLength = computed(() => this.options()?.maxBodyLength ?? 300);

  protected readonly audience = computed<CampaignAudience | null>(() => {
    const option = this.audienceOption();
    if (!option) return null;
    const audience: CampaignAudience = { type: option.type };
    if (option.inactiveDays !== undefined) audience.inactiveDays = option.inactiveDays;
    if (this.zoneId()) audience.zoneId = this.zoneId();
    return audience;
  });

  protected readonly isDriverAudience = computed(() => this.audienceType().includes('DRIVERS'));
  protected readonly appName = computed(() => (this.isDriverAudience() ? 'Seddo Chauffeur' : 'Seddo'));

  protected readonly charactersLabel = computed(() => {
    const info = this.preview()?.message;
    const characters = info?.characters ?? this.body().length;
    const sms = this.channels().includes('SMS') && info && info.smsParts > 1 ? ` · ${info.smsParts} SMS` : '';
    return `${characters} caractères${sms}`;
  });
  protected readonly recipientsLabel = computed(() => {
    const p = this.preview();
    if (this.previewLoading() && !p) return 'Calcul…';
    return p ? `${p.recipients.toLocaleString('fr-FR')} destinataire${p.recipients > 1 ? 's' : ''}` : '— destinataires';
  });
  protected readonly canSend = computed(() => !!this.audience() && this.body().trim().length > 0 && this.channels().length > 0);

  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  protected readonly rangeLabel = computed(() => {
    const total = this.total();
    if (total === 0) return '0 sur 0';
    const start = (this.page() - 1) * this.pageSize() + 1;
    return `${start}-${Math.min(start + this.campaigns().length - 1, total)} sur ${total}`;
  });
  protected readonly pages = computed(() => {
    const last = this.totalPages();
    const start = Math.max(1, Math.min(this.page() - 1, last - 2));
    return Array.from({ length: Math.min(3, last) }, (_, i) => start + i);
  });

  constructor() {
    // Recalcule destinataires et taille du message quand le ciblage ou le texte change.
    effect(onCleanup => {
      const audience = this.audience();
      const body = this.body().trim();
      if (!audience || !body) {
        this.preview.set(null);
        this.previewError.set('');
        return;
      }
      const timer = setTimeout(() => this.runPreview(audience, body), PREVIEW_DELAY_MS);
      onCleanup(() => clearTimeout(timer));
    });
  }

  ngOnInit(): void {
    this.service.options().subscribe({
      next: options => {
        this.options.set(options);
        this.audienceType.set(options.audiences[0]?.type ?? '');
      },
      error: err => this.optionsError.set(this.message(err, 'Impossible de charger les options de campagne.'))
    });
    this.load();
  }

  ngOnDestroy(): void {
    clearTimeout(this.searchTimer);
  }

  private runPreview(audience: CampaignAudience, body: string): void {
    const seq = ++this.previewSeq;
    this.previewLoading.set(true);
    this.service.preview(audience, body).subscribe({
      next: res => {
        if (seq !== this.previewSeq) return;
        this.preview.set(res);
        this.previewError.set('');
        this.previewLoading.set(false);
      },
      error: err => {
        if (seq !== this.previewSeq) return;
        this.preview.set(null);
        this.previewError.set(this.message(err, 'Impossible de calculer les destinataires.'));
        this.previewLoading.set(false);
      }
    });
  }

  protected load(): void {
    const seq = ++this.listSeq;
    this.loading.set(true);
    this.error.set('');
    this.service.list(this.page(), this.pageSize(), this.search().trim()).subscribe({
      next: res => {
        if (seq !== this.listSeq) return;
        this.campaigns.set(res.items);
        this.total.set(res.total);
        this.loading.set(false);
      },
      error: err => {
        if (seq !== this.listSeq) return;
        this.campaigns.set([]);
        this.total.set(0);
        this.error.set(this.message(err, "Impossible de charger l'historique."));
        this.loading.set(false);
      }
    });
  }

  protected toggleChannel(code: CampaignChannel, checked: boolean): void {
    this.channels.update(list => (checked ? [...list.filter(c => c !== code), code] : list.filter(c => c !== code)));
  }

  protected onBody(value: string): void {
    this.body.set(value);
  }

  /** « Programmer » ouvre le choix de la date, puis demande confirmation. */
  protected onSchedule(): void {
    if (!this.scheduling()) {
      this.scheduling.set(true);
      return;
    }
    if (!this.scheduledAt()) {
      this.actionError.set("Choisissez la date et l'heure d'envoi.");
      return;
    }
    this.openConfirm('schedule');
  }

  protected cancelScheduling(): void {
    this.scheduling.set(false);
    this.scheduledAt.set('');
  }

  protected openConfirm(mode: SendMode): void {
    this.actionError.set('');
    this.dialogError.set('');
    this.confirm.set(mode);
  }

  protected closeConfirm(): void {
    if (this.busy()) return;
    this.confirm.set(null);
  }

  protected submit(): void {
    const mode = this.confirm();
    const audience = this.audience();
    if (!mode || !audience) return;
    this.busy.set(true);
    this.dialogError.set('');
    this.service
      .create({
        channels: this.channels(),
        audience,
        body: this.body().trim(),
        // Heure de Dakar = UTC : la valeur saisie est envoyée telle quelle avec le suffixe Z.
        ...(mode === 'schedule' ? { scheduledAt: `${this.scheduledAt()}:00Z` } : {})
      })
      .subscribe({
        next: campaign => {
          this.busy.set(false);
          this.confirm.set(null);
          this.notice.set(
            mode === 'schedule' ? 'Campagne programmée.' : `Campagne envoyée à ${(campaign.recipients ?? 0).toLocaleString('fr-FR')} destinataire(s).`
          );
          this.body.set('');
          this.cancelScheduling();
          this.page.set(1);
          this.load();
        },
        error: err => {
          this.dialogError.set(this.message(err, "L'envoi a échoué."));
          this.busy.set(false);
        }
      });
  }

  protected cancelCampaign(campaign: Campaign): void {
    this.actionError.set('');
    this.cancellingId.set(campaign.id);
    this.service.cancel(campaign.id).subscribe({
      next: () => {
        this.cancellingId.set(null);
        this.notice.set('Campagne annulée.');
        this.load();
      },
      error: err => {
        this.cancellingId.set(null);
        this.actionError.set(this.message(err, "L'annulation a échoué."));
      }
    });
  }

  protected onSearch(value: string): void {
    this.search.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.page.set(1);
      this.load();
    }, SEARCH_DELAY_MS);
  }

  protected onPageSize(value: string): void {
    this.pageSize.set(Number(value));
    this.page.set(1);
    this.load();
  }

  protected goTo(page: number): void {
    const next = Math.min(Math.max(page, 1), this.totalPages());
    if (next === this.page()) return;
    this.page.set(next);
    this.load();
  }

  protected statusInfo(status: string): { label: string; css: string } {
    return STATUSES[status] ?? { label: status, css: 'pill-gray' };
  }

  protected openRate(c: Campaign): string {
    return c.recipients && c.opens ? `${Math.round((c.opens / c.recipients) * 100)} %` : '—';
  }

  protected formatDate(value: string | null): string {
    const d = value ? new Date(value) : null;
    if (!d || isNaN(d.getTime())) return '—';
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${time}`;
  }

  protected num(value: number | null): string {
    return value === null ? '—' : value.toLocaleString('fr-FR');
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
