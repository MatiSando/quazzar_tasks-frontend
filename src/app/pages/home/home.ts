// src/app/pages/home/home.component.ts
import { Component, inject, signal, OnInit } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

@Component({
  selector: 'app-home',
  standalone: true,          // Componente standalone (sin NgModule)
  imports: [RouterModule],   // Necesario para [routerLink] en la plantilla
  templateUrl: './home.html',
  styleUrls: ['./home.css'],
})
export class HomeComponent implements OnInit {
  // Inyección del router usando la API 'inject' (Angular 14+)
  private router = inject(Router);

  // Signal para mostrar el nombre del usuario en la cabecera
  // (reacciona automáticamente a cambios)
  userName = signal<string>('');

  // === Acción: Cerrar sesión ===
  // - Borra token y datos de usuario de *sessionStorage* (no localStorage).
  // - Redirige a la pantalla de login (ruta raíz '').
  logout() {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('qp_user');
    this.router.navigate([''], { replaceUrl: true });
  }

  // === Ciclo de vida: OnInit ===
  // - Evita acceso si no hay token (acceso directo por URL).
  // - Carga el usuario desde sessionStorage y setea el nombre.
  ngOnInit(): void {
    // Guard defensivo: si no hay token, vuelve a login
    const token = sessionStorage.getItem('token');
    if (!token) {
      this.router.navigate([''], { replaceUrl: true });
      return;
    }

    // Cargar el nombre del usuario desde sessionStorage
    try {
      const raw = sessionStorage.getItem('qp_user');
      if (raw) {
        // parseo seguro con fallback
        const user = JSON.parse(raw) as { full_name?: string } | null;
        this.userName.set(user?.full_name ?? '');
      }
    } catch {
      // Si el JSON estuviera corrupto por algún motivo, forzamos logout suave
      // (opcional: podrías limpiar y redirigir)
      // sessionStorage.removeItem('qp_user');
      // this.router.navigate([''], { replaceUrl: true });
    }
  }
}
