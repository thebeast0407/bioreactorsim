import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartConfig, ChartEvent, SimState } from '../../models/simulation.model';
import { ChartPanelComponent } from '../chart-panel/chart-panel.component';

export const DEFAULT_CHART_CONFIGS: ChartConfig[] = [
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
    bands: [{ y1:6.5, y2:6.9, fill:'#fef3c7', opacity:.65 }, { y1:7.5, y2:7.8, fill:'#fef3c7', opacity:.65 }],
    referenceLines: [
      { y:7.8, label:'Limit Hi', color:'#ef4444' }, { y:7.5, label:'Alert Hi', color:'#f59e0b' },
      { y:6.9, label:'Alert Lo', color:'#f59e0b' }, { y:6.5, label:'Limit Lo', color:'#ef4444' },
    ],
  },
  {
    id: 'temp', title: 'Temperature (°C)', series: [{ key: 'temperature_C', label: 'Temp °C', color: '#f97316' }],
    yDomain: [33, 41], setpoint: 37.0,
    bands: [{ y1:34, y2:36, fill:'#fef3c7', opacity:.65 }, { y1:38.5, y2:40, fill:'#fef3c7', opacity:.65 }],
    referenceLines: [
      { y:40, label:'Limit Hi', color:'#ef4444' }, { y:38.5, label:'Alert Hi', color:'#f59e0b' },
      { y:36, label:'Alert Lo', color:'#f59e0b' }, { y:34,   label:'Limit Lo', color:'#ef4444' },
    ],
  },
  {
    id: 'do', title: 'Dissolved Oxygen (%)', series: [{ key: 'dissolved_oxygen_pct', label: 'DO %', color: '#06b6d4' }],
    yDomain: [2, 108], setpoint: 40,
    bands: [{ y1:10, y2:20, fill:'#fef3c7', opacity:.65 }, { y1:90, y2:100, fill:'#fef3c7', opacity:.65 }],
    referenceLines: [
      { y:100, label:'Limit Hi', color:'#ef4444' }, { y:90, label:'Alert Hi', color:'#f59e0b' },
      { y:20,  label:'Alert Lo', color:'#f59e0b' }, { y:10, label:'Limit Lo', color:'#ef4444' },
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
    series: [{ key: 'growth_rate_h', label: 'μ growth h⁻¹', color: '#16a34a' }],
  },
];

/**
 * Self-contained 2×3 chart grid for bioreactor CPP time-series data.
 * Drop into any application: provide `chartData`, `duration`, `faultEvents`,
 * and `recoveryEvents`. Override `configs` to show a custom chart set.
 */
@Component({
  selector: 'app-charts-grid',
  standalone: true,
  imports: [CommonModule, ChartPanelComponent],
  template: `
    <div class="charts-grid">
      <div *ngFor="let cfg of configs" class="chart-cell">
        <app-chart-panel
          [config]="cfg"
          [data]="chartData"
          [duration]="duration"
          [faultEvents]="faultEvents"
          [recoveryEvents]="recoveryEvents"
        />
      </div>
    </div>
  `,
  styles: [`
    :host { display:block; height:100%; min-height:0; }
    .charts-grid {
      display:grid;
      grid-template-columns:1fr 1fr;
      grid-template-rows:1fr 1fr 1fr;
      gap:6px;
      height:100%;
    }
    .chart-cell { min-height:0; overflow:hidden; }
  `],
})
export class ChartsGridComponent {
  @Input() chartData: (SimState & { viable_cell_density_m?: number; dead_cell_density_m?: number })[] = [];
  @Input() duration = 48;
  @Input() faultEvents: ChartEvent[] = [];
  @Input() recoveryEvents: ChartEvent[] = [];
  /** Override to display a custom set of charts instead of the default 6. */
  @Input() configs: ChartConfig[] = DEFAULT_CHART_CONFIGS;
}
