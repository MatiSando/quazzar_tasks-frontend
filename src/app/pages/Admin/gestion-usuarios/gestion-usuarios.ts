/**
 * ==========================================================
 *  GESTIÓN DE USUARIOS — Panel de Administración (Angular)
 * ----------------------------------------------------------
 *  Este componente permite:
 *   - Listar usuarios desde Laravel.
 *   - Crear, editar y eliminar usuarios.
 *   - Restablecer contraseñas.
 *   - Ordenar columnas y gestionar selección de filas.
 *
 *  Usa formularios reactivos y señales (signals) para estado UI.
 * ----------------------------------------------------------
 *  Autor: Matías Sandoval
 *  Proyecto: QuazzarPro Tasks — QuaZZar Technologies S.L.
 *  Fecha: Diciembre 2025
 * ==========================================================
 */

import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { UserRow, UsuariosService } from '../../../services/usuarios';

/** Claves por las que se puede ordenar la tabla de usuarios */
type SortKey = 'full_name' | 'email' | 'role' | 'active';

@Component({
  selector: 'app-gestion-usuarios',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  templateUrl: './gestion-usuarios.html',
  styleUrls: ['./gestion-usuarios.css'],
})
export class GestionUsuariosComponent implements OnInit {

  // ===== Inyecciones y servicios =====
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private usuariosSrv = inject(UsuariosService);

  /** Nombre del usuario autenticado (cabecera) */
  userName = signal('');

  // =========================================================
  //  Ciclo de vida
  // =========================================================
  /**
   * Verifica sesión, carga el nombre del usuario y obtiene la lista inicial.
   */
  ngOnInit(): void {
    // Si no hay token, vuelve al login
    const token = sessionStorage.getItem('token');
    if (!token) {
      this.router.navigate([''], { replaceUrl: true });
      return;
    }

    // Carga del nombre del usuario para la UI
    try {
      const raw = sessionStorage.getItem('qp_user');
      if (raw) {
        const user = JSON.parse(raw);
        this.userName.set(user?.full_name ?? '');
      }
    } catch {}

    // Cargar usuarios desde Laravel
    this.loadUsuarios();
  }

  /**
   * Llama al servicio para obtener el listado completo de usuarios.
   * Actualiza la señal `rows` con la respuesta de la API.
   */
  private loadUsuarios() {
    this.usuariosSrv.getAll().subscribe({
      next: (data) => this.rows.set(data),
      error: (err) => console.error('Error cargando usuarios', err),
    });
  }

  /** Cierra sesión y navega al login. */
  logout() {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('qp_user');
    this.router.navigate([''], { replaceUrl: true });
  }

  /** Acceso rápido al panel principal. */
  goPanel() { this.router.navigate(['/home']); }

  // =========================================================
  //  Estado de tabla y selección
  // =========================================================
  /** Filas actuales (respuesta del backend) */
  rows = signal<UserRow[]>([]);
  /** TrackBy para *ngFor (mejora performance) */
  trackById = (_: number, row: UserRow) => row.id;

  /** ID seleccionado para acciones contextuales (editar/borrar) */
  selectedId = signal<number | null>(null);
  /** Marca como seleccionada una fila */
  selectRow(id: number) { this.selectedId.set(id); }

  // =========================================================
  //  Modal y formulario (crear/editar)
  // =========================================================
  /** Controla la visibilidad del modal de alta/edición */
  addModalOpen = signal(false);
  /** Si es distinto de null, estamos editando ese ID */
  editingId: number | null = null;

  /** Formulario reactivo de creación/edición de usuario */
  addForm = this.fb.nonNullable.group({
    full_name: this.fb.nonNullable.control('', [Validators.required, Validators.minLength(3)]),
    email:     this.fb.nonNullable.control('', [Validators.required, Validators.email]),
    role:      this.fb.nonNullable.control<'admin'|'user'>('user'),
    active:    this.fb.nonNullable.control(true),
  });

  /** Abre modal en modo creación (resetea el formulario) */
  openAddModal() {
    this.editingId = null;
    this.addForm.reset({
      full_name: '',
      email: '',
      role: 'user',
      active: true,
    });
    this.addModalOpen.set(true);
  }

  /**
   * Abre modal en modo edición con datos precargados.
   * @param user Fila seleccionada a editar.
   */
  openEditModal(user: UserRow) {
    this.editingId = user.id;
    this.addForm.reset({
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      active: user.active,
    });
    this.addModalOpen.set(true);
  }

  /** Cierra el modal sin guardar cambios. */
  closeAddModal() { this.addModalOpen.set(false); }

