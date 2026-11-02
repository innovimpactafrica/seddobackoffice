import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './auth/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    data: { title: 'Connexion' },
    loadComponent: () =>
      import('./pages/login-page/login-page').then(({ LoginPage }) => LoginPage)
  },
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'dashboard'
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    data: { title: 'Tableau de bord' },
    loadComponent: () =>
      import('./pages/dashboard-page/dashboard-page').then(({ DashboardPage }) => DashboardPage)
  },
  {
    path: 'courses',
    canActivate: [authGuard],
    data: { title: 'Courses' },
    loadComponent: () =>
      import('./pages/courses-page/courses-page').then(({ CoursesPage }) => CoursesPage)
  },
  {
    path: 'rapports',
    canActivate: [authGuard],
    data: { title: 'Rapports' },
    loadComponent: () =>
      import('./pages/rapports-page/rapports-page').then(({ RapportsPage }) => RapportsPage)
  },
  {
    path: 'chauffeurs',
    canActivate: [authGuard],
    data: { title: 'Chauffeurs' },
    loadComponent: () =>
      import('./pages/chauffeurs-page/chauffeurs-page').then(({ ChauffeursPage }) => ChauffeursPage)
  },
  {
    path: 'clients',
    canActivate: [authGuard],
    data: { title: 'Clients' },
    loadComponent: () =>
      import('./pages/clients-page/clients-page').then(({ ClientsPage }) => ClientsPage)
  },
  {
    path: 'zones',
    canActivate: [authGuard],
    data: { title: 'Zones' },
    loadComponent: () =>
      import('./pages/zones-page/zones-page').then(({ ZonesPage }) => ZonesPage)
  },
  {
    path: 'paiements',
    canActivate: [authGuard],
    data: { title: 'Paiements' },
    loadComponent: () =>
      import('./pages/paiements-page/paiements-page').then(({ PaiementsPage }) => PaiementsPage)
  },
  {
    path: 'versements',
    canActivate: [authGuard],
    data: { title: 'Versements chauffeurs' },
    loadComponent: () =>
      import('./pages/versements-page/versements-page').then(({ VersementsPage }) => VersementsPage)
  },
  {
    path: 'rapprochement',
    canActivate: [authGuard],
    data: { title: 'Rapprochement' },
    loadComponent: () =>
      import('./pages/rapprochement-page/rapprochement-page').then(({ RapprochementPage }) => RapprochementPage)
  },
  {
    path: 'reclamations',
    canActivate: [authGuard],
    data: { title: 'Réclamations / litiges' },
    loadComponent: () =>
      import('./pages/reclamations-page/reclamations-page').then(({ ReclamationsPage }) => ReclamationsPage)
  },
  {
    path: 'alertes-sos',
    canActivate: [authGuard],
    data: { title: 'Alertes SOS' },
    loadComponent: () =>
      import('./pages/alertes-sos-page/alertes-sos-page').then(({ AlertesSosPage }) => AlertesSosPage)
  },
  {
    path: 'communication',
    canActivate: [authGuard],
    data: { title: 'Communication' },
    loadComponent: () =>
      import('./pages/communication-page/communication-page').then(({ CommunicationPage }) => CommunicationPage)
  },
  {
    path: 'tarification',
    canActivate: [authGuard],
    data: { title: 'Tarification' },
    loadComponent: () =>
      import('./pages/tarification-page/tarification-page').then(({ TarificationPage }) => TarificationPage)
  },
  {
    path: 'commissions',
    canActivate: [authGuard],
    data: { title: 'Commissions' },
    loadComponent: () =>
      import('./pages/commissions-page/commissions-page').then(({ CommissionsPage }) => CommissionsPage)
  },
  {
    path: 'utilisateurs',
    canActivate: [authGuard],
    data: { title: 'Utilisateurs' },
    loadComponent: () =>
      import('./pages/utilisateurs-page/utilisateurs-page').then(({ UtilisateursPage }) => UtilisateursPage)
  },
  {
    path: 'journal-audit',
    canActivate: [authGuard],
    data: { title: "Journal d'audit" },
    loadComponent: () =>
      import('./pages/journal-audit-page/journal-audit-page').then(({ JournalAuditPage }) => JournalAuditPage)
  },
  {
    path: 'parametres',
    canActivate: [authGuard],
    data: { title: 'Paramètres' },
    loadComponent: () =>
      import('./pages/parametres-page/parametres-page').then(({ ParametresPage }) => ParametresPage)
  },
  {
    path: '**',
    redirectTo: 'dashboard'
  }
];
