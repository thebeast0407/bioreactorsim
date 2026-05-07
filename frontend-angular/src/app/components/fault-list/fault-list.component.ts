import {
  Component, Input, Output, EventEmitter, OnChanges, ViewChild, ElementRef,
  HostListener, ChangeDetectionStrategy, ChangeDetectorRef,
  ViewEncapsulation,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FaultCatalogue, FaultEntry } from '../../models/simulation.model';

const CAT_COLOR: Record<string, string> = {
  process:   '#ef4444',
  sensor:    '#f97316',
  excursion: '#a855f7',
};
const CAT_LABEL: Record<string, string> = {
  process:   'Process Faults',
  sensor:    'Sensor / Actuator',
  excursion: 'CPP Excursions',
};

@Component({
  selector: 'app-fault-list',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './fault-list.component.html',
  // Styles live here (encapsulation None = global, reliable across any container)
  encapsulation: ViewEncapsulation.None,
  styles: [`
    .fl-container { background:#fff; border:1px solid #e2e8f0; border-radius:10px;
      display:flex; flex-direction:column; height:100%;
      box-shadow:0 1px 3px rgba(0,0,0,.04); }
    .fl-hdr { padding:7px 14px; border-bottom:1px solid #f1f5f9;
      display:flex; align-items:center; gap:10px; flex-shrink:0; }
    .fl-hdr-title { font-size:11px; font-weight:700; color:#374151;
      text-transform:uppercase; letter-spacing:.07em; }
    .fl-off-tag { font-size:10px; color:#9ca3af; background:#f9fafb;
      border:1px solid #e5e7eb; padding:1px 8px; border-radius:99px; }
    .fl-body { display:flex; flex:1; min-height:0; }
    .fl-left { flex:0 0 320px; padding:10px 14px; border-right:1px solid #f1f5f9;
      display:flex; flex-direction:column; gap:8px; }
    /* Trigger */
    .fl-trigger { width:100%; display:flex; align-items:center; justify-content:space-between;
      padding:8px 12px; border:1px solid #d1d5db; border-radius:8px; background:#fff;
      cursor:pointer; font-size:12px; color:#374151; text-align:left;
      transition:border-color .15s,box-shadow .15s; }
    .fl-trigger:hover:not(:disabled) { border-color:#94a3b8; box-shadow:0 0 0 2px #f1f5f9; }
    .fl-trigger:focus { outline:none; border-color:#3b82f6; box-shadow:0 0 0 3px #dbeafe; }
    .fl-trigger:disabled { opacity:.45; cursor:not-allowed; }
    .fl-trigger-label { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#374151; }
    .fl-arrow { font-size:12px; color:#94a3b8; margin-left:8px; flex-shrink:0;
      transition:transform .15s; display:inline-block; }
    .fl-arrow.open { transform:rotate(180deg); }
    /* Dropdown menu — position:fixed, created via ngStyle, styled here */
    .fl-menu { background:#fff; border:1px solid #e2e8f0; border-radius:10px;
      box-shadow:0 8px 28px rgba(0,0,0,.14), 0 2px 6px rgba(0,0,0,.06);
      overflow-y:auto; max-height:280px; padding:4px 0; }
    .fl-group-hdr { padding:8px 12px 4px; font-size:10px; font-weight:700;
      text-transform:uppercase; letter-spacing:.08em; }
    .fl-opt { display:flex; align-items:center; gap:8px; padding:8px 12px;
      cursor:pointer; font-size:12px; color:#374151; user-select:none; }
    .fl-opt:hover { background:#f8fafc; }
    .fl-opt.selected { background:#eff6ff; color:#1d4ed8; }
    .fl-opt-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }
    .fl-opt-name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    /* Trigger btn */
    .fl-trig-btn { background:#dc2626; color:#fff; border:none; border-radius:7px;
      padding:7px 16px; font-size:12px; font-weight:700; cursor:pointer;
      align-self:flex-start; transition:opacity .15s; }
    .fl-trig-btn:disabled { opacity:.38; cursor:not-allowed; }
    /* Description */
    .fl-desc { font-size:11px; color:#64748b; line-height:1.5;
      display:flex; flex-wrap:wrap; align-items:center; gap:5px; padding:2px 0; }
    .fl-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; display:inline-block; }
    .fl-meta { font-size:10px; color:#94a3b8; font-family:monospace; }
    .fl-err { font-size:11px; color:#b91c1c; background:#fef2f2; padding:4px 8px; border-radius:4px; }
    .fl-ok  { font-size:11px; color:#15803d; background:#dcfce7; padding:4px 8px; border-radius:4px; }
    /* Status */
    .fl-right { flex:1; padding:10px 14px; overflow-y:auto; }
    .fl-status-title { font-size:10px; font-weight:700; color:#94a3b8;
      text-transform:uppercase; letter-spacing:.08em; margin-bottom:6px; }
    .fl-empty { font-size:11px; color:#cbd5e1; font-style:italic; }
    .fl-row { display:flex; align-items:flex-start; gap:8px;
      border-left:3px solid; padding-left:8px; margin-bottom:6px; }
    .fl-sicon { font-size:13px; flex-shrink:0; line-height:1.4; }
    .fl-sname { font-size:12px; font-weight:600; }
    .fl-smeta { font-size:10px; color:#94a3b8; margin-top:1px; }
  `],
})
export class FaultListComponent implements OnChanges {
  @Input()  allFaults:       FaultCatalogue[] = [];
  @Input()  activeFaults:    FaultEntry[]     = [];
  @Input()  recoveredFaults: FaultEntry[]     = [];
  @Input()  simRunning = false;
  // External async state for the trigger action (set by parent after calling the API)
  @Input()  triggerPending = false;
  @Input()  triggerError:  string | null = null;
  @Input()  triggerSuccess: string | null = null;
  /** Emits the fault_id to trigger — parent calls the API and feeds back status via inputs */
  @Output() triggerFaultRequest = new EventEmitter<string>();

