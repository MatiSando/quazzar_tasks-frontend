// ===============================================================
// src/app/services/auth.ts
// ---------------------------------------------------------------
// Servicio de autenticación de QuaZZarPro.
// Gestiona el inicio de sesión (login) y el cambio de contraseña
// del usuario autenticado.
// ===============================================================

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

// ===============================================================
// Tipos e interfaces auxiliares
// ===============================================================

// Rol del usuario: puede ser "admin" o "user"
export type UserRole = 'admin' | 'user';

// Estructura esperada de la respuesta del backend al hacer login
export interface LoginResponse {
  status: 'success' | 'error'; // indica si el login fue exitoso o fallido
  message: string;             // mensaje informativo o de error
  token?: string;              // token JWT devuelto por la API
  user?: {                     // datos del usuario autenticado
    id: number;
    full_name: string;
    email: string;
    rol: UserRole;             // rol asignado en el backend (admin / user)
  };
}

// ===============================================================
// Servicio principal de autenticación
// ===============================================================
@Injectable({ providedIn: 'root' })
export class AuthService {

  // Inyección del cliente HTTP de Angular
  private http = inject(HttpClient);

  // URL base de la API backend (Laravel)
  private apiUrl = 'https://quazzartasks-backend-production.up.railway.app/api';


  // ===============================================================
  // MÉTODO: login()
  // ---------------------------------------------------------------
  // Envía las credenciales del usuario al backend para autenticación.
  // Retorna un observable con la respuesta del servidor.
  // ===============================================================
  login(email: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.apiUrl}/login`, { email, password });
  }

  // ===============================================================
  // MÉTODO: changePassword()
  // ---------------------------------------------------------------
  // Permite cambiar la contraseña de un usuario ya autenticado.
  // Se usa principalmente cuando el usuario entra con "1234"
  // y debe establecer una nueva contraseña desde el modal.
  // ---------------------------------------------------------------
  // Parámetros:
  // - userId: ID del usuario que va a cambiar su contraseña
  // - newPassword: nueva contraseña
  // - repeatPassword: confirmación (debe coincidir)
  //
  // Devuelve un observable con el estado y mensaje del backend.
  // ===============================================================
  changePassword(
    userId: number,
    newPassword: string,
    repeatPassword: string
  ): Observable<{ status: string; message: string }> {

    // Llamada HTTP POST a /usuarios/{id}/change-password (Laravel)
    return this.http.post<{ status: string; message: string }>(
      `${this.apiUrl}/usuarios/${userId}/change-password`,
      {
        password: newPassword,
        password_confirmation: repeatPassword, // ← requerido por la validación "confirmed" en Laravel
      }
    );
  }
}
