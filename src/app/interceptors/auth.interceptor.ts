// ===============================================================
// auth.interceptor.ts
// ---------------------------------------------------------------
// Interceptor HTTP que añade el token de autenticación (Bearer)
// a todas las peticiones HTTP salientes si existe en sessionStorage.
// ===============================================================

import { HttpInterceptorFn } from '@angular/common/http';

// ===============================================================
// Definición del interceptor como función
// ---------------------------------------------------------------
// Angular 16+ permite usar funciones interceptoras (HttpInterceptorFn)
// en lugar de clases tradicionales.
// ===============================================================
export const authInterceptor: HttpInterceptorFn = (req, next) => {

  // Intentamos recuperar el token almacenado en sessionStorage
  const token = sessionStorage.getItem('token');

  // Si no hay token (usuario no autenticado), se envía la petición tal cual
  if (!token) return next(req);

  // Si existe token, clonamos la request original y añadimos el encabezado Authorization
  // con el formato "Bearer <token>"
  const authReq = req.clone({
    setHeaders: { Authorization: `Bearer ${token}` },
  });

  // Continuamos el flujo normal de la petición con el request modificado
  return next(authReq);
};
