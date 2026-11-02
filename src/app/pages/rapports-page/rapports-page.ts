import { HttpErrorResponse } from '@angular/common/http';
import { AfterViewInit, Component, computed, ElementRef, inject, OnDestroy, OnInit, PLATFORM_ID, signal, ViewChild } from '@angular/core';
import { DatePipe, isPlatformBrowser } from '@angular/common';
import { catchError, forkJoin, map, of } from 'rxjs';
import { Chart, registerables } from 'chart.js';
import { ReportPeriod, ReportsService, ReportSummary } from './reports.service';

Chart.register(...registerables);

type PeriodKey = '7d' | '14d' | '30d' | 'month' | 'lastMonth';

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: '7d', label: '7 derniers jours' },
  { key: '14d', label: '14 derniers jours' },
  { key: '30d', label: '30 derniers jours' },
  { key: 'month', label: 'Ce mois-ci' },
  { key: 'lastMonth', label: 'Mois dernier' }
];

type Level = 'vert' | 'orange' | 'rouge' | 'gris';

interface Indicator {
  label: string;
  value: string;
  target: string;
  level: Level;
}

interface DayRow {
  date: Date;
  completed: number;
  gmv: number;
  commission: number;
  refunded: number;
  cancelled: number;
  noDriver: number;
  isToday: boolean;
}

const fmt = (n: number): string => Math.round(n).toLocaleString('fr-FR');

