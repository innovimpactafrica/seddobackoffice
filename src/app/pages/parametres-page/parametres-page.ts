import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-parametres-page',
  imports: [CommonModule],
  templateUrl: './parametres-page.html',
  styleUrl: './parametres-page.css'
})
export class ParametresPage {
  protected readonly config = {
    nomPlateforme: 'Seddo VTC Dakar',
    devise: 'Franc CFA (XOF)',
    fuseauHoraire: 'GMT+0 (Dakar / Casablanca)',
    delaiExpirationOtp: 300,
    seuilAlerteSoldeOm: 500000,
    modeMaintenance: false,
    contactSupport: '+221 33 800 00 00',
    emailSupport: 'support@seddo.sn'
  };
}
