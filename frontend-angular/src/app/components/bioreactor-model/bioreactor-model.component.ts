import { Component, Input, OnChanges, OnDestroy, AfterViewInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SimState, FaultEntry } from '../../models/simulation.model';

const IMG_W = 1376, IMG_H = 768, IMG_ASPECT = IMG_W / IMG_H;

// anchor: 'center' → badge centered on x (default)
//         'left'   → badge's LEFT  edge starts at x (safe near left  image edge)
//         'right'  → badge's RIGHT edge ends   at x (safe near right image edge)
const ANNOTATIONS = [
  { key: 'press', label: 'Pressure', xF: 0.99, yF: 0.06, fmt: (v: number) => v.toFixed(3), unit: ' bar',            anchor: 'right' },
  { key: 'pH',    label: 'pH',       xF: 0.99, yF: 0.27, fmt: (v: number) => v.toFixed(2), unit: '',                anchor: 'right' },
  { key: 'do',    label: 'DO',       xF: 0.99, yF: 0.50, fmt: (v: number) => v.toFixed(1), unit: ' %',              anchor: 'right' },
  { key: 'temp',  label: 'Temp',     xF: 0.99, yF: 0.73, fmt: (v: number) => v.toFixed(1), unit: ' °C',             anchor: 'right' },
  { key: 'vcd',   label: 'VCD',      xF: 0.01, yF: 0.15, fmt: (v: number) => (v / 1e6).toFixed(2), unit: ' ×10⁶/mL', anchor: 'left' },
];

const LIMITS: Record<string, { aL: number; aH: number; lL: number; lH: number }> = {
  pH:    { aL: 6.9, aH: 7.5, lL: 6.5,  lH: 7.8 },
  do:    { aL: 20,  aH: 90,  lL: 10,   lH: 100 },
  temp:  { aL: 36,  aH: 38.5,lL: 34,   lH: 40 },
  press: { aL: 1.0, aH: 1.5, lL: 0.8,  lH: 2.0 },
};

const FAULT_CPP: Record<string, string[]> = {
  agitator_power_loss:['do'], sparger_blockage:['do'], gas_supply_failure:['do'],
  foam_overflow:['do'], viscosity_surge:['do'], antifoam_injection:['do'],
  impeller_shear:['do','vcd'], coolant_leak:['do'], exhaust_filter_clog:['do','press'],
  seed_hypoxia:['do','vcd'], do_probe_bias:['do'], pid_fault:['temp'],
  antifoam_overdose:['do'], ph_high:['pH'], ph_low:['pH'], ph_oscillation:['pH'],
  do_low_sustained:['do'], do_high:['do'], do_hunting:['do'],
  temp_high:['temp'], temp_low:['temp'], temp_ramp:['temp'],
};

const CAT_COLOR: Record<string, string> = { process:'#ef4444', sensor:'#f97316', excursion:'#a855f7' };
const STATUS_STYLE = {
  normal: { bg:'#f0fdf4', border:'#22c55e', lc:'#16a34a', vc:'#15803d' },
  alert:  { bg:'#fffbeb', border:'#f59e0b', lc:'#b45309', vc:'#92400e' },
  limit:  { bg:'#fef2f2', border:'#ef4444', lc:'#b91c1c', vc:'#991b1b' },
};

function status(key: string, v: number): 'normal' | 'alert' | 'limit' {
  const b = LIMITS[key]; if (!b) return 'normal';
  if (v < b.lL || v > b.lH) return 'limit';
  if (v < b.aL || v > b.aH) return 'alert';
  return 'normal';
}

export interface Badge {
  key: string; label: string; left: number; top: number;
  transform: string;
  formatted: string; st: typeof STATUS_STYLE['normal'];
  hasFault: boolean; faultColor: string;
}

@Component({
  selector: 'app-bioreactor-model',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './bioreactor-model.component.html',
})
export class BioreactorModelComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() state: SimState | null = null;
  @Input() activeFaults: FaultEntry[] = [];
  @ViewChild('container') containerRef!: ElementRef<HTMLDivElement>;

  imgRect = { left: 0, top: 0, w: 0, h: 0 };
  badges: Badge[] = [];
  faultTags: { label: string; color: string; left: number; top: number }[] = [];
  timeLabel = '';
  private ro?: ResizeObserver;

  ngAfterViewInit(): void {
    this.ro = new ResizeObserver(() => this.recalc());
    this.ro.observe(this.containerRef.nativeElement);
    this.recalc();
  }

  ngOnChanges(): void { this.rebuild(); }
  ngOnDestroy(): void { this.ro?.disconnect(); }

  private recalc(): void {
    const el = this.containerRef.nativeElement;
    const cw = el.clientWidth, ch = el.clientHeight;
    if (!cw || !ch) return;
    const cA = cw / ch;
    let w: number, h: number, left: number, top: number;
    if (cA > IMG_ASPECT) { h = ch; w = ch * IMG_ASPECT; left = (cw - w) / 2; top = 0; }
    else                  { w = cw; h = cw / IMG_ASPECT; left = 0; top = (ch - h) / 2; }
    this.imgRect = { left, top, w, h };
    this.rebuild();
  }

  private rebuild(): void {
    if (!this.state || !this.imgRect.w) { this.badges = []; this.faultTags = []; return; }
    const s = this.state;
    const vals: Record<string, number> = {
      pH: s.pH, do: s.dissolved_oxygen_pct, temp: s.temperature_C,
      press: s.pressure_bar, vcd: s.viable_cell_density,
    };
    const faultedCPP: Record<string, FaultEntry> = {};
    for (const f of this.activeFaults) {
      for (const k of (FAULT_CPP[f.id] ?? [])) { faultedCPP[k] = f; }
    }
    const { left, top, w, h } = this.imgRect;
    this.badges = ANNOTATIONS.map(a => {
      const v = vals[a.key] ?? 0;
      const st = STATUS_STYLE[status(a.key, v)];
      const fault = faultedCPP[a.key];
      const xShift = a.anchor === 'left' ? '0%' : a.anchor === 'right' ? '-100%' : '-50%';
      return {
        key: a.key, label: a.label,
        left: left + w * a.xF,
        top:  top  + h * a.yF,
        transform: `translate(${xShift}, -50%)`,
        formatted: `${a.fmt(v)}${a.unit}`,
        st, hasFault: !!fault,
        faultColor: fault ? (CAT_COLOR[fault.category] || '#ef4444') : '',
      };
    });
    this.faultTags = this.activeFaults.map((f, i) => ({
      label: f.name, color: CAT_COLOR[f.category] || '#ef4444',
      left: left + 8,
      top:  top + h - 26 - i * 24,
    }));
    this.timeLabel = `t = ${s.time_h.toFixed(2)} h`;
  }
}
