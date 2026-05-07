import { Injectable, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { BatchParams, FaultCatalogue, SimState } from '../models/simulation.model';

const API = '/api';

@Injectable({ providedIn: 'root' })
export class SimulationService {
  private es: EventSource | null = null;

  readonly state$       = new BehaviorSubject<SimState | null>(null);
  readonly connected$   = new BehaviorSubject<boolean>(false);
  readonly finished$    = new BehaviorSubject<boolean>(false);
  readonly error$       = new BehaviorSubject<string | null>(null);
  readonly batchParams$ = new BehaviorSubject<BatchParams | null>(null);

  // zone.js does NOT monkey-patch EventSource, so all onmessage / onerror
  // callbacks run outside Angular's zone.  NgZone.run() re-enters the zone
  // so BehaviorSubject emissions trigger change detection in components.
  constructor(private http: HttpClient, private ngZone: NgZone) {}

  // ── REST calls (HttpClient is always zone-aware) ──────────────────────────

  getFaults(): Observable<FaultCatalogue[]> {
    return this.http.get<FaultCatalogue[]>(`${API}/faults`);
  }

  startSimulation(p: BatchParams): Observable<{ status: string }> {
    return this.http.post<{ status: string }>(`${API}/simulation/start`, {
      duration_hours: p.duration_hours,
      dt_minutes:     p.dt_minutes,
      fault_ids:      [],
    });
  }

  stopSimulation(): Observable<{ status: string }> {
    return this.http.post<{ status: string }>(`${API}/simulation/stop`, {});
  }

  triggerFault(faultId: string): Observable<{ status: string; fault_id: string }> {
    return this.http.post<{ status: string; fault_id: string }>(
      `${API}/fault/trigger`, { fault_id: faultId }
    );
  }

  applyRecovery(faultId: string): Observable<{ status: string }> {
    return this.http.post<{ status: string }>(`${API}/fault/recover`, { fault_id: faultId });
  }

  declineRecovery(faultId: string): Observable<{ status: string }> {
    return this.http.post<{ status: string }>(`${API}/fault/decline`, { fault_id: faultId });
  }

  // ── SSE stream ────────────────────────────────────────────────────────────

  connectStream(): void {
    this.closeStream();
    this.connected$.next(false);
    this.error$.next(null);

    // Run EventSource creation outside Angular zone to avoid zone conflicts,
    // then re-enter the zone explicitly for each emission.
    this.ngZone.runOutsideAngular(() => {
      this.es = new EventSource(`${API}/simulation/stream`);

      this.es.onmessage = (evt) => {
        // Skip SSE comment lines (keep-alive pings sent as ": ping")
        if (!evt.data || evt.data.trim() === '') return;
        try {
          const data: SimState = JSON.parse(evt.data);
          // Re-enter Angular zone so BehaviorSubject emissions trigger CD
          this.ngZone.run(() => {
            this.state$.next(data);
            this.connected$.next(true);
            this.error$.next(null);
            if (data.finished) this.finished$.next(true);
          });
        } catch {
          // Skip malformed frames
        }
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
