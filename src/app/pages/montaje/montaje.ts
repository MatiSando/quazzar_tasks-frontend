// src/app/pages/montaje/montaje.ts
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import {
  TareasService,
  Proceso,
  TareaCatalogo,
  PendienteResp,
  PendingItem
} from '../../services/tareas';

import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

/** Modelo UI de una tarea simple (check) */
type Task = { label: string; done: boolean };
/** Sección agrupadora de tareas (Fase 1, Fase 2, …) */
type Section = { name: string; tasks: Task[] };
/** Opción de color para el selector (value puede ser HEX o nombre tal cual viene de BD) */
type ColorOption = { label: string; value: string };
/** Estados internos del VIN en el input */
type VinStatus = 'idle' | 'typing' | 'checking' | 'ok' | 'dup' | 'notfound' | 'invalid';

@Component({
  selector: 'app-montaje-tareas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './montaje.html',
  styleUrls: ['./montaje.css'],
})
export class MontajeTareasComponent implements OnInit {
  // ===== Inyectables =====
  private router = inject(Router);
  private tareasSrv = inject(TareasService);

  // ===== Constantes de módulo =====
  private readonly MODULE_KEY = 'MONTAJE';
  private readonly PROCESO: Proceso = 'montaje';

  // ===== Usuario / cabecera =====
  userName = signal(''); // nombre mostrado en el header (leído de sessionStorage)

  // ===== Modal “Guardar progreso y salir” =====
  private _showLeaveModal = signal(false);
  showLeaveModal = () => this._showLeaveModal();   // getter para el *ngIf del modal
  closeLeaveModal() { this._showLeaveModal.set(false); }
  private _pendingLeaveTarget: 'home' | 'logout' | null = null; // adónde vamos tras cerrar modal

  /**
   * Indica si debemos preguntar al salir.
   * Solo tiene sentido si hay color, VIN seleccionado y el VIN está OK.
   */
  private shouldPromptOnLeave(): boolean {
    return !!this.vehicleColorHex() &&
           !!this.selectedBastidor() &&
           this.vinStatus() === 'ok';
  }

  /** Intenta salir; si hay progreso relevante muestra el modal, si no, navega directamente. */
  private tryLeave(target: 'home' | 'logout') {
    if (this.shouldPromptOnLeave()) {
      this._pendingLeaveTarget = target;
      this._showLeaveModal.set(true);
    } else {
      this.leaveNow(target);
    }
  }

  /** Navegación inmediata (sin modal) */
  private leaveNow(target: 'home' | 'logout') {
    if (target === 'logout') {
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('qp_user');
      this.router.navigate([''], { replaceUrl: true });
    } else {
      this.router.navigate(['/home']);
    }
  }

  // Acciones de cabecera
  logout() { this.tryLeave('logout'); }
  goHome() { this.tryLeave('home'); }

  // ===== Helpers usuario / contador diario =====
  private getToday(): string { return new Date().toISOString().split('T')[0]; }
  private getCurrentUserEmail(): string {
    try {
      const raw = sessionStorage.getItem('qp_user');
      if (!raw) return '';
      return (JSON.parse(raw)?.email ?? '').toLowerCase();
    } catch { return ''; }
  }
  private getCurrentUserId(): number {
    try {
      const raw = sessionStorage.getItem('qp_user');
      if (!raw) return 0;
      return Number(JSON.parse(raw)?.id ?? 0);
    } catch { return 0; }
  }
  private getCountKey(email = this.getCurrentUserEmail(), date = this.getToday()): string {
    return `count_${email}_${date}_${this.MODULE_KEY}`;
  }

  // ===== Estado global de pantalla =====
  dailyCount = signal(0);                 // contador de tareas finalizadas hoy (persistido en localStorage)
  loading = signal(false);
  errorMsg = signal<string | null>(null);