/** Montant compact : 26,8 M F ; 92 950 F en dessous du million. */
const compact = (n: number): string =>
  Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M F` : `${fmt(n)} F`;

const duration = (s: number): string => (s < 90 ? `${Math.round(s)} s` : `${(s / 60).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} min`);

/** Date locale → `AAAA-MM-JJ`. */
const isoDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const addDays = (d: Date, n: number): Date => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};

@Component({
  selector: 'app-rapports-page',
  imports: [DatePipe],
  templateUrl: './rapports-page.html',
  styleUrl: './rapports-page.css'
})
export class RapportsPage implements OnInit, AfterViewInit, OnDestroy {
  private readonly service = inject(ReportsService);
  private readonly platformId = inject(PLATFORM_ID);

  @ViewChild('barCanvas') private barCanvas?: ElementRef<HTMLCanvasElement>;
  private barChart?: Chart;
  private seq = 0;

  protected readonly periods = PERIODS;
  protected readonly periodKey = signal<PeriodKey>('7d');

  protected readonly summary = signal<ReportSummary | null>(null);
  /** Même durée juste avant : pour « vs période précédente ». */
  protected readonly previous = signal<ReportSummary | null>(null);
  /** Plus récent en premier (tableau) ; le graphique les reprend dans l'ordre chronologique. */
  protected readonly days = signal<DayRow[]>([]);
  protected readonly daysError = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly exporting = signal(false);

  /** Période envoyée à l'API (`to` exclue) et jours qu'elle couvre. */
  protected readonly range = computed(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = addDays(today, 1);
    let from: Date;
    let to = tomorrow;
    switch (this.periodKey()) {
      case '7d': from = addDays(today, -6); break;
      case '14d': from = addDays(today, -13); break;
      case '30d': from = addDays(today, -29); break;
      case 'month': from = new Date(today.getFullYear(), today.getMonth(), 1); break;
      case 'lastMonth':
        from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        to = new Date(today.getFullYear(), today.getMonth(), 1);
        break;
    }
    const count = Math.round((to.getTime() - from.getTime()) / 86_400_000);
    return { from, to, last: addDays(to, -1), count };
  });

  protected readonly kpis = computed(() => {
    const s = this.summary();
    if (!s) return [];
    const p = this.previous();
    const r = s.rides;
    const rate = r.gmv > 0 ? (r.commission / r.gmv) * 100 : null;
    return [
      { label: 'Courses terminées', val: fmt(r.completed), sub: this.trend(r.completed, p?.rides.completed) ?? `sur ${fmt(r.orders)} commandes` },
      { label: 'Encaissé', val: compact(r.gmv), sub: this.trend(r.gmv, p?.rides.gmv) ?? '—' },
      { label: 'Commission Seddo', val: compact(r.commission), sub: rate === null ? '—' : `taux moyen ${rate.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %` },
      { label: 'Remboursé', val: compact(s.money.refunded), sub: this.trend(s.money.refunded, p?.money.refunded) ?? 'aux clients' },
      { label: 'Versé aux chauffeurs', val: compact(s.money.paidOut), sub: `gains chauffeurs ${compact(r.driverEarnings)}` }
    ];
  });

  /** Cibles reprises de la maquette du backoffice. */
  protected readonly indicators = computed<Indicator[]>(() => {
    const s = this.summary();
    if (!s) return [];
    const level = (ok: boolean, near: boolean): Level => (ok ? 'vert' : near ? 'orange' : 'rouge');
    const none = (label: string, target: string): Indicator => ({ label, value: '—', target, level: 'gris' });
    const served = s.rides.servedRate === null ? null : Number(s.rides.servedRate) * 100;
    const rating = s.rating.avgDriverRating === null ? null : Number(s.rating.avgDriverRating);
    const pickup = s.rides.avgPickupS;
    const payout = s.money.payoutP95S;
    const refund = s.money.refundP95S;
    return [
      served === null ? none('Courses servies', '> 85 %') : { label: 'Courses servies', value: `${served.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`, target: '> 85 %', level: level(served > 85, served > 75) },
      pickup === null ? none('Arrivée du chauffeur', '< 7 min') : { label: 'Arrivée du chauffeur', value: duration(pickup), target: '< 7 min', level: level(pickup < 420, pickup < 600) },
      payout === null ? none('Versement p95', '< 15 min') : { label: 'Versement p95', value: duration(payout), target: '< 15 min', level: level(payout < 900, payout < 1200) },
      refund === null ? none('Remboursement p95', '< 5 min') : { label: 'Remboursement p95', value: duration(refund), target: '< 5 min', level: level(refund < 300, refund < 420) },
      rating === null
        ? none('Note moyenne', '≥ 4,5')
        : { label: 'Note moyenne', value: rating.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), target: '≥ 4,5', level: level(rating >= 4.5, rating >= 4.2) }
    ];
  });

  ngOnInit(): void {
    this.load();
  }

  ngAfterViewInit(): void {
    this.renderChart();
  }

  ngOnDestroy(): void {
    this.barChart?.destroy();
  }

  protected setPeriod(key: string): void {
    this.periodKey.set(key as PeriodKey);
    this.load();
  }

  protected money(n: number): string {
    return `${fmt(n)} F`;
  }

  protected load(): void {
    const { from, to, count } = this.range();
    const period: ReportPeriod = { from: isoDay(from), to: isoDay(to) };
    const before: ReportPeriod = { from: isoDay(addDays(from, -count)), to: isoDay(from) };
    const todayIso = isoDay(new Date());
    // L'API ne donne que des totaux : une synthèse par jour pour le graphique et le détail.
    const dayList = Array.from({ length: count }, (_, i) => addDays(from, i));
    const daily$ = forkJoin(
      dayList.map(d =>
        this.service.summary({ from: isoDay(d), to: isoDay(addDays(d, 1)) }).pipe(
          map((s): DayRow => ({
            date: d,
            completed: s.rides.completed,
            gmv: s.rides.gmv,
            commission: s.rides.commission,
            refunded: s.money.refunded,
            cancelled: s.rides.cancelled,
            noDriver: s.rides.noDriver,
            isToday: isoDay(d) === todayIso
          }))
        )
      )
    ).pipe(catchError(() => of(null)));

    const seq = ++this.seq;
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      summary: this.service.summary(period),
      previous: this.service.summary(before).pipe(catchError(() => of(null))),
      daily: daily$
    }).subscribe({
      next: ({ summary, previous, daily }) => {
        if (seq !== this.seq) return;
        this.summary.set(summary);
        this.previous.set(previous);
        this.daysError.set(daily === null);
        this.days.set((daily ?? []).slice().reverse());
        this.loading.set(false);
        this.renderChart();
      },
      error: err => {
        if (seq !== this.seq) return;
        this.loading.set(false);
        this.error.set(this.message(err, 'Impossible de charger le rapport.'));
      }
    });
  }

  protected exportCsv(): void {
    const { from, to, last } = this.range();
    this.exporting.set(true);
    this.service.ridesCsv({ from: isoDay(from), to: isoDay(to) }).subscribe({
      next: blob => {
        this.exporting.set(false);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `courses-${isoDay(from)}-au-${isoDay(last)}.csv`;
        a.click();
        // Révoquer tout de suite peut annuler le téléchargement dans Chrome.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      error: err => {
        this.exporting.set(false);
        this.error.set(this.message(err, "L'export n'a pas pu être téléchargé."));
      }
    });
  }

  /** « +14 % vs période précédente », ou null sans base de comparaison. */
  private trend(current: number, before: number | undefined): string | null {
    if (before === undefined || before === 0) return null;
    const pct = Math.round(((current - before) / before) * 100);
    return `${pct > 0 ? '+' : ''}${pct} % vs période précédente`;
  }

  private renderChart(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const ctx = this.barCanvas?.nativeElement.getContext('2d');
    if (!ctx) return;
    const days = this.days().slice().reverse();
    const labels = days.map(d => `${d.date.getDate()}/${d.date.getMonth() + 1}`);
    const data = days.map(d => d.completed);
    const colors = days.map((d, i) => (d.isToday || (i === days.length - 1 && !days.some(x => x.isToday)) ? '#FF5F00' : '#F7C8A6'));

    // Recréé à chaque chargement : un graphique créé vide puis mis à jour ne se redessinait pas.
    this.barChart?.destroy();
    this.barChart = undefined;
    if (!days.length) return;

    this.barChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ data, backgroundColor: colors, borderRadius: 3, hoverBackgroundColor: '#e04e00', barPercentage: 0.7, categoryPercentage: 0.85 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#17130f',
            titleColor: '#fff',
            bodyColor: '#fff',
            padding: 8,
            displayColors: false,
            callbacks: {
              title: items => `${items[0].label} : ${items[0].formattedValue} course${Number(items[0].raw) > 1 ? 's' : ''}`,
              label: () => ''
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#888', font: { size: 11 } } },
          y: { display: false, beginAtZero: true, suggestedMax: 1 }
        },
        layout: { padding: { top: 24 } }
      },
      plugins: [
        {
          id: 'valueOnTop',
          afterDatasetsDraw(chart) {
            const { ctx: c, data: d } = chart;
            // Au-delà de 16 barres, les valeurs se chevauchent : l'info-bulle suffit.
            if (d.labels && d.labels.length > 16) return;
            c.save();
            c.font = '600 10.5px -apple-system, sans-serif';
            c.fillStyle = '#555';
            c.textAlign = 'center';
            chart.getDatasetMeta(0).data.forEach((bar, i) => {
              const val = d.datasets[0].data[i] as number;
              c.fillText(val.toLocaleString('fr-FR'), bar.x, bar.y - 6);
            });
            c.restore();
          }
        }
      ]
    });
  }

  private message(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) return 'Impossible de joindre le serveur.';
      if (err.status === 403) return 'Votre rôle ne permet pas de consulter les rapports.';
      const body = err.error as { message?: string | string[] } | null;
      if (Array.isArray(body?.message) && body.message.length) return body.message.join(' ');
      if (typeof body?.message === 'string' && body.message) return body.message;
    }
    return fallback;
  }
}
