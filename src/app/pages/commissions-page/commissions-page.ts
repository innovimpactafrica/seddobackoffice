import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

interface CommissionPalier {
  segment: string;
  tauxSeddo: number;
  partChauffeur: number;
  description: string;
  volumeMensuel: string;
}

@Component({
  selector: 'app-commissions-page',
  imports: [CommonModule],
  templateUrl: './commissions-page.html',
  styleUrl: './commissions-page.css'
})
export class CommissionsPage {
  protected readonly paliers: CommissionPalier[] = [
    { segment: 'Chauffeur Standard', tauxSeddo: 15, partChauffeur: 85, description: 'Taux par défaut appliqué sur toutes les courses urbaines', volumeMensuel: '8 400 000 FCFA' },
    { segment: 'Chauffeur Élite (&gt; 150 courses/mois)', tauxSeddo: 12, partChauffeur: 88, description: 'Bonus de fidélité pour les chauffeurs assidus', volumeMensuel: '2 150 000 FCFA' },
    { segment: 'Partenaires Flotte Pro', tauxSeddo: 10, partChauffeur: 90, description: 'Contrats B2B et gestionnaires de parcs', volumeMensuel: '1 200 000 FCFA' }
  ];
}
