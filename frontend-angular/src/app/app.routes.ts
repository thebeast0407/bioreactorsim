import { Routes } from '@angular/router';
import { ConfigStageComponent } from './components/config-stage/config-stage.component';
import { DashboardStageComponent } from './components/dashboard-stage/dashboard-stage.component';

export const routes: Routes = [
  { path: '',          component: ConfigStageComponent },
  { path: 'dashboard', component: DashboardStageComponent },
  { path: '**',        redirectTo: '' },
];
