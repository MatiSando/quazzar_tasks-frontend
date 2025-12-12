import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

import {
  TareasService,
  Proceso,
  TareaCatalogo,
  PendingItem,
  SnapshotResp,
} from '../../services/tareas';

type Task = { label: string; done: boolean };
type Section = { name: string; tasks: Task[] };

@Component({
  selector: 'app-pintura',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pintura.html',
  styleUrls: ['./pintura.css'],
})
export class PinturaTareasComponent implements OnInit {

  // === inyectables ===
  private router = inject(Router);         // Router para navegar (home/logout)
  private tareasSrv = inject(TareasService); // Servicio HTTP de la API

  // === constantes módulo ===
  private readonly MODULE_KEY = 'PINTURA';     // Clave para contador local (LS)
  private readonly PROCESO: Proceso = 'pintura'; // Nombre del proceso para la API

  // === usuario / cabecera ===
  userName = signal(''); // Nombre del usuario logado (para mostrar en header)

  // === contador diario (sólo suma al finalizar) ===
  dailyCount = signal(0); // Contador de tareas finalizadas hoy (por usuario + día)

  private getToday(): string {
    // Devuelve fecha YYYY-MM-DD (para clave de LS del contador)
    return new Date().toISOString().split('T')[0];
  }
  private getCurrentUserEmail(): string {
    // Lee email del usuario almacenado en sessionStorage (qp_user)
    try {
      const raw = sessionStorage.getItem('qp_user');
      if (!raw) return '';
      return (JSON.parse(raw)?.email ?? '').toLowerCase();
    } catch { return ''; }
  }
  private getCurrentUserId(): number {
    // Lee id numérico del usuario logado desde sessionStorage (qp_user)
    try {
      const raw = sessionStorage.getItem('qp_user');
      if (!raw) return 0;
      return Number(JSON.parse(raw)?.id ?? 0);
    } catch { return 0; }
  }
  private getCountKey(email = this.getCurrentUserEmail(), date = this.getToday()): string {
    // Construye la clave única para el contador diario (LS)
    return `count_${email}_${date}_${this.MODULE_KEY}`;
  }

  // === estado global ===
  loading = signal(false);            // Cargando catálogo/llamadas
  errorMsg = signal<string | null>(null); // Mensaje de error visual

  // === inputs de color ===
  colorDescripcion = signal(''); // Texto libre del color
  colorRAL = signal('');         // Código RAL

  // === secciones/tareas (llenadas desde BD) ===
  sections = signal<Section[]>([]); // Estructura por secciones con tareas

  // ===== control de pendiente por ID =====
  private _pendingId: number | null = null; // Si retomamos, aquí guardamos el id del pendiente

  // ===== snapshot pendiente (para aplicar cuando haya catálogo) =====
  private _pendingSnapshot: { color?: string | null; RAL?: string | null; checks?: Record<string, boolean>; id?: number } | null = null;

  /** Normaliza LABEL -> nombre de columna (igual que en back) */
  private labelToCol(label: string): string {
    // Quita acentos, pasa a snake_case alfanumérico (coincide con nombres de columnas en BD)
    if (!label) return '';
    let s = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    s = s.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    return s.replace(/^_+|_+$/g, '');
  }

  /** Devuelve un patch con claves de COLUMNA (no labels) para PUT */
  private buildChecksPatch(): Record<string, 0|1> {
    // Recorre todas las tareas y devuelve { columna: 0|1 } para actualización parcial
    const patch: Record<string, 0|1> = {};
    for (const sec of this.sections()) {
      for (const t of sec.tasks) {
        const col = this.labelToCol(t.label);
        patch[col] = t.done ? 1 : 0;
      }
    }
    return patch;
  }

