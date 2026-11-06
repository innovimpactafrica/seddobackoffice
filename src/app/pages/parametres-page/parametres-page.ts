import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { AppParams, MapsPlatform, Setting, SettingsService, SettingValue } from './settings.service';

type SettingKind = 'boolean' | 'number' | 'list' | 'map' | 'text';

const PLATFORMS: { key: MapsPlatform; label: string; hint: string }[] = [
  { key: 'android', label: 'Application Android', hint: 'Apps client et chauffeur Android' },
  { key: 'ios', label: 'Application iOS', hint: 'Apps client et chauffeur iOS' },
  { key: 'web', label: 'Web', hint: 'Backoffice et simulateur' }
];

@Component({
  selector: 'app-parametres-page',
  imports: [CommonModule],
  templateUrl: './parametres-page.html',
  styleUrl: './parametres-page.css'
})
export class ParametresPage implements OnInit {
  private readonly service = inject(SettingsService);

  // ─── Paramètres globaux ───────────────────────────────────────────────────

  protected readonly settings = signal<Setting[]>([]);
  protected readonly settingsLoading = signal(true);
  protected readonly settingsError = signal('');
  protected readonly settingsNotice = signal('');
  protected readonly search = signal('');

  /** Paramètres par groupe, dans l'ordre de l'API ; les clés Google Maps ont leur propre carte. */
  protected readonly groups = computed(() => {
    const q = this.search().trim().toLowerCase();
    const groups = new Map<string, Setting[]>();
    for (const s of this.settings()) {
      if (s.key.startsWith('app.maps_key_')) continue;
      if (q && ![s.label, s.description, s.key, s.group].some(v => v.toLowerCase().includes(q))) continue;
      groups.set(s.group, [...(groups.get(s.group) ?? []), s]);
    }
    return [...groups].map(([name, items]) => ({ name, items }));
  });

  /** Paramètre en cours de modification et sa saisie (texte, ou une valeur par catégorie). */
  protected readonly editingKey = signal<string | null>(null);
  protected readonly draft = signal('');
  protected readonly draftMap = signal<Record<string, string>>({});
  protected readonly editError = signal('');
  /** Valeur prête à être envoyée, en attente du motif. */
  protected readonly pending = signal<{ setting: Setting; value: SettingValue } | null>(null);

  // ─── Clés Google Maps ─────────────────────────────────────────────────────

  protected readonly platforms = PLATFORMS;
  protected readonly params = signal<AppParams | null>(null);
  protected readonly mapsLoading = signal(true);
  protected readonly mapsError = signal('');
  protected readonly mapsNotice = signal('');

  /** Saisie par plateforme : absent = inchangée, "" = clé à retirer. */
  protected readonly drafts = signal<Partial<Record<MapsPlatform, string>>>({});
  protected readonly editing = signal<Partial<Record<MapsPlatform, boolean>>>({});
  protected readonly changedPlatforms = computed(() => {
    const maps = this.params()?.maps;
    const drafts = this.drafts();
    return PLATFORMS.filter(p => p.key in drafts && (drafts[p.key] ?? '').trim() !== (maps?.[p.key] ?? ''));
  });

  protected readonly confirming = signal(false);
  protected readonly reason = signal('');
  protected readonly dialogError = signal('');
  protected readonly busy = signal(false);

  ngOnInit(): void {
    this.loadSettings();
    this.loadMaps();
  }

  protected loadSettings(): void {
    this.settingsLoading.set(true);
    this.service.list().subscribe({
      next: list => {
        this.settings.set(list);
        this.settingsError.set('');
        this.settingsLoading.set(false);
      },
      error: err => {
        this.settingsError.set(this.message(err, 'Impossible de charger les paramètres.'));
        this.settingsLoading.set(false);
      }
    });
  }

  protected kind(value: SettingValue): SettingKind {
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    if (Array.isArray(value)) return 'list';
    if (value && typeof value === 'object') return 'map';
    return 'text';
  }

  protected mapEntries(value: SettingValue): [string, number][] {
    return Object.entries(value as Record<string, number>);
  }

