import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnDestroy, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { actionLabel } from './audit-labels';
import { AuditActionCount, AuditLogFilters, AuditLogItem, AuditLogsService } from './audit-logs.service';

interface LogRow {
  key: string;
  date: string;
  qui: string;
  action: string;
  motif: string;
}

type Period = 'all' | '7' | '30';

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const ACTOR_TYPES = [
  { value: 'ADMIN', label: 'Administrateurs' },
  { value: 'USER', label: 'Clients et chauffeurs' },
  { value: 'ANONYMOUS', label: 'Anonymes' },
  { value: 'SYSTEM', label: 'Système' }
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isoDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const shortDate = (d: Date): string => `${d.getDate()} ${MONTHS[d.getMonth()]}`;

@Component({
  selector: 'app-journal-audit-page',
  imports: [],
  templateUrl: './journal-audit-page.html',
  styleUrl: './journal-audit-page.css'
})
export class JournalAuditPage implements OnInit, OnDestroy {
  private readonly service = inject(AuditLogsService);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly actorTypes = ACTOR_TYPES;
  protected readonly pageSizes = [20, 50, 100];

  protected readonly rows = signal<LogRow[]>([]);
  protected readonly actions = signal<AuditActionCount[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly pageSize = signal(20);
  protected readonly loading = signal(false);
  protected readonly exporting = signal(false);
  protected readonly error = signal('');

  protected readonly q = signal('');
  protected readonly actorType = signal('');
  protected readonly action = signal('');
  protected readonly period = signal<Period>('all');

  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  protected readonly pages = computed(() => {
    const last = this.totalPages();
    const start = Math.max(1, Math.min(this.page() - 1, last - 2));
    return Array.from({ length: Math.min(3, last) }, (_, i) => start + i);
  });
  protected readonly rangeLabel = computed(() => {
    const total = this.total();
    if (total === 0) return '0 sur 0';
    const start = (this.page() - 1) * this.pageSize() + 1;
    const end = Math.min(start + this.pageSize() - 1, total);
    return `${start}-${end} sur ${total}`;
  });
  protected readonly periodLabel = computed(() => {
    const { from, to } = this.dateRange();
    return from ? `${shortDate(from)} – ${shortDate(to)} ${to.getFullYear()}` : '';
  });

  private searchTimer?: ReturnType<typeof setTimeout>;
  private requestId = 0;

  ngOnInit(): void {
    this.load();
    this.service.actions().subscribe({
      next: list => this.actions.set(list),
      error: () => this.actions.set([])
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.searchTimer);
  }

  protected onSearch(value: string): void {
    this.q.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.applyFilters(), 300);
  }

  protected onActorType(value: string): void {
    this.actorType.set(value);
    this.applyFilters();
  }

  protected onAction(value: string): void {
    this.action.set(value);
    this.applyFilters();
  }

  protected onPeriod(value: string): void {
    this.period.set(value as Period);
    this.applyFilters();
  }

  protected onPageSize(value: string): void {
    this.pageSize.set(Number(value));
    this.applyFilters();
  }

  protected goTo(page: number): void {
    const next = Math.min(Math.max(page, 1), this.totalPages());
    if (next === this.page()) return;
    this.page.set(next);
    this.load();
  }

  protected actionOptionLabel(code: string): string {
    return actionLabel(code);
  }

  protected exportCsv(): void {
    if (!isPlatformBrowser(this.platformId) || this.exporting()) return;
    this.exporting.set(true);
    this.service.exportCsv(this.filters()).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `journal-audit-${isoDate(new Date())}.csv`;
        link.click();
        URL.revokeObjectURL(url);
        this.exporting.set(false);
      },
      error: err => {
        this.error.set(this.message(err, "L'export a échoué."));
        this.exporting.set(false);
      }
    });
  }

  protected load(): void {
    const id = ++this.requestId;
    this.loading.set(true);
    this.error.set('');
    this.service.list({ ...this.filters(), page: this.page(), pageSize: this.pageSize() }).subscribe({
      next: res => {
        if (id !== this.requestId) return;
        this.rows.set(res.items.map((item, i) => this.toRow(item, i)));
        this.total.set(res.total);
        this.loading.set(false);
      },
      error: err => {
        if (id !== this.requestId) return;
        this.rows.set([]);
        this.total.set(0);
        this.error.set(this.message(err, 'Impossible de charger le journal.'));
        this.loading.set(false);
      }
    });
  }

  private applyFilters(): void {
    this.page.set(1);
    this.load();
  }

  private dateRange(): { from: Date | null; to: Date } {
    const to = new Date();
    const days = this.period() === 'all' ? 0 : Number(this.period());
    if (!days) return { from: null, to };
    const from = new Date(to);
    from.setDate(from.getDate() - days);
    return { from, to };
  }

  private filters(): AuditLogFilters {
    const { from, to } = this.dateRange();
    return {
      q: this.q().trim(),
      actorType: this.actorType(),
      action: this.action(),
      from: from ? isoDate(from) : undefined,
      to: from ? isoDate(new Date(to.getTime() + 86_400_000)) : undefined
    };
  }

  private toRow(item: AuditLogItem, index: number): LogRow {
    return {
      key: item.id ?? `${index}`,
      date: this.formatDate(item.createdAt ?? item.at),
      qui: this.actorName(item),
      action: this.actionText(item),
      motif: this.reason(item)
    };
  }

  private formatDate(value?: string): string {
    const d = value ? new Date(value) : null;
    if (!d || isNaN(d.getTime())) return '—';
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `${shortDate(d)} ${time}`;
  }

  private actorName(item: AuditLogItem): string {
    const a = item.actor;
    const name = item.actorName ?? item.actorLabel ?? (typeof a === 'string' ? a : a?.name ?? a?.email);
    if (name) return name;
    switch (item.actorType) {
      case 'SYSTEM': return 'Système';
      case 'ANONYMOUS': return 'Anonyme';
      case 'USER': return item.actorApp === 'driver' ? 'Chauffeur' : item.actorApp === 'customer' ? 'Client' : 'Utilisateur';
      default: return '—';
    }
  }

  private actionText(item: AuditLogItem): string {
    const label = actionLabel(item.action);
    const orderId = item.after?.['orderId'];
    const target = typeof orderId === 'string' ? orderId : item.entityId && !UUID.test(item.entityId) ? item.entityId : '';
    return target ? `${label} · ${target}` : label;
  }

  private reason(item: AuditLogItem): string {
    return item.reason || '—';
  }

  private message(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) return 'Impossible de joindre le serveur.';
      if (error.status === 403) return "Vous n'avez pas accès au journal d'audit.";
    }
    return fallback;
  }
}
