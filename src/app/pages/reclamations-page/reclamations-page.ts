import { HttpErrorResponse } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { AdminUserDto, AdminUsersService } from '../utilisateurs-page/users.service';
import { TICKET_CATEGORIES as CATEGORIES, TICKET_PRIORITIES as PRIORITIES, TICKET_STATUSES as STATUSES, TicketDetail, TicketListItem, TicketMessage, TicketPriority, TicketsService, TicketStatus } from './tickets.service';

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const MESSAGES_REFRESH_MS = 8_000;

@Component({
  selector: 'app-reclamations-page',
  imports: [],
  templateUrl: './reclamations-page.html',
  styleUrl: './reclamations-page.css'
})
export class ReclamationsPage implements OnInit, OnDestroy {
  private readonly service = inject(TicketsService);
  private readonly users = inject(AdminUsersService);
  private readonly platformId = inject(PLATFORM_ID);
  private searchTimer?: ReturnType<typeof setTimeout>;
  private pollTimer?: ReturnType<typeof setInterval>;
  private seq = 0;

  protected readonly pageSizes = [10, 20, 50];
  protected readonly statusOptions = (Object.keys(STATUSES) as TicketStatus[]).map(code => ({ code, label: STATUSES[code].label }));
  protected readonly priorityOptions = (Object.keys(PRIORITIES) as TicketPriority[]).map(code => ({ code, label: PRIORITIES[code].label }));

  protected readonly tickets = signal<TicketListItem[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly search = signal('');
  protected readonly status = signal('');
  protected readonly page = signal(1);
  protected readonly pageSize = signal(20);
  protected readonly agents = signal<AdminUserDto[]>([]);

  // Fiche ouverte
  protected readonly detail = signal<TicketDetail | null>(null);
  protected readonly messages = signal<TicketMessage[]>([]);
  protected readonly detailLoading = signal(false);
  protected readonly detailError = signal('');
  protected readonly busy = signal(false);
  protected readonly formStatus = signal<TicketStatus>('OPEN');
  protected readonly formPriority = signal<TicketPriority>('NORMAL');
  protected readonly formAssignee = signal('');
  protected readonly formResolution = signal('');
  protected readonly replyBody = signal('');
  protected readonly replyInternal = signal(false);
  protected readonly warning = signal(false);
  protected readonly warnMessage = signal('');

  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  protected readonly rangeLabel = computed(() => {
    const total = this.total();
    if (total === 0) return '0 sur 0';
    const start = (this.page() - 1) * this.pageSize() + 1;
    return `${start}-${Math.min(start + this.pageSize() - 1, total)} sur ${total}`;
  });
  protected readonly pages = computed(() => {
    const last = this.totalPages();
    const start = Math.max(1, Math.min(this.page() - 1, last - 2));
    return Array.from({ length: Math.min(3, last) }, (_, i) => start + i);
  });
  protected readonly openCount = computed(() => this.tickets().filter(t => t.status === 'OPEN' || t.status === 'IN_PROGRESS').length);

  ngOnInit(): void {
    this.load();
    this.users.list(1, 100).subscribe({
      next: res => this.agents.set(res.items),
      error: () => this.agents.set([])
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.searchTimer);
    this.stopPolling();
  }

  protected load(): void {
    const seq = ++this.seq;
    this.loading.set(true);
    this.service.list(this.page(), this.pageSize(), this.search().trim(), this.status()).subscribe({
      next: res => {
        if (seq !== this.seq) return;
        this.tickets.set(res.items);
        this.total.set(res.total);
        this.error.set('');
        this.loading.set(false);
      },
      error: err => {
        if (seq !== this.seq) return;
        this.tickets.set([]);
        this.total.set(0);
        this.error.set(this.message(err, 'Impossible de charger les réclamations.'));
        this.loading.set(false);
      }
    });
  }

  protected onSearch(value: string): void {
    this.search.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.page.set(1);
      this.load();
    }, 350);
  }

  protected onStatus(value: string): void {
    this.status.set(value);
    this.page.set(1);
    this.load();
  }

  protected onPageSize(value: string): void {
    this.pageSize.set(Number(value));
    this.page.set(1);
    this.load();
  }

  protected goTo(page: number): void {
    this.page.set(Math.min(Math.max(page, 1), this.totalPages()));
    this.load();
  }

  // --- Fiche ---

  protected open(ticket: TicketListItem): void {
    this.detail.set(null);
    this.messages.set([]);
    this.detailError.set('');
    this.warning.set(false);
    this.replyBody.set('');
    this.replyInternal.set(false);
    this.detailLoading.set(true);
    this.openId.set(ticket.id);
    this.service.detail(ticket.id).subscribe({
      next: d => {
        if (this.openId() !== ticket.id) return;
        this.applyDetail(d);
        this.detailLoading.set(false);
      },
      error: err => {
        this.detailError.set(this.message(err, 'Impossible de charger la réclamation.'));
        this.detailLoading.set(false);
      }
    });
    this.loadMessages(ticket.id);
    this.startPolling(ticket.id);
  }

