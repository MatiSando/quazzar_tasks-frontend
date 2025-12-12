// src/app/admin.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

export const adminGuard: CanActivateFn = () => {
  const router = inject(Router);

  // Sesión activa en esta pestaña
  const token = sessionStorage.getItem('token');
  if (!token) {
    router.navigate(['']); // login
    return false;
  }

  // Leer usuario (con rol) desde sessionStorage
  try {
    const raw = sessionStorage.getItem('qp_user');
    const user = raw ? JSON.parse(raw) : null;
    if (user?.role === 'admin') {
      return true; // ✅ es admin, puede pasar
    }
  } catch {}

  //  No es admin → lo mando a Home
  router.navigate(['/home'], { replaceUrl: true });
  return false;
};
