/**
 * ==========================================================
 *  GESTIÓN DE TAREAS — Panel de Administración (Angular)
 * ----------------------------------------------------------
 *  Este componente permite al administrador gestionar el
 *  catálogo de tareas de cada proceso productivo:
 *  - Crear, editar y eliminar tareas.
 *  - Mostrar tareas activas e inactivas.
 *  - Controlar la tabla, modales, y ordenación de registros.
 * ----------------------------------------------------------
 *  Autor: Matías Sandoval
 *  Proyecto: QuazzarPro Tasks
 *  Empresa: QuaZZar Technologies S.L.
 *  Fecha: Diciembre 2025
 * ==========================================================
 */

import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import {
  TareasService,
  TareaCatalogo,
  CreateCatalogoDto,
  UpdateCatalogoDto,
  Proceso as ProcesoApi
} from '../../../services/tareas';

/** Procesos visibles en interfaz (nombre legible para la tabla) */
type ProcesoUI = 'Pintura' | 'Chasis' | 'Premontaje' | 'Montaje';

/** Claves ordenables en la tabla */
type SortKey = 'proceso' | 'seccion' | 'label' | 'activa';

/** Estructura de cada fila de tarea en la tabla */
type TaskRow = {
  id: number;
  proceso: ProcesoUI;
  seccion?: string | null;
  label: string;
  activa: boolean;
};

/** Mapeo UI → API (para enviar valores correctos al backend) */
const UI_TO_API: Record<ProcesoUI, ProcesoApi> = {
  'Pintura': 'pintura',
  'Chasis': 'chasis',
  'Premontaje': 'premontaje',
  'Montaje': 'montaje',
};

/** Mapeo API → UI (para mostrar nombres legibles en la tabla) */
const API_TO_UI: Record<ProcesoApi, ProcesoUI> = {
  'pintura': 'Pintura',
  'chasis': 'Chasis',
  'premontaje': 'Premontaje',
  'montaje': 'Montaje',
};

@Component({
  selector: 'app-gestion-tareas',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  templateUrl: './gestion-tareas.html',
  styleUrls: ['./gestion-tareas.css'],
})
export class GestionTareasComponent implements OnInit {

  // ====== DEPENDENCIAS E INYECCIONES ======
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private tareasSrv = inject(TareasService);

  /** Nombre del usuario logueado (mostrado en cabecera) */
  userName = signal('');

  // ====== CONTROL DEL SIDENAV (menú lateral) ======
  sidenavOpen = signal(false);
  toggleSidenav() { this.sidenavOpen.update(v => !v); }
  closeSidenav() { this.sidenavOpen.set(false); }

  // ====== DATOS PRINCIPALES ======
  /** Lista de tareas mostradas en tabla */
  rows = signal<TaskRow[]>([]);
  /** Indicador de carga (spinner o deshabilitado) */
  loading = signal(false);

  // =========================================================
  //  CICLO DE VIDA
  // =========================================================
  ngOnInit(): void {
    // Validación de sesión activa
    const token = sessionStorage.getItem('token');
    if (!token) {
      this.router.navigate([''], { replaceUrl: true });
      return;
    }

    // Carga del nombre de usuario logueado
    try {
      const raw = sessionStorage.getItem('qp_user');
      if (raw) {
        const user = JSON.parse(raw);
        this.userName.set(user?.full_name ?? '');
      }
    } catch { }

    // Cargar datos desde la API al iniciar
    this.cargarDesdeApi();
  }

  /** Cierra sesión y redirige al login */
  logout() {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('qp_user');
    this.router.navigate([''], { replaceUrl: true });
  }

  /** Redirige al panel principal */
  goPanel() { this.router.navigate(['/home']); }

  // =========================================================
  //  CARGA DE DATOS
  // =========================================================
  /**
   * Obtiene el catálogo completo de tareas desde el backend.
   * En el panel de administración deben mostrarse todas las tareas,
   * tanto activas como inactivas.
   */
  private cargarDesdeApi() {
    this.loading.set(true);
    this.tareasSrv.getCatalogo(undefined, { soloActivas: false }).subscribe({
      next: (list: TareaCatalogo[]) => {
        const mapped: TaskRow[] = (list || []).map((r) => ({
          id: r.id,
          proceso: API_TO_UI[r.proceso],
          seccion: r.seccion ?? null,
          label: r.label,
          activa: !!(r as any).activa, // normaliza 0/1 → boolean
        }));
        this.rows.set(mapped);
        this.loading.set(false);
      },
      error: (e) => {
        console.error(e);
        this.loading.set(false);
        alert('No se pudo cargar el catálogo de tareas.');
      }
    });
  }

  // =========================================================
  //  SELECCIÓN DE FILA (para edición o eliminación)
  // =========================================================
  trackById = (_: number, row: TaskRow) => row.id;
  selectedId = signal<number | null>(null);
  selectRow(id: number) { this.selectedId.set(id); }

  // =========================================================
  //  MODAL Y FORMULARIO DE CREACIÓN / EDICIÓN
  // =========================================================
  addModalOpen = signal(false);

  /** Formulario reactivo de creación/edición de tarea */
  addForm = this.fb.nonNullable.group({
    proceso: this.fb.nonNullable.control<ProcesoApi>('premontaje', [Validators.required]),
    seccion: this.fb.control<string | null>(''),
    label: this.fb.nonNullable.control('', [Validators.required, Validators.minLength(3)]),
    activa: this.fb.nonNullable.control(true),
  });

