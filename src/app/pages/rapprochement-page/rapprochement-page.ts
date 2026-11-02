import { Component } from '@angular/core';

interface Journee {
  jour: string;
  releve: string;
  grandLivre: string;
  ecart: string;
  aTraiter: boolean;
  clotureePar: string;
}

@Component({
  selector: 'app-rapprochement-page',
  imports: [],
  templateUrl: './rapprochement-page.html',
  styleUrl: './rapprochement-page.css'
})
export class RapprochementPage {
  protected readonly kpis = [
    { label: 'Journées rapprochées', valeur: '44 / 45', sub: 'depuis le 1er mars', red: false },
    { label: 'Écarts ouverts', valeur: '1', sub: '1 500 F', red: true },
    { label: 'Taux automatique', valeur: '99,96 %', sub: 'opérations rapprochées sans action', red: false },
    { label: 'Dernier import', valeur: '15 avr. 06:00', sub: 'relevé du 14 avr.', red: false }
  ];

  protected readonly journees: Journee[] = [
    { jour: 'mer. 14 avr.', releve: '713 938 F', grandLivre: '712 438 F', ecart: '1 500 F', aTraiter: true, clotureePar: '—' },
    { jour: 'mar. 13 avr.', releve: '680 907 F', grandLivre: '680 907 F', ecart: '0 F', aTraiter: false, clotureePar: 'Ousmane D.' },
    { jour: 'lun. 12 avr.', releve: '642 789 F', grandLivre: '642 789 F', ecart: '0 F', aTraiter: false, clotureePar: 'Ousmane D.' },
    { jour: 'dim. 11 avr.', releve: '522 317 F', grandLivre: '522 317 F', ecart: '0 F', aTraiter: false, clotureePar: 'Ousmane D.' },
    { jour: 'sam. 10 avr.', releve: '786 130 F', grandLivre: '786 130 F', ecart: '0 F', aTraiter: false, clotureePar: 'Aminata K.' },
    { jour: 'ven. 9 avr.', releve: '712 298 F', grandLivre: '712 298 F', ecart: '0 F', aTraiter: false, clotureePar: 'Ousmane D.' },
    { jour: 'jeu. 8 avr.', releve: '608 625 F', grandLivre: '608 625 F', ecart: '0 F', aTraiter: false, clotureePar: 'Aminata K.' },
    { jour: 'mer. 7 avr.', releve: '602 440 F', grandLivre: '602 440 F', ecart: '0 F', aTraiter: false, clotureePar: 'Aminata K.' },
    { jour: 'mar. 6 avr.', releve: '635 041 F', grandLivre: '635 041 F', ecart: '0 F', aTraiter: false, clotureePar: 'Aminata K.' },
    { jour: 'lun. 5 avr.', releve: '583 026 F', grandLivre: '583 026 F', ecart: '0 F', aTraiter: false, clotureePar: 'Aminata K.' }
  ];
}
