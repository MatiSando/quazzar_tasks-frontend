// Importaciones principales de Angular
import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';

// Importaciones del servicio de autenticación
import { AuthService, LoginResponse, UserRole } from '../../services/auth';

// ==== Interfaz auxiliar para guardar el usuario en sessionStorage ====
interface StoredUser {
  id: number;
  email: string;
  full_name: string;
  role: UserRole;
}

// ==== Decorador del componente Angular ====
@Component({
  selector: 'app-login',
  standalone: true,                     // Componente standalone (sin módulo)
  imports: [CommonModule, ReactiveFormsModule], // Se importan los módulos necesarios
  templateUrl: './login.html',          // HTML del login
  styleUrls: ['./login.css'],           // CSS asociado
})
export class LoginPageComponent implements OnInit {

  // ==== Inyección de dependencias ====
  private fb = inject(FormBuilder);     // FormBuilder para formularios reactivos
  private router = inject(Router);      // Router para navegación
  private auth = inject(AuthService);   // Servicio de autenticación

  // ==== Estado general de la interfaz ====
  loading = signal(false);              // Indicador de carga (spinner o deshabilitar botón)
  errorMsg = signal<string | null>(null); // Mensaje de error para el usuario
  showPassword = signal(false);         // Control para mostrar/ocultar contraseña

  // ==== Control del splash (pantalla intermedia con logo) ====
  showSplash = signal(false);

  // ==== Modal de cambio de contraseña ====
  showChangePassModal = signal(false);  // Controla la visibilidad del modal
  changeError = signal<string | null>(null); // Mensaje de error dentro del modal
  changeLoading = signal(false);        // Indicador de carga dentro del modal
  private lastUser: { id: number; role: UserRole } | null = null; // Guarda el último usuario logueado

  // ==== Formulario del cambio de contraseña ====
  changeForm = this.fb.group({
    newPassword: ['', [Validators.required, Validators.minLength(4)]],
    confirmPassword: ['', [Validators.required]],
  });

  // ==== Formulario de login principal ====
  private rememberedEmail = localStorage.getItem('qp_remember_email') ?? ''; // Carga el email recordado

  form = this.fb.group({
    email: [this.rememberedEmail, [Validators.required, Validators.email]],  // Campo email
    password: ['', [Validators.required, Validators.minLength(4)]],          // Campo contraseña
    remember: [!!this.rememberedEmail],                                      // Checkbox "recordar"
  });

  // Getters de comodidad para acceder rápido a los controles
  get f() { return this.form.controls; }
  get cf() { return this.changeForm.controls; }

  // ==== CICLO DE VIDA ====
  ngOnInit(): void {
    // Elimina restos antiguos en localStorage (por seguridad)
    if (localStorage.getItem('token') || localStorage.getItem('qp_user')) {
      localStorage.removeItem('token');
      localStorage.removeItem('qp_user');
    }

    // Si ya hay sesión activa en sessionStorage, redirige a home automáticamente
    if (sessionStorage.getItem('token')) {
      this.router.navigate(['/home'], { replaceUrl: true });
    }
  }

  // ==== Mostrar / ocultar contraseña ====
  toggleShowPassword() {
    this.showPassword.update(v => !v);
  }

  // ==== Navegación centralizada según el rol del usuario ====
  private navegarPorRol(role: UserRole) {
    // Muestra el splash antes de entrar al panel
    this.showSplash.set(true);

    // Después de 1.6 segundos, redirige según el rol
    setTimeout(() => {
      if (role === 'admin') {
        this.router.navigate(['/gestion-usuarios'], { replaceUrl: true }); // Admin
      } else {
        this.router.navigate(['/home'], { replaceUrl: true }); // Usuarios normales
      }
    }, 1600);
  }

