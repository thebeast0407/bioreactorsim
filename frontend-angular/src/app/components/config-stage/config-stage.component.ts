import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SimulationService } from '../../services/simulation.service';
import { BatchParams } from '../../models/simulation.model';

@Component({
  selector: 'app-config-stage',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './config-stage.component.html',
})
export class ConfigStageComponent {
  duration   = 48;
  dtMinutes  = 1;
  batchId    = '';
  productName = '';
  orderNo    = '';

  loading = false;
  error: string | null = null;

  constructor(private sim: SimulationService, private router: Router) {}

  get recoveryWindowH(): string {
    return (this.duration * 0.4).toFixed(1);
  }

  start(): void {
    this.loading = true;
    this.error   = null;

    const params: BatchParams = {
      duration_hours: this.duration,
      dt_minutes:     this.dtMinutes,
      batch_id:       this.batchId.trim()      || `BTH-${Date.now().toString(36).toUpperCase()}`,
      product_name:   this.productName.trim()  || 'Unknown Product',
      order_no:       this.orderNo.trim()      || '—',
      started_at:     new Date().toISOString(),
    };

    this.sim.batchParams$.next(params);
    this.sim.startSimulation(params).subscribe({
      next: () => this.router.navigate(['/dashboard']),
      error: () => {
        this.error   = 'Could not start simulation. Is the API server running?';
        this.loading = false;
      },
    });
  }
}
