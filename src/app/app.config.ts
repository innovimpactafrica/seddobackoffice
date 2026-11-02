import { ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { authInterceptor } from './core/api/auth.interceptor';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';

// Pipes date et nombres en français (« 26 oct. 2026 », « 12,3 »).
registerLocaleData(localeFr);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    provideRouter(routes), provideClientHydration(withEventReplay()),
    { provide: LOCALE_ID, useValue: 'fr' }
  ]
};
