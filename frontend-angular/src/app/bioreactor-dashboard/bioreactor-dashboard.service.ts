/**
 * DashboardService — a scoped (non-root) version of SimulationService.
 *
 * Provided at the BioreactorDashboardComponent level so each component
 * instance gets its own isolated service. The API base URL is configurable
 * via configure(), called by the host component before use.
 */
import { Injectable, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { BatchParams, FaultCatalogue, SimState } from '../models/simulation.model';

@Injectable()   // ← NO providedIn: 'root' — injected at component level only
export class DashboardService {
  apiBase = '/api';

  private es: EventSource | null = null;

  readonly state$       = new BehaviorSubject<SimState | null>(null);
  readonly connected$   = new BehaviorSubject<boolean>(false);
  readonly finished$    = new BehaviorSubject<boolean>(false);
  readonly error$       = new BehaviorSubject<string | null>(null);
  readonly batchParams$ = new BehaviorSubject<BatchParams | null>(null);

  constructor(private http: HttpClient, private ngZone: NgZone) {}

  /** Call this before any other method to set the API base URL. */
  configure(apiBase: string): void {
    this.apiBase = apiBase.replace(/\/$/, ''); // strip trailing slash
  }

  // ── REST ─────────────────────────────────────────────────────────────────

  getFaults(): Observable<FaultCatalogue[]> {
    return this.http.get<FaultCatalogue[]>(`${this.apiBase}/faults`);
  }

  startSimulation(p: BatchParams): Observable<{ status: string }> {
    return this.http.post<{ status: string }>(`${this.apiBase}/simulation/start`, {
      duration_hours: p.duration_hours,
      dt_minutes:     p.dt_minutes,
      fault_ids:      [],
    });
  }

  stopSimulation(): Observable<{ status: string }> {
    return this.http.post<{ status: string }>(`${this.apiBase}/simulation/stop`, {});
  }

  triggerFault(faultId: string): Observable<{ status: string; fault_id: string }> {
    return this.http.post<{ status: string; fault_id: string }>(
      `${this.apiBase}/fault/trigger`, { fault_id: faultId }
    );
  }

  applyRecovery(faultId: string): Observable<{ status: string }> {
    return this.http.post<{ status: string }>(`${this.apiBase}/fault/recover`, { fault_id: faultId });
  }

  declineRecovery(faultId: string): Observable<{ status: string }> {
    return this.http.post<{ status: string }>(`${this.apiBase}/fault/decline`, { fault_id: faultId });
  }

  // ── SSE stream ────────────────────────────────────────────────────────────

  connectStream(): void {
    this.closeStream();
    this.connected$.next(false);
    this.error$.next(null);

    this.ngZone.runOutsideAngular(() => {
      this.es = new EventSource(`${this.apiBase}/simulation/stream`);

      this.es.onmessage = (evt) => {
        if (!evt.data || evt.data.trim() === '') return;
        try {
          const data: SimState = JSON.parse(evt.data);
          this.ngZone.run(() => {
            this.state$.next(data);
            this.connected$.next(true);
            this.error$.next(null);
            if (data.finished) this.finished$.next(true);
          });
        } catch { /* skip malformed frames */ }
      };

      this.es.onerror = () => {
        this.ngZone.run(() => {
          this.connected$.next(false);
          this.error$.next('Stream disconnected — simulation may have stopped.');
        });
      };
    });
  }

  closeStream(): void {
    this.es?.close();
    this.es = null;
  }

  reset(): void {
    this.closeStream();
    this.state$.next(null);
    this.connected$.next(false);
    this.finished$.next(false);
    this.error$.next(null);
  }
}
