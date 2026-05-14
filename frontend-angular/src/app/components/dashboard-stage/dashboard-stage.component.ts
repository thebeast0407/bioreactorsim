import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { SimulationService } from '../../services/simulation.service';
import {
  SimState, FaultEntry, FaultCatalogue, BatchParams,
  ChartEvent,
} from '../../models/simulation.model';
import { BioreactorModelPanelComponent } from '../bioreactor-model-panel/bioreactor-model-panel.component';
import { ChartsGridComponent } from '../charts-grid/charts-grid.component';
import { FaultInjectionPanelComponent } from '../fault-injection-panel/fault-injection-panel.component';
import { RecoveryBarComponent } from '../recovery-bar/recovery-bar.component';

const DATA_CAP = 3000;

function mergePoint(data: any[], point: any): any[] {
  const next = [...data, point];
  if (next.length <= DATA_CAP) return next;
  const thinned = next.filter((_, i) => i === 0 || i % 2 === 0);
  if (thinned[thinned.length - 1].time_h !== next[next.length - 1].time_h)
    thinned.push(next[next.length - 1]);
  return thinned;
}

@Component({
  selector: 'app-dashboard-stage',
  standalone: true,
  imports: [CommonModule, BioreactorModelPanelComponent, ChartsGridComponent, FaultInjectionPanelComponent, RecoveryBarComponent],
  templateUrl: './dashboard-stage.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardStageComponent implements OnInit, OnDestroy {
  state:    SimState | null = null;
  connected = false;
  finished  = false;
  error:    string | null = null;
  batch:    BatchParams | null = null;
  allFaults: FaultCatalogue[] = [];

  chartData: any[] = [];
  faultEvents:    ChartEvent[] = [];
  recoveryEvents: ChartEvent[] = [];

  private seenFaultIds    = new Set<string>();
  private seenRecoveryIds = new Set<string>();
  private subs = new Subscription();

  constructor(
    private sim: SimulationService,
    private router: Router,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.batch = this.sim.batchParams$.value;
    if (!this.batch) { this.router.navigate(['/']); return; }

    this.sim.getFaults().subscribe(f => { this.allFaults = f; this.cdr.markForCheck(); });
    this.sim.reset();
    this.sim.connectStream();

    // With OnPush, we must call markForCheck() after every external emission
    // so Angular knows the view may need updating.
    this.subs.add(this.sim.state$.subscribe(s => {
      if (s) { this.onState(s); this.cdr.markForCheck(); }
    }));
    this.subs.add(this.sim.connected$.subscribe(v => { this.connected = v; this.cdr.markForCheck(); }));
    this.subs.add(this.sim.finished$.subscribe(v => { this.finished  = v; this.cdr.markForCheck(); }));
    this.subs.add(this.sim.error$.subscribe(e    => { this.error     = e; this.cdr.markForCheck(); }));
  }

  ngOnDestroy(): void { this.subs.unsubscribe(); this.sim.closeStream(); }

  private onState(s: SimState): void {
    this.state = s;
    // Collect fault trigger events
    const all = [...(s.active_faults || []), ...(s.recovered_faults || [])];
    for (const f of all) {
      if (!this.seenFaultIds.has(f.id)) {
        this.seenFaultIds.add(f.id);
        this.faultEvents = [...this.faultEvents, { time_h: f.triggered_at_h, name: f.name, category: f.category }];
      }
    }
    for (const f of (s.recovered_faults || [])) {
      const key = f.id + '_rec';
      if (!this.seenRecoveryIds.has(key) && f.recovered_at_h != null) {
        this.seenRecoveryIds.add(key);
        this.recoveryEvents = [...this.recoveryEvents, { time_h: f.recovered_at_h, name: f.name, category: f.category }];
      }
    }
    const point = {
      ...s,
      viable_cell_density_m: s.viable_cell_density / 1e6,
      dead_cell_density_m:   s.dead_cell_density   / 1e6,
    };
    this.chartData = mergePoint(this.chartData, point);
  }

  get duration(): number { return this.state?.duration_hours ?? this.batch?.duration_hours ?? 48; }
  get progress(): number { return this.state ? Math.min(100, (this.state.time_h / this.duration) * 100) : 0; }
  get activeFaults():   FaultEntry[]  { return this.state?.active_faults    ?? []; }
  get recoveredFaults(): FaultEntry[] { return this.state?.recovered_faults ?? []; }

  get statusLabel(): string { return this.finished ? 'Complete' : this.connected ? 'Running' : 'Connecting…'; }
  get statusColor(): string { return this.finished ? '#15803d'  : this.connected ? '#2563eb' : '#94a3b8'; }
  get statusBg():    string { return this.finished ? '#dcfce7'  : this.connected ? '#dbeafe' : '#f1f5f9'; }

  // ── Fault and recovery action handlers (from child @Output events) ─────────

  triggerPending  = false;
  triggerError:   string | null = null;
  triggerSuccess: string | null = null;
  recoveryBusy:   'apply' | 'decline' | null = null;

  onTriggerFault(faultId: string): void {
    this.triggerPending = true;
    this.triggerError   = null;
    this.triggerSuccess = null;
    const name = this.allFaults.find(f => f.id === faultId)?.name ?? faultId;
    this.sim.triggerFault(faultId).subscribe({
      next: () => {
        this.triggerPending  = false;
        this.triggerSuccess  = name;
        this.cdr.markForCheck();
        setTimeout(() => { this.triggerSuccess = null; this.cdr.markForCheck(); }, 3000);
      },
      error: () => {
        this.triggerPending = false;
        this.triggerError   = 'Could not trigger — simulation may not be running.';
        this.cdr.markForCheck();
      },
    });
  }

  onApplyRecovery(faultId: string): void {
    this.recoveryBusy = 'apply';
    this.sim.applyRecovery(faultId).subscribe({
      next:  () => { this.recoveryBusy = null; this.cdr.markForCheck(); },
      error: () => { this.recoveryBusy = null; this.cdr.markForCheck(); },
    });
  }

  onDeclineRecovery(faultId: string): void {
    this.recoveryBusy = 'decline';
    this.sim.declineRecovery(faultId).subscribe({
      next:  () => { this.recoveryBusy = null; this.cdr.markForCheck(); },
      error: () => { this.recoveryBusy = null; this.cdr.markForCheck(); },
    });
  }

  formatTime(iso: string | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(undefined, { month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' });
  }

  stop(): void {
    this.sim.stopSimulation().subscribe();
    this.sim.closeStream();
    this.router.navigate(['/']).then(() => this.sim.reset());
  }
}
