/**
 * ==========================================================
 *  BÚSQUEDAS AVANZADAS — Historial/Log de Tareas (Angular)
 * ----------------------------------------------------------
 *  Módulo de consulta con filtros por fecha, trabajador y área.
 *  Incluye:
 *   - Carga de datos desde API (Laravel) con mapeo a modelo UI.
 *   - Ordenación client-side por columna y dirección.
 *   - Paginación client-side con elipsis (1 … 4 5 [6] 7 8 … N).
 *   - Señales (signals) para estado reactivo y alto rendimiento.
 * ----------------------------------------------------------
 *  Autor: Matías Sandoval
 *  Proyecto: QuazzarPro Tasks — QuaZZar Technologies S.L.
 *  Fecha: Diciembre 2025
 * ==========================================================
 */

import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { TareasService } from '../../../services/tareas';

/** Valores legibles en UI (capitalizados) */
type Proceso = 'Premontaje' | 'Montaje' | 'Pintura' | 'Chasis';

/** Claves de ordenación disponibles en la tabla */
type SortKey = 'fecha' | 'fecha_fin' | 'trabajador' | 'area' | 'accion' | 'resultado';

/** Fila visual del resultado de búsqueda (ya mapeada y normalizada) */
type SearchRow = {
  id: number;
  fecha: string;               // YYYY-MM-DD
  fecha_fin: string | null;    // YYYY-MM-DD | 'Pendiente' | null
  trabajador: string;
  area: Proceso;
  accion: string;
  resultado: string;
};

@Component({
  selector: 'app-busqueda',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  templateUrl: './busqueda.html',
  styleUrls: ['./busqueda.css'],
})
export class BusquedaComponent implements OnInit {
  // ===== Inyecciones y servicios =====
  private router = inject(Router);
  private tareasSrv = inject(TareasService);

  /** Nombre del usuario autenticado (cabecera) */
  userName = signal('');

  // =========================================================
  //  Ciclo de vida
  // =========================================================
  /**
   * Verifica sesión, carga el nombre del usuario y prepara
   * listeners de filtros con debounce ligero antes de la búsqueda.
   */
  ngOnInit(): void {
    // Seguridad básica de ruta
    const token = sessionStorage.getItem('token');
    if (!token) {
      this.router.navigate([''], { replaceUrl: true });
      return;
    }
    // Carga de nombre para UI
    try {
      const raw = sessionStorage.getItem('qp_user');
      if (raw) this.userName.set(JSON.parse(raw)?.full_name ?? '');
    } catch {}

    // Cada vez que cambie un filtro, reinicia a página 1 y programa fetch
    const reload = () => { this.currentPage.set(1); this.scheduleFetch(); };
    this.f_fechaDesde.valueChanges.subscribe(reload);
    this.f_fechaHasta.valueChanges.subscribe(reload);
    this.f_trabajador.valueChanges.subscribe(reload);
    this.f_area.valueChanges.subscribe(reload);

    // Carga inicial
    this.fetchRows();
  }

  /** Cierra sesión y vuelve al login. */
  logout() {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('qp_user');
    this.router.navigate([''], { replaceUrl: true });
  }

  // =========================================================
  //  Sidenav (responsive)
  // =========================================================
  sidenavOpen = signal(false);
  toggleSidenav() { this.sidenavOpen.update(v => !v); }
  closeSidenav() { this.sidenavOpen.set(false); }

  // =========================================================
  //  Filtros
  // =========================================================
  /** Rango de fecha (desde/hasta), trabajador y área */
  f_fechaDesde = new FormControl<string>('');
  f_fechaHasta = new FormControl<string>('');
  f_trabajador = new FormControl<string>('');
  f_area = new FormControl<Proceso | ''>('');

  /** Listas auxiliares para selects/autocomplete */
  trabajadores: string[] = ['Matías', 'Adrian', 'Edgar', 'Rafael', 'Joseph'];
  areas: Proceso[] = ['Premontaje', 'Montaje', 'Pintura', 'Chasis'];

  /** Limpia todos los filtros y recarga */
  clearFilters() {
    this.f_fechaDesde.setValue('');
    this.f_fechaHasta.setValue('');
    this.f_trabajador.setValue('');
    this.f_area.setValue('');
    this.currentPage.set(1);
    this.fetchRows();
  }

  // =========================================================
  //  Estado de datos
  // =========================================================
  /** Resultado crudo ya mapeado a `SearchRow` */
  rows = signal<SearchRow[]>([]);
  /** Indicadores de carga y error */
  loading = signal(false);
  errorMsg = signal<string | null>(null);

  // =========================================================
  //  Carga desde API (con debounce suave)
  // =========================================================
  private fetchTimer: any = null;

  /**
   * Programa una nueva carga con un pequeño retraso (250ms)
   * para agrupar cambios de filtros y evitar peticiones en ráfaga.
   */
  private scheduleFetch() {
    clearTimeout(this.fetchTimer);
    this.fetchTimer = setTimeout(() => this.fetchRows(), 250);
  }

  /**
   * Extrae la parte YYYY-MM-DD de una fecha ISO o con espacio.
   * @param value Cadena de fecha, con posible hora.
   */
  private toDateOnly(value?: string | null): string {
    if (!value) return '';
    const t = value.trim();
    if (t.includes('T')) return t.split('T')[0];
    if (t.includes(' ')) return t.split(' ')[0];
    return t;
  }

