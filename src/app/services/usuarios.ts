// ===============================================================
// src/app/services/usuarios.service.ts
// ---------------------------------------------------------------
// Servicio encargado de gestionar los usuarios desde el panel
// de administración (solo accesible para roles "admin").
//
// Incluye operaciones CRUD completas (listar, crear, actualizar,
// eliminar) y la posibilidad de resetear contraseñas.
// ---------------------------------------------------------------
// Este servicio se comunica con la API Laravel ubicada en
// http://127.0.0.1:8000/api/usuarios
// ===============================================================

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { environment } from '../../environments/environment.prod';

// ===============================================================
// Tipos e interfaces auxiliares
// ===============================================================

// Rol permitido en la aplicación (mismo valor que en Laravel)
export type UserRole = 'admin' | 'user';

// Estructura del usuario que maneja el frontend (ya adaptada)
export interface UserRow {
  id: number;
  full_name: string;
  email: string;
  role: UserRole;   // clave usada en el front (en Laravel es "rol")
  active: boolean;  // clave usada en el front (en Laravel es "activo")
}

// DTO para creación de usuarios (se envía desde formularios Angular)
export interface CreateUserDto {
  full_name: string;
  email: string;
  role: UserRole;     // se mapeará a "rol" para Laravel
  active: boolean;    // se mapeará a "activo" para Laravel
  password?: string;  // opcional; si no se envía, Laravel pondrá "1234"
}

// DTO para actualización de usuarios existentes
export interface UpdateUserDto {
  full_name: string;
  email: string;
  role: UserRole;
  active: boolean;
}

// ===============================================================
// Servicio principal de usuarios
// ===============================================================
@Injectable({ providedIn: 'root' })
export class UsuariosService {

  // Inyección del cliente HTTP de Angular
  private http = inject(HttpClient);

  // URL base de la API
  //private apiUrl = 'http://127.0.0.1:8000/api';
  private apiUrl = environment.apiUrl;
  // ===============================================================
  // MÉTODO PRIVADO: toFront()
  // ---------------------------------------------------------------
  // Transforma un objeto recibido del backend (Laravel)
  // al formato utilizado en el frontend (Angular).
  // Ejemplo:
  // { rol: "admin", activo: 1 } → { role: "admin", active: true }
  // ===============================================================
  private toFront(u: any): UserRow {
    return {
      id: Number(u.id),
      full_name: String(u.full_name ?? ''),
      email: String(u.email ?? '').toLowerCase(),
      role: (u.rol ?? 'user') as UserRole,
      active: !!u.activo,
    };
  }

  // ===============================================================
  // MÉTODO PRIVADO: toBackPayload()
  // ---------------------------------------------------------------
  // Convierte el DTO del front al formato esperado por el backend.
  // - "role" → "rol"
  // - "active" → "activo"
  // Si incluye "password", también se envía.
  // ===============================================================
  private toBackPayload(dto: CreateUserDto | UpdateUserDto): any {
    return {
      full_name: dto.full_name,
      email: dto.email.toLowerCase(),
      rol: dto.role,           // clave que espera Laravel
      activo: dto.active,      // clave que espera Laravel
      // Solo se incluye password si el DTO lo trae (crear usuario)
      ...('password' in dto && (dto as CreateUserDto).password
        ? { password: (dto as CreateUserDto).password }
        : {}),
    };
  }

  // ===============================================================
  // MÉTODO: getAll()
  // ---------------------------------------------------------------
  // Obtiene la lista completa de usuarios desde la API.
  // Se transforma cada registro con "toFront" para uniformar datos.
  // ===============================================================
  getAll(): Observable<UserRow[]> {
    return this.http.get<any[]>(`${this.apiUrl}/usuarios`).pipe(
      map(arr => (Array.isArray(arr) ? arr : []).map(this.toFront.bind(this)))
    );
  }

  // ===============================================================
  // MÉTODO: create()
  // ---------------------------------------------------------------
  // Crea un nuevo usuario en el backend.
  // Si no se especifica contraseña, Laravel usará "1234" por defecto.
  // ===============================================================
  create(dto: CreateUserDto): Observable<UserRow> {
    const payload = this.toBackPayload(dto);
    return this.http.post<any>(`${this.apiUrl}/usuarios`, payload).pipe(
      // El backend devuelve { status, message, usuario }
      map(res => this.toFront(res?.usuario ?? res))
    );
  }

  // ===============================================================
  // MÉTODO: update()
  // ---------------------------------------------------------------
  // Actualiza un usuario existente (por su ID).
  // En caso de que el backend no devuelva el usuario actualizado,
  // se reconstruye a partir del payload enviado.
  // ===============================================================
  update(id: number, dto: UpdateUserDto): Observable<UserRow> {
    const payload = this.toBackPayload(dto);
    return this.http.put<any>(`${this.apiUrl}/usuarios/${id}`, payload).pipe(
      map(res => {
        const u = res?.usuario ?? { id, ...payload };
        return this.toFront(u);
      })
    );
  }

  // ===============================================================
  // MÉTODO: delete()
  // ---------------------------------------------------------------
  // Elimina un usuario por su ID.
  // Devuelve un objeto con el estado y un mensaje opcional.
  // ===============================================================
  delete(id: number): Observable<{ status: string; message?: string }> {
    return this.http.delete<{ status: string; message?: string }>(
      `${this.apiUrl}/usuarios/${id}`
    );
  }

  // ===============================================================
  // MÉTODO: resetPassword()
  // ---------------------------------------------------------------
  // Restablece la contraseña del usuario (normalmente a "1234").
  // Endpoint: POST /usuarios/{id}/reset-password
  // ===============================================================
  resetPassword(id: number): Observable<{ status: string; message: string }> {
    return this.http.post<{ status: string; message: string }>(
      `${this.apiUrl}/usuarios/${id}/reset-password`,
      {}
    );
  }
}