  /** Aplica snapshot si ya hay secciones cargadas */
  private applyPendingIfReady() {
    // Si hay datos pendientes guardados y el catálogo ya está en memoria, los aplicamos
    if (!this._pendingSnapshot) return;
    if (this.sections().length === 0) return;

    const { color, RAL, checks, id } = this._pendingSnapshot;

    // Color / RAL
    if ((color || '').trim()) this.colorDescripcion.set((color || '').trim());
    if ((RAL || '').trim())   this.colorRAL.set((RAL || '').trim());

    // Checks -> marca done según snapshot
    const ck = checks || {};
    const arr = structuredClone(this.sections());
    for (const sec of arr) {
      for (const t of sec.tasks) {
        const col = this.labelToCol(t.label);
        t.done = !!ck[col];
      }
    }
    this.sections.set(arr);

    // guarda id (clave para trabajar por id)
    this._pendingId = id ?? null;
    this._pendingSnapshot = null;
  }

  // ===== MODALES =====
  showModal = signal(false); // Modal de "tareas completadas"
  closeModal() { this.showModal.set(false); }

  private _showLeaveModal = signal(false); // Modal "guardar y salir"
  showLeaveModal = () => this._showLeaveModal();
  closeLeaveModal() { this._showLeaveModal.set(false); }
  private _pendingLeaveTarget: 'home' | 'logout' | null = null; // a dónde ir tras salir

  // ===== ciclo de vida =====
  ngOnInit(): void {
    // usuario
    try {
      const raw = sessionStorage.getItem('qp_user');
      if (raw) this.userName.set(JSON.parse(raw)?.full_name ?? '');
    } catch {}

    // contador local (lee LS por clave única)
    const saved = localStorage.getItem(this.getCountKey());
    this.dailyCount.set(saved ? +saved : 0);

    // cargar catálogo de PINTURA
    this.cargarTareasDesdeBD();

    // autorreanudar si el usuario tiene un pendiente en pintura (por id)
    this.autoResumeFromUserPending();
  }

  /** Carga catálogo proceso=pintura y agrupa por sección */
  private cargarTareasDesdeBD() {
    // Pide a la API todas las tareas del catálogo para "pintura" y construye sections[] agrupando por seccion
    this.loading.set(true);
    this.errorMsg.set(null);

    this.tareasSrv.getCatalogo(this.PROCESO).subscribe({
      next: (rows: TareaCatalogo[]) => {
        const activos = rows.filter(r => r.activa !== false);

        // Agrupar por sección
        const mapSec = new Map<string, Task[]>();
        for (const r of activos) {
          const sec = (r.seccion?.trim() || 'Partes');
          if (!mapSec.has(sec)) mapSec.set(sec, []);
          mapSec.get(sec)!.push({ label: r.label, done: false });
        }

        // Ordenar por nombre (y Fase X si aplica)
        const faseNum = (name: string) => {
          const m = name.match(/fase\s*(\d+)/i);
          return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
        };
        const ordered = Array.from(mapSec.entries())
          .sort((a, b) => {
            const fa = faseNum(a[0]), fb = faseNum(b[0]);
            if (fa !== fb) return fa - fb;
            return a[0].localeCompare(b[0], 'es', { sensitivity: 'base' });
          })
          .map(([name, tasks]) => ({ name, tasks }));

        this.sections.set(ordered);
        this.loading.set(false);

        // Si ya teníamos snapshot de pendiente, aplícalo ahora
        this.applyPendingIfReady();
      },
      error: (e) => {
        console.error(e);
        this.errorMsg.set('No se pudieron cargar las tareas de Pintura.');
        this.loading.set(false);
      }
    });
  }

  // ===== cómputos =====
  colorInputsComplete = computed(() =>
    // Considera completo cuando hay descripción y RAL
    this.colorDescripcion().trim().length > 0 &&
    this.colorRAL().trim().length > 0
  );

  progress = (sec: Section) =>
    // Porcentaje de progreso por sección (nº tareas hechas / total)
    sec.tasks.length === 0 ? 0 :
      Math.round((sec.tasks.filter(t => t.done).length * 100) / sec.tasks.length);

  private sectionComplete = (s: Section) => s.tasks.every(t => t.done); // Todas las tareas de la sección marcadas

  allComplete = computed(() =>
    // Todo listo para finalizar: hay secciones y todas completas + color y RAL rellenos
    this.sections().length > 0 &&
    this.sections().every(s => this.sectionComplete(s)) &&
    this.colorInputsComplete()
  );

