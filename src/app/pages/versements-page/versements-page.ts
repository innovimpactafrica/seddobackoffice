import { Component } from '@angular/core';
import { NgClass } from '@angular/common';

type StatutVersement = 'Échoué' | 'En file' | 'Retenu' | 'Versé';

interface Versement {
  chauffeur: string;
  numeroOm: string;
  course: string;
  montant: string;
  tentatives: string;
  motif: string;
  statut: StatutVersement;
}

@Component({
  selector: 'app-versements-page',
  imports: [NgClass],
  templateUrl: './versements-page.html',
  styleUrl: './versements-page.css'
})
export class VersementsPage {
  protected readonly kpis = [
    { label: 'Versés (échantillon)', valeur: '868', sub: '2 778 918 F', red: false },
    { label: 'À traiter', valeur: '3', sub: '11 000 F', red: true },
    { label: 'Retenus (litige)', valeur: '5', sub: '16 545 F', red: false },
    { label: 'Tentatives max', valeur: '5', sub: 'puis file « à traiter »', red: false }
  ];

  protected readonly versements: Versement[] = [
    { chauffeur: 'Aïda D.', numeroOm: '70 ••• 29 88', course: 'SD-1326', montant: '4 880 F', tentatives: '3 / 5', motif: 'Numéro OM invalide', statut: 'Échoué' },
    { chauffeur: 'Malick S.', numeroOm: '78 ••• 46 52', course: 'SD-1058', montant: '3 880 F', tentatives: '5 / 5', motif: 'Délai dépassé côté Orange', statut: 'Échoué' },
    { chauffeur: 'Ibrahima F.', numeroOm: '77 ••• 61 07', course: 'SD-1802', montant: '2 240 F', tentatives: '3 / 5', motif: 'Délai dépassé côté Orange · prochaine tentative 18:55', statut: 'En file' },
    { chauffeur: 'Lamine D.', numeroOm: '78 ••• 14 50', course: 'SD-1837', montant: '2 480 F', tentatives: '0 / 5', motif: 'Course en incident', statut: 'Retenu' },
    { chauffeur: 'Serigne N.', numeroOm: '77 ••• 33 28', course: 'SD-1512', montant: '3 760 F', tentatives: '0 / 5', motif: 'Réclamation client ouverte', statut: 'Retenu' },
    { chauffeur: 'Mariama D.', numeroOm: '75 ••• 20 78', course: 'SD-1209', montant: '4 040 F', tentatives: '0 / 5', motif: 'Contrôle anti-fraude', statut: 'Retenu' },
    { chauffeur: 'Pape T.', numeroOm: '76 ••• 21 88', course: 'SD-865', montant: '2 665 F', tentatives: '0 / 5', motif: 'Réclamation client ouverte', statut: 'Retenu' },
    { chauffeur: 'Mamadou T.', numeroOm: '76 ••• 59 80', course: 'SD-793', montant: '3 600 F', tentatives: '0 / 5', motif: 'Contrôle anti-fraude', statut: 'Retenu' },
    { chauffeur: 'Aliou W.', numeroOm: '75 ••• 26 72', course: 'SD-1826', montant: '3 360 F', tentatives: '1 / 5', motif: '—', statut: 'Versé' },
    { chauffeur: 'Malick D.', numeroOm: '77 ••• 84 05', course: 'SD-1833', montant: '3 120 F', tentatives: '1 / 5', motif: '—', statut: 'Versé' }
  ];

  protected statutClass(s: StatutVersement): string {
    switch (s) {
      case 'Échoué': return 'pill-red';
      case 'En file': return 'pill-blue';
      case 'Retenu': return 'pill-gray';
      case 'Versé': return 'pill-green';
    }
  }
}