  // ===== Colores (vienen de BD Pintura) =====
  colorOptions = signal<ColorOption[]>([]); // catálogo de colores sin duplicados
  vehicleColorHex = signal<string>('');     // valor elegido (HEX o nombre)
  vehicleColorName = signal<string>('');    // etiqueta legible para mostrar

  /** Selección de color: busca la opción por value y sincroniza etiqueta */
  setColor(value: string) {
    const opt = this.colorOptions().find(o => o.value.toUpperCase() === (value || '').toUpperCase());
    this.vehicleColorHex.set(value || '');
    this.vehicleColorName.set(opt?.label ?? value ?? '');
  }

  /** Normaliza etiqueta de color para mostrar (HEX en mayúsculas, nombre capitalizado) */
  private toLabel(v: string): string {
    const s = (v || '').trim();
    const isHex = /^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(s);
    if (isHex) return s.toUpperCase();
    return s.toLowerCase().replace(/\b\w/g, m => m.toUpperCase());
  }

  /** Inserta un color en la lista si no existe aún (evita duplicados por mayúsc/minúsc o label) */
  private pushColorIfMissing(raw: string) {
    const val = (raw || '').trim();
    if (!val) return;
    const exists = this.colorOptions().some(
      c => c.value.toUpperCase() === val.toUpperCase() || c.label.toLowerCase() === val.toLowerCase()
    );
    if (!exists) {
      const newList = [...this.colorOptions(), { label: this.toLabel(val), value: val }];
      this.colorOptions.set(newList);
    }
  }

  // ===== VIN (bastidor) — lista + validación =====
  bastidorOptions = signal<string[]>([]);  // lista fuente para datalist
  vinQuery = signal<string>('');           // texto que escribe el usuario
  selectedBastidor = signal<string>('');   // VIN seleccionado (limpio)
  vinEnUso = signal<boolean>(false);       // true si ya está finalizado en Montaje
  vinStatus = signal<VinStatus>('idle');   // estado de UI

  /** VIN válido (solo alfanumérico; aquí no se fuerza longitud) */
  private isValidVin(v?: string | null) {
    if (!v) return false;
    return /^[A-Z0-9]+$/.test(v.toUpperCase());
  }
  /** VIN presente en la lista de BD (datalist) */
  private inDbList(v: string) {
    return this.bastidorOptions().includes((v || '').toUpperCase());
  }

  /** Lista filtrada para el datalist según lo que va tecleando el usuario */
  bastidorFiltered = computed(() => {
    const q = this.vinQuery().toUpperCase().trim();
    const all = this.bastidorOptions();
    if (!q) return all;
    return all.filter(v => v.includes(q));
  });

  // ===== Tareas por secciones (desde BD) =====
  sections = signal<Section[]>([]);  // cada sección contiene su array de tasks

  /** % de progreso por sección (redondeado) */
  progress(section: Section): number {
    const t = section.tasks.length || 1;
    const d = section.tasks.filter(x => x.done).length;
    return Math.round((d / t) * 100);
  }
  /** Alterna una tarea dentro de una sección (inmutable) */
  toggleTask(si: number, ti: number) {
    const copy = structuredClone(this.sections());
    copy[si].tasks[ti].done = !copy[si].tasks[ti].done;
    this.sections.set(copy);
  }
  /** Limpia todas las tareas de una sección */
  clearSection(si: number) {
    const copy = structuredClone(this.sections());
    copy[si].tasks.forEach(t => (t.done = false));
    this.sections.set(copy);
  }

  // ===== Validaciones compuestas =====
  private hasColor = computed(() => !!this.vehicleColorHex());
  private vinLibre = computed(() => !this.vinEnUso());
  private sectionComplete = (s: Section) => s.tasks.length > 0 && s.tasks.every(t => t.done);
  private allSectionsDone = computed(() => {
    const secs = this.sections();
    return secs.length > 0 && secs.every(sec => this.sectionComplete(sec));
  });

