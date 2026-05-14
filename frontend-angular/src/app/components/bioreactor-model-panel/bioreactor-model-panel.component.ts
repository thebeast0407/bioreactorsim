import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SimState, FaultEntry } from '../../models/simulation.model';
import { BioreactorModelComponent } from '../bioreactor-model/bioreactor-model.component';

/**
 * Self-contained panel wrapping the 2D bioreactor model visualization.
 * Drop into any application: provide `state` + `activeFaults` via inputs.
 */
@Component({
  selector: 'app-bioreactor-model-panel',
  standalone: true,
  imports: [CommonModule, BioreactorModelComponent],
  template: `
    <div class="model-panel">
      <app-bioreactor-model [state]="state" [activeFaults]="activeFaults" />
    </div>
  `,
  styles: [`
    :host { display:block; height:100%; min-height:0; overflow:hidden; }
    .model-panel {
      height:100%;
      background:#fff;
      border:1px solid #e2e8f0;
      border-radius:10px;
      box-shadow:0 1px 3px rgba(0,0,0,.04);
      overflow:hidden;
    }
  `],
})
export class BioreactorModelPanelComponent {
  @Input() state: SimState | null = null;
  @Input() activeFaults: FaultEntry[] = [];
}
