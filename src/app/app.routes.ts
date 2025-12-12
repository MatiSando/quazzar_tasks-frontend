import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home';
import { PinturaTareasComponent } from './pages/pintura/pintura';
import { ChasisTareasComponent } from './pages/chasis/chasis';
import { PremontajeTareasComponent } from './pages/premontaje/premontaje';
import { MontajeTareasComponent } from './pages/montaje/montaje';
import { authGuard } from './auth.guard';
import { adminGuard } from './admin.guard';
import { PendientesTareasComponent } from './pages/pendientes/pendientes-tareas';


export const routes: Routes = [
  // Login público
  {
    path: '',
    loadComponent: () => import('./pages/login/login').then(m => m.LoginPageComponent),
    pathMatch: 'full',
  },

  // Privadas (user o admin)
  { path: 'home',        component: HomeComponent,            canActivate: [authGuard] },
  { path: 'pintura',     component: PinturaTareasComponent,   canActivate: [authGuard] },
  { path: 'chasis',      component: ChasisTareasComponent,    canActivate: [authGuard] },
  { path: 'premontaje',  component: PremontajeTareasComponent,canActivate: [authGuard] },
  { path: 'montaje',     component: MontajeTareasComponent,   canActivate: [authGuard] },
  { path: 'pendientes', component: PendientesTareasComponent, canActivate: [authGuard] },


  // Solo ADMIN
  {
    path: 'gestion-tareas',
    loadComponent: () =>
      import('./pages/Admin/gestion-tareas/gestion-tareas').then(m => m.GestionTareasComponent),
    canActivate: [authGuard, adminGuard],
  },
  {
    path: 'gestion-usuarios',
    loadComponent: () =>
      import('./pages/Admin/gestion-usuarios/gestion-usuarios').then(m => m.GestionUsuariosComponent),
    canActivate: [authGuard, adminGuard],
  },
  {
  path: 'busquedas',
  loadComponent: () => import('./pages/Admin/busquedas/busqueda').then(m => m.BusquedaComponent),
  canActivate: [authGuard, adminGuard],
},


  // Ruta no encontrada
  { path: '**', redirectTo: '' },
];