  /** Condición global para habilitar el botón Finalizar */
  canFinish = computed(() =>
    this.allSectionsDone() &&
    this.hasColor() &&
    this.isValidVin(this.selectedBastidor()) &&
    this.inDbList(this.selectedBastidor()) &&
    this.vinLibre() &&
    this.vinStatus() === 'ok'
  );

  /** Comprueba si hay algún progreso (para decidir si mostrar modal al salir) */
  hasProgress() {
    const tareasHechas = this.sections().some(sec => sec.tasks.some(t => t.done));
    const colorElegido = !!this.vehicleColorHex() || !!this.vehicleColorName();
    const vinEscrito = this.selectedBastidor().trim().length > 0;
    return tareasHechas || colorElegido || vinEscrito;
  }

  // ===== Limpiezas =====
  /** Limpia datos del vehículo (color + VIN + estados) */
  clearVehicle() {
    this.vehicleColorHex.set('');
    this.vehicleColorName.set('');
    this.selectedBastidor.set('');
    this.vinQuery.set('');
    this.vinEnUso.set(false);
    this.vinStatus.set('idle');
  }
  /** Limpia todas las tareas y el vehículo */
  clearAll() {
    const copy = structuredClone(this.sections());
    copy.forEach(sec => sec.tasks.forEach(t => (t.done = false)));
    this.sections.set(copy);
    this.clearVehicle();
  }

  // ===== Persistencia / normalización =====
  /** Normaliza el label a un nombre de columna (igual que en backend) */
  private labelToCol(label: string): string {
    if (!label) return '';
    let s = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    s = s.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    return s.replace(/^_+|_+$/g, '');
  }

  /** Construye el payload de checks usando el label tal cual (el back lo normaliza igual) */
  private buildChecksPayload(): Record<string, boolean> {
    const p: Record<string, boolean> = {};
    for (const s of this.sections()) {
      for (const t of s.tasks) p[t.label] = !!t.done;
    }
    return p;
  }

  // ===== Modal de “Finalizar” =====
  showModal = signal(false);
  finish() {
    if (!this.canFinish()) return;
    this.showModal.set(true);
  }
  closeModal() { this.showModal.set(false); }
  onBackdropClick(ev: MouseEvent) {
    if (ev.target === ev.currentTarget) this.closeModal();
  }

  // ===== Reanudar pendientes: snapshot para evitar condiciones de carrera =====
  private _pendingSnapshot: { color?: string | null; checks?: Record<string, boolean>; id?: number } | null = null;

  /** Aplica el snapshot si las sections() ya están cargadas */
  private applyPendingIfReady() {
    if (!this._pendingSnapshot) return;
    if (this.sections().length === 0) return;

    const { color, checks } = this._pendingSnapshot;

    // Restaura color
    const c = (color || '').trim();
    if (c) {
      this.pushColorIfMissing(c);
      const opt = this.colorOptions().find(o => o.value.toUpperCase() === c.toUpperCase());
      if (opt) {
        this.vehicleColorHex.set(opt.value);
        this.vehicleColorName.set(opt.label);
      } else {
        this.vehicleColorHex.set(c);
        this.vehicleColorName.set(this.toLabel(c));
      }
    }

    // Restaura checks por sección/tarea
    const ck = checks || {};
    const arr = structuredClone(this.sections());
    for (const sec of arr) {
      for (const t of sec.tasks) {
        const col = this.labelToCol(t.label);
        t.done = !!ck[col];
      }
    }
    this.sections.set(arr);

    this._pendingSnapshot = null;
  }

  /** Comprobación para autofinalizar un pendiente (si ya está todo completo) */
  private isAutoFinalizable(): boolean {
    return this.allSectionsDone() &&
           !!this.vehicleColorHex() &&
           !!this.selectedBastidor() &&
           this.vinStatus() === 'ok';
  }

