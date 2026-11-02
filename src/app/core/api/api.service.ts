import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

type QueryParams = Record<string, string | number | boolean | null | undefined>;

/** Client HTTP centralisé : préfixe l'URL de base issue de l'environnement. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  get<T>(path: string, params?: QueryParams): Observable<T> {
    return this.http.get<T>(this.url(path), { params: this.toParams(params) });
  }

  getBlob(path: string, params?: QueryParams): Observable<Blob> {
    return this.http.get(this.url(path), { params: this.toParams(params), responseType: 'blob' });
  }

  post<T>(path: string, body?: unknown): Observable<T> {
    return this.http.post<T>(this.url(path), body ?? {});
  }

  put<T>(path: string, body?: unknown): Observable<T> {
    return this.http.put<T>(this.url(path), body ?? {});
  }

  patch<T>(path: string, body?: unknown): Observable<T> {
    return this.http.patch<T>(this.url(path), body ?? {});
  }

  delete<T>(path: string, body?: unknown): Observable<T> {
    return this.http.delete<T>(this.url(path), body === undefined ? {} : { body });
  }

  private url(path: string): string {
    return `${environment.apiUrl}${path}`;
  }

  private toParams(params?: QueryParams): HttpParams | undefined {
    if (!params) return undefined;
    let result = new HttpParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined && value !== '') {
        result = result.set(key, String(value));
      }
    }
    return result;
  }
}
