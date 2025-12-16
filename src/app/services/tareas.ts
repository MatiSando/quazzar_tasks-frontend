/**
 * ==========================================================
 *  SERVICIO DE TAREAS — Angular (HTTP API)
 * ----------------------------------------------------------
 *  Responsable de la comunicación Angular ↔ Laravel para:
 *  - Catálogo de tareas (CRUD).
 *  - Ciclo de vida de tareas por área (iniciar, actualizar,
 *    finalizar, marcar pendiente).
 *  - Utilidades de negocio (VIN, colores, etc.).
 *  - Logs de actividad y pendientes de usuario.
 * ----------------------------------------------------------
 *  Autor: Matías Sandoval
 *  Proyecto: QuazzarPro Tasks — QuaZZar Technologies S.L.
 *  Fecha: Diciembre 2025
 * ==========================================================
 */

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/** Valores que usa la API (minúsculas) */
export type Proceso = 'pintura' | 'chasis' | 'premontaje' | 'montaje';

/** Modelo del catálogo (tarea genérica que se configura por proceso/sección) */
export interface TareaCatalogo {
  id: number;
  proceso: Proceso;
  seccion?: string | null;
  label: string;
  activa: boolean; // si el back devuelve 0/1, lo normalizamos en el map
}

/** DTOs para crear/actualizar entradas del catálogo */
export interface CreateCatalogoDto {
  proceso: Proceso;
  seccion?: string | null;
  label: string;
  activa: boolean;
}
export interface UpdateCatalogoDto {
  proceso?: Proceso;
  seccion?: string | null;
  label?: string;
  activa?: boolean;
}

/** DTO y respuesta para iniciar una tarea de un área concreta */
export interface IniciarTareaDto {
  usuario_id: number;
  area: Proceso;
  bastidor?: string | null;
  color?: string | null;
  RAL?: string | null;
  checks?: Record<string, boolean>;
}
export interface IniciarTareaResp {
  id?: number; idArea?: number; id_area?: number; status?: string;
}

/** Estructuras de “pendiente / snapshot / estado por VIN” */
export interface PendienteResp {
  exists: boolean;
  id?: number;
  bastidor?: string | null;
  color?: string | null;
  RAL?: string | null;
  checks?: Record<string, boolean>; // CLAVES = nombres de columna
}
export interface VinEstadoChasisResp {
  status: 'free' | 'pending' | 'finalized';
  id?: number;
  checks?: Record<string, boolean>;
}

/** Aliases “bonitos” para UI y modelos de búsqueda/log */
export type ProcesoHuman = 'Premontaje' | 'Montaje' | 'Pintura' | 'Chasis';

export interface SearchRowApi {
  id: number;
  fecha: string;
  fecha_fin?: string | null;
  trabajador: string;
  area: ProcesoHuman;
  accion?: string | null;
  resultado?: string | null;
}

/** Modelo de elemento pendiente de un usuario */
export interface PendingItem {
  area: 'Premontaje' | 'Montaje' | 'Pintura' | 'Chasis';
  area_key: 'premontaje' | 'montaje' | 'pintura' | 'chasis';
  id: number;
  bastidor?: string | null;
  color?: string | null;
  RAL?: string | null;
  fecha_inicio?: string | null;
  total_checks: number;
  done_checks: number;
}

/** Snapshot de una tarea (estado + campos auxiliares) */
export interface SnapshotResp {
  exists: boolean;
  id?: number;
  estado?: 'pendiente' | 'finalizada' | string | null;
  bastidor?: string | null;
  color?: string | null;
  RAL?: string | null;
  fecha_inicio?: string | null;
  checks?: Record<string, boolean>;
}

@Injectable({ providedIn: 'root' })
export class TareasService {
  /** Base de la API (considera mover a environment.* para despliegues) */
  private apiUrl = environment.apiUrl;
//private apiUrl = 'http://127.0.0.1:8000/api';

  constructor(private http: HttpClient) {}

  // =========================================================
  //  CATÁLOGO (CRUD)
  // =========================================================

