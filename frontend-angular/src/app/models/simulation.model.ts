export interface FaultEntry {
  id: string;
  name: string;
  category: 'process' | 'sensor' | 'excursion';
  desc: string;
  triggered_at_h: number;
  recovered: boolean;
  recovered_at_h: number | null;
}

export interface RecoveryPrompt {
  fault_id: string;
  fault_name: string;
  recovery_name: string;
  deadline_h: number;
  remaining_h: number;
}

export interface SimState {
  time_h: number;
  pH: number;
  temperature_C: number;
  pressure_bar: number;
  dissolved_oxygen_pct: number;
  viable_cell_density: number;
  dead_cell_density: number;
  viability_pct: number;
  growth_rate_h: number;
  death_rate_h: number;
  substrate_g_L: number;
  lactate_g_L: number;
  active_faults: FaultEntry[];
  recovered_faults: FaultEntry[];
  recovery_prompt: RecoveryPrompt | null;
  finished: boolean;
  duration_hours: number;
}

export interface FaultCatalogue {
  id: string;
  category: 'process' | 'sensor' | 'excursion';
  name: string;
  desc: string;
  trigger_default_h: number;
}

export interface BatchParams {
  duration_hours: number;
  dt_minutes: number;
  batch_id: string;
  product_name: string;
  order_no: string;
  started_at: string;
}

export interface ChartEvent {
  time_h: number;
  name: string;
  category: string;
}

export interface ChartSeriesCfg {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
}

export interface ChartBand {
  y1: number;
  y2: number;
  fill: string;
  opacity?: number;
}

export interface ChartRefLine {
  y: number;
  label: string;
  color: string;
}

export interface ChartConfig {
  id: string;
  title: string;
  series: ChartSeriesCfg[];
  yDomain?: [number, number];
  setpoint?: number;
  bands?: ChartBand[];
  referenceLines?: ChartRefLine[];
}
