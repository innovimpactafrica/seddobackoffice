import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_ENDPOINTS } from '../../core/api/api-endpoints';
import { ApiService } from '../../core/api/api.service';

export type CampaignChannel = 'PUSH' | 'SMS';

export interface AudienceOption {
  type: string;
  label: string;
  inactiveDays?: number;
}

export interface ZoneOption {
  id: string | null;
  name: string;
  kind: string | null;
}

export interface ChannelOption {
  code: CampaignChannel;
  label: string;
}

export interface CampaignOptions {
  audiences: AudienceOption[];
  zones: ZoneOption[];
  channels: ChannelOption[];
  maxBodyLength: number;
}

export interface CampaignMessageInfo {
  characters: number;
  encoding: string;
  smsParts: number;
}

export interface Campaign {
  id: string;
  date: string;
  status: string;
  audience: { type: string; inactiveDays?: number; zoneId?: string };
  audienceLabel: string;
  channels: CampaignChannel[];
  channelLabel: string;
  recipients: number | null;
  pushSent: number | null;
  smsSent: number | null;
  opens: number;
  openRate: number | null;
  title: string | null;
  body: string;
  message: CampaignMessageInfo;
  scheduledAt: string | null;
  sentAt: string | null;
  createdBy: string;
}

export interface CampaignsPage {
  items: Campaign[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CampaignAudience {
  type: string;
  inactiveDays?: number;
  zoneId?: string;
}

export interface NewCampaign {
  channels: CampaignChannel[];
  audience: CampaignAudience;
  body: string;
  title?: string;
  /** ISO 8601, heure de Dakar = UTC (suffixe Z) ; absent = envoi immédiat. */
  scheduledAt?: string;
}

export interface CampaignPreview {
  recipients: number;
  audienceLabel: string;
  message: CampaignMessageInfo;
}

@Injectable({ providedIn: 'root' })
export class CampaignsService {
  private readonly api = inject(ApiService);

  options(): Observable<CampaignOptions> {
    return this.api.get<CampaignOptions>(API_ENDPOINTS.campaigns.options);
  }

  list(page: number, pageSize: number, q?: string): Observable<CampaignsPage> {
    return this.api.get<CampaignsPage>(API_ENDPOINTS.campaigns.list, { page, pageSize, q });
  }

  preview(audience: CampaignAudience, body: string): Observable<CampaignPreview> {
    return this.api.post<CampaignPreview>(API_ENDPOINTS.campaigns.preview, { ...audience, body });
  }

  create(campaign: NewCampaign): Observable<Campaign> {
    return this.api.post<Campaign>(API_ENDPOINTS.campaigns.create, campaign);
  }

  /** Annule une campagne programmée pas encore envoyée. */
  cancel(id: string): Observable<unknown> {
    return this.api.post(API_ENDPOINTS.campaigns.cancel(id));
  }
}