  /** ¿Hay progreso en general? */
  hasProgress(): boolean {
    // Se usa para decidir si mostrar algún modal o lógica de salida
    const tareasHechas = this.sections().some(s => s.tasks.some(t => t.done));
    const colorLleno = this.colorDescripcion().trim().length > 0 || this.colorRAL().trim().length > 0;
    return tareasHechas || colorLleno;
  }

  /** Mostrar modal de salida solo si hay color y RAL */
  private shouldPromptOnLeave(): boolean { return this.colorInputsComplete(); }

  // ===== acciones UI =====
  toggleTask(sectionIndex: number, taskIndex: number) {
    // Invierte el estado done de una tarea concreta
    const arr = structuredClone(this.sections());
    const task = arr[sectionIndex].tasks[taskIndex];
    arr[sectionIndex].tasks[taskIndex] = { ...task, done: !task.done };
    this.sections.set(arr);
  }

  onColorInputChange(event: Event, type: 'descripcion' | 'ral') {
    // Actualiza los inputs de color con el valor del <input>
    const value = (event.target as HTMLInputElement).value;
    if (type === 'descripcion') this.colorDescripcion.set(value);
    else this.colorRAL.set(value);
  }

  clearSection(sectionIndex: number) {
    // Limpia (pone en false) todas las tareas de una sección
    const arr = structuredClone(this.sections());
    arr[sectionIndex].tasks = arr[sectionIndex].tasks.map(t => ({ ...t, done: false }));
    this.sections.set(arr);
  }

  clearAll() {
    // Limpia todas las tareas + borra inputs de color + resetea id pendiente
    const arr = structuredClone(this.sections());
    arr.forEach(s => s.tasks = s.tasks.map(t => ({ ...t, done: false })));
    this.sections.set(arr);
    this.colorDescripcion.set('');
    this.colorRAL.set('');
    this._pendingId = null; // muy importante, resetea el contexto de pendiente
  }

  // ===== Finalizar =====
  finish() { if (this.allComplete()) this.showModal.set(true); } // Abre modal de confirmación

  /** iniciar/actualizar + finalizar, sumando contador y limpiando */
  continueAndClear() {
    // Flujo principal al pulsar "Finalizar"
    if (!this.allComplete()) return;
    const userId = this.getCurrentUserId();
    if (!userId) return;

    const color = this.colorDescripcion().trim() || null;
    const RAL   = this.colorRAL().trim() || null;

    const afterFinish = () => {
      // Sumar 1 al contador de hoy, persistir, limpiar y cerrar modal
      const newTotal = this.dailyCount() + 1;
      this.dailyCount.set(newTotal);
      localStorage.setItem(this.getCountKey(), String(newTotal));
      this.clearAll();
      this.showModal.set(false);
    };

    // Si venimos de un pendiente (tenemos id) → actualizar por id y finalizar ese MISMO id
    if (this._pendingId) {
      const patch = { color, RAL, ...this.buildChecksPatch() };
      this.tareasSrv.actualizarTarea(this.PROCESO, this._pendingId, patch).subscribe({
        next: () => {
          this.tareasSrv.finalizarTarea(this.PROCESO, this._pendingId!).subscribe({
            next: afterFinish,
            error: (e) => console.error('Error al finalizar (pintura)', e)
          });
        },
        error: (e) => console.error('Error al actualizar por id (pintura)', e),
      });
      return;
    }

    // Si NO hay pendiente (no hay id) → crear y finalizar
    const checks = this.buildChecksPatch(); // ya normalizado a columnas
    this.tareasSrv.iniciarTarea({
      usuario_id: userId,
      area: this.PROCESO,
      color,
      RAL,
        checks: Object.fromEntries(
        this.sections().flatMap(sec => sec.tasks.map(t => [t.label, !!t.done]))
      )
    }).subscribe({
      next: (resp) => {
        const newId = (resp as any)?.id_area as number | undefined;
        if (!newId) { console.error('Respuesta iniciar sin id_area', resp); return; }

        this.tareasSrv.finalizarTarea(this.PROCESO, newId).subscribe({
          next: afterFinish,
          error: (e) => console.error('Error al finalizar en BD', e)
        });
      },
      error: (e) => console.error('Error al iniciar en BD', e)
    });
  }