  /** Valeur lisible avec son unité (« 1 800 s · 30 min », « 5 Mo », « Oui »). */
  protected format(value: SettingValue, unit: string | null): string {
    const suffix = unit ? ` ${unit}` : '';
    switch (this.kind(value)) {
      case 'boolean':
        return value ? 'Oui' : 'Non';
      case 'number':
        return this.formatNumber(value as number, unit);
      case 'list':
        return (value as number[]).map(n => this.num(n)).join(', ') + suffix;
      case 'map':
        return this.mapEntries(value).map(([k, n]) => `${k} : ${this.num(n)}${suffix}`).join(' · ');
      default:
        return (value as string) || '—';
    }
  }

  private formatNumber(n: number, unit: string | null): string {
    if (unit === 'octets') return n >= 1048576 ? `${this.num(n / 1048576)} Mo` : `${this.num(n)} octets`;
    const base = `${this.num(n)}${unit ? ' ' + unit : ''}`;
    return unit === 's' && n >= 60 ? `${base} · ${this.duration(n)}` : base;
  }

  private duration(seconds: number): string {
    if (seconds % 3600 === 0) return `${seconds / 3600} h`;
    if (seconds > 3600) return `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`;
    return `${this.num(seconds / 60)} min`;
  }

  private num(n: number): string {
    return n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  }

  protected startEdit(setting: Setting): void {
    const value = setting.value;
    this.editingKey.set(setting.key);
    this.editError.set('');
    this.settingsNotice.set('');
    if (this.kind(value) === 'map') {
      this.draftMap.set(Object.fromEntries(this.mapEntries(value).map(([k, n]) => [k, String(n)])));
    } else {
      this.draft.set(Array.isArray(value) ? value.join(', ') : String(value));
    }
  }

  protected cancelEdit(): void {
    this.editingKey.set(null);
  }

  protected setDraftMap(key: string, value: string): void {
    this.draftMap.update(m => ({ ...m, [key]: value }));
  }

  /** Vérifie la saisie (même type que la valeur actuelle) puis demande le motif. */
  protected reviewEdit(setting: Setting): void {
    const value = this.parseDraft(setting.value);
    if (value === null) return this.editError.set(this.invalidMessage(this.kind(setting.value)));
    if (JSON.stringify(value) === JSON.stringify(setting.value)) return this.editError.set('Valeur inchangée.');
    this.editError.set('');
    this.reason.set('');
    this.dialogError.set('');
    this.pending.set({ setting, value });
  }

  /** Interrupteur Oui/Non : demande directement le motif pour la valeur inverse. */
  protected toggleBoolean(setting: Setting): void {
    this.editingKey.set(null);
    this.settingsNotice.set('');
    this.reason.set('');
    this.dialogError.set('');
    this.pending.set({ setting, value: !setting.value });
  }

  /** Saisie convertie dans le type de la valeur actuelle, ou null si elle est invalide. */
  private parseDraft(current: SettingValue): SettingValue | null {
    const toNumber = (text: string): number | null => {
      const n = Number(text.replace(/\s/g, '').replace(',', '.'));
      return text.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
    };
    switch (this.kind(current)) {
      case 'boolean':
        return this.draft() === 'true';
      case 'number':
        return toNumber(this.draft());
      case 'list': {
        const values = this.draft().split(/[;,]/).filter(p => p.trim() !== '').map(toNumber);
        return values.length && values.every(v => v !== null) ? (values as number[]) : null;
      }
      case 'map': {
        const entries = Object.entries(this.draftMap()).map(([k, text]) => [k, toNumber(text)] as const);
        return entries.every(([, n]) => n !== null) ? Object.fromEntries(entries) as Record<string, number> : null;
      }
      default:
        return this.draft().trim();
    }
  }

  private invalidMessage(kind: SettingKind): string {
    if (kind === 'list') return 'Saisissez des nombres positifs séparés par des virgules (ex. 30, 7).';
    if (kind === 'map') return 'Chaque valeur doit être un nombre positif.';
    return 'Saisissez un nombre positif.';
  }

  protected closePending(): void {
    if (!this.busy()) this.pending.set(null);
  }