  /**
   * Llama al backend aplicando los filtros actuales y transforma
   * la respuesta a un modelo de UI consistente y amigable.
   */
  private fetchRows() {
    this.loading.set(true);
    this.errorMsg.set(null);

    // Construcción segura de filtros
    const from = (this.f_fechaDesde.value || '').trim();
    const to = (this.f_fechaHasta.value || '').trim();
    const trab = (this.f_trabajador.value || '').trim();
    const areaHuman = this.f_area.value || '';
    // El backend espera minúsculas
    const area = areaHuman ? areaHuman.toLowerCase() as 'premontaje'|'montaje'|'pintura'|'chasis' : undefined;

    this.tareasSrv.getTareasLog({
      from: from || undefined,
      to: to || undefined,
      trabajador: trab || undefined,
      area,
    }).subscribe({
      next: (list) => {
        // Mapeo: normaliza fechas y rellena campos vacíos
        const mapped = (list || []).map(r => ({
          id: r.id,
          fecha: this.toDateOnly(r.fecha),                               // sin hora
          fecha_fin: r.fecha_fin ? this.toDateOnly(r.fecha_fin) : 'Pendiente',
          trabajador: r.trabajador,
          area: r.area as Proceso,
          accion: r.accion ?? 'Registro',
          resultado: r.resultado ?? 'OK',
        }));
        this.rows.set(mapped);
        this.currentPage.set(1); // al recargar lista, vuelve a pág. 1
        this.loading.set(false);
      },
      error: (e) => {
        console.error(e);
        this.errorMsg.set('No se pudieron cargar los datos.');
        this.loading.set(false);
      }
    });
  }

  // =========================================================
  //  Ordenación (client-side)
  // =========================================================
  /** Columna activa de ordenación */
  sortKey = signal<SortKey>('fecha');
  /** Dirección de ordenación */
  sortDir = signal<'asc' | 'desc'>('desc');

  /**
   * Cambia columna/dirección de ordenación.
   * Fechas por defecto ordenan descendente; texto ascendente.
   */
  sortBy(key: SortKey) {
    if (this.sortKey() === key) {
      this.sortDir.update(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortKey.set(key);
      this.sortDir.set((key === 'fecha' || key === 'fecha_fin') ? 'desc' : 'asc');
    }
    this.currentPage.set(1); // al cambiar orden, vuelve a pág. 1
  }

  /** Normaliza para comparar cadenas de forma consistente */
  private norm(v: unknown) { return (v ?? '').toString().toLocaleLowerCase('es'); }

  /**
   * Devuelve la colección ordenada según `sortKey/sortDir`.
   * Se usa como base para paginar.
   */
  filteredRows = computed(() => {
    const data = this.rows();
    const key = this.sortKey();
    const mult = this.sortDir() === 'asc' ? 1 : -1;

    return [...data].sort((a, b) => {
      const av = (key === 'fecha' || key === 'fecha_fin') ? (a[key] || '') : this.norm(a[key]);
      const bv = (key === 'fecha' || key === 'fecha_fin') ? (b[key] || '') : this.norm(b[key]);
      if (av < bv) return -1 * mult;
      if (av > bv) return  1 * mult;
      return a.id - b.id; // orden estable por ID
    });
  });

  /** Total de elementos filtrados/ordenados (antes de paginar) */
  totalFiltrados = computed(() => this.filteredRows().length);

  // =========================================================
  //  Paginación (client-side)
  // =========================================================
  /** Elementos por página */
  readonly pageSize = 10;
  /** Página actual (1-based) */
  currentPage = signal(1);

  /** Número total de páginas derivado del total filtrado */
  totalPages = computed(() => {
    const total = this.totalFiltrados();
    return Math.max(1, Math.ceil(total / this.pageSize));
  });

  /**
   * Slice de filas para la página actual.
   * (Si cambias a paginación de backend, este slice no se usa).
   */
  paginatedRows = computed(() => {
    const page = this.currentPage();
    const start = (page - 1) * this.pageSize;
    return this.filteredRows().slice(start, start + this.pageSize);
  });

  // --- Navegación + items con elipsis ---
  /** Ventana de páginas visibles a cada lado de la actual */
  private readonly window = 2;

  /**
   * Calcula los items de paginación con elipsis.
   * Ej.: [1, '…', 5, 6, 7, '…', 20]
   */
  pageItems = computed<(number | '…')[]>(() => {
    const total = this.totalPages();
    const current = this.currentPage();
    const win = this.window;

    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }

    const pages: (number | '…')[] = [];
    const start = Math.max(2, current - win);
    const end   = Math.min(total - 1, current + win);

    pages.push(1);
    if (start > 2) pages.push('…');
    for (let p = start; p <= end; p++) pages.push(p);
    if (end < total - 1) pages.push('…');
    pages.push(total);

    return pages;
  });

  /**
   * Cambia a una página concreta garantizando el rango [1..total].
   * Si el backend fuera paginado, aquí dispararías una carga remota.
   */
  goToPage(n: number) {
    const max = this.totalPages();
    const target = Math.min(Math.max(1, n), max);
    if (target === this.currentPage()) return;
    this.currentPage.set(target);
  }

  /** Navegación relativa */
  prevPage() { this.goToPage(this.currentPage() - 1); }
  nextPage() { this.goToPage(this.currentPage() + 1); }

  // =========================================================
  //  Selección
  // =========================================================
  /** ID de fila seleccionada (para resaltar o acciones) */
  selectedId = signal<number | null>(null);
  /** Marca fila seleccionada por ID */
  selectRow(id: number) { this.selectedId.set(id); }
  /** TrackBy para *ngFor (rendimiento) */
  trackById = (_: number, r: SearchRow) => r.id;
}