  // ==== FUNCIÓN PRINCIPAL DE LOGIN ====
  onSubmit() {
    this.errorMsg.set(null);  // Limpia errores previos

    // Si el formulario es inválido, marca todos los campos como tocados
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    // Extrae los valores actuales del formulario
    const { email, password, remember } = this.form.getRawValue();
    const emailLower = (email ?? '').toLowerCase();  // Email en minúsculas
    const plainPass = password ?? '';                // Contraseña sin cifrar

    this.loading.set(true); // Activa el indicador de carga

    // Llama al servicio AuthService -> login()
    this.auth.login(emailLower, plainPass).subscribe({
      next: (resp: LoginResponse) => {
        this.loading.set(false);

        // Si la respuesta no es correcta, muestra el mensaje de error
        if (resp.status !== 'success' || !resp.token || !resp.user) {
          this.errorMsg.set(resp.message || 'Credenciales no válidas.');
          return;
        }

        // Guarda el rol del usuario y su ID
        const role = resp.user.rol as UserRole;
        this.lastUser = { id: resp.user.id, role };

        // Recordar o no el email en localStorage
        if (remember) localStorage.setItem('qp_remember_email', emailLower);
        else localStorage.removeItem('qp_remember_email');

        // Guarda token + datos del usuario en sessionStorage
        const storedUser: StoredUser = {
          id: resp.user.id,
          email: resp.user.email.toLowerCase(),
          full_name: resp.user.full_name,
          role,
        };
        sessionStorage.setItem('token', resp.token);
        sessionStorage.setItem('qp_user', JSON.stringify(storedUser));

        // Limpia la contraseña del formulario por seguridad
        this.form.patchValue({ password: '' });

        // Si el usuario entra con contraseña por defecto "1234" -> mostrar modal de cambio
        if (plainPass === '1234') {
          this.showChangePassModal.set(true);
          return;
        }

        // En cualquier otro caso, navegar según el rol con splash
        this.navegarPorRol(role);
      },
      error: (err) => {
        this.loading.set(false);

        // Manejo de errores con mensajes personalizados
        const status = err?.status;
        let msg = 'Error de comunicación con el servidor.';

        if (status === 400 || status === 401) {
          msg = 'Credenciales no válidas. Revisa tu email o contraseña.';
        } else if (err?.error?.message) {
          msg = String(err.error.message);
        } else if (err?.message) {
          msg = String(err.message);
        }

        this.errorMsg.set(msg);
      }
    });
  }

  // ==== CAMBIO DE CONTRASEÑA DESDE EL MODAL ====
  submitNewPassword() {
    this.changeError.set(null);
    if (!this.lastUser) return; // Evita errores si no hay usuario cargado

    // Validar formulario
    if (this.changeForm.invalid) {
      this.changeForm.markAllAsTouched();
      return;
    }

    // Extraer contraseñas del formulario
    const { newPassword, confirmPassword } = this.changeForm.getRawValue();
    const newPass = newPassword ?? '';
    const confirm = confirmPassword ?? '';

    // Validaciones básicas
    if (newPass.length < 4) {
      this.changeError.set('La nueva contraseña debe tener al menos 4 caracteres.');
      return;
    }
    if (newPass !== confirm) {
      this.changeError.set('Las contraseñas no coinciden.');
      return;
    }

    this.changeLoading.set(true); // Indicador de carga en modal

    // Llamada al backend con los 3 argumentos: id, nueva contraseña y confirmación
    this.auth.changePassword(this.lastUser.id, newPass, confirm).subscribe({
      next: () => {
        // Si el cambio fue exitoso
        this.changeLoading.set(false);
        this.showChangePassModal.set(false);
        this.changeForm.reset();
        // Navega normalmente según el rol del usuario
        this.navegarPorRol(this.lastUser!.role);
      },
      error: (err) => {
        console.error('Error cambiando contraseña', err);
        this.changeLoading.set(false);
        this.changeError.set('No se pudo actualizar la contraseña.');
      }
    });
  }

  // ==== Cancelar modal de cambio de contraseña ====
  cancelarCambio() {
    this.showChangePassModal.set(false);
    this.changeForm.reset();
  }
}
