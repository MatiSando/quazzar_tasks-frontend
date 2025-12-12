import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TareasService } from '../../services/tareas';

/* ===========================================================
   Tipos utilitarios para tipar el view-model de la tabla
   =========================================================== */
type AreaKey = 'premontaje' | 'montaje' | 'pintura' | 'chasis';  // clave usada por el backend / API
type AreaTitle = 'Premontaje' | 'Montaje' | 'Pintura' | 'Chasis'; // etiqueta amigable para la UI

/** Estructura con la que pintamos cada fila de la lista de pendientes */
type PendingVM = {
  area_key: AreaKey;          // clave técnica del área (coincide con endpoints)
  area: AreaTitle;            // nombre visible del área en la interfaz
  id: number;                 // id del registro de tarea pendiente (en su tabla de área)
  bastidor?: string | null;   // VIN/bastidor si aplica al área
  color?: string | null;      // color si aplica al área
  fecha?: string | null;      // fecha de inicio (ISO) si viene de la API
  total: number;              // total de checks disponibles en la tarea
  done: number;               // checks completados
};

@Component({
  selector: 'app-pendientes-tareas',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pendientes-tareas.html',
  styleUrls: ['./pendientes-tareas.css'],
})
export class PendientesTareasComponent implements OnInit {
  // === Inyectables ===
  private router = inject(Router);
  private tareasSrv = inject(TareasService);

  // === Estado de cabecera/usuario ===
  userName = signal('');   // nombre del usuario logado (para mostrar en header)
  userId = 0;              // id numérico del usuario (usado en llamadas a la API)

  // === Estado de carga/errores ===
  loading = signal(false);                // spinner/loading general de la pantalla
  errorMsg = signal<string | null>(null); // mensaje de error para UI

  // === Datos mostrados en la tabla ===
  rows = signal<PendingVM[]>([]); // colección de pendientes mapeados a nuestro VM

  /* ===========================================================
     Ciclo de vida
     =========================================================== */
  ngOnInit(): void {
    // 1) Recuperar usuario desde sessionStorage para cabecera y para filtrar por su id
    try {
      const raw = sessionStorage.getItem('qp_user');
      if (raw) {
        const u = JSON.parse(raw);
        this.userName.set(u?.full_name ?? '');
        this.userId = Number(u?.id || 0);
      }
    } catch {}

    // 2) Si no hay token, redirigimos al login (ruta raíz)
    if (!sessionStorage.getItem('token')) {
      this.router.navigate([''], { replaceUrl: true });
      return;
    }

    // 3) Cargar pendientes del usuario
    if (this.userId) this.loadPendientes();
  }

  /* ===========================================================
     Acciones de cabecera
     =========================================================== */
  logout() {
    // Limpiamos información sensible y navegamos a login
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('qp_user');
    this.router.navigate([''], { replaceUrl: true });
  }

  volverHome() {
    // Vuelve a la home del sistema
    this.router.navigate(['/home']);
  }

  /* ===========================================================
     Carga de pendientes desde la API
     =========================================================== */
  private loadPendientes() {
    this.loading.set(true);
    this.errorMsg.set(null);

    // Llama al endpoint getPendientesUsuario(userId) y mapea al VM local
    this.tareasSrv.getPendientesUsuario(this.userId).subscribe({
      next: (list) => {
        this.rows.set(
          list.map(p => ({
            // Pasamos las propiedades relevantes con nombres amigables
            area_key: p.area_key,
            area: p.area as AreaTitle,
            id: p.id,
            bastidor: p.bastidor ?? null,
            color: p.color ?? null,
            fecha: p.fecha_inicio ?? null,
            total: p.total_checks,
            done: p.done_checks,
          }))
        );
        this.loading.set(false);
      },
      error: (e) => {
        console.error(e);
        this.errorMsg.set('No se pudieron cargar tus tareas pendientes.');
        this.loading.set(false);
      }
    });
  }

  /* ===========================================================
     Retomar un pendiente según su área
     -----------------------------------------------------------
     1) Pedimos el "snapshot" al backend para ese registro (id).
     2) Persistimos temporalmente ese snapshot en localStorage con
        una clave por área (SNAPSHOT_*).
     3) Navegamos al componente del área correspondiente, donde
        la pantalla leerá el snapshot y rellenará los datos.
     =========================================================== */
  retomar(row: PendingVM) {
    this.tareasSrv.getSnapshot(row.area_key, row.id).subscribe({
      next: (snap) => {
        if (!snap?.exists) return; // si el back informa que no existe, no hacemos nada

        const payload = JSON.stringify(snap); // guardamos tal cual (lo parseará la pantalla de destino)

        switch (row.area_key) {
          case 'chasis':
            localStorage.setItem('SNAPSHOT_CHASIS', payload);
            this.router.navigate(['/chasis']);
            break;

          case 'montaje':
            localStorage.setItem('SNAPSHOT_MONTAJE', payload);
            this.router.navigate(['/montaje']);
            break;

          case 'pintura':
            localStorage.setItem('SNAPSHOT_PINTURA', payload);
            this.router.navigate(['/pintura']);
            break;

          case 'premontaje':
            localStorage.setItem('SNAPSHOT_PREMONTAJE', payload);
            this.router.navigate(['/premontaje']);
            break;
        }
      },
      error: (e) => console.error('No se pudo obtener snapshot', e)
    });
  }

  /* ===========================================================
     Utilidades de UI
     =========================================================== */

  /** Devuelve "X%" con el progreso de checks hechos sobre el total. */
  progresoLabel(r: PendingVM) {
    if (!r.total) return '0%';
    return `${Math.round((r.done * 100) / r.total)}%`;
  }
}
