import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FaultCatalogue, FaultEntry } from '../../models/simulation.model';
import { FaultListComponent } from '../fault-list/fault-list.component';

/**
 * Self-contained fault injection panel.
 * Drop into any application: provide the fault lists + sim status via inputs,
 * subscribe to `triggerFaultRequest` to handle the API call in the host app.
 */
@Component({
  selector: 'app-fault-injection-panel',
  standalone: true,
  imports: [CommonModule, FaultListComponent],
  template: `
    <app-fault-list
      [allFaults]="allFaults"
      [activeFaults]="activeFaults"
      [recoveredFaults]="recoveredFaults"
      [simRunning]="simRunning"
      [triggerPending]="triggerPending"
      [triggerError]="triggerError"
      [triggerSuccess]="triggerSuccess"
      (triggerFaultRequest)="triggerFaultRequest.emit($event)"
    />
  `,
  styles: [`
    :host { display:block; height:100%; }
  `],
})
export class FaultInjectionPanelComponent {
  @Input() allFaults: FaultCatalogue[] = [];
  @Input() activeFaults: FaultEntry[] = [];
  @Input() recoveredFaults: FaultEntry[] = [];
  @Input() simRunning = false;
  @Input() triggerPending = false;
  @Input() triggerError: string | null = null;
  @Input() triggerSuccess: string | null = null;
  @Output() triggerFaultRequest = new EventEmitter<string>();
}