  // ===== Salir (volver / logout) con modal de “Guardar progreso” =====
  private tryLeave(target: 'home' | 'logout') {
    // Decide si mostrar modal de guardar y salir o salir directo
    if (this.shouldPromptOnLeave()) {
      this._pendingLeaveTarget = target;
      this._showLeaveModal.set(true);
      return;
    }
    this.leaveNow(target);
  }

  /** Guardar y salir (usa id si lo hay; si no, crea pendiente nuevo) */
  confirmSaveAndLeave() {
    // Desde el modal: guarda (upsert por id o iniciar) y luego navega
    if (!this.colorInputsComplete()) {
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

    const color = this.colorDescripcion().trim();
    const RAL   = this.colorRAL().trim();

    const done = () => {
      this._showLeaveModal.set(false);
      this.clearAll();
      this.leaveNow(this._pendingLeaveTarget || 'home');
    };

    if (this._pendingId) {
      // upsert directo por id
      const patch = { color, RAL, ...this.buildChecksPatch() };
      this.tareasSrv.actualizarTarea(this.PROCESO, this._pendingId, patch).subscribe({
        next: done,
        error: done
      });
      return;
    }

    // crear pendiente nuevo
    this.tareasSrv.iniciarTarea({
      usuario_id: userId,
      area: this.PROCESO,
      color,
      RAL,
      checks: Object.fromEntries(
        this.sections().flatMap(sec => sec.tasks.map(t => [t.label, !!t.done]))
      )
    }).subscribe({ next: done, error: done });
  }

  confirmLeaveWithoutSaving() {
    // Opción del modal: salir sin guardar (limpia estado y navega)
    this._showLeaveModal.set(false);
    this.clearAll();
    this.leaveNow(this._pendingLeaveTarget || 'home');
  }
  cancelLeave() {
    // Cierra el modal sin hacer nada
    this._showLeaveModal.set(false);
    this._pendingLeaveTarget = null;
  }

  /** Acción final de salida */
  private leaveNow(target: 'home' | 'logout') {
    // Navegación final según destino (limpia token/usuario si es logout)
    if (target === 'logout') {
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('qp_user');
      this.router.navigate([''], { replaceUrl: true });
    } else {
      this.router.navigate(['/home']);
    }
  }

  goHome() { this.tryLeave('home'); }   // Botón "volver a tareas"
  logout() { this.tryLeave('logout'); } // Botón "cerrar sesión"

  // ====== AUTORREANUDAR PENDIENTE DEL USUARIO (PINTURA) ======
  private autoResumeFromUserPending() {
    // Busca en la API si el usuario tiene un pendiente en "pintura"
    const userId = this.getCurrentUserId();
    if (!userId) return;

    this.tareasSrv.getPendientesUsuario(userId).subscribe({
      next: (items: PendingItem[]) => {
        // Selecciona el primero del área "pintura"
        const mine = items.find(p => p.area_key === 'pintura');
        if (!mine) return;

        // Pide un snapshot completo por id (color, RAL, checks normalizados)
        this.tareasSrv.getSnapshot('pintura', mine.id).subscribe({
          next: (snap: SnapshotResp) => {
            if (!snap?.exists) return;

            // Guardar datos para aplicar cuando el catálogo esté listo
            this._pendingSnapshot = {
              color:  snap.color ?? mine.color ?? null,
              RAL:    snap.RAL   ?? mine.RAL   ?? null,
              checks: snap.checks ?? {},
              id:     snap.id ?? mine.id
            };

            // Si ya hay catálogo, se aplicará aquí mismo
            this.applyPendingIfReady();
          },
          error: () => { /* silencioso */ }
        });
      },
      error: () => { /* silencioso */ }
    });
  }
}