  protected saveSetting(): void {
    const pending = this.pending();
    if (!pending) return;
    const reason = this.reason().trim();
    if (!reason) return this.dialogError.set('Le motif est obligatoire.');
    this.busy.set(true);
    this.dialogError.set('');
    this.service.update(pending.setting.key, pending.value, reason).subscribe({
      next: res => {
        this.busy.set(false);
        this.pending.set(null);
        this.editingKey.set(null);
        const updatedAt = new Date().toISOString();
        this.settings.update(list => list.map(s => (s.key === res.key ? { ...s, value: res.value, updatedAt } : s)));
        this.settingsNotice.set(`« ${pending.setting.label} » : ${this.format(res.value, pending.setting.unit)}.`);
      },
      error: err => {
        this.busy.set(false);
        this.dialogError.set(this.message(err, "Le paramètre n'a pas pu être modifié."));
      }
    });
  }

  protected loadMaps(): void {
    this.mapsLoading.set(true);
    this.service.appParams().subscribe({
      next: params => {
        this.params.set(params);
        this.drafts.set({});
        this.editing.set({});
        this.mapsError.set('');
        this.mapsLoading.set(false);
      },
      error: err => {
        this.mapsError.set(this.message(err, 'Impossible de charger les clés Google Maps.'));
        this.mapsLoading.set(false);
      }
    });
  }

  /** Fin de clé seulement, comme dans le journal d'audit. */
  protected masked(key: string | null): string {
    return key ? `•••• ${key.slice(-4)}` : '';
  }

  protected edit(platform: MapsPlatform): void {
    this.editing.update(e => ({ ...e, [platform]: true }));
    this.drafts.update(d => ({ ...d, [platform]: this.params()?.maps[platform] ?? '' }));
    this.mapsNotice.set('');
  }

  protected setDraft(platform: MapsPlatform, value: string): void {
    this.drafts.update(d => ({ ...d, [platform]: value }));
  }

  /** Retirer = envoyer "" pour cette plateforme. */
  protected remove(platform: MapsPlatform): void {
    this.editing.update(e => ({ ...e, [platform]: false }));
    this.drafts.update(d => ({ ...d, [platform]: '' }));
    this.mapsNotice.set('');
  }

  protected cancel(platform: MapsPlatform): void {
    this.editing.update(e => ({ ...e, [platform]: false }));
    this.drafts.update(d => {
      const next = { ...d };
      delete next[platform];
      return next;
    });
  }

  protected isRemoved(platform: MapsPlatform): boolean {
    return this.drafts()[platform] === '' && !!this.params()?.maps[platform] && !this.editing()[platform];
  }

  protected openConfirm(): void {
    if (!this.changedPlatforms().length) return;
    this.reason.set('');
    this.dialogError.set('');
    this.confirming.set(true);
  }

  protected closeConfirm(): void {
    if (!this.busy()) this.confirming.set(false);
  }

  protected save(): void {
    const reason = this.reason().trim();
    if (!reason) return this.dialogError.set('Le motif est obligatoire.');
    const keys: Partial<Record<MapsPlatform, string>> = {};
    for (const p of this.changedPlatforms()) keys[p.key] = (this.drafts()[p.key] ?? '').trim();

    this.busy.set(true);
    this.dialogError.set('');
    this.service.updateAppParams(keys, reason).subscribe({
      next: () => {
        this.busy.set(false);
        this.confirming.set(false);
        this.mapsNotice.set('Clés enregistrées. Les apps les prennent en compte à leur prochain démarrage (jusqu’à 5 min).');
        this.loadMaps();
      },
      error: err => {
        this.busy.set(false);
        this.dialogError.set(this.message(err, "Les clés n'ont pas pu être enregistrées."));
      }
    });
  }

  private message(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) return 'Impossible de joindre le serveur.';
      if (err.status === 403) return "Vous n'avez pas les droits pour cette action.";
      const message = (err.error as { message?: string | string[] } | null)?.message;
      if (Array.isArray(message) && message.length) return message.join(' ');
      if (typeof message === 'string' && message) return message;
    }
    return fallback;
  }
}
