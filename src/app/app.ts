import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { catchError, EMPTY, exhaustMap, filter, interval, merge, startWith, Subject } from 'rxjs';
import { AuthService } from './auth/auth.service';
import { canAccessPath, firstAllowedPath } from './auth/access';
import { AdminBadges, BadgeKey, BadgesService } from './core/api/badges.service';

/** Rafraîchissement périodique des compteurs de la sidebar. */
const BADGES_REFRESH_MS = 60_000;

interface NavItem {
  label: string;
  icon: string;
  path: string;
  /** Compteur de GET /v1/admin/badges affiché sur ce menu. */
  badgeKey?: BadgeKey;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly auth = inject(AuthService);
  private readonly badgesService = inject(BadgesService);

  /** Derniers compteurs reçus (null tant que rien n'est chargé : aucune pastille). */
  private readonly badges = signal<AdminBadges | null>(null);
  private readonly badgesRefresh = new Subject<void>();

  protected readonly pageTitle = signal('Tableau de bord');

  // Détection synchrone dès l'instanciation (évite tout flash de layout)
  protected readonly isLoginRoute = signal(
    (typeof window !== 'undefined' && window.location.pathname.includes('/login')) || false
  );

  /**
   * La sidebar et la structure du backoffice ne s'affichent QUE si :
   * - le profil est connecté (auth.isAuthenticated() === true)
   * - ET l'utilisateur n'est pas sur la page de connexion
   */
  protected readonly showShell = computed(() => {
    return this.auth.isAuthenticated() && !this.isLoginRoute();
  });

  /** Initiales de l'utilisateur pour l'avatar */
  protected readonly userInitials = computed(() => {
    const u = this.auth.currentUser();
    if (!u) return '?';
    return u.initials;
  });

  /** Menus de la sidebar ; `badgeKey` relie un menu à son compteur API. */
  private readonly allNavGroups: NavGroup[] = [
    {
      title: 'PILOTAGE',
      items: [
        { label: 'Tableau de bord', icon: '',  path: '/dashboard' },
        { label: 'Courses',         icon: '',  path: '/courses',  badgeKey: 'rides' },
        { label: 'Rapports',        icon: '',  path: '/rapports' }
      ]
    },
    {
      title: 'OPÉRATIONS',
      items: [
        { label: 'Chauffeurs', icon: '', path: '/chauffeurs', badgeKey: 'drivers' },
        { label: 'Clients',    icon: '', path: '/clients' },
        { label: 'Zones',      icon: '', path: '/zones' }
      ]
    },
    {
      title: 'FINANCE',
      items: [
        { label: 'Portefeuilles',        icon: '', path: '/portefeuilles' },
        { label: 'Paiements',            icon: '', path: '/paiements',     badgeKey: 'payments' },
        { label: 'Versements',           icon: '', path: '/versements',    badgeKey: 'payouts' },
        { label: 'Rapprochement',        icon: '', path: '/rapprochement', badgeKey: 'reconciliation' }
      ]
    },
    {
      title: 'SUPPORT',
      items: [
        { label: 'Réclamations', icon: '', path: '/reclamations', badgeKey: 'tickets' },
        { label: 'Alertes SOS',  icon: '', path: '/alertes-sos',  badgeKey: 'sos' },
        { label: 'Communication',icon: '', path: '/communication' }
      ]
    },
    {
      title: 'ADMINISTRATION',
      items: [
        { label: 'Tarifs et commission', icon: '', path: '/tarification' },
        { label: 'Utilisateurs',         icon: '', path: '/utilisateurs' },
        { label: "Journal d'audit",      icon: '', path: '/journal-audit' },
        { label: 'Paramètres',           icon: '', path: '/parametres' }
      ]
    }
  ];

  /** Menus visibles : seuls les écrans autorisés pour le rôle sont affichés, les groupes vides disparaissent. */
  protected readonly navGroups = computed<NavGroup[]>(() => {
    const role = this.auth.currentUser()?.roleCode;
    return this.allNavGroups
      .map(group => ({ ...group, items: group.items.filter(item => canAccessPath(role, item.path)) }))
      .filter(group => group.items.length > 0);
  });

  protected readonly logoutConfirmOpen = signal(false);

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.onNavEnd());

    this.onNavEnd();
    void this.syncProfile();
    this.watchBadges();
  }

  /** Compteur à afficher pour un menu (0 ou inconnu → pas de pastille). */
  protected badgeOf(item: NavItem): number {
    const value = item.badgeKey ? this.badges()?.[item.badgeKey] : undefined;
    return typeof value === 'number' && value > 0 ? value : 0;
  }

  protected badgeText(count: number): string {
    return count > 99 ? '99+' : String(count);
  }

  /**
   * Recharge les compteurs au démarrage, à chaque navigation (une action vient
   * peut-être d'être traitée) et toutes les minutes. Erreur → on garde les derniers.
   */
  private watchBadges(): void {
    if (typeof window === 'undefined') return;
    merge(this.badgesRefresh, interval(BADGES_REFRESH_MS))
      .pipe(
        startWith(undefined),
        filter(() => this.showShell()),
        exhaustMap(() => this.badgesService.get().pipe(catchError(() => EMPTY))),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(badges => this.badges.set(badges));
  }

  /** Rôle changé depuis la connexion : l'écran ouvert peut ne plus être autorisé. */
  private async syncProfile(): Promise<void> {
    if (typeof window === 'undefined') return;
    await this.auth.refreshProfile();
    const user = this.auth.currentUser();
    if (!user) return;
    if (this.auth.mustChangePassword()) {
      void this.router.navigate(['/login']);
    } else if (!canAccessPath(user.roleCode, this.router.url)) {
      void this.router.navigateByUrl(firstAllowedPath(user.roleCode));
    }
  }

  private onNavEnd(): void {
    let route = this.router.routerState.snapshot.root;
    while (route.firstChild) {
      route = route.firstChild;
    }
    this.pageTitle.set(String(route.data['title'] ?? 'Tableau de bord'));

    const currentUrl = this.router.url || (typeof window !== 'undefined' ? window.location.pathname : '');
    this.isLoginRoute.set(currentUrl.includes('/login'));
    this.badgesRefresh.next();
  }

  protected askLogout(): void {
    this.logoutConfirmOpen.set(true);
  }

  protected cancelLogout(): void {
    this.logoutConfirmOpen.set(false);
  }

  protected async confirmLogout(): Promise<void> {
    this.logoutConfirmOpen.set(false);
    this.badges.set(null);
    await this.auth.signOut();
    await this.router.navigate(['/login']);
  }
}