  @ViewChild('triggerBtn') triggerRef!: ElementRef<HTMLButtonElement>;

  selectedId = '';
  dropOpen   = false;
  dropStyle: Record<string, string> = {};

  groups: { cat: string; label: string; color: string; items: FaultCatalogue[] }[] = [];

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnChanges(): void {
    const activeIds    = new Set(this.activeFaults.map(f => f.id));
    const recoveredIds = new Set(this.recoveredFaults.map(f => f.id));
    const available    = this.allFaults.filter(f => !activeIds.has(f.id) && !recoveredIds.has(f.id));

    this.groups = ['process', 'sensor', 'excursion']
      .map(cat => ({
        cat, label: CAT_LABEL[cat], color: CAT_COLOR[cat],
        items: available.filter(f => f.category === cat),
      }))
      .filter(g => g.items.length > 0);

    if (this.selectedId && !available.find(f => f.id === this.selectedId)) {
      this.selectedId = '';
    }
  }

  get selectedFault(): FaultCatalogue | undefined {
    return this.allFaults.find(f => f.id === this.selectedId);
  }

  catColor(cat: string): string { return CAT_COLOR[cat] ?? '#64748b'; }

  // ── Dropdown ──────────────────────────────────────────────────────────────

  toggleDrop(event: MouseEvent): void {
    event.stopPropagation();
    if (!this.simRunning) return;

    if (this.dropOpen) {
      this.dropOpen = false;
      this.cdr.markForCheck();
      return;
    }

    const rect   = this.triggerRef.nativeElement.getBoundingClientRect();
    const menuH  = Math.min(this.groups.reduce((n, g) => n + 28 + g.items.length * 36, 0), 280);
    const below  = window.innerHeight - rect.bottom - 8;
    const top    = below >= menuH ? rect.bottom + 4 : rect.top - menuH - 4;

    this.dropStyle = {
      position: 'fixed',
      top:      `${Math.max(8, top)}px`,
      left:     `${rect.left}px`,
      width:    `${Math.max(rect.width, 280)}px`,
      zIndex:   '999999',
    };
    this.dropOpen = true;
    this.cdr.markForCheck();
  }

  // Use mousedown so selection fires BEFORE the document mousedown closes the menu.
  // This guarantees the option is selected even if the host listener fires.
  selectOption(fault: FaultCatalogue, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.selectedId = fault.id;
    this.dropOpen   = false;
    this.cdr.markForCheck();
  }

  // Close on mousedown outside — fires before click, avoids race with option selection
  @HostListener('document:mousedown', ['$event'])
  onDocMousedown(event: MouseEvent): void {
    if (!this.dropOpen) return;
    const target = event.target as HTMLElement;
    // If the click is inside the trigger or the menu itself, don't close
    if (this.triggerRef?.nativeElement.contains(target)) return;
    if (target.closest('.fl-menu')) return;
    this.dropOpen = false;
    this.cdr.markForCheck();
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (!this.dropOpen) return;
    this.dropOpen = false;
    this.cdr.markForCheck();
  }

  // ── Trigger fault — emit to parent; parent calls the API ─────────────────

  trigger(): void {
    if (!this.selectedId || this.triggerPending) return;
    this.triggerFaultRequest.emit(this.selectedId);
    this.selectedId = '';
    this.cdr.markForCheck();
  }
}
