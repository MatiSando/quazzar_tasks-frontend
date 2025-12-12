// src/app/pages/premontaje/premontaje.ts
import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';

import {
  TareasService,
  Proceso,
  TareaCatalogo,
  PendingItem,
  SnapshotResp,
} from '../../services/tareas';

// ---- Tipos mínimos de apoyo de la vista ----
type Task = { label: string; done: boolean };
type Section = { name: string; tasks: Task[] };
type ColorOption = { label: string; value: string };

@Component({
  selector: 'app-premontaje-tareas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './premontaje.html',
  styleUrls: ['./premontaje.css'],
})
export class PremontajeTareasComponent implements OnInit {

  // Router y servicio de API (DI clásica con inject())
  private router = inject(Router);
  private tareasSrv = inject(TareasService);

  // ===== Constantes del módulo =====
  // Clave usada en keys locales y en el back
  private readonly MODULE_KEY: string = 'PREMONTAJE';
  // Valor de proceso tal como espera la API
  private readonly PROCESO: Proceso = 'premontaje';

  // ===== Cabecera / sesión =====
  // Nombre del usuario logado (se saca de sessionStorage en ngOnInit)
  userName = signal('');

  // ===== Utilidades de usuario/contador diario =====
  // YYYY-MM-DD del día actual (para componer la key del contador)
  private getToday(): string { return new Date().toISOString().split('T')[0]; }

  // Email e id del usuario desde sessionStorage (los guarda tu login)
  private getCurrentUserEmail(): string {
    try { return (JSON.parse(sessionStorage.getItem('qp_user') || '{}')?.email ?? '').toLowerCase(); }
    catch { return ''; }
  }
  private getCurrentUserId(): number {
    try { return Number(JSON.parse(sessionStorage.getItem('qp_user') || '{}')?.id ?? 0); }
    catch { return 0; }
  }

  // Clave del contador diario por usuario+fecha+módulo → count_email_YYYY-MM-DD_PREMONTAJE
  private getCountKey(email = this.getCurrentUserEmail(), date = this.getToday()): string {
    return `count_${email}_${date}_${this.MODULE_KEY}`;
  }

  // ===== Estado general de la pantalla =====
  loading = signal(false);                // spinner general de carga
  errorMsg = signal<string | null>(null); // error de catálogo u otros

  // ===== Contador diario (sólo se incrementa al finalizar correctamente) =====
  dailyCount = signal(0);

  // ===== Colores (provenientes del histórico de Pintura) =====
  // Lista maestra de opciones (sin duplicados). Usamos array simple (no signal) para evitar
  // re-render excesivo en el select; los signals para el valor elegido.
  colorOptions: ColorOption[] = [];
  // HEX o nombre exacto que guardaremos en la BD
  vehicleColorHex = signal<string>('');   // value real (p.ej. "#FF0000" o "Rojo Corsa")
  // Etiqueta mostrada al usuario (capitalizada, o el propio HEX)
  vehicleColorName = signal<string>('');

  // Normaliza una etiqueta: si es HEX → en mayúsculas; si es nombre → Capitalize Words
  private toLabel(v: string): string {
    const s = (v || '').trim();
    const isHex = /^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(s);
    if (isHex) return s.toUpperCase();
    return s.toLowerCase().replace(/\b\w/g, m => m.toUpperCase());
  }

