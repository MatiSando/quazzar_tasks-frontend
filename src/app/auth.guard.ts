import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

export const authGuard: CanActivateFn = () => {

  const router = inject(Router);

  const token = sessionStorage.getItem('token');  // o donde guarde la sesión

  if (!token) {
    router.navigate(['']);   // login está en path ''
    return false;
  }

  return true;
};
