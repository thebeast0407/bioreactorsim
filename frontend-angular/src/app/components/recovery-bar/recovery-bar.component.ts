import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RecoveryPrompt } from '../../models/simulation.model';

@Component({
  selector: 'app-recovery-bar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './recovery-bar.component.html',
})
export class RecoveryBarComponent {
  @Input()  prompt:  RecoveryPrompt | null = null;
  @Input()  busy:    'apply' | 'decline' | null = null;
  /** Emits fault_id — parent calls applyRecovery(faultId) */
  @Output() applyRequest   = new EventEmitter<string>();
  /** Emits fault_id — parent calls declineRecovery(faultId) */
  @Output() declineRequest = new EventEmitter<string>();

  get urgent(): boolean { return (this.prompt?.remaining_h ?? 99) < 0.5; }
  get accentColor(): string { return this.urgent ? '#ef4444' : '#f59e0b'; }

  apply():   void { if (this.prompt) this.applyRequest.emit(this.prompt.fault_id); }
  decline(): void { if (this.prompt) this.declineRequest.emit(this.prompt.fault_id); }
}
