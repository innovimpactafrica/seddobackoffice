import { HttpErrorResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { AdminUserDto, AdminUsersService, InvitedUserDto, PermissionDto, RoleDto, RolesResponse, UpdateUserBody } from './users.service';

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

interface DroitCell {
  code: string;
  label: string;
}

interface DroitRow {
  key: string;
  label: string;
  routes: string;
  cells: DroitCell[];
}

interface DroitGroup {
  label: string;
  rows: DroitRow[];
}

/** Domaine d'une permission, déduit du préfixe de sa clé (DRIVER_, ZONE_…). */
const PERMISSION_GROUPS: { prefixes: string[]; label: string }[] = [
  { prefixes: ['DRIVER_'], label: 'Chauffeurs' },
  { prefixes: ['REFUND_', 'PAYOUT_'], label: 'Finance' },
  { prefixes: ['PRICING_'], label: 'Tarifs et commission' },
  { prefixes: ['ZONE_'], label: 'Zones' },
  { prefixes: ['BACKOFFICE_'], label: 'Backoffice' }
];

/** Couleur de pastille par niveau d'accès. */
const ACCESS_PILLS: Record<string, string> = {
  YES: 'pill-green',
  NO: 'pill-gray',
  REQUEST: 'pill-yellow',
  VALIDATION: 'pill-blue'
};

const ACCESS_HINTS: Record<string, string> = {
  YES: 'action directe',
  NO: 'action refusée',
  REQUEST: 'crée une demande à faire valider',
  VALIDATION: 'valide les demandes des autres'
};

@Component({
  selector: 'app-utilisateurs-page',
  imports: [],
  templateUrl: './utilisateurs-page.html',
  styleUrl: './utilisateurs-page.css'
})
export class UtilisateursPage implements OnInit {
  private readonly service = inject(AdminUsersService);
  private readonly auth = inject(AuthService);

  protected readonly pageSizes = [10, 25, 50];

  protected readonly users = signal<AdminUserDto[]>([]);
  protected readonly rolesData = signal<RolesResponse | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly rightsError = signal('');

  /** Utilisateur dont on change le rôle (fenêtre ouverte) et rôle choisi. */
  protected readonly editing = signal<AdminUserDto | null>(null);
  protected readonly newRole = signal('');
  protected readonly savingId = signal<string | null>(null);
  protected readonly actionError = signal('');

  /** Utilisateur dont on confirme la désactivation / réactivation. */
  protected readonly confirming = signal<AdminUserDto | null>(null);

  /** Fenêtre « Modifier les droits » d'une action sensible : valeurs choisies par rôle. */
  protected readonly editingPermission = signal<PermissionDto | null>(null);
  protected readonly permissionDraft = signal<Record<string, string>>({});
  protected readonly permissionReason = signal('');
  protected readonly permissionError = signal('');
  protected readonly notice = signal('');

  /** Fenêtre d'invitation. */
  protected readonly inviteOpen = signal(false);
  protected readonly inviteName = signal('');
  protected readonly inviteEmail = signal('');
  protected readonly inviteRole = signal('');
  protected readonly dialogError = signal('');
  protected readonly busy = signal(false);

  /** Fenêtre « 2FA » (renvoyer l'invitation / réinitialiser) et identifiants provisoires à communiquer. */
  protected readonly security = signal<AdminUserDto | null>(null);
  protected readonly credentials = signal<{ name: string; email: string; password: string } | null>(null);
  protected readonly copied = signal(false);

  protected readonly search = signal('');
  protected readonly roleFilter = signal('');
  protected readonly page = signal(1);
  protected readonly pageSize = signal(10);

  /** Rôles affichés en colonnes : Admin en dernier, comme sur la maquette. */
  protected readonly roleColumns = computed<RoleDto[]>(() => {
    const roles = this.rolesData()?.roles ?? [];
    return [...roles.filter(r => r.code !== 'ADMIN'), ...roles.filter(r => r.code === 'ADMIN')];
  });

  /** Permissions regroupées par domaine, dans l'ordre renvoyé par l'API. */
  protected readonly droitGroups = computed<DroitGroup[]>(() => {
    const data = this.rolesData();
    if (!data) return [];
    const columns = this.roleColumns();
    const groups = new Map<string, DroitRow[]>();
    for (const p of data.permissions) {
      const group = PERMISSION_GROUPS.find(g => g.prefixes.some(prefix => p.key.startsWith(prefix)))?.label ?? 'Autres';
      const row: DroitRow = {
        key: p.key,
        label: p.label,
        routes: p.routes,
        cells: columns.map(r => {
          const code = p.rights[r.code] ?? '';
          return { code, label: data.accessLabels[code] ?? (code || '—') };
        })
      };
      groups.set(group, [...(groups.get(group) ?? []), row]);
    }
    return [...groups].map(([label, rows]) => ({ label, rows }));
  });

  /** Légende des niveaux d'accès renvoyés par l'API (Oui, Non, Demande, Validation). */
  protected readonly accessLegend = computed(() => {
    const data = this.rolesData();
    if (!data) return [];
    return Object.entries(data.accessLabels).map(([code, label]) => ({
      code,
      label,
      hint: ACCESS_HINTS[code] ?? ''
    }));
  });

  protected accessPill(code: string): string {
    return ACCESS_PILLS[code] ?? 'pill-gray';
  }

  protected readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const role = this.roleFilter();
    return this.users().filter(
      u =>
        (!role || u.role === role) &&
        (!q || [u.name, u.email, u.roleLabel].some(v => v.toLowerCase().includes(q)))
    );
  });

  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.pageSize())));
  protected readonly visible = computed(() => {
    const start = (this.page() - 1) * this.pageSize();
    return this.filtered().slice(start, start + this.pageSize());
  });
  protected readonly pages = computed(() => {
    const last = this.totalPages();
    const start = Math.max(1, Math.min(this.page() - 1, last - 2));
    return Array.from({ length: Math.min(3, last) }, (_, i) => start + i);
  });
  protected readonly rangeLabel = computed(() => {
    const total = this.filtered().length;
    if (total === 0) return '0 sur 0';
    const start = (this.page() - 1) * this.pageSize() + 1;
    return `${start}-${Math.min(start + this.pageSize() - 1, total)} sur ${total}`;
  });

  ngOnInit(): void {
    this.loadUsers();
    this.service.roles().subscribe({
      next: data => this.rolesData.set(data),
      error: err => this.rightsError.set(this.message(err, 'Impossible de charger les droits par rôle.'))
    });
  }

  protected loadUsers(): void {
    this.loading.set(true);
    this.error.set('');
    this.service.list(1, 100).subscribe({
      next: res => {
        this.users.set(res.items);
        this.loading.set(false);
      },
      error: err => {
        this.users.set([]);
        this.error.set(this.message(err, 'Impossible de charger les utilisateurs.'));
        this.loading.set(false);
      }
    });
  }

  protected onSearch(value: string): void {
    this.search.set(value);
    this.page.set(1);
  }

  protected onRole(value: string): void {
    this.roleFilter.set(value);
    this.page.set(1);
  }

  protected onPageSize(value: string): void {
    this.pageSize.set(Number(value));
    this.page.set(1);
  }

  protected goTo(page: number): void {
    this.page.set(Math.min(Math.max(page, 1), this.totalPages()));
  }

  protected openInvite(): void {
    this.dialogError.set('');
    this.inviteName.set('');
    this.inviteEmail.set('');
    this.inviteRole.set(this.roleColumns().find(r => r.code !== 'ADMIN')?.code ?? '');
    this.inviteOpen.set(true);
  }

  protected closeInvite(): void {
    this.inviteOpen.set(false);
  }

  protected submitInvite(): void {
    const name = this.inviteName().trim();
    const email = this.inviteEmail().trim();
    if (!name || !/^\S+@\S+\.\S+$/.test(email) || !this.inviteRole()) {
      this.dialogError.set('Renseignez un nom, une adresse e-mail valide et un rôle.');
      return;
    }
    this.dialogError.set('');
    this.busy.set(true);
    this.service.invite({ email, name, role: this.inviteRole() }).subscribe({
      next: user => {
        this.busy.set(false);
        this.inviteOpen.set(false);
        this.afterInvitation(user);
        this.loadUsers();
      },
      error: err => {
        this.dialogError.set(this.message(err, "L'invitation a échoué."));
        this.busy.set(false);
      }
    });
  }

  protected openSecurity(user: AdminUserDto): void {
    this.dialogError.set('');
    this.security.set(user);
  }

  protected closeSecurity(): void {
    this.security.set(null);
  }

  protected resendInvitation(user: AdminUserDto): void {
    this.runSecurity(this.service.resendInvitation(user.id));
  }

  protected resetTwoFactor(user: AdminUserDto): void {
    if (typeof window !== 'undefined' && !window.confirm(`Réinitialiser la 2FA de ${user.name} ? Elle devra la configurer à nouveau.`)) {
      return;
    }
    this.runSecurity(this.service.reset2fa(user.id));
  }

  protected closeCredentials(): void {
    this.credentials.set(null);
    this.copied.set(false);
  }

  protected async copyPassword(): Promise<void> {
    const creds = this.credentials();
    if (!creds || typeof navigator === 'undefined') return;
    try {
      await navigator.clipboard.writeText(creds.password);
      this.copied.set(true);
    } catch {
      this.copied.set(false);
    }
  }

  private runSecurity(request: Observable<InvitedUserDto>): void {
    this.dialogError.set('');
    this.busy.set(true);
    request.subscribe({
      next: updated => {
        const { temporaryPassword: _ignored, ...user } = updated;
        this.users.update(list => list.map(u => (u.id === user.id ? user : u)));
        this.busy.set(false);
        this.security.set(null);
        this.afterInvitation(updated);
      },
      error: err => {
        this.dialogError.set(this.message(err, "L'opération a échoué."));
        this.busy.set(false);
      }
    });
  }

  /** Sans envoi d'e-mail configuré, l'API renvoie le mot de passe provisoire : on l'affiche une seule fois. */
  private afterInvitation(user: InvitedUserDto): void {
    if (user.temporaryPassword) {
      this.copied.set(false);
      this.credentials.set({ name: user.name, email: user.email, password: user.temporaryPassword });
    }
  }

  protected isSelf(user: AdminUserDto): boolean {
    return user.email.toLowerCase() === this.auth.currentUser()?.email.toLowerCase();
  }

  protected openRoleDialog(user: AdminUserDto): void {
    this.actionError.set('');
    this.newRole.set(user.role);
    this.editing.set(user);
  }

  // ─── Droits par rôle ───────────────────────────────────────────────────────

  /** Rôles modifiables (l'Admin a toujours tous les droits). */
  protected readonly configurableRoles = computed(() => this.roleColumns().filter(r => r.configurable));

  protected openPermission(key: string): void {
    const p = this.rolesData()?.permissions.find(x => x.key === key);
    if (!p) return;
    this.editingPermission.set(p);
    this.permissionDraft.set({ ...p.rights });
    this.permissionReason.set('');
    this.permissionError.set('');
    this.notice.set('');
  }

  protected setDraft(role: string, value: string): void {
    this.permissionDraft.update(d => ({ ...d, [role]: value }));
  }

  protected closePermission(): void {
    if (!this.busy()) this.editingPermission.set(null);
  }

  protected savePermission(): void {
    const p = this.editingPermission();
    if (!p) return;
    const draft = this.permissionDraft();
    // N'envoie que les rôles modifiés : le journal d'audit reste lisible.
    const changed: Record<string, string> = {};
    for (const r of this.configurableRoles()) {
      if (draft[r.code] && draft[r.code] !== p.rights[r.code]) changed[r.code] = draft[r.code];
    }
    if (!Object.keys(changed).length) return this.permissionError.set('Aucun droit modifié.');
    const reason = this.permissionReason().trim();
    if (!reason) return this.permissionError.set('Le motif est obligatoire.');
    this.busy.set(true);
    this.permissionError.set('');
    this.service.updatePermission(p.key, changed, reason).subscribe({
      next: data => {
        this.busy.set(false);
        this.rolesData.set(data);
        this.editingPermission.set(null);
        this.notice.set(`Droits « ${p.label} » mis à jour : appliqués par l'API dans les 30 secondes.`);
      },
      error: err => {
        this.busy.set(false);
        this.permissionError.set(this.message(err, "Les droits n'ont pas pu être modifiés."));
      }
    });
  }

  protected closeRoleDialog(): void {
    this.editing.set(null);
  }

  protected saveRole(): void {
    const user = this.editing();
    if (!user || this.newRole() === user.role) return this.closeRoleDialog();
    if (this.isSelf(user) && user.role === 'ADMIN') {
      this.actionError.set('Vous ne pouvez pas retirer votre propre rôle Admin.');
      return this.closeRoleDialog();
    }
    this.update(user, { role: this.newRole(), active: user.status === 'ACTIVE' }, () => this.closeRoleDialog());
  }

  /** Ouvre la fenêtre de confirmation de désactivation / réactivation. */
  protected toggleActive(user: AdminUserDto): void {
    this.actionError.set('');
    this.confirming.set(user);
  }

  protected closeConfirm(): void {
    if (this.savingId()) return;
    this.confirming.set(null);
  }

  protected confirmToggle(): void {
    const user = this.confirming();
    if (!user) return;
    this.update(user, { role: user.role, active: user.status !== 'ACTIVE' }, () => this.confirming.set(null));
  }

  private update(user: AdminUserDto, body: UpdateUserBody, done?: () => void): void {
    this.actionError.set('');
    this.savingId.set(user.id);
    this.service.update(user.id, body).subscribe({
      next: updated => {
        this.users.update(list => list.map(u => (u.id === updated.id ? updated : u)));
        this.savingId.set(null);
        done?.();
      },
      error: err => {
        this.actionError.set(this.message(err, "La modification a échoué."));
        this.savingId.set(null);
      }
    });
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
