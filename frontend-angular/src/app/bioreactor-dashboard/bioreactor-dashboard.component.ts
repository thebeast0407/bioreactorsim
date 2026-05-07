/**
 * BioreactorDashboardComponent
 *
 * A fully self-contained, reusable dashboard for the bioreactor simulation API.
 * Drop into any Angular 17+ application:
 *
 *   import { BioreactorDashboardComponent } from './bioreactor-dashboard';
 *
 *   @Component({
 *     template: `<bioreactor-dashboard apiBase="http://your-server:8000/api" />`
 *   })
 *
 * The component manages its own service instance (not root-level), so multiple
 * instances on the same page each run an independent simulation connection.
 */
import {
  Component, Input, Output, EventEmitter,
  OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { Subscription } from 'rxjs';

import { DashboardService } from './bioreactor-dashboard.service';
import { BioreactorModelComponent } from '../components/bioreactor-model/bioreactor-model.component';
import { ChartPanelComponent } from '../components/chart-panel/chart-panel.component';
import { FaultListComponent } from '../components/fault-list/fault-list.component';
import { RecoveryBarComponent } from '../components/recovery-bar/recovery-bar.component';
import {
  BatchParams, FaultCatalogue, FaultEntry, SimState,
  ChartConfig, ChartEvent,
} from '../models/simulation.model';

// ── Chart configs (same as DashboardStageComponent) ───────────────────────────

const DATA_CAP = 3000;

function mergePoint(data: any[], pt: any): any[] {
  const next = [...data, pt];
  if (next.length <= DATA_CAP) return next;
  const thinned = next.filter((_, i) => i === 0 || i % 2 === 0);
  if (thinned[thinned.length - 1].time_h !== next[next.length - 1].time_h)
    thinned.push(next[next.length - 1]);
  return thinned;
}

const CHART_CONFIGS: ChartConfig[] = [
  {
    id: 'cells', title: 'Cell Density & Viability',
    series: [
      { key: 'viable_cell_density_m', label: 'VCD ×10⁶/mL', color: '#16a34a' },
      { key: 'dead_cell_density_m',   label: 'DCD ×10⁶/mL', color: '#dc2626', dashed: true },
      { key: 'viability_pct',         label: 'Viability %',  color: '#7c3aed' },
    ],
  },
  {
    id: 'ph', title: 'pH', series: [{ key: 'pH', label: 'pH', color: '#3b82f6' }],
    yDomain: [6.2, 8.0], setpoint: 7.2,
    bands: [{ y1: 6.5, y2: 6.9, fill: '#fef3c7', opacity: .65 }, { y1: 7.5, y2: 7.8, fill: '#fef3c7', opacity: .65 }],
    referenceLines: [
      { y: 7.8, label: 'Limit Hi', color: '#ef4444' }, { y: 7.5, label: 'Alert Hi', color: '#f59e0b' },
      { y: 6.9, label: 'Alert Lo', color: '#f59e0b' }, { y: 6.5, label: 'Limit Lo', color: '#ef4444' },
    ],
  },
  {
    id: 'temp', title: 'Temperature (°C)', series: [{ key: 'temperature_C', label: 'Temp °C', color: '#f97316' }],
    yDomain: [33, 41], setpoint: 37,
    bands: [{ y1: 34, y2: 36, fill: '#fef3c7', opacity: .65 }, { y1: 38.5, y2: 40, fill: '#fef3c7', opacity: .65 }],
    referenceLines: [
      { y: 40, label: 'Limit Hi', color: '#ef4444' }, { y: 38.5, label: 'Alert Hi', color: '#f59e0b' },
      { y: 36, label: 'Alert Lo', color: '#f59e0b' }, { y: 34,   label: 'Limit Lo', color: '#ef4444' },
    ],
  },
  {
    id: 'do', title: 'Dissolved Oxygen (%)', series: [{ key: 'dissolved_oxygen_pct', label: 'DO %', color: '#06b6d4' }],
    yDomain: [2, 108], setpoint: 40,
    bands: [{ y1: 10, y2: 20, fill: '#fef3c7', opacity: .65 }, { y1: 90, y2: 100, fill: '#fef3c7', opacity: .65 }],
    referenceLines: [
      { y: 100, label: 'Limit Hi', color: '#ef4444' }, { y: 90, label: 'Alert Hi', color: '#f59e0b' },
      { y: 20,  label: 'Alert Lo', color: '#f59e0b' }, { y: 10, label: 'Limit Lo', color: '#ef4444' },
    ],
  },
  {
    id: 'substrate', title: 'Substrate & Lactate (g/L)',
    series: [
      { key: 'substrate_g_L', label: 'Glucose g/L', color: '#eab308' },
      { key: 'lactate_g_L',   label: 'Lactate g/L', color: '#ec4899', dashed: true },
    ],
  },
  {
    id: 'rates', title: 'Cell Growth Rate (h⁻¹)',
    series: [{ key: 'growth_rate_h', label: 'μ h⁻¹', color: '#16a34a' }],
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

@Component({
  selector: 'bioreactor-dashboard',
  standalone: true,
  // Provide DashboardService here — each component instance gets its own service,
  // keeping multiple dashboard instances fully isolated from each other.
  providers: [DashboardService],
  imports: [
    CommonModule,
    FormsModule,
    HttpClientModule,
    BioreactorModelComponent,
    ChartPanelComponent,
    FaultListComponent,
    RecoveryBarComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './bioreactor-dashboard.component.html',
  styles: [`
    :host { display:block; width:100%; height:100%; }
    /* ── Config stage ─────────────────────────────────────────────────── */
    .bd-page { min-height:100%; background:#f8fafc; display:flex; align-items:center; justify-content:center; padding:24px; }
    .bd-card { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:36px 40px; width:100%; max-width:560px; box-shadow:0 1px 4px rgba(0,0,0,.06); }
    .bd-header { display:flex; align-items:center; gap:16px; margin-bottom:28px; }
    .bd-logo { font-size:44px; line-height:1; }
    .bd-title { font-size:22px; font-weight:700; color:#0f172a; margin-bottom:4px; }
    .bd-sub { font-size:13px; color:#64748b; }
    .bd-err { background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:10px 14px; color:#b91c1c; font-size:13px; margin-bottom:20px; }
    .bd-section { margin-bottom:20px; }
    .bd-section-label { font-size:11px; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:.08em; margin-bottom:12px; }
    .bd-grid2 { display:grid; grid-template-columns:1fr 1fr; gap:12px 16px; }
    .bd-field { display:flex; flex-direction:column; gap:5px; font-size:12px; font-weight:600; color:#374151; }
    .bd-field input { padding:7px 10px; border:1px solid #d1d5db; border-radius:6px; font-size:13px; color:#111827; outline:none; }
    .bd-hint { font-size:11px; color:#9ca3af; white-space:nowrap; margin-left:6px; }
    .bd-divider { height:1px; background:#f1f5f9; margin:4px 0 20px; }
    .bd-info { background:#f0f9ff; border:1px solid #bae6fd; border-radius:8px; padding:10px 14px; font-size:12px; color:#0369a1; line-height:1.5; margin-bottom:24px; }
    .bd-start-btn { width:100%; background:#2563eb; color:#fff; border:none; border-radius:8px; padding:13px 0; font-size:15px; font-weight:600; cursor:pointer; }
    .bd-start-btn:disabled { opacity:.6; cursor:not-allowed; }
    /* ── Dashboard stage ──────────────────────────────────────────────── */
    .bd-dash { height:100%; display:flex; flex-direction:column; background:#f8fafc; overflow:hidden; }
    .bd-topbar { display:flex; align-items:center; gap:16px; padding:7px 16px; background:#fff; border-bottom:1px solid #e2e8f0; flex-shrink:0; }
    .bd-app-title { font-size:14px; font-weight:700; color:#0f172a; white-space:nowrap; flex:0 0 auto; }
    .bd-progress-wrap { flex:1; display:flex; align-items:center; gap:10px; }
    .bd-track { flex:1; height:5px; background:#e2e8f0; border-radius:99px; overflow:hidden; }
    .bd-fill { height:100%; background:linear-gradient(90deg,#3b82f6,#22c55e); border-radius:99px; transition:width .5s ease; }
    .bd-prog-label { font-size:11px; color:#64748b; font-family:monospace; white-space:nowrap; }
    .bd-live-dot { width:8px; height:8px; border-radius:50%; background:#d1d5db; transition:background .3s; }
    .bd-live-dot.live { background:#22c55e; box-shadow:0 0 6px #22c55e88; }
    .bd-stop-btn { background:#fff; color:#dc2626; border:1px solid #fca5a5; border-radius:6px; padding:4px 12px; font-size:11px; font-weight:600; cursor:pointer; flex-shrink:0; }
    .bd-err-banner { background:#fef2f2; padding:5px 16px; font-size:11px; color:#b91c1c; flex-shrink:0; border-bottom:1px solid #fecaca; }
    .bd-batch-bar { display:flex; align-items:center; padding:5px 16px; background:#fff; border-bottom:1px solid #e2e8f0; flex-shrink:0; flex-wrap:wrap; gap:0; }
    .bd-bf { display:flex; flex-direction:column; gap:1px; padding:3px 16px 3px 0; margin-right:12px; border-right:1px solid #f1f5f9; }
    .bd-bf:last-child { border-right:none; }
    .bd-bfl { font-size:9px; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:.07em; }
    .bd-bfv { font-size:12px; font-weight:600; color:#1e293b; }
    .bd-bfv.mono { font-family:monospace; }
    .bd-status-badge { font-size:11px; font-weight:700; padding:1px 8px; border-radius:99px; }
    .bd-recov-row { padding:4px 12px; flex-shrink:0; }
    .bd-main-grid { flex:1; display:grid; grid-template-columns:2fr 3fr; gap:8px; padding:0 12px; min-height:0; }
    .bd-model-col { min-height:0; overflow:hidden; background:#fff; border:1px solid #e2e8f0; border-radius:10px; box-shadow:0 1px 3px rgba(0,0,0,.04); }
    .bd-charts-grid { display:grid; grid-template-columns:1fr 1fr; grid-template-rows:1fr 1fr 1fr; gap:6px; min-height:0; }
    .bd-chart-cell { min-height:0; overflow:hidden; }
    .bd-fault-row { height:185px; flex-shrink:0; padding:4px 12px 8px; }
  `],
})
export class BioreactorDashboardComponent implements OnInit, OnDestroy {

  /** Base URL of the simulation API, e.g. 'http://localhost:8000/api' */
  @Input() apiBase = '/api';
  /** Height of the dashboard stage. Defaults to 100vh. */
  @Input() height = '100vh';

  /** Emitted when a simulation starts with the batch parameters. */
  @Output() simulationStarted = new EventEmitter<BatchParams>();
  /** Emitted when the user stops the simulation. */
  @Output() simulationStopped = new EventEmitter<void>();
  /** Emitted on every SSE state frame — use for external data consumers. */
  @Output() stateUpdate = new EventEmitter<SimState>();

  // ── Internal state ────────────────────────────────────────────────────────

  stage: 'config' | 'dashboard' = 'config';

  // Config form
  cfgDuration   = 48;
  cfgDtMinutes  = 1;
  cfgBatchId    = '';
  cfgProduct    = '';
  cfgOrderNo    = '';
  cfgLoading    = false;
  cfgError:    string | null = null;

  // Dashboard
  batch:     BatchParams | null = null;
  state:     SimState    | null = null;
  connected  = false;
  finished   = false;
  sseError:  string | null = null;
  allFaults: FaultCatalogue[]   = [];
  chartData: any[]              = [];
  faultEvents:    ChartEvent[]  = [];
  recoveryEvents: ChartEvent[]  = [];

  triggerPending  = false;
  triggerError:   string | null = null;
  triggerSuccess: string | null = null;
  recoveryBusy:   'apply' | 'decline' | null = null;

  private seenFaultIds    = new Set<string>();
  private seenRecoveryIds = new Set<string>();
  private subs = new Subscription();

  readonly chartConfigs = CHART_CONFIGS;

  constructor(private svc: DashboardService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.svc.configure(this.apiBase);
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    this.svc.reset();
  }

  // ── Config stage ──────────────────────────────────────────────────────────

  get recoveryWindowH(): string { return (this.cfgDuration * 0.4).toFixed(1); }

  startSim(): void {
    this.cfgLoading = true;
    this.cfgError   = null;

    const p: BatchParams = {
      duration_hours: this.cfgDuration,
      dt_minutes:     this.cfgDtMinutes,
      batch_id:       this.cfgBatchId.trim()  || `BTH-${Date.now().toString(36).toUpperCase()}`,
      product_name:   this.cfgProduct.trim()  || 'Unknown Product',
      order_no:       this.cfgOrderNo.trim()  || '—',
      started_at:     new Date().toISOString(),
    };

    this.svc.startSimulation(p).subscribe({
      next: () => {
        this.batch      = p;
        this.cfgLoading = false;
        this.stage      = 'dashboard';
        this.simulationStarted.emit(p);
        this.cdr.markForCheck();
        this._initDashboard();
      },
      error: () => {
        this.cfgError   = 'Could not start simulation. Is the API server running?';
        this.cfgLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  // ── Dashboard stage ───────────────────────────────────────────────────────

  private _initDashboard(): void {
    this.svc.getFaults().subscribe(f => { this.allFaults = f; this.cdr.markForCheck(); });
    this.svc.reset();
    this.svc.connectStream();

    this.subs.add(this.svc.state$.subscribe(s => {
      if (!s) return;
      this._onState(s);
      this.stateUpdate.emit(s);
      this.cdr.markForCheck();
    }));
    this.subs.add(this.svc.connected$.subscribe(v => { this.connected = v; this.cdr.markForCheck(); }));
    this.subs.add(this.svc.finished$.subscribe(v => { this.finished  = v; this.cdr.markForCheck(); }));
    this.subs.add(this.svc.error$.subscribe(e    => { this.sseError  = e; this.cdr.markForCheck(); }));
  }

  private _onState(s: SimState): void {
    this.state = s;
    for (const f of [...(s.active_faults || []), ...(s.recovered_faults || [])]) {
      if (!this.seenFaultIds.has(f.id)) {
        this.seenFaultIds.add(f.id);
        this.faultEvents = [...this.faultEvents, { time_h: f.triggered_at_h, name: f.name, category: f.category }];
      }
    }
    for (const f of (s.recovered_faults || [])) {
      const k = f.id + '_rec';
      if (!this.seenRecoveryIds.has(k) && f.recovered_at_h != null) {
        this.seenRecoveryIds.add(k);
        this.recoveryEvents = [...this.recoveryEvents, { time_h: f.recovered_at_h, name: f.name, category: f.category }];
      }
    }
    this.chartData = mergePoint(this.chartData, {
      ...s,
      viable_cell_density_m: s.viable_cell_density / 1e6,
      dead_cell_density_m:   s.dead_cell_density   / 1e6,
    });
  }

  stopSim(): void {
    this.svc.stopSimulation().subscribe();
    this.svc.closeStream();
    this.subs.unsubscribe();
    this.subs = new Subscription();
    this.svc.reset();
    this.stage         = 'config';
    this.state         = null;
    this.chartData     = [];
    this.faultEvents   = [];
    this.recoveryEvents = [];
    this.seenFaultIds.clear();
    this.seenRecoveryIds.clear();
    this.simulationStopped.emit();
    this.cdr.markForCheck();
  }

  // ── Action handlers (wired from child @Output events) ─────────────────────

  onTriggerFault(faultId: string): void {
    this.triggerPending = true;
    this.triggerError   = null;
    this.triggerSuccess = null;
    const name = this.allFaults.find(f => f.id === faultId)?.name ?? faultId;
    this.svc.triggerFault(faultId).subscribe({
      next: () => {
        this.triggerPending  = false;
        this.triggerSuccess  = name;
        this.cdr.markForCheck();
        setTimeout(() => { this.triggerSuccess = null; this.cdr.markForCheck(); }, 3000);
      },
      error: () => {
        this.triggerPending = false;
        this.triggerError   = 'Could not trigger fault.';
        this.cdr.markForCheck();
      },
    });
  }

  onApplyRecovery(faultId: string): void {
    this.recoveryBusy = 'apply';
    this.svc.applyRecovery(faultId).subscribe({
      next:  () => { this.recoveryBusy = null; this.cdr.markForCheck(); },
      error: () => { this.recoveryBusy = null; this.cdr.markForCheck(); },
    });
  }

  onDeclineRecovery(faultId: string): void {
    this.recoveryBusy = 'decline';
    this.svc.declineRecovery(faultId).subscribe({
      next:  () => { this.recoveryBusy = null; this.cdr.markForCheck(); },
      error: () => { this.recoveryBusy = null; this.cdr.markForCheck(); },
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  get duration(): number { return this.state?.duration_hours ?? this.batch?.duration_hours ?? 48; }
  get progress(): number { return this.state ? Math.min(100, (this.state.time_h / this.duration) * 100) : 0; }
  get activeFaults():    FaultEntry[] { return this.state?.active_faults    ?? []; }
  get recoveredFaults(): FaultEntry[] { return this.state?.recovered_faults ?? []; }
  get statusLabel(): string { return this.finished ? 'Complete' : this.connected ? 'Running' : 'Connecting…'; }
  get statusColor(): string { return this.finished ? '#15803d' : this.connected ? '#2563eb' : '#94a3b8'; }
  get statusBg():    string { return this.finished ? '#dcfce7' : this.connected ? '#dbeafe' : '#f1f5f9'; }

  formatTime(iso: string | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(undefined, { month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' });
  }
}