  // ===== Ciclo de vida =====
  ngOnInit(): void {
    // Cabecera: nombre de usuario
    try {
      const raw = sessionStorage.getItem('qp_user');
      if (raw) this.userName.set(JSON.parse(raw)?.full_name ?? '');
    } catch {}

    // Contador diario desde localStorage
    const saved = localStorage.getItem(this.getCountKey());
    this.dailyCount.set(saved ? +saved : 0);

    // Cargas iniciales en paralelo
    this.cargarColoresDesdePintura();
    this.cargarTareasDesdeBD();
    this.cargarBastidoresChasis();

    // Intento de autorreanudar últimos pendientes del usuario
    this.autoResumeFromUserPending();
  }

  /** Carga catálogo de tareas (proceso=montaje) y agrupa por sección */
  private cargarTareasDesdeBD() {
    this.loading.set(true);
    this.errorMsg.set(null);

    this.tareasSrv.getCatalogo(this.PROCESO).subscribe({
      next: (rows: TareaCatalogo[]) => {
        const activos = rows.filter(r => r.activa !== false);

        // Agrupar por sección (por defecto “Fase 1”)
        const mapSec = new Map<string, Task[]>();
        for (const r of activos) {
          const sec = (r.seccion?.trim() || 'Fase 1');
          if (!mapSec.has(sec)) mapSec.set(sec, []);
          mapSec.get(sec)!.push({ label: r.label, done: false });
        }

        // Ordenar por “Fase n” si existe; si no, alfabético
        const faseNum = (name: string) => {
          const m = name.match(/fase\s*(\d+)/i);
          return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
        };
        const ordered = Array.from(mapSec.entries())
          .sort((a, b) => {
            const fa = faseNum(a[0]); const fb = faseNum(b[0]);
            if (fa !== fb) return fa - fb;
            return a[0].localeCompare(b[0], 'es', { sensitivity: 'base' });
          })
          .map(([name, tasks]) => ({ name, tasks }));

        this.sections.set(ordered);
        this.loading.set(false);

        // Aplica snapshot si estaba en cola
        this.applyPendingIfReady();
      },
      error: (e) => {
        console.error(e);
        this.errorMsg.set('No se pudieron cargar las tareas de Montaje.');
        this.loading.set(false);
      }
    });
  }

  /** Carga colores desde BD de Pintura y normaliza sin duplicados */
  private cargarColoresDesdePintura() {
    this.tareasSrv.getColoresPintura(true).subscribe({
      next: (dbColors) => {
        const opts: ColorOption[] = [];
        const seen = new Set<string>();
        for (const raw of dbColors) {
          const val = (raw || '').trim();
          if (!val) continue;
          const key = val.toUpperCase();
          if (seen.has(key)) continue;
          seen.add(key);
          opts.push({ label: this.toLabel(val), value: val });
        }
        this.colorOptions.set(opts);
      },
      error: (e) => console.error('No se pudieron cargar colores de Pintura', e)
    });
  }

  /**
   * Dado un listado de VINs, comprueba cuáles siguen disponibles en Montaje.
   * Opcionalmente limita el lote para no disparar demasiadas peticiones concurrentes.
   */
  private filterAvailableInMontaje(vins: string[], batchLimit = 100) {
    const slice = vins.slice(0, batchLimit);

    const checks$ = slice.map(v =>
      this.tareasSrv.isVinDisponibleEnMontaje(v).pipe(
        map(avail => ({ v, avail })),
        catchError(() => of({ v, avail: false }))
      )
    );

    forkJoin(checks$).subscribe(results => {
      const filtered = results
        .filter(r => r.avail)
        .map(r => r.v.toUpperCase());

      const remainder = vins.slice(batchLimit).map(v => v.toUpperCase());

      this.bastidorOptions.set(
        [...filtered, ...remainder]
          .filter((v, i, a) => a.indexOf(v) === i) // únicos
      );
    });
  }