  // =========================================================
  //  Guardar (crear/editar)
  // =========================================================
  /**
   * Si `editingId` !== null → actualiza usuario.
   * Si `editingId` === null → crea un usuario nuevo.
   * Muestra alertas de éxito / error y sincroniza la lista local.
   */
  saveUser() {
    // Validación de formulario
    if (this.addForm.invalid) {
      this.addForm.markAllAsTouched();
      return;
    }
    const data = this.addForm.getRawValue();

    // === EDITAR ===
    if (this.editingId !== null) {
      this.usuariosSrv.update(this.editingId, data).subscribe({
        next: (uActualizado) => {
          // Sustituye en la lista local el usuario editado
          this.rows.update(list =>
            list.map(u => u.id === this.editingId ? uActualizado : u)
          );
          // Aviso de éxito solicitado
          alert('Usuario modificado con éxito');
          // Cierra el modal
          this.closeAddModal();
        },
        error: (err) => {
          console.error('Error actualizando usuario', err);
          alert('No se pudo actualizar el usuario');
        },
      });
      return;
    }

    // === CREAR ===
    this.usuariosSrv.create({
      full_name: data.full_name!,
      email: data.email!,
      role: data.role!,
      active: data.active!,
    }).subscribe({
      next: (nuevo) => {
        // Añade el nuevo usuario a la lista local
        this.rows.update(list => [...list, nuevo]);
        this.selectedId.set(nuevo.id);
        // (Opcional) podrías mostrar un alert de éxito:
        // alert('Usuario creado con éxito');
        this.closeAddModal();
      },
      error: (err) => {
        console.error('Error creando usuario', err);
        alert('No se pudo crear el usuario');
      },
    });
  }

  // =========================================================
  //  Borrado
  // =========================================================
  /**
   * Elimina un usuario tras confirmación del operador.
   * @param id ID del usuario a borrar.
   */
  deleteRow(id: number) {
    const user = this.rows().find(u => u.id === id);
    const name = user?.full_name ?? 'este usuario';
    const ok = confirm(`¿Seguro que quieres eliminar a ${name}?`);
    if (!ok) return;

    this.usuariosSrv.delete(id).subscribe({
      next: () => {
        // Remueve de la lista local
        this.rows.update(list => list.filter(u => u.id !== id));
        if (this.selectedId() === id) this.selectedId.set(null);
      },
      error: (err) => console.error('Error borrando usuario', err),
    });
  }

  /** Atajo para borrar el usuario actualmente seleccionado. */
  deleteSelected() {
    const id = this.selectedId();
    if (!id) return;
    this.deleteRow(id);
  }

  // =========================================================
  //  Acciones auxiliares
  // =========================================================
  /**
   * Solicita al backend un reseteo de contraseña para el usuario dado.
   * Muestra alertas de resultado (éxito/error).
   */
  resetPassword(user: UserRow) {
    const ok = confirm(`¿Restablecer la contraseña de ${user.full_name}?`);
    if (!ok) return;

    this.usuariosSrv.resetPassword(user.id).subscribe({
      next: (resp) => {
        alert(resp.message || 'Contraseña restablecida');
      },
      error: (err) => {
        console.error('Error reseteando contraseña', err);
        alert('No se pudo restablecer la contraseña');
      },
    });
  }

  // =========================================================
  //  Sidenav (responsive)
  // =========================================================
  /** Estado del drawer lateral en móviles */
  sidenavOpen = signal(false);
  /** Alterna apertura/cierre del sidenav */
  toggleSidenav() { this.sidenavOpen.update(v => !v); }
  /** Cierra el sidenav (p. ej. al navegar) */
  closeSidenav()  { this.sidenavOpen.set(false); }

  // =========================================================
  //  Ordenación de tabla (client-side)
  // =========================================================
  /** Columna activa de ordenación */
  sortKey = signal<SortKey>('full_name');
  /** Dirección de ordenación */
  sortDir = signal<'asc' | 'desc'>('asc');

  /**
   * Devuelve la lista ordenada por `sortKey` y `sortDir`.
   * Normaliza tipos para comparar (string/boolean).
   */
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
      const av = normalize(a[key as keyof UserRow]);
      const bv = normalize(b[key as keyof UserRow]);
      if (av < bv) return -1 * mult;
      if (av > bv) return  1 * mult;
      return (a.id - b.id);
    });
  });

  /**
   * Cambia la columna o invierte la dirección de ordenación.
   * @param key Columna nueva por la que ordenar.
   */
  sortBy(key: SortKey) {
    if (this.sortKey() === key) {
      this.sortDir.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortKey.set(key);
      this.sortDir.set('asc');
    }
  }
}