  /** Abre el modal en modo creación */
  addTask() { this.openAddModal(); }

  /** Configura el modal vacío para crear una nueva tarea */
  openAddModal() {
    this.selectedId.set(null);
    this.addForm.reset({
      proceso: 'premontaje',
      seccion: '',
      label: '',
      activa: true,
    });
    this.addModalOpen.set(true);
  }

  /** Abre el modal precargado para editar una tarea existente */
  openEditModal(row: TaskRow) {
    this.selectedId.set(row.id);
    this.addForm.setValue({
      proceso: UI_TO_API[row.proceso],
      seccion: row.seccion ?? '',
      label: row.label,
      activa: row.activa,
    });
    this.addModalOpen.set(true);
  }

  /** Cierra el modal y resetea los campos */
  closeAddModal() {
    this.addModalOpen.set(false);
    this.addForm.reset({
      proceso: 'premontaje',
      seccion: '',
      label: '',
      activa: true,
    });
  }

  // =========================================================
  //  GUARDAR / ACTUALIZAR TAREA (CRUD)
  // =========================================================
  /**
   * Guarda o actualiza una tarea según el modo actual.
   * Si existe un `selectedId` → edita.
   * Si no, crea una nueva tarea en la base de datos.
   */
  saveTask() {
    if (this.addForm.invalid) {
      this.addForm.markAllAsTouched();
      return;
    }

    const { proceso, seccion, label, activa } = this.addForm.getRawValue();
    const dto: CreateCatalogoDto & UpdateCatalogoDto = {
      proceso,
      seccion: (seccion ?? '').trim() || null,
      label: (label ?? '').trim(),
      activa: !!activa,
    };

    const id = this.selectedId();

    if (id !== null) {
      // === EDITAR ===
      this.tareasSrv.updateCatalogo(id, dto).subscribe({
        next: () => {
          alert('Tarea editada con éxito');
          this.cargarDesdeApi(); // recarga la tabla
          this.closeAddModal();
        },
        error: (err) => this.showNiceError(err, 'No se pudo actualizar la tarea.'),
      });
    } else {
      // === CREAR ===
      this.tareasSrv.createCatalogo(dto).subscribe({
        next: () => {
          alert('Tarea creada con éxito');
          this.cargarDesdeApi();
          this.closeAddModal();
        },
        error: (err) => this.showNiceError(err, 'No se pudo crear la tarea.'),
      });
    }
  }

  // =========================================================
  //  BORRADO DE TAREAS
  // =========================================================
  /**
   * Elimina una tarea de forma permanente tras confirmación del usuario.
   * @param id - ID de la tarea a eliminar
   * @param ev - Evento opcional (para detener propagación de clic)
   */
  deleteRow(id: number, ev?: Event) {
    ev?.stopPropagation();
    const row = this.rows().find(r => r.id === id);
    const label = row?.label ?? 'esta tarea';

    const ok = confirm(`¿Seguro que quieres eliminar "${label}"?`);
    if (!ok) return;

    this.tareasSrv.deleteCatalogo(id).subscribe({
      next: () => {
        // Actualiza la lista en memoria sin recargar todo
        this.rows.update(list => list.filter(r => r.id !== id));
        if (this.selectedId() === id) this.selectedId.set(null);
      },
      error: () => alert('No se pudo eliminar la tarea.'),
    });
  }

  /** Elimina la tarea actualmente seleccionada */
  deleteSelected(ev?: Event) {
    const id = this.selectedId();
    if (!id) return;
    this.deleteRow(id, ev);
  }

  // =========================================================
  //  ORDENACIÓN DE TABLA
  // =========================================================
  sortKey = signal<SortKey>('proceso');
  sortDir = signal<'asc' | 'desc'>('asc');

  /** Devuelve la lista ordenada dinámicamente según columna y dirección */
  sortedRows = computed(() => {
    const key = this.sortKey();
    const dir = this.sortDir();
    const mult = dir === 'asc' ? 1 : -1;

    const normalize = (v: unknown) => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'boolean') return v ? 1 : 0;
      return String(v).toLocaleLowerCase('es');
    };

    return [...this.rows()].sort((a, b) => {
      const av = normalize(a[key as keyof TaskRow]);
      const bv = normalize(b[key as keyof TaskRow]);
      if (av < bv) return -1 * mult;
      if (av > bv) return 1 * mult;
      return (a.id - b.id);
    });
  });

  /** Cambia la columna o dirección de ordenación */
  sortBy(key: SortKey) {
    if (this.sortKey() === key) {
      this.sortDir.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortKey.set(key);
      this.sortDir.set('asc');
    }
  }

  // =========================================================
  //  GESTIÓN DE ERRORES (Laravel 422, validaciones, etc.)
  // =========================================================
  /**
   * Muestra errores detallados del backend (Laravel) de forma legible.
   * Si la respuesta incluye `errors`, se muestran todos concatenados.
   * @param err - Error HTTP recibido
   * @param fallback - Mensaje genérico alternativo
   */
  private showNiceError(err: any, fallback: string) {
    const errors = err?.error?.errors;
    if (errors && typeof errors === 'object') {
      const msgs = Object.values(errors).flat().join('\n');
      alert(msgs);
      return;
    }
    const msg = err?.error?.message || fallback;
    alert(msg);
  }
}