  // Inserta un color si no existe (evita duplicados por value o por label)
  private pushColorIfMissing(raw: string) {
    const val = (raw || '').trim();
    if (!val) return;
    const exists = this.colorOptions.some(
      c => c.value.toUpperCase() === val.toUpperCase() || c.label.toLowerCase() === val.toLowerCase()
    );
    if (!exists) {
      this.colorOptions = [...this.colorOptions, { label: this.toLabel(val), value: val }];
      // Orden alfabético por etiqueta (locale ES)
      this.colorOptions.sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));
    }
  }

  // Cambia el color seleccionado y sincroniza label mostrado
  setColor(value: string) {
    const opt = this.colorOptions.find(o => (o.value || '').toUpperCase() === (value || '').toUpperCase());
    this.vehicleColorHex.set(value || '');
    this.vehicleColorName.set(opt?.label ?? value ?? '');
  }

  // ===== Secciones y tareas (catálogo traído de la BD) =====
  sections = signal<Section[]>([]);

  // ===== Control de pendiente por ID =====
  // Si reanudamos un pendiente, guardamos su id para actualizar ese mismo registro
  private _pendingId: number | null = null;

  // ===== Snapshot temporal de un pendiente (para aplicar cuando ya esté el catálogo) =====
  private _pendingSnapshot: { color?: string | null; checks?: Record<string, boolean>; id?: number } | null = null;

  // === Helpers de normalización ===

  /** Pasa un label humano a nombre de columna (igual que hace el back):
   *  - quita acentos, minúsculas, separadores a "_"
   *  - ej: "Tornillos laterales" -> "tornillos_laterales"
   */
  private labelToCol(label: string): string {
    if (!label) return '';
    let s = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    s = s.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    return s.replace(/^_+|_+$/g, '');
  }

  /** Construye un patch {columna: 0|1} para hacer PUT al actualizar por id */
  private buildChecksPatch(): Record<string, 0|1> {
    const patch: Record<string, 0|1> = {};
    for (const sec of this.sections()) {
      for (const t of sec.tasks) {
        const col = this.labelToCol(t.label);
        patch[col] = t.done ? 1 : 0;
      }
    }
    return patch;
  }

  /** Aplica el snapshot (color + checks) cuando ya tengamos catálogo cargado.
   *  Deja _pendingId listo para trabajar por id (update/finalize el mismo registro).
   */
  private applyPendingIfReady() {
    if (!this._pendingSnapshot) return;
    if (this.sections().length === 0) return;

    const { color, checks, id } = this._pendingSnapshot;

    // 1) Color (asegura que existe en el combo y selecciónalo)
    const c = (color || '').trim();
    if (c) {
      this.pushColorIfMissing(c);
      const opt = this.colorOptions.find(o => o.value.toUpperCase() === c.toUpperCase());
      if (opt) {
        this.vehicleColorHex.set(opt.value);
        this.vehicleColorName.set(opt.label);
      } else {
        this.vehicleColorHex.set(c);
        this.vehicleColorName.set(this.toLabel(c));
      }
    }

    // 2) Checks (marcados según snapshot)
    const ck = checks || {};
    const arr = structuredClone(this.sections());
    for (const sec of arr) {
      for (const t of sec.tasks) {
        const col = this.labelToCol(t.label);
        t.done = !!ck[col];
      }
    }
    this.sections.set(arr);

    // 3) Guardamos el id del pendiente con el que se está trabajando
    this._pendingId = id ?? null;
    this._pendingSnapshot = null;
  }

  // ===== Cómputos de progreso / validaciones =====

  // Porcentaje de avance de una sección
  progress(section: Section): number {
    const total = section.tasks.length || 1;
    const done = section.tasks.filter(t => t.done).length;
    return Math.round((done / total) * 100);
  }

  // Sección completa si tiene al menos 1 tarea y todas están hechas
  private sectionComplete = (s: Section) => s.tasks.length > 0 && s.tasks.every(t => t.done);

  // Todas las secciones completas
  private allSectionsDone = computed(() =>
    this.sections().length > 0 && this.sections().every(sec => this.sectionComplete(sec))
  );

  // El color es válido si hay un valor seleccionado
  validColor = computed(() => !!this.vehicleColorHex());

  // Regla global para habilitar "Terminar"
  allComplete = computed(() => this.allSectionsDone() && this.validColor());

  // ¿Hay algo que perder si salimos? (para decidir si mostrar modal “Guardar y salir”)
  hasProgress() {
    const tareasHechas = this.sections().some(sec => sec.tasks.some(t => t.done));
    const colorElegido = !!this.vehicleColorHex() || !!this.vehicleColorName();
    return tareasHechas || colorElegido;
  }

  // ===== Acciones sobre tareas =====

  // Toggle de una tarea concreta
  toggleTask(sectionIndex: number, taskIndex: number) {
    const copy = structuredClone(this.sections());
    copy[sectionIndex].tasks[taskIndex].done = !copy[sectionIndex].tasks[taskIndex].done;
    this.sections.set(copy);
  }

  // Limpia una sección completa
  clearSection(sectionIndex: number) {
    const copy = structuredClone(this.sections());
    copy[sectionIndex].tasks.forEach(t => t.done = false);
    this.sections.set(copy);
  }

  // Limpia todo: tareas + color + contexto de pendiente
  clearAll() {
    const copy = structuredClone(this.sections());
    copy.forEach(sec => sec.tasks.forEach(t => t.done = false));
    this.sections.set(copy);
    this.clearVehicle();
    this._pendingId = null; // muy importante para no actualizar por id viejo
  }

  // Limpia sólo el vehículo (color)
  clearVehicle() {
    this.vehicleColorHex.set('');
    this.vehicleColorName.set('');
  }

  // ===== Modal “Finalizar” =====
  showModal = signal(false);
  // Abre el modal si todo está completo
  finish() { if (this.allComplete()) this.showModal.set(true); }
  // Cierra modal
  closeModal() { this.showModal.set(false); }
  // Cierra modal al pinchar fuera del cuadro
  onBackdropClick(ev: MouseEvent) { if (ev.target === ev.currentTarget) this.closeModal(); }

  // ===== Helpers de persistencia =====

  /** Construye un objeto de labels → boolean para iniciar (el back ya normaliza).
   *  Ej: { "Montar estriberas": true, "Ajustar faro": false }
   */
  private buildChecksLabels(): Record<string, boolean> {
    const p: Record<string, boolean> = {};
    for (const sec of this.sections()) {
      for (const t of sec.tasks) p[t.label] = !!t.done;
    }
    return p;
  }

  // ===== Persistencia en BD: iniciar/actualizar → finalizar =====

  /** Flujo de finalizar:
   *  - si hay _pendingId: actualiza por id (PUT patch) y finaliza ese MISMO id
   *  - si no hay _pendingId: inicia (POST) y, con el id devuelto, finaliza
   *  En ambos casos: suma contador local y limpia el estado.
   */
  continueAndClear() {
    if (!this.allComplete()) return;

    const userId = this.getCurrentUserId();
    if (!userId) return;

    const color = this.vehicleColorHex() || null;

    // Acción común tras finalizar OK
    const afterFinish = () => {
      const newTotal = this.dailyCount() + 1;
      this.dailyCount.set(newTotal);
      localStorage.setItem(this.getCountKey(), String(newTotal));
      this.clearAll();
      this.showModal.set(false);
    };

    // Caso 1: venimos de un pendiente → actualizar por id y finalizar ese id
    if (this._pendingId) {
      const patch = { color, ...this.buildChecksPatch() };
      this.tareasSrv.actualizarTarea(this.PROCESO, this._pendingId, patch).subscribe({
        next: () => {
          this.tareasSrv.finalizarTarea(this.PROCESO, this._pendingId!).subscribe({
            next: afterFinish,
            error: (e) => console.error('Error al finalizar en BD (premontaje)', e),
          });
        },
        error: (e) => console.error('Error al actualizar por id (premontaje)', e)
      });
      return;
    }

    // Caso 2: no hay pendiente → iniciar y luego finalizar con el id recién creado
    this.tareasSrv.iniciarTarea({
      usuario_id: userId,
      area: this.PROCESO,
      color,
      checks: this.buildChecksLabels(),
    }).subscribe({
      next: (resp) => {
        const newId = (resp as any)?.id_area as number | undefined;
        if (!newId) {
          console.error('Respuesta iniciar sin id_area', resp);
          return;
        }
        this.tareasSrv.finalizarTarea(this.PROCESO, newId).subscribe({
          next: afterFinish,
          error: (e) => console.error('Error al finalizar en BD (premontaje)', e)
        });
      },
      error: (e) => console.error('Error al iniciar en BD (premontaje)', e)
    });
  }

  // ===== Modal “Guardar y salir” =====
  private _showLeaveModal = signal(false);
  showLeaveModal = () => this._showLeaveModal();
  closeLeaveModal() { this._showLeaveModal.set(false); }
  private _pendingLeaveTarget: 'home' | 'logout' | null = null;

  // Sólo pedimos guardar si hay un color válido (es tu regla para Premontaje)
  private shouldPromptOnLeave(): boolean { return this.validColor(); }

  // Intenta navegar; si procede, muestra modal
  private tryLeave(target: 'home' | 'logout') {
    if (this.shouldPromptOnLeave()) {
      this._pendingLeaveTarget = target;
      this._showLeaveModal.set(true);
    } else {
      this.leaveNow(target);
    }
  }

  // Navegación efectiva (borra sesión en logout)
  private leaveNow(target: 'home' | 'logout') {
    if (target === 'logout') {
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('qp_user');
      this.router.navigate([''], { replaceUrl: true });
    } else {
      this.router.navigate(['/home']);
    }
  }

  // Handlers públicos para botones del header
  logout() { this.tryLeave('logout'); }
  goHome() { this.tryLeave('home'); }

  /** Guardar y salir:
   *  - si hay _pendingId → PUT (patch) por id
   *  - si NO hay _pendingId → POST iniciar
   *  Después limpia estado y navega.
   */
  confirmSaveAndLeave() {
    if (!this.validColor()) {
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

    const done = () => {
      this._showLeaveModal.set(false);
      this.clearAll();
      this.leaveNow(this._pendingLeaveTarget || 'home');
    };

    if (this._pendingId) {
      const patch = { color, ...this.buildChecksPatch() };
      this.tareasSrv.actualizarTarea(this.PROCESO, this._pendingId, patch).subscribe({ next: done, error: done });
      return;
    }

    this.tareasSrv.iniciarTarea({
      usuario_id: userId,
      area: this.PROCESO,
      color,
      checks: this.buildChecksLabels(),
    }).subscribe({ next: done, error: done });
  }

  // Salir sin guardar: cierra modal, limpia y navega
  confirmLeaveWithoutSaving() {
    this._showLeaveModal.set(false);
    this.clearAll();
    this.leaveNow(this._pendingLeaveTarget || 'home');
  }

  // Cancelar modal: no navega
  cancelLeave() {
    this._showLeaveModal.set(false);
    this._pendingLeaveTarget = null;
  }

  // ===== Ciclo de vida =====
  ngOnInit(): void {
    // 1) Usuario para la cabecera
    try {
      const raw = sessionStorage.getItem('qp_user');
      if (raw) this.userName.set(JSON.parse(raw)?.full_name ?? '');
    } catch {}

    // 2) Contador diario desde localStorage
    const saved = localStorage.getItem(this.getCountKey());
    this.dailyCount.set(saved ? +saved : 0);

    // 3) Cargar datos base: colores y catálogo
    this.cargarColoresDesdePintura();
    this.cargarTareasDesdeBD();

    // 4) Intentar reanudar un pendiente del usuario (por id) en Premontaje
    this.autoResumeFromUserPending();
  }

  /** Trae la lista de colores históricos de Pintura (únicos) y los vuelca en el select */
  private cargarColoresDesdePintura() {
    this.tareasSrv.getColoresPintura(true).subscribe({
      next: (dbColors) => {
        const seen = new Set<string>();
        this.colorOptions = [];
        for (const raw of dbColors) {
          const val = (raw || '').trim();
          if (!val) continue;
          const key = val.toUpperCase();
          if (seen.has(key)) continue; // evita duplicados
          seen.add(key);
          this.colorOptions.push({ label: this.toLabel(val), value: val });
        }
        this.colorOptions.sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));
        // Por si llegaba un snapshot de pendiente antes de terminar este fetch
        this.applyPendingIfReady();
      },
      error: (e) => console.error('No se pudieron cargar colores de Pintura', e)
    });
  }

  /** Carga el catálogo de tareas para Premontaje y lo agrupa por sección (Fase X si aplica) */
  private cargarTareasDesdeBD() {
    this.loading.set(true);
    this.errorMsg.set(null);

    this.tareasSrv.getCatalogo(this.PROCESO).subscribe({
      next: (rows: TareaCatalogo[]) => {
        // Filtramos sólo las activas
        const activos = rows.filter(r => r.activa !== false);

        // Agrupar por sección (por defecto "Fase 1" si viene vacío)
        const mapSec = new Map<string, Task[]>();
        for (const r of activos) {
          const sec = (r.seccion?.trim() || 'Fase 1');
          if (!mapSec.has(sec)) mapSec.set(sec, []);
          mapSec.get(sec)!.push({ label: r.label, done: false });
        }

        // Ordena por "Fase N" si existe; si no, por nombre
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

        // Si había snapshot esperando (por ejemplo, reanudar) lo aplicamos ahora
        this.applyPendingIfReady();
      },
      error: (e) => {
        console.error(e);
        this.errorMsg.set('No se pudieron cargar las tareas de Premontaje.');
        this.loading.set(false);
      }
    });
  }

  // ====== Autorreanudar el último pendiente del usuario en Premontaje ======
  private autoResumeFromUserPending() {
    const userId = this.getCurrentUserId();
    if (!userId) return;

    this.tareasSrv.getPendientesUsuario(userId).subscribe({
      next: (items: PendingItem[]) => {
        // Buscamos un pendiente del área 'premontaje'
        const mine = items.find(p => p.area_key === 'premontaje');
        if (!mine) return;

        // Traemos su snapshot (id + color + checks) para aplicarlo correctamente
        this.tareasSrv.getSnapshot('premontaje', mine.id).subscribe({
          next: (snap: SnapshotResp) => {
            if (!snap?.exists) return;

            this._pendingSnapshot = {
              color:  snap.color ?? mine.color ?? null,
              checks: snap.checks ?? {},
              id:     snap.id ?? mine.id
            };

            this.applyPendingIfReady();
          },
          error: () => { /* silencioso para no molestar al usuario */ }
        });
      },
      error: () => { /* silencioso */ }
    });
  }
}
