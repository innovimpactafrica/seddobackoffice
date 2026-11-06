import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { canAccessPath } from '../../auth/access';
import { DriverWallet } from '../chauffeurs-page/driver-wallet';
import { driverName, DriversService, WalletListItem } from '../chauffeurs-page/drivers.service';
import { WalletsPanel } from '../chauffeurs-page/wallets-panel';

/** Chauffeur affiché en tête de la fiche portefeuille. */
interface Selected {
  id: string;
  name: string;
  phone: string | null;
}

/**
 * Menu « Portefeuilles » : liste de tous les portefeuilles chauffeurs puis fiche d'un portefeuille
 * (mouvements, ajustement, blocage des espèces). L'URL garde le chauffeur ouvert (?id=…).
 */
@Component({
  selector: 'app-portefeuilles-page',
  imports: [RouterLink, WalletsPanel, DriverWallet],
  templateUrl: './portefeuilles-page.html',
  styleUrl: './portefeuilles-page.css'
})
export class PortefeuillesPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly drivers = inject(DriversService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly role = computed(() => this.auth.currentUser()?.roleCode ?? '');
  /** Ajustement et blocage : Admin et Finance ; les autres rôles consultent. */
  protected readonly canManage = computed(() => ['ADMIN', 'FINANCE'].includes(this.role()));
  /** Le lien vers la fiche chauffeur n'apparaît que si le rôle a accès à la page Chauffeurs. */
  protected readonly canOpenDriver = computed(() => canAccessPath(this.role(), '/chauffeurs'));

  protected readonly selected = signal<Selected | null>(null);

  ngOnInit(): void {
    const id = this.route.snapshot.queryParamMap.get('id');
    if (id) this.openById(id);
  }

  protected open(w: WalletListItem): void {
    this.selected.set({ id: w.driverId, name: driverName(w) || 'Chauffeur sans nom', phone: w.phone });
    this.syncUrl(w.driverId);
  }

  protected back(): void {
    this.selected.set(null);
    this.syncUrl(null);
  }

  /** Arrivée directe par l'URL : le nom vient de la liste des portefeuilles (lisible par tous les rôles de la page). */
  private openById(id: string): void {
    this.selected.set({ id, name: 'Portefeuille chauffeur', phone: null });
    this.drivers.wallets({}).subscribe({
      next: list => {
        const w = list.find(x => x.driverId === id);
        if (w && this.selected()?.id === id) this.selected.set({ id, name: driverName(w) || 'Chauffeur sans nom', phone: w.phone });
      },
      error: () => {}
    });
  }

  private syncUrl(id: string | null): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { id }, replaceUrl: true });
  }
}