  /**
   * Obtiene el catálogo de tareas. Por defecto devuelve sólo las activas.
   * Para paneles de administración que necesiten ver todo, usar { soloActivas:false }.
   *
   * @param proceso     Proceso a filtrar (pintura, chasis, premontaje, montaje).
   * @param opts        Opciones de consulta (soloActivas por defecto = true).
   * @returns           Observable con lista normalizada de tareas.
   */
  getCatalogo(
    proceso?: Proceso,
    opts: { soloActivas?: boolean } = { soloActivas: true }
  ): Observable<TareaCatalogo[]> {
    let params = new HttpParams();
    if (proceso) params = params.set('proceso', proceso);
    if (opts?.soloActivas !== false) params = params.set('activa', '1'); // filtro de back

    return this.http
      .get<TareaCatalogo[]>(`${this.apiUrl}/tareas`, { params })
      .pipe(
        // Normalización + seguridad en cliente (por si el back no filtró correctamente)
        map(rows =>
          (rows || [])
            .filter(r => opts?.soloActivas === false ? true : (r as any).activa === true || (r as any).activa === 1)
            .map(r => ({
              ...r,
              activa: !!(r as any).activa, // 0/1 → boolean
              proceso: r.proceso,
            }))
        )
      );
  }

  /**
   * Crea una entrada del catálogo.
   * @param dto  Datos de la tarea a crear.
   */
  createCatalogo(dto: CreateCatalogoDto) {
    return this.http.post(`${this.apiUrl}/tareas`, dto);
  }

  /**
   * Actualiza una entrada del catálogo.
   * @param id   ID de la tarea a actualizar.
   * @param dto  Campos a modificar (parcial).
   */
  updateCatalogo(id: number, dto: UpdateCatalogoDto) {
    return this.http.put(`${this.apiUrl}/tareas/${id}`, dto);
  }

  /**
   * Elimina una entrada del catálogo (borrado real).
   * @param id  ID de la tarea a eliminar.
   */
  deleteCatalogo(id: number) {
    return this.http.delete(`${this.apiUrl}/tareas/${id}`);
  }

  // =========================================================
  //  TAREAS DE ÁREA (CICLO DE VIDA)
  // =========================================================

  /**
   * Inicia una tarea de un área (crea registro en la tabla del área).
   * @param dto  Datos de inicio (usuario, área, vin/bastidor, color, checks…).
   * @returns    Identificadores y estado devueltos por la API.
   */
  iniciarTarea(dto: IniciarTareaDto) {
    return this.http.post<IniciarTareaResp>(`${this.apiUrl}/tareas/iniciar`, dto);
  }

  /**
   * Actualiza parcialmente una tarea de un área (patch).
   * @param area   Área/proceso (minúsculas).
   * @param id     ID de la tarea en esa tabla de área.
   * @param patch  Campos a actualizar (parche).
   */
  actualizarTarea(area: Proceso, id: number, patch: Record<string, any>) {
    return this.http.put(`${this.apiUrl}/tareas/${area}/${id}`, patch);
  }

  /**
   * Finaliza una tarea de un área (marca fecha_fin/estado).
   * @param area  Área/proceso (minúsculas).
   * @param id    ID de la tarea.
   */
  finalizarTarea(area: Proceso, id: number) {
    return this.http.post(`${this.apiUrl}/tareas/${area}/${id}/finalizar`, {});
  }

  /**
   * Marca una tarea como “pendiente” en el área indicado.
   * @param area  Área/proceso (minúsculas).
   * @param id    ID de la tarea.
   */
  marcarPendiente(area: Proceso, id: number) {
    return this.http.post(`${this.apiUrl}/tareas/${area}/${id}/pendiente`, {});
  }

  /**
   * Consulta si existe un pendiente del usuario para un VIN en un área.
   * Importante: el back necesita el `user_id` para filtrar “mis pendientes”.
   *
   * @param area     Área/proceso (minúsculas).
   * @param vin      Bastidor/VIN (17 caracteres).
   * @param userId   ID del usuario logueado.
   */
  getPendiente(area: Proceso, vin: string, userId: number) {
    const params = new HttpParams().set('user_id', String(userId));
    return this.http.get<PendienteResp>(`${this.apiUrl}/tareas/${area}/pendiente/${vin}`, { params });
  }

  // =========================================================
  //  UTILIDADES DE NEGOCIO (VIN, colores, disponibilidad)
  // =========================================================

