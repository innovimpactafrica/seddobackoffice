import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from './auth/auth.service';
import { canAccessPath, firstAllowedPath } from './auth/access';

interface NavItem {
  label: string;
  icon: string;
  path: string;
  badge?: number;
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

  /** Données statiques de démonstration (badges exacts de la maquette) */
  private readonly allNavGroups: NavGroup[] = [
    {
      title: 'PILOTAGE',
      items: [
        { label: 'Tableau de bord', icon: '',  path: '/dashboard' },
        { label: 'Courses',         icon: '',  path: '/courses',  badge: 10 },
        { label: 'Rapports',        icon: '',  path: '/rapports' }
      ]
    },
    {
      title: 'OPÉRATIONS',
      items: [
        { label: 'Chauffeurs', icon: '', path: '/chauffeurs', badge: 6 },
        { label: 'Clients',    icon: '', path: '/clients' },
        { label: 'Zones',      icon: '', path: '/zones' }
      ]
    },
    {
      title: 'FINANCE',
      items: [
        { label: 'Paiements',            icon: '', path: '/paiements' },
        { label: 'Versements',           icon: '', path: '/versements',    badge: 3 },
        { label: 'Rapprochement',        icon: '', path: '/rapprochement', badge: 1 }
      ]
    },
    {
      title: 'SUPPORT',
      items: [
        { label: 'Réclamations', icon: '', path: '/reclamations', badge: 8 },
        { label: 'Alertes SOS',  icon: '', path: '/alertes-sos',  badge: 1 },
        { label: 'Communication',icon: '', path: '/communication' }
      ]
    },
    {
      title: 'ADMINISTRATION',
      items: [
        { label: 'Tarifs et commission', icon: '', path: '/tarification' },
        { label: 'Utilisateurs',         icon: '', path: '/utilisateurs' },
        { label: "Journal d'audit",      icon: '', path: '/journal-audit' }
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
  }

  protected askLogout(): void {
    this.logoutConfirmOpen.set(true);
  }

  protected cancelLogout(): void {
    this.logoutConfirmOpen.set(false);
  }

  protected async confirmLogout(): Promise<void> {
    this.logoutConfirmOpen.set(false);
    await this.auth.signOut();
    await this.router.navigate(['/login']);
  }
}