  /** Trae VINs desde Chasis y filtra los ya finalizados en Montaje */
  private cargarBastidoresChasis() {
    this.tareasSrv.getBastidoresChasis(true).subscribe({
      next: (list) => {
        const upperUnique = list
          .map(v => v.toUpperCase())
          .filter((v, i, a) => a.indexOf(v) === i);

        // Filtrado contra Montaje (disponibles)
        this.filterAvailableInMontaje(upperUnique);
      },
      error: (e) => {
        console.error('No se pudieron cargar bastidores de chasis', e);
        this.bastidorOptions.set([]);
      }
    });
  }
  /** Botón para refrescar manualmente la lista de VINs */
  refreshBastidores() { this.cargarBastidoresChasis(); }

  /** Maneja escritura del VIN: limpia, valida, consulta disponibilidad y autocompleta color/pending */
  onVinInput(value: string) {
    const clean = (value || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');

    this.vinQuery.set(clean);
    this.selectedBastidor.set(clean);
    this.vinEnUso.set(false);

    if (!clean) { this.vinStatus.set('idle'); return; }

    this.vinStatus.set('typing');

    // Si no está en la lista de BD, marcamos como "no encontrado"
    if (!this.inDbList(clean)) {
      this.vinStatus.set('notfound');
      return;
    }

    // Comprobación de disponibilidad en Montaje
    this.vinStatus.set('checking');
    this.tareasSrv.isVinDisponibleEnMontaje(clean).subscribe({
      next: (available) => {
        this.vinEnUso.set(!available);
        this.vinStatus.set(available ? 'ok' : 'dup');

        if (available) {
          // Autorellenar color desde Pintura por VIN (si existe)
          this.tareasSrv.getColorPinturaPorVin(clean).subscribe({
            next: (res) => {
              const color = (res?.color || '').trim();
              if (!color) return;
              this.pushColorIfMissing(color);
              const opt = this.colorOptions().find(
                c => c.value.toUpperCase() === color.toUpperCase()
              );
              if (opt) {
                this.vehicleColorHex.set(opt.value);
                this.vehicleColorName.set(opt.label);
              } else {
                this.vehicleColorHex.set(color);
                this.vehicleColorName.set(this.toLabel(color));
              }
            },
            error: () => { /* silencioso */ }
          });

          // Si hay pendiente del usuario con ese VIN, cargar snapshot
          const userId = this.getCurrentUserId();
          this.tareasSrv.getPendiente(this.PROCESO, clean, userId).subscribe({
            next: (p: PendienteResp) => {
              if (p?.exists) {
                if (p.bastidor) {
                  const vinUpper = p.bastidor.toUpperCase();
                  this.selectedBastidor.set(vinUpper);
                  this.vinQuery.set(vinUpper);
                }
                this._pendingSnapshot = { color: p.color ?? null, checks: p.checks ?? {}, id: p.id };
                this.applyPendingIfReady();

                // Si ya está todo completo, intentamos auto-finalizar
                if (this.isAutoFinalizable() && p.id) {
                  this.tareasSrv.finalizarTarea(this.PROCESO, p.id).subscribe({
                    next: () => {
                      const newTotal = this.dailyCount() + 1;
                      this.dailyCount.set(newTotal);
                      localStorage.setItem(this.getCountKey(), String(newTotal));
                      this.clearAll();
                    },
                    error: (e) => console.error('Error auto-finalizando pendiente', e),
                  });
                }
              }
            },
            error: () => { /* silencioso */ }
          });
        }
      },
      error: () => {
        this.vinEnUso.set(false);
        this.vinStatus.set('invalid');
      }
    });
  }

  /** Autorresumen/retomar al abrir, sin teclear VIN (busca el último pendiente del usuario) */
  private autoResumeFromUserPending() {
    const userId = this.getCurrentUserId();
    if (!userId) return;

    this.tareasSrv.getPendientesUsuario(userId).subscribe({
      next: (items: PendingItem[]) => {
        const mine = items.find(p => p.area_key === 'montaje' && (p.bastidor || '').trim().length > 0);
        if (!mine) return;

        const vin = (mine.bastidor || '').toUpperCase().trim();
        if (!vin) return;

        // Si el VIN no está en el datalist, lo añadimos para permitir la selección
        if (!this.inDbList(vin)) {
          const arr = [...this.bastidorOptions()];
          arr.push(vin);
          this.bastidorOptions.set(
            arr.filter((v, i, a) => a.indexOf(v) === i)
          );
        }

        this.selectedBastidor.set(vin);
        this.vinQuery.set(vin);

        // Traer snapshot completo del pendiente y aplicarlo
        this.tareasSrv.getPendiente(this.PROCESO, vin, this.getCurrentUserId()).subscribe({
          next: (p: PendienteResp) => {
            if (!p?.exists) return;

            this._pendingSnapshot = { color: p.color ?? null, checks: p.checks ?? {}, id: p.id };
            this.applyPendingIfReady();

            this.vinStatus.set('ok');
          },
          error: () => { /* silencioso */ }
        });
      },
      error: () => { /* silencioso */ }
    });
  }

  // ===== Persistencia: iniciar -> finalizar =====
  /** Lógica de “Finalizar” del modal: inicia la tarea + la marca finalizada y limpia UI */
  continueAndClear() {
    if (!this.canFinish()) return;
    const userId = this.getCurrentUserId();
    if (!userId) return;

    const vin = this.selectedBastidor() || null;
    const color = this.vehicleColorHex() || null;
    const checks = this.buildChecksPayload();

    this.tareasSrv.iniciarTarea({
      usuario_id: userId,
      area: this.PROCESO,
      bastidor: vin,
      color,
      checks
    }).subscribe({
      next: (resp) => {
        const newId = (resp as any)?.id_area as number | undefined;
        if (!newId) {
          console.error('Respuesta iniciar sin id_area', resp);
          return;
        }

        this.tareasSrv.finalizarTarea(this.PROCESO, newId).subscribe({
          next: () => {
            const newTotal = this.dailyCount() + 1;
            this.dailyCount.set(newTotal);
            localStorage.setItem(this.getCountKey(), String(newTotal));
            this.clearAll();
            this.showModal.set(false);
          },
          error: (e) => console.error('Error al finalizar en BD', e)
        });
      },
      error: (e) => console.error('Error al iniciar en BD', e)
    });
  }

  /** Guardar y salir: persiste como “pendiente” y luego navega */
  confirmSaveAndLeave() {
    if (!this.vehicleColorHex() || !this.selectedBastidor() || this.vinStatus() !== 'ok') {
      this._showLeaveModal.set(false);
      this.leaveNow(this._pendingLeaveTarget || 'home');
      return;
    }

    const userId = this.getCurrentUserId();
    if (!userId) {
      this._showLeaveModal.set(false);
      this.leaveNow(this._pendingLeaveTarget || 'home');
      return;
    }

    const color = this.vehicleColorHex();
    const bastidor = this.selectedBastidor();
    const checks = this.buildChecksPayload();

    this.tareasSrv.iniciarTarea({
      usuario_id: userId,
      area: this.PROCESO,
      color,
      bastidor,
      checks
    }).subscribe({
      next: () => {
        this._showLeaveModal.set(false);
        this.clearAll();
        this.leaveNow(this._pendingLeaveTarget || 'home');
      },
      error: () => {
        this._showLeaveModal.set(false);
        this.leaveNow(this._pendingLeaveTarget || 'home');
      }
    });
  }

  /** Salir descartando cambios (no persiste pendiente) */
  confirmLeaveWithoutSaving() {
    this._showLeaveModal.set(false);
    this.clearAll();
    this.leaveNow(this._pendingLeaveTarget || 'home');
  }

  /** Cerrar modal sin hacer nada */
  cancelLeave() {
    this._showLeaveModal.set(false);
    this._pendingLeaveTarget = null;
  }
}
