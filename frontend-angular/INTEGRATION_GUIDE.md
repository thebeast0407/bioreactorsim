# BioreactorDashboardComponent — Integration Guide

A fully self-contained Angular component that streams live bioreactor simulation data, renders CPP badges on a 2D vessel model, displays 6 real-time charts with fault/recovery markers, and exposes fault injection controls. Each component instance owns its own service — multiple instances on the same page are fully isolated.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Folder copy checklist](#folder-copy-checklist)
3. [Install npm dependencies](#install-npm-dependencies)
4. [Register HttpClient](#register-httpclient)
5. [Import and use the component](#import-and-use-the-component)
6. [API reference](#api-reference)
7. [Output events](#output-events)
8. [Proxy the API during development](#proxy-the-api-during-development)
9. [Serve the bioreactor model image](#serve-the-bioreactor-model-image)
10. [Full working example](#full-working-example)
11. [Troubleshooting](#troubleshooting)

---

## 1. Prerequisites

| Requirement | Minimum version |
|---|---|
| Angular | 17.x (standalone components) |
| TypeScript | 5.x |
| zone.js | 0.14.x |
| Node / npm | 18 / 9 |
| Bioreactor Python API | running at a reachable URL |

---

## 2. Folder copy checklist

Copy the following folders **as-is** into your project's `src/app/` directory:

```
src/app/
├── bioreactor-dashboard/          ← main reusable component
│   ├── bioreactor-dashboard.component.html
│   ├── bioreactor-dashboard.component.ts
│   ├── bioreactor-dashboard.service.ts
│   └── index.ts
├── components/                    ← sub-components (all required)
│   ├── bioreactor-model/
│   ├── chart-panel/
│   ├── fault-list/
│   └── recovery-bar/
└── models/
    └── simulation.model.ts        ← shared TypeScript interfaces
```

> **Tip:** Keep the relative directory structure unchanged. All internal imports use relative paths and will break if folders are renamed or moved.

---

## 3. Install npm dependencies

The component relies on Chart.js and its annotation plugin. Install them in your consuming project:

```bash
npm install chart.js@^4.4.3 chartjs-plugin-annotation@^3.0.1
```

Angular packages (`@angular/common`, `@angular/forms`, `@angular/router`, `rxjs`) are already part of any Angular 17 project.

---

## 4. Register HttpClient

The component uses `HttpClient` internally. Provide it at the application level using `provideHttpClient()`:

**`main.ts`** (standalone bootstrap — most common in Angular 17):

```typescript
import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(),
    // ... other providers
  ],
});
```

**NgModule-based apps** — add `HttpClientModule` to your root `AppModule` imports instead:

```typescript
import { HttpClientModule } from '@angular/common/http';

@NgModule({
  imports: [HttpClientModule, ...],
})
export class AppModule {}
```

---

## 5. Import and use the component

`BioreactorDashboardComponent` is a standalone component. Import it directly in any standalone component or NgModule that needs it.

### Standalone component (Angular 17 style)

```typescript
import { Component } from '@angular/core';
import { BioreactorDashboardComponent } from './bioreactor-dashboard';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [BioreactorDashboardComponent],
  template: `
    <bioreactor-dashboard
      apiBase="http://localhost:8000/api"
      height="100vh"
    />
  `,
})
export class AppComponent {}
```

### NgModule-based app

```typescript
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { BioreactorDashboardComponent } from './bioreactor-dashboard';
import { AppComponent } from './app.component';

@NgModule({
  declarations: [AppComponent],
  imports: [BrowserModule, BioreactorDashboardComponent],
  bootstrap: [AppComponent],
})
export class AppModule {}
```

---

## 6. API reference

### Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| `apiBase` | `string` | `'/api'` | Base URL of the bioreactor Python API. No trailing slash. Example: `'http://localhost:8000/api'` |
| `height` | `string` | `'100vh'` | CSS height of the dashboard stage. Accepts any valid CSS value: `'100vh'`, `'800px'`, `'calc(100vh - 60px)'` |

### Example with all inputs

```html
<bioreactor-dashboard
  apiBase="http://prod-server:8000/api"
  height="calc(100vh - 64px)"
  (simulationStarted)="onBatchStarted($event)"
  (simulationStopped)="onBatchStopped()"
  (stateUpdate)="onStateFrame($event)"
/>
```

---

## 7. Output events

| Output | Payload type | When emitted |
|---|---|---|
| `simulationStarted` | `BatchParams` | User fills the config form and clicks **Start Simulation** |
| `simulationStopped` | `void` | User clicks **■ Stop** on the dashboard toolbar |
| `stateUpdate` | `SimState` | Every SSE frame received from the API (~every simulated minute) |

### BatchParams interface

```typescript
interface BatchParams {
  duration_hours: number;   // e.g. 48
  dt_minutes:     number;   // simulation time step, e.g. 1
  batch_id:       string;   // e.g. "BTH-ABCD1234"
  product_name:   string;   // e.g. "mAb-001"
  order_no:       string;   // e.g. "ORD-2025-001"
  started_at:     string;   // ISO 8601 timestamp
}
```

### SimState interface (subset of key fields)

```typescript
interface SimState {
  time_h:                 number;   // elapsed simulation hours
  pH:                     number;
  temperature_C:          number;
  pressure_bar:           number;
  dissolved_oxygen_pct:   number;
  viable_cell_density:    number;   // cells/mL
  viability_pct:          number;
  growth_rate_h:          number;   // h⁻¹
  substrate_g_L:          number;
  lactate_g_L:            number;
  active_faults:          FaultEntry[];
  recovered_faults:       FaultEntry[];
  recovery_prompt:        RecoveryPrompt | null;
  finished:               boolean;
  duration_hours:         number;
}
```

### Listening to state updates

```typescript
import { SimState } from './bioreactor-dashboard';

// In your component:
onStateFrame(state: SimState): void {
  console.log(`t=${state.time_h.toFixed(1)}h  VCD=${(state.viable_cell_density / 1e6).toFixed(2)}×10⁶/mL`);
  // push to your own store, log to LIMS, etc.
}
```

---

## 8. Proxy the API during development

During local development your Angular dev server runs on (e.g.) `localhost:4200` while the Python API runs on `localhost:8000`. Browsers block cross-origin requests to different ports, so configure the Angular dev proxy to forward API calls.

**`proxy.conf.json`** (create in the project root):

```json
{
  "/api": {
    "target": "http://localhost:8000",
    "changeOrigin": true,
    "secure": false
  },
  "/bioreactormodel.png": {
    "target": "http://localhost:8000",
    "changeOrigin": true,
    "secure": false
  }
}
```

**`angular.json`** — add `proxyConfig` to the serve options:

```json
"serve": {
  "builder": "@angular-devkit/build-angular:dev-server",
  "options": {
    "proxyConfig": "proxy.conf.json"
  }
}
```

Then use a relative `apiBase` in development:

```html
<bioreactor-dashboard apiBase="/api" />
```

For production, set `apiBase` to the full URL of the deployed API:

```html
<bioreactor-dashboard apiBase="https://your-api.example.com/api" />
```

---

## 9. Serve the bioreactor model image

The 2D vessel schematic (`bioreactormodel.png`) is loaded at the path `/bioreactormodel.png` (root-relative). The Python API serves this file at `GET /bioreactormodel.png`.

- In **development** — the proxy entry in step 8 handles it automatically.
- In **production** — either:
  - Keep using `apiBase` proxy configuration in your production web server (nginx, etc.), **or**
  - Copy `bioreactormodel.png` into your Angular project's `public/` (Angular 17) or `src/assets/` folder and update the `<img src>` in `bioreactor-model.component.html` to `src="/assets/bioreactormodel.png"`.

> The image file is located in the Python API project at:
> `bioreactor/bioreactormodel.png`

---

## 10. Full working example

### Standalone app that embeds the dashboard

```typescript
// src/main.ts
import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, {
  providers: [provideHttpClient()],
});
```

```typescript
// src/app/app.component.ts
import { Component } from '@angular/core';
import { BioreactorDashboardComponent } from './bioreactor-dashboard';
import { BatchParams, SimState } from './models/simulation.model';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [BioreactorDashboardComponent],
  template: `
    <bioreactor-dashboard
      apiBase="/api"
      height="100vh"
      (simulationStarted)="onStarted($event)"
      (simulationStopped)="onStopped()"
      (stateUpdate)="onState($event)"
    />
  `,
})
export class AppComponent {
  onStarted(batch: BatchParams): void {
    console.log('Batch started:', batch.batch_id);
  }

  onStopped(): void {
    console.log('Simulation stopped');
  }

  onState(s: SimState): void {
    // Optional: forward to your own analytics, store, or LIMS integration
  }
}
```

### Embedding inside a larger layout (sidebar + dashboard)

```html
<!-- app.component.html -->
<div style="display:flex; height:100vh;">
  <nav style="width:220px; flex-shrink:0; background:#1e293b;">
    <!-- your navigation -->
  </nav>
  <main style="flex:1; min-width:0;">
    <bioreactor-dashboard
      apiBase="/api"
      height="100%"
    />
  </main>
</div>
```

### Multiple independent instances

```html
<!-- Each instance manages its own API connection independently -->
<div style="display:grid; grid-template-columns:1fr 1fr; height:100vh;">
  <bioreactor-dashboard apiBase="http://reactor-1:8000/api" height="100%" />
  <bioreactor-dashboard apiBase="http://reactor-2:8000/api" height="100%" />
</div>
```

---

## 11. Troubleshooting

### Dashboard is stuck on "Connecting…"

The SSE stream cannot be reached. Check:
- The Python API is running (`uvicorn main:app --port 8000`)
- `apiBase` points to the correct host and port
- The dev proxy is configured (step 8) if running locally
- Browser DevTools → Network tab → filter by `stream` to inspect the SSE connection

### Charts are blank / no data appears

The SSE connection established but data is empty. Ensure:
- A simulation was started via `POST /api/simulation/start` (the config form does this)
- The API is not returning errors (check the red banner at the top of the dashboard)

### `NullInjectorError: No provider for HttpClient`

`HttpClient` is not provided. Follow step 4 to add `provideHttpClient()` to your app's bootstrap providers.

### `bioreactormodel.png` returns 404

The image is not being proxied. Ensure the proxy entry for `/bioreactormodel.png` is in `proxy.conf.json` (step 8), or copy the image to your app's assets folder and update the `<img src>` path.

### TypeScript errors after copying files

Ensure your `tsconfig.app.json` has `"strict": true` compatible settings. All interfaces are in `src/app/models/simulation.model.ts` — verify the import paths are correct relative to your project's folder layout.

### Build budget exceeded

The chart libraries add ~580 KB to the main bundle. Increase the budget in `angular.json` if needed:

```json
"budgets": [
  { "type": "initial", "maximumWarning": "1mb", "maximumError": "2mb" },
  { "type": "anyComponentStyle", "maximumWarning": "8kb", "maximumError": "16kb" }
]
```
