import {
  Component, Input, OnChanges, OnDestroy, AfterViewInit,
  ViewChild, ElementRef, SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Chart, ChartConfiguration, ChartDataset, registerables } from 'chart.js';
import Annotation from 'chartjs-plugin-annotation';
import { ChartConfig, ChartEvent, SimState } from '../../models/simulation.model';

Chart.register(...registerables, Annotation);

const CAT_STROKE: Record<string, string> = {
  process:   '#ef4444',
  sensor:    '#f97316',
  excursion: '#a855f7',
};

function hexAlpha(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function xTicks(duration: number): number[] {
  const NICE = [1, 2, 3, 4, 6, 8, 10, 12, 16, 24, 36, 48];
  const step = NICE.find(n => n >= duration / 6) ?? Math.ceil(duration / 6);
  const ticks: number[] = [];
  for (let t = 0; t <= duration; t += step) ticks.push(t);
  return ticks;
}

// ── Annotation builders ───────────────────────────────────────────────────────
// All labels get backgroundColor: 'transparent' to remove the default black box.
// Bands use drawTime: 'beforeDatasetsDraw' so they sit behind the data line.

function hLine(y: number, color: string, dash: number[], label?: string, labelPos?: string) {
  return {
    type:        'line' as const,
    yMin:        y,
    yMax:        y,
    borderColor: color,
    borderWidth: 1,
    borderDash:  dash,
    drawTime:    'beforeDatasetsDraw',
    label: label ? {
      display:         true,
      content:         label,
      position:        labelPos ?? 'end',
      backgroundColor: 'transparent',
      color,
      font:            { size: 7, weight: 'normal' as const },
      padding:         2,
      yAdjust:         -6,
    } : { display: false },
  };
}

function vLine(x: number, color: string, dash: number[], icon: string) {
  return {
    type:        'line' as const,
    xMin:        x,
    xMax:        x,
    borderColor: color,
    borderWidth: 1.5,
    borderDash:  dash,
    drawTime:    'afterDatasetsDraw',
    label: {
      display:         true,
      content:         icon,
      position:        'start' as const,
      backgroundColor: 'transparent',
      color,
      font:            { size: 10 },
      padding:         0,
      yAdjust:         2,
    },
  };
}

function band(y1: number, y2: number, fillHex: string, opacity: number) {
  return {
    type:            'box' as const,
    yMin:            y1,
    yMax:            y2,
    backgroundColor: hexAlpha(fillHex, opacity),
    borderWidth:     0,
    drawTime:        'beforeDatasetsDraw',
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-chart-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="panel">
      <div class="title">{{ config.title }}</div>
      <div class="canvas-wrap"><canvas #canvas></canvas></div>
    </div>
    <style>
      .panel { background:#fff; border:1px solid #e2e8f0; border-radius:10px;
               padding:8px 10px 4px; display:flex; flex-direction:column;
               height:100%; box-shadow:0 1px 3px rgba(0,0,0,.04); overflow:hidden; }
      .title { font-size:11px; font-weight:700; color:#475569; text-transform:uppercase;
               letter-spacing:.06em; margin-bottom:4px; flex-shrink:0; }
      .canvas-wrap { flex:1; position:relative; min-height:0; }
      canvas { width:100%!important; height:100%!important; }
    </style>
  `,
})
export class ChartPanelComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() config!: ChartConfig;
  @Input() data: (SimState & { viable_cell_density_m?: number; dead_cell_density_m?: number })[] = [];
  @Input() duration = 48;
  @Input() faultEvents:    ChartEvent[] = [];
  @Input() recoveryEvents: ChartEvent[] = [];
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  private chart?: Chart;

  ngAfterViewInit(): void {
    const ctx = this.canvasRef.nativeElement.getContext('2d')!;
    this.chart = new Chart(ctx, this.buildConfig(ctx));
    if (this.data.length) this.updateData();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.chart) return;
    if (changes['data'])                                        this.updateData();
    if (changes['faultEvents'] || changes['recoveryEvents'])    this.updateEventLines();
    if (changes['duration'])                                    this.updateXAxis();
  }

  ngOnDestroy(): void { this.chart?.destroy(); }

  // ── Data update ───────────────────────────────────────────────────────────

  private updateData(): void {
    if (!this.chart || !this.data.length) return;
    this.config.series.forEach((s, i) => {
      const ds = this.chart!.data.datasets[i];
      if (!ds) return;
      ds.data = this.data.map(d => ({
        x: d.time_h,
        y: (d as unknown as Record<string, number>)[s.key] ?? 0,
      }));
    });
    this.chart.update('none');
  }

  // ── Fault / recovery vertical lines ──────────────────────────────────────

  private updateEventLines(): void {
    if (!this.chart) return;
    const anns = (this.chart.options as any).plugins.annotation.annotations as Record<string, unknown>;
    Object.keys(anns).filter(k => k.startsWith('fe_') || k.startsWith('re_')).forEach(k => delete anns[k]);

    this.faultEvents.forEach((fe, i) => {
      anns[`fe_${i}`] = vLine(fe.time_h, CAT_STROKE[fe.category] ?? '#ef4444', [4, 3], '⚠');
    });
    this.recoveryEvents.forEach((re, i) => {
      anns[`re_${i}`] = vLine(re.time_h, '#22c55e', [5, 3], '✓');
    });
    this.chart.update('none');
  }

  private updateXAxis(): void {
    if (!this.chart) return;
    const xs = (this.chart.options.scales as any)['x'];
    xs.max = this.duration;
    xs.ticks.values = xTicks(this.duration);
    this.chart.update('none');
  }

  // ── Initial build ─────────────────────────────────────────────────────────

  private buildConfig(ctx: CanvasRenderingContext2D): ChartConfiguration {
    const isSingle = this.config.series.length === 1 && !this.config.series[0].dashed;

    const datasets: ChartDataset[] = this.config.series.map(s => ({
      type:             'line' as const,
      label:            s.label,
      data:             [],
      borderColor:      s.color,
      borderWidth:      2,
      borderDash:       s.dashed ? [5, 3] : [],
      backgroundColor:  isSingle ? this.makeGradient(ctx, s.color) : hexAlpha(s.color, 0),
      fill:             isSingle,
      pointRadius:      0,
      pointHoverRadius: 3,
      tension:          0.3,
    } as ChartDataset));

    // ── Annotations: bands first (drawn behind), then lines on top ──────────
    const annotations: Record<string, unknown> = {};

    // 1. Shaded alert bands (amber, drawn before datasets)
    (this.config.bands ?? []).forEach((b, i) => {
      annotations[`band_${i}`] = band(b.y1, b.y2, b.fill, b.opacity ?? 0.55);
    });

    // 2. Setpoint baseline (grey dashed, no label text to avoid clutter)
    if (this.config.setpoint != null) {
      annotations['sp'] = hLine(this.config.setpoint, '#94a3b8', [6, 3]);
    }

    // 3. Alert / limit reference lines (labelled, transparent bg)
    (this.config.referenceLines ?? []).forEach((rl, i) => {
      const pos = i % 2 === 0 ? 'end' : 'start';
      annotations[`rl_${i}`] = hLine(rl.y, rl.color, [3, 3], rl.label, pos);
    });

    return {
      type: 'line',
      data: { datasets },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        animation:           false,
        parsing:             false,
        layout: { padding: { right: 8 } },
        scales: {
          x: {
            type: 'linear',
            min:  0,
            max:  this.duration,
            ticks: {
              values:   xTicks(this.duration),
              callback: (v) => `${v}h`,
              color:    '#94a3b8',
              font:     { size: 9 },
              maxRotation: 0,
            },
            grid:   { color: '#f1f5f9', drawTicks: false },
            border: { color: '#e2e8f0' },
          },
          y: {
            min:    this.config.yDomain?.[0],
            max:    this.config.yDomain?.[1],
            ticks:  { color: '#94a3b8', font: { size: 9 } },
            grid:   { color: '#f1f5f9', drawTicks: false },
            border: { display: false },
          },
        },
        plugins: {
          legend: {
            labels: {
              color:           '#64748b',
              font:            { size: 10 },
              usePointStyle:   true,
              pointStyle:      'line',
              pointStyleWidth: 20,
              boxHeight:       2,
            },
          },
          tooltip: {
            backgroundColor: '#fff',
            titleColor:      '#94a3b8',
            bodyColor:       '#1e293b',
            borderColor:     '#e2e8f0',
            borderWidth:     1,
            padding:         8,
            callbacks: {
              title: (items) => `t = ${Number(items[0].parsed.x).toFixed(2)} h`,
            },
          },
          annotation: { annotations },
        },
      },
    } as ChartConfiguration;
  }

  private makeGradient(ctx: CanvasRenderingContext2D, color: string): CanvasGradient {
    const g = ctx.createLinearGradient(0, 0, 0, 280);
    g.addColorStop(0,   hexAlpha(color, 0.18));
    g.addColorStop(1,   hexAlpha(color, 0));
    return g;
  }
}
