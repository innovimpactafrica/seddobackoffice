import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_ENDPOINTS } from '../../core/api/api-endpoints';
import { ApiService } from '../../core/api/api.service';
import { RideStatus } from '../courses-page/rides.service';

export type DriverStatus = 'DRAFT' | 'IN_REVIEW' | 'DOCUMENT_TO_FIX' | 'VALIDATED' | 'REFUSED' | 'SUSPENDED' | 'BANNED';
export type DriverAction = 'validate' | 'request-fix' | 'refuse' | 'suspend' | 'reactivate' | 'ban';
export type SelfieStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Ligne de la liste ; le téléphone arrive masqué (« +221 77 *** ** 11 »). */
export interface DriverListItem {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string;
  status: DriverStatus;
  /** Chaîne décimale (« 5.00 »). */
  rating: string | null;
  acceptanceRate: number | null;
  cancelRate: number | null;
  plate: string | null;
  make: string | null;
  model: string | null;
  category: string | null;
  vehicleStatus: string | null;
  completedRides: number;
  appointmentAt: string | null;
  appointmentChangeRequested: boolean;
  createdAt: string;
}

export interface DriverVehicle {
  id?: string;
  category?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  color?: string | null;
  plate?: string | null;
  seats?: number | null;
  status?: string | null;
}

export interface DriverDetail {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string;
  lang: string;
  accountStatus: string;
  status: DriverStatus;
  rating: string | null;
  acceptanceRate: number | null;
  cancelRate: number | null;
  payoutMsisdn: string | null;
  payoutMsisdnVerified: boolean;
  createdAt: string;
  vehicle: DriverVehicle | null;
  stats: { completed: number; cancelledByDriver: number; netEarnings: number };
  /** ONLINE, OFFLINE, BUSY (en course). */
  presence: string;
  recentRides: DriverRide[];
  recentPayouts: DriverPayout[];
}

export interface DriverRide {
  id: string;
  ref: string;
  status: RideStatus;
  /** Prix payé par le client. */
  price: number;
  driverNet: number;
  createdAt: string;
}

/** Versement Orange Money ; `orderId` = référence de la course suivie de -P1, -P2… */
export interface DriverPayout {
  orderId: string;
  amount: number;
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | string;
  attempts: number;
  /** Retenu par la Finance. */
  held: boolean;
  createdAt: string;
}

export type DocumentStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

/** Pièce envoyée : format supposé (liste vide dans la seule réponse reçue). */
export interface DossierDocument {
  id: string;
  type: string;
  label?: string | null;
  status: DocumentStatus | string;
  expiresAt?: string | null;
  rejectionReason?: string | null;
  uploadedAt?: string | null;
  mimeType?: string | null;
}

export interface EmergencyContact {
  name?: string | null;
  phone?: string | null;
  relation?: string | null;
}

export interface AppointmentChangeRequest {
  reason?: string | null;
  preferredAt?: string | null;
  requestedAt?: string | null;
}

export interface Dossier {
  form: {
    firstName: string | null;
    lastName: string | null;
    birthDate: string | null;
    address: string | null;
    emergencyContact: EmergencyContact | null;
    status: DriverStatus;
    charterVersion: string | null;
    charterSignedAt: string | null;
    submittedAt: string | null;
    appointmentAt: string | null;
    appointmentNote: string | null;
    appointmentPlace: string | null;
    appointmentChangeRequest: AppointmentChangeRequest | null;
    reviewNote: string | null;
  };
  vehicle: DriverVehicle | null;
  documents: DossierDocument[];
  /** Codes des pièces obligatoires non fournies. */
  missing: string[];
}

export interface Appointment {
  at: string;
  place?: string;
  note?: string;
}

export interface DocumentType {
  code: string;
  label: string;
  instruction: string;
  /** 2 = Vos documents, 3 = Votre véhicule. */
  step: 2 | 3;
  required: boolean;
  needsExpiry: boolean;
  active: boolean;
  sortOrder: number;
}

export interface NewDocumentType {
  code: string;
  label: string;
  instruction: string;
  step: 2 | 3;
  required: boolean;
  needsExpiry: boolean;
  sortOrder?: number;
  reason: string;
}

export type DocumentTypePatch = Partial<Omit<DocumentType, 'code'>> & { reason: string };

export interface DailySelfie {
  id: string;
  driverId: string;
  firstName: string | null;
  lastName: string | null;
  day: string;
  takenAt: string;
  status: SelfieStatus;
  rejectionReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  /** Photo SELFIE du dossier ; null = rien à comparer. */
  referenceDocumentId: string | null;
}

/** Ligne de GET /wallets : portefeuille d'un chauffeur (montants en F CFA). */
export interface WalletListItem {
  driverId: string;
  firstName: string | null;
  lastName: string | null;
  phone: string;
  balance: number;
  /** Commissions retenues sur les courses en espèces en cours. */
  reserved: number;
  available: number;
  cashEnabled: boolean;
  cashBlocked: boolean;
  blockedReason: string | null;
  lastTopupAt: string | null;
}

export type WalletFilter = 'below_reserve' | 'blocked';

/** Mouvement du portefeuille ; `ride` et `topup` ne sont renseignés que pour ces types (forme non documentée). */
export interface WalletEntry {
  id: string;
  /** ADJUSTMENT, et selon les courses et rechargements (types non documentés). */
  type: string;
  /** Signé : + crédit, − débit. */
  amount: number;
  at: string;
  reason: string | null;
  ride: { id?: string; ref?: string } | null;
  topup: { id?: string; ref?: string } | null;
}