  /**
   * Devuelve el estado de un VIN en Chasis (libre/pendiente/finalizado).
   */
  getVinEstadoChasis(vin: string) {
    return this.http.get<VinEstadoChasisResp>(`${this.apiUrl}/chasis/vin-estado/${vin}`);
  }

  /**
   * Devuelve la lista de bastidores posibles para Chasis (únicos, limpios y ordenados).
   * @param noCache  Si true, añade timestamp para evitar caches.
   */
  getBastidoresChasis(noCache = true): Observable<string[]> {
    const url = `${this.apiUrl}/chasis/bastidores${noCache ? `?t=${Date.now()}` : ''}`;
    return this.http.get<any>(url).pipe(
      map(resp => {
        const list: string[] = Array.isArray(resp)
          ? resp
          : Array.isArray(resp?.bastidores) ? resp.bastidores : [];
        return list
          .map(v => (v || '').toUpperCase().trim())
          .filter(v => /^[A-Z0-9]{17}$/.test(v))
          .filter((v, i, a) => a.indexOf(v) === i)
          .sort();
      })
    );
  }

  /**
   * Comprueba si un VIN está disponible en Montaje.
   * @returns true si está disponible, false en caso contrario.
   */
  isVinDisponibleEnMontaje(vin: string): Observable<boolean> {
    return this.http.get<{ available: boolean }>(`${this.apiUrl}/montaje/vin-disponible/${vin}`)
      .pipe(map(r => !!r?.available));
  }

  /**
   * Obtiene color/RAL a partir de un VIN (Pintura).
   */
  getColorPinturaPorVin(vin: string) {
    return this.http.get<{ color: string | null; RAL: string | null }>(`${this.apiUrl}/pintura/color-por-vin/${vin}`);
  }

  /**
   * Devuelve lista única de colores disponibles en Pintura.
   * @param noCache  Si true, añade timestamp para evitar caches.
   */
  getColoresPintura(noCache = true) {
    const url = `${this.apiUrl}/pintura/colores${noCache ? `?t=${Date.now()}` : ''}`;
    return this.http.get<any>(url).pipe(
      map(resp =>
        (Array.isArray(resp) ? resp : [])
          .map(v => (v ?? '').toString().trim())
          .filter(v => !!v)
          .filter((v, i, a) => a.indexOf(v) === i)
      )
    );
  }

  // =========================================================
  //  LOGS / PENDIENTES / SNAPSHOTS
  // =========================================================

  /**
   * Búsquedas/Log de tareas con filtros básicos.
   * @param params Rango de fechas, trabajador y área (en minúsculas).
   */
  getTareasLog(params: {
    from?: string;
    to?: string;
    trabajador?: string;
    area?: 'premontaje'|'montaje'|'pintura'|'chasis';
  }) {
    let httpParams = new HttpParams();
    if (params.from)       httpParams = httpParams.set('from', params.from);
    if (params.to)         httpParams = httpParams.set('to', params.to);
    if (params.trabajador) httpParams = httpParams.set('trabajador', params.trabajador);
    if (params.area)       httpParams = httpParams.set('area', params.area);
    return this.http.get<SearchRowApi[]>(`${this.apiUrl}/busquedas/tareas`, { params: httpParams });
  }

  /**
   * Lista los pendientes de un usuario (todas las áreas).
   * @param userId  ID del usuario.
   */
  getPendientesUsuario(userId: number) {
    return this.http.get<PendingItem[]>(`${this.apiUrl}/pendientes/${userId}`);
  }

  /**
   * Obtiene el snapshot de una tarea concreta (estado + datos auxiliares).
   * @param area  Área/proceso (minúsculas).
   * @param id    ID de la tarea en esa tabla de área.
   */
  getSnapshot(area: 'premontaje'|'montaje'|'pintura'|'chasis', id: number) {
    return this.http.get<SnapshotResp>(`${this.apiUrl}/tareas/${area}/${id}/snapshot`);
  }

  /**
   * Comprueba si un VIN ya fue finalizado en un área.
   * @param area  Área/proceso (minúsculas).
   * @param vin   Bastidor/VIN.
   */
  isFinalizado(area: Proceso, vin: string) {
    return this.http.get<{ finalized: boolean }>(`${this.apiUrl}/tareas/${area}/finalizado/${vin}`);
  }
}