  protected readonly openId = signal<string | null>(null);

  protected close(): void {
    if (this.busy()) return;
    this.stopPolling();
    this.openId.set(null);
    this.detail.set(null);
  }

  private applyDetail(d: TicketDetail): void {
    this.detail.set(d);
    this.formStatus.set(d.status);
    this.formPriority.set(d.priority);
    this.formAssignee.set(d.assignee ?? '');
    this.formResolution.set(d.resolution ?? '');
  }

  private loadMessages(id: string, silent = false): void {
    this.service.messages(id).subscribe({
      next: list => {
        if (this.openId() !== id) return;
        const current = this.messages();
        // Évite de redessiner le fil quand rien n'a changé.
        if (silent && list.length === current.length && list[list.length - 1]?.id === current[current.length - 1]?.id) return;
        this.messages.set(list);
      },
      error: err => {
        if (!silent) this.detailError.set(this.message(err, 'Impossible de charger les messages.'));
      }
    });
  }

  private startPolling(id: string): void {
    this.stopPolling();
    if (!isPlatformBrowser(this.platformId)) return;
    this.pollTimer = setInterval(() => {
      if (this.openId() === id && !this.busy()) this.loadMessages(id, true);
    }, MESSAGES_REFRESH_MS);
  }

  private stopPolling(): void {
    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  protected save(): void {
    const d = this.detail();
    if (!d) return;
    const resolution = this.formResolution().trim();
    const status = this.formStatus();
    if ((status === 'RESOLVED' || status === 'CLOSED') && !resolution) {
      this.detailError.set('La résolution est obligatoire pour résoudre ou clore une réclamation.');
      return;
    }
    this.busy.set(true);
    this.detailError.set('');
    this.service
      .update(d.id, {
        status,
        priority: this.formPriority(),
        ...(this.formAssignee() ? { assignee: this.formAssignee() } : {}),
        ...(resolution ? { resolution } : {})
      })
      .subscribe({
        next: updated => {
          this.applyDetail(updated);
          this.busy.set(false);
          this.notice.set(`Réclamation ${updated.ref} mise à jour.`);
          this.load();
        },
        error: err => {
          this.detailError.set(this.message(err, 'La mise à jour a échoué.'));
          this.busy.set(false);
        }
      });
  }

  protected sendReply(): void {
    const d = this.detail();
    const body = this.replyBody().trim();
    if (!d || !body) return;
    this.busy.set(true);
    this.detailError.set('');
    this.service.reply(d.id, body, this.replyInternal()).subscribe({
      next: () => {
        this.replyBody.set('');
        this.busy.set(false);
        this.loadMessages(d.id);
      },
      error: err => {
        this.detailError.set(this.message(err, "L'envoi a échoué."));
        this.busy.set(false);
      }
    });
  }

  protected openWarn(): void {
    this.warnMessage.set('');
    this.detailError.set('');
    this.warning.set(true);
  }

  protected sendWarn(): void {
    const d = this.detail();
    const message = this.warnMessage().trim();
    if (!d) return;
    if (!message) {
      this.detailError.set("Saisissez le message à envoyer au chauffeur.");
      return;
    }
    this.busy.set(true);
    this.detailError.set('');
    this.service.warnDriver(d.id, message).subscribe({
      next: () => {
        this.busy.set(false);
        this.warning.set(false);
        this.notice.set('Le chauffeur a été averti.');
      },
      error: err => {
        this.detailError.set(this.message(err, "L'avertissement n'a pas pu être envoyé."));
        this.busy.set(false);
      }
    });
  }

  // --- Affichage ---

  protected statusInfo(s: TicketStatus): { label: string; css: string } {
    return STATUSES[s] ?? { label: s, css: 'pill-gray' };
  }

  protected prioInfo(p: TicketPriority): { label: string; css: string } {
    return PRIORITIES[p] ?? { label: p, css: 'pill-gray' };
  }

  protected categoryLabel(code: string): string {
    return CATEGORIES[code] ?? code;
  }

  protected clientOf(t: TicketListItem): string {
    return t.openedBy || (t.openerRole === 'driver' ? 'Chauffeur' : 'Client');
  }

  protected agentName(id: string | null): string {
    if (!id) return 'Non assigné';
    return this.agents().find(a => a.id === id)?.name ?? 'Agent';
  }

  protected authorOf(m: TicketMessage): string {
    if (m.authorType === 'ADMIN') return m.adminName || 'Support';
    return m.userName || 'Client';
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
