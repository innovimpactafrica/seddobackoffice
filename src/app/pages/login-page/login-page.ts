import { Component, computed, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService, LoginChallenge, MIN_PASSWORD_LENGTH } from '../../auth/auth.service';
import { firstAllowedPath } from '../../auth/access';

@Component({
  selector: 'app-login-page',
  imports: [FormsModule],
  templateUrl: './login-page.html',
  styleUrl: './login-page.css'
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  protected email = '';
  protected password = '';
  protected readonly showPassword = signal(false);

  protected readonly otpDigits = signal<string[]>(['', '', '', '', '', '']);
  protected readonly otpIndices = [0, 1, 2, 3, 4, 5] as const;

  protected readonly step = signal<'credentials' | 'code' | 'password'>('credentials');
  protected readonly challenge = signal<LoginChallenge | null>(null);
  protected readonly errorMessage = signal('');
  protected readonly isLoading = signal(false);

  /** Changement du mot de passe provisoire (première connexion ou invitation). */
  protected readonly currentPassword = signal('');
  protected readonly newPassword = signal('');
  protected readonly confirmPassword = signal('');
  protected readonly showPasswords = signal(false);
  protected readonly minLength = MIN_PASSWORD_LENGTH;

  protected readonly rules = computed(() => {
    const value = this.newPassword();
    return [
      { label: `Au moins ${MIN_PASSWORD_LENGTH} caractères`, ok: value.length >= MIN_PASSWORD_LENGTH },
      { label: 'Différent du mot de passe provisoire', ok: !!value && value !== this.currentPassword() },
      { label: 'Confirmation identique', ok: !!value && value === this.confirmPassword() }
    ];
  });

  protected readonly canSubmitPassword = computed(
    () => !!this.currentPassword() && this.rules().every(rule => rule.ok)
  );

  constructor() {
    if (this.auth.isAuthenticated()) {
      if (this.auth.mustChangePassword()) {
        // Session ouverte avec un mot de passe provisoire (ex. rechargement de la page).
        this.step.set('password');
      } else {
        this.router.navigate([firstAllowedPath(this.auth.currentUser()?.roleCode)]);
      }
    }
  }

  protected onOtpInput(event: Event, index: number): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const input = event.target as HTMLInputElement;
    const digit = input.value.replace(/\D/g, '').slice(-1);

    this.otpDigits.update(prev => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });

    // Forcer la valeur dans le DOM
    input.value = digit;

    // Avancer au champ suivant
    if (digit && index < 5) {
      const el = document.getElementById(`otp-${index + 1}`) as HTMLInputElement | null;
      el?.focus();
    }
  }

  protected onOtpKeydown(event: KeyboardEvent, index: number): void {
    if (!isPlatformBrowser(this.platformId)) return;

    if (event.key === 'Backspace') {
      if (!this.otpDigits()[index] && index > 0) {
        event.preventDefault();
        this.otpDigits.update(prev => {
          const next = [...prev];
          next[index - 1] = '';
          return next;
        });
        const el = document.getElementById(`otp-${index - 1}`) as HTMLInputElement | null;
        if (el) {
          el.value = '';
          el.focus();
        }
      }
    }

    // Permettre la navigation clavier entre cellules
    if (event.key === 'ArrowLeft' && index > 0) {
      (document.getElementById(`otp-${index - 1}`) as HTMLInputElement | null)?.focus();
    }
    if (event.key === 'ArrowRight' && index < 5) {
      (document.getElementById(`otp-${index + 1}`) as HTMLInputElement | null)?.focus();
    }
  }

  protected onOtpPaste(event: ClipboardEvent): void {
    if (!isPlatformBrowser(this.platformId)) return;

    event.preventDefault();
    const pasted = (event.clipboardData?.getData('text') ?? '').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;

    const next = Array.from({ length: 6 }, (_, i) => pasted[i] ?? '');
    this.otpDigits.set(next);

    // Synchroniser les valeurs DOM
    setTimeout(() => {
      next.forEach((val, i) => {
        const el = document.getElementById(`otp-${i}`) as HTMLInputElement | null;
        if (el) el.value = val;
      });
      const focusIdx = next.findIndex(d => !d);
      const target = document.getElementById(`otp-${focusIdx === -1 ? 5 : focusIdx}`) as HTMLInputElement | null;
      target?.focus();
    });
  }

  protected async onSubmit(): Promise<void> {
    if (this.isLoading()) return;
    this.errorMessage.set('');

    switch (this.step()) {
      case 'credentials':
        await this.submitCredentials();
        break;
      case 'code':
        await this.submitCode();
        break;
      default:
        await this.submitPassword();
    }
  }

  /** Abandonne le changement de mot de passe : la session provisoire est fermée. */
  protected async cancelPasswordChange(): Promise<void> {
    await this.auth.signOut();
    this.currentPassword.set('');
    this.newPassword.set('');
    this.confirmPassword.set('');
    this.password = '';
    this.backToCredentials();
  }

  private async submitPassword(): Promise<void> {
    if (!this.canSubmitPassword()) {
      this.errorMessage.set('Le nouveau mot de passe ne respecte pas toutes les règles.');
      return;
    }

    this.isLoading.set(true);
    const result = await this.auth.changePassword(this.currentPassword(), this.newPassword());
    this.isLoading.set(false);

    if (result.success) {
      await this.router.navigate([firstAllowedPath(this.auth.currentUser()?.roleCode)]);
    } else {
      this.errorMessage.set(result.error ?? 'Le mot de passe n’a pas pu être modifié.');
    }
  }

  protected backToCredentials(): void {
    this.step.set('credentials');
    this.challenge.set(null);
    this.resetOtp();
    this.errorMessage.set('');
  }

  private async submitCredentials(): Promise<void> {
    if (!this.email.trim() || !this.password) {
      this.errorMessage.set('Saisissez votre adresse e-mail et votre mot de passe.');
      return;
    }

    this.isLoading.set(true);
    const result = await this.auth.login(this.email, this.password);
    this.isLoading.set(false);

    if (result.success && result.data) {
      this.challenge.set(result.data);
      this.step.set('code');
      this.resetOtp();
    } else {
      this.errorMessage.set(result.error ?? 'Erreur de connexion.');
    }
  }

  private async submitCode(): Promise<void> {
    const code = this.otpDigits().join('');
    const challenge = this.challenge();
    if (!challenge || code.length !== 6) {
      this.errorMessage.set('Saisissez le code à 6 chiffres.');
      return;
    }

    this.isLoading.set(true);
    const result = await this.auth.verifyCode(challenge.challengeToken, code);
    this.isLoading.set(false);

    if (result.success) {
      if (result.data?.mustChangePassword) {
        // Le mot de passe saisi à l'étape 1 est le provisoire : on le préremplit.
        this.currentPassword.set(this.password);
        this.step.set('password');
      } else {
        await this.router.navigate([firstAllowedPath(this.auth.currentUser()?.roleCode)]);
      }
    } else {
      this.errorMessage.set(result.error ?? 'Code invalide ou expiré.');
    }
  }

  private resetOtp(): void {
    this.otpDigits.set(['', '', '', '', '', '']);
    if (!isPlatformBrowser(this.platformId)) return;
    setTimeout(() => {
      this.otpIndices.forEach(i => {
        const el = document.getElementById(`otp-${i}`) as HTMLInputElement | null;
        if (el) el.value = '';
      });
      (document.getElementById('otp-0') as HTMLInputElement | null)?.focus();
    });
  }
}