/** Fiche portefeuille (GET /wallets/{driverId}), renvoyée aussi après un ajustement ou un blocage. */
export interface WalletDetail {
  currency: string;
  available: number;
  balance: number;
  reserved: number;
  /** Réserve minimale exigée en plus de la commission pour recevoir une course en espèces. */
  minReserve: number;
  /** Commission maximale couverte par le disponible (disponible − réserve minimale). */
  maxCommission: number;
  cashEnabled: boolean;
  cashBlocked: boolean;
  blockedReason: string | null;
  lowBalance: boolean;
  /** Message affiché au chauffeur dans son app. */
  message: string | null;
  topupAmounts: number[];
  /** Montants retenus sur des courses en cours (forme non documentée). */
  holds: { id?: string; amount?: number; ride?: { ref?: string } | null; at?: string; createdAt?: string }[];
  entries: WalletEntry[];
}

@Injectable({ providedIn: 'root' })
export class DriversService {
  private readonly api = inject(ApiService);

  list(params: { page: number; pageSize: number; status?: string; q?: string }): Observable<Paged<DriverListItem>> {
    return this.api.get<Paged<DriverListItem>>(API_ENDPOINTS.drivers.list, params);
  }

  detail(id: string): Observable<DriverDetail> {
    return this.api.get<DriverDetail>(API_ENDPOINTS.drivers.detail(id));
  }

  /** Renvoie le nouveau statut du dossier. */
  act(id: string, action: DriverAction, reason: string): Observable<{ id: string; status: DriverStatus }> {
    return this.api.post(API_ENDPOINTS.drivers.action(id, action), { reason });
  }

  dossier(id: string): Observable<Dossier> {
    return this.api.get<Dossier>(API_ENDPOINTS.drivers.dossier(id));
  }

  /** Consultation tracée au journal d'audit. */
  documentFile(id: string, docId: string): Observable<Blob> {
    return this.api.getBlob(API_ENDPOINTS.drivers.documentFile(id, docId));
  }

  approveDocument(id: string, docId: string): Observable<{ id: string; status: string }> {
    return this.api.post(API_ENDPOINTS.drivers.approveDocument(id, docId));
  }

  /** Le dossier passe en « Pièce à corriger » et le chauffeur est prévenu. */
  rejectDocument(id: string, docId: string, reason: string): Observable<{ id: string; status: string }> {
    return this.api.post(API_ENDPOINTS.drivers.rejectDocument(id, docId), { reason });
  }

  /** Chauffeur prévenu par SMS ; efface sa demande de changement. */
  setAppointment(id: string, body: Appointment): Observable<{ appointmentAt: string; place: string; note: string | null }> {
    return this.api.post(API_ENDPOINTS.drivers.appointment(id), body);
  }

  /** Demande validée ensuite par la Finance. */
  requestPayoutMsisdn(id: string, body: { msisdn: string; holderName: string; reason: string }): Observable<{ requestId: string; status: string }> {
    return this.api.post(API_ENDPOINTS.drivers.payoutMsisdnRequest(id), body);
  }

  revealPhone(id: string, reason: string): Observable<{ phone: string }> {
    return this.api.post(API_ENDPOINTS.drivers.revealPhone(id), { reason });
  }

  documentTypes(): Observable<DocumentType[]> {
    return this.api.get<DocumentType[]>(API_ENDPOINTS.drivers.documentTypes);
  }

  createDocumentType(body: NewDocumentType): Observable<unknown> {
    return this.api.post(API_ENDPOINTS.drivers.documentTypes, body);
  }

  updateDocumentType(code: string, body: DocumentTypePatch): Observable<unknown> {
    return this.api.patch(API_ENDPOINTS.drivers.documentType(code), body);
  }

  selfies(params: { page: number; pageSize: number; status: SelfieStatus; q?: string }): Observable<Paged<DailySelfie>> {
    return this.api.get<Paged<DailySelfie>>(API_ENDPOINTS.drivers.selfies, params);
  }

  /** Consultation tracée au journal d'audit : à charger à la demande, pas pour toute la liste. */
  selfieFile(id: string): Observable<Blob> {
    return this.api.getBlob(API_ENDPOINTS.drivers.selfieFile(id));
  }

  selfieReference(id: string): Observable<Blob> {
    return this.api.getBlob(API_ENDPOINTS.drivers.selfieReference(id));
  }

  wallets(params: { q?: string; filter?: WalletFilter }): Observable<WalletListItem[]> {
    return this.api.get<WalletListItem[]>(API_ENDPOINTS.wallets.list, params);
  }

  wallet(driverId: string): Observable<WalletDetail> {
    return this.api.get<WalletDetail>(API_ENDPOINTS.wallets.detail(driverId));
  }

  /** Ajustement par la Finance : montant signé (+ crédite, − débite), motif obligatoire. */
  adjustWallet(driverId: string, amount: number, reason: string): Observable<WalletDetail> {
    return this.api.post<WalletDetail>(API_ENDPOINTS.wallets.adjust(driverId), { amount, reason });
  }

  setCashBlocked(driverId: string, blocked: boolean, reason: string): Observable<WalletDetail> {
    return this.api.put<WalletDetail>(API_ENDPOINTS.wallets.cashBlock(driverId), { blocked, reason });
  }

  approveSelfie(id: string): Observable<unknown> {
    return this.api.post(API_ENDPOINTS.drivers.approveSelfie(id));
  }

  rejectSelfie(id: string, reason: string): Observable<{ id: string; status: string; driverSetOffline: boolean }> {
    return this.api.post(API_ENDPOINTS.drivers.rejectSelfie(id), { reason });
  }
}

export function driverName(d: { firstName: string | null; lastName: string | null }): string {
  return [d.firstName, d.lastName].filter(Boolean).join(' ').trim();
}
