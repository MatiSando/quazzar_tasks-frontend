import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  TareasService,
  TareaCatalogo,
  Proceso,
  VinEstadoChasisResp,
} from '../../services/tareas';

/** Estructura de una tarea renderizada en la UI (catálogo normalizado). */
type Task = { label: string; done: boolean };

/** Estados de la validación/consulta del VIN en la UI. */
type VinState = 'idle' | 'typing' | 'checking' | 'ok' | 'finalized' | 'invalid';

@Component({
  selector: 'app-chasis-tareas',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chasis.html',
  styleUrls: ['./chasis.css'],
})
export class ChasisTareasComponent implements OnInit {
  // ===== Inyección de dependencias =====
  private router = inject(Router);
  private tareasSrv = inject(TareasService);

  // ===== Constantes del módulo/almacenamiento =====
  private readonly PROCESO: Proceso = 'chasis';     // proceso backend (API)
  private readonly MODULE_KEY = 'CHASIS';           // clave para contador diario
  private readonly LS_VIN_KEY = 'CHASIS_VIN';       // clave para persistir VIN mientras escribe
  private readonly SNAP_KEY   = 'SNAPSHOT_CHASIS';  // clave de snapshot (retomar desde "Pendientes")

  // ===== Cabecera / sesión (nombre de usuario en header) =====
  userName = signal('');

  /** Botones de cabecera: centralizan salida con confirmación si hay progreso. */
  logout() { this.tryLeave('logout'); }
  goHome() { this.tryLeave('home'); }

  // ===== Utilidades: fecha/usuario/contador diario =====
  private getToday(): string { return new Date().toISOString().split('T')[0]; }

  /** Email del usuario (para componer la clave del contador diario). */
  private getCurrentUserEmail(): string {
    try { return (JSON.parse(sessionStorage.getItem('qp_user') || '{}')?.email ?? '').toLowerCase(); }
    catch { return ''; }
  }

  /** ID del usuario (necesario para llamadas a la API). */
  private getCurrentUserId(): number {
    try { return Number(JSON.parse(sessionStorage.getItem('qp_user') || '{}')?.id ?? 0); }
    catch { return 0; }
  }

  /** Clave de contador diario por usuario+fecha+módulo (persistida en localStorage). */
  private getCountKey(email = this.getCurrentUserEmail(), date = this.getToday()): string {
    return `count_${email}_${date}_${this.MODULE_KEY}`;
  }

  /** Contador de tareas finalizadas hoy (solo UI/localStorage). */
  dailyCount = signal(0);

  // ===== Estado general de UI =====
  loading = signal(false);
  errorMsg = signal<string | null>(null);

  // ===== Catálogo / tareas de la tabla =====
  tasks = signal<Task[]>([]);
  total = computed(() => this.tasks().length);
  doneCount = computed(() => this.tasks().filter(t => t.done).length);
  /** Porcentaje de progreso (redondeado). */
  progress = computed(() => this.total() === 0 ? 0 : Math.round((this.doneCount() * 100) / this.total()));

  // ===== VIN / validación y estado =====
  /** VIN actual (bastidor) — se almacena siempre en mayúsculas y sin símbolos. */
  private _bastidor = signal<string>('');           // <- arranca vacío siempre
  bastidor = () => this._bastidor();

  /** Estado de la UI con respecto al VIN (idle/invalid/ok/finalized...). */
  vinState = signal<VinState>('idle');

  /** ID en BD si el VIN corresponde a una tarea pendiente detectada. */
  private _pendingId: number | null = null;

  /**
   * Buffer temporal cuando llegan checks antes de cargar el catálogo.
   * Esto ocurre si reanudamos un snapshot o detectamos "pending" y
   * aún no terminaron de llegar las tareas del catálogo.
   */
  private _buffered: { vin: string; checks: Record<string, boolean>; id?: number | null } | null = null;

  // ====== Ciclo de vida ======
  ngOnInit(): void {
    // 0) Mostrar nombre en header y levantar contador diario desde localStorage
    try { this.userName.set(JSON.parse(sessionStorage.getItem('qp_user') || '{}')?.full_name ?? ''); } catch {}
    const saved = localStorage.getItem(this.getCountKey());
    this.dailyCount.set(saved ? +saved : 0);

    // 1) Cargar catálogo de tareas (solo activas)
    this.cargarTareasDesdeBD();

    // 2) Aplicar snapshot si venimos desde "Pendientes" (one-shot) y preparar VIN/Checks
    this.consumeSnapshotIfAny();
    // NOTA IMPORTANTE: ya NO auto-cargamos el último VIN de LS_VIN_KEY para evitar confusiones.
  }

  // ===== Catálogo (carga desde backend) =====
  private cargarTareasDesdeBD() {
    this.loading.set(true);
    this.errorMsg.set(null);

    this.tareasSrv.getCatalogo(this.PROCESO).subscribe({
      next: (rows: TareaCatalogo[]) => {
        // Filtra por activas (defensivo por si el back devolviera inactivas)
        const activos = rows.filter(r => r.activa !== false);
        // Normaliza a estructura de UI { label, done:false }
        this.tasks.set(activos.map(r => ({ label: r.label, done: false })));
        this.loading.set(false);
        // Si había checks en buffer (snapshot o pendiente), se aplican ahora
        this.flushBufferedIfAny();
      },
      error: (e) => {
        console.error(e);
        this.errorMsg.set('No se pudieron cargar las tareas de Chasis.');
        this.loading.set(false);
      }
    });
  }

  // ===== VIN / validación y consulta de estado en back =====

  /** Valida sintácticamente un VIN (17 caracteres alfanuméricos). */
  private isValidVin(v?: string | null): boolean {
    if (!v) return false;
    return /^[A-Z0-9]{17}$/.test(v.toUpperCase());
  }

  /**
   * Handler del input VIN:
   * - Normaliza texto (mayúsculas, sin símbolos, 17 chars).
   * - Persiste el VIN en localStorage (por si refresca).
   * - Consulta al back para saber si está "finalized" / "pending" / libre.
   * - Si "pending", aplica los checks mapeando por columnas normalizadas.
   */
  onBastidorInput(value: string) {
    const clean = (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 17);
    this._bastidor.set(clean);
    localStorage.setItem(this.LS_VIN_KEY, clean); // persistimos mientras escribe
    this._pendingId = null;

    if (!clean) { this.vinState.set('idle'); return; }
    if (!this.isValidVin(clean)) { this.vinState.set('invalid'); return; }

    this.vinState.set('checking');
    this.tareasSrv.getVinEstadoChasis(clean).subscribe({
      next: (resp: VinEstadoChasisResp) => {
        if (resp.status === 'finalized') { this.vinState.set('finalized'); return; }
        if (resp.status === 'pending') {
          // Si hay pendiente: aplicamos checks y guardamos ID de BD
          this.applyPendingChecks(resp.checks || {});
          this._pendingId = resp.id ?? null;
          this.vinState.set('ok');
          return;
        }
        // Si no está finalizado ni pendiente, está libre
        this.vinState.set('ok');
      },
      error: () => this.vinState.set('invalid')
    });
  }

  /** Limpia VIN y estado asociado en la UI y en localStorage. */
  clearBastidor() {
    this._bastidor.set('');
    this.vinState.set('idle');
    this._pendingId = null;
    localStorage.removeItem(this.LS_VIN_KEY);
  }

  // ===== Normalizador de etiquetas a nombres de columna y aplicación de checks =====

  /**
   * Convierte una etiqueta de catálogo a un nombre de columna "seguro":
   * - quita acentos
   * - minúsculas
   * - no alfanumérico -> guion bajo
   * - trim de guiones bajos inicial/final
   */
  private labelToCol(label: string): string {
    if (!label) return '';
    let s = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    s = s.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    return s.replace(/^_+|_+$/g, '');
  }

  /**
   * Aplica checks pendientes a la lista de tareas cargadas.
   * Si aún no se cargó el catálogo, guarda en buffer para aplicar después.
   */
  private applyPendingChecks(checks: Record<string, boolean>) {
    if (this.tasks().length === 0) {
      this._buffered = { vin: this.bastidor(), checks, id: this._pendingId };
      return;
    }
    const arr = structuredClone(this.tasks());
    for (let i = 0; i < arr.length; i++) {
      const col = this.labelToCol(arr[i].label);
      arr[i].done = !!checks[col];
    }
    this.tasks.set(arr);
  }

  /** Aplica checks que quedaron en buffer cuando aún no había catálogo. */
  private flushBufferedIfAny() {
    if (!this._buffered) return;
    const { vin, checks, id } = this._buffered;
    this._pendingId = id ?? null;
    const arr = structuredClone(this.tasks());
    for (let i = 0; i < arr.length; i++) {
      const col = this.labelToCol(arr[i].label);
      arr[i].done = !!checks[col];
    }
    this.tasks.set(arr);
    this.vinState.set('ok');
    // Revalida VIN al terminar de aplicar (sincroniza estados)
    setTimeout(() => this.onBastidorInput(vin), 300);
    this._buffered = null;
  }

  // ===== Acciones de tareas (UI local) =====

  /** Marca/desmarca una tarea por índice (inmutable para signals). */
  toggleTask(i: number) {
    const arr = [...this.tasks()];
    arr[i] = { ...arr[i], done: !arr[i].done };
    this.tasks.set(arr);
  }

  /** Limpia todas las tareas y el VIN (reinicio del formulario). */
  clearAll() {
    this.tasks.update(list => list.map(t => ({ ...t, done: false })));
    this.clearBastidor();
  }

  // ===== Finalización / guardado en BD =====

  /** True si hay catálogo y todas las tareas están marcadas. */
  private allComplete() { return this.total() > 0 && this.doneCount() === this.total(); }

  /** Habilita el botón de finalizar solo si VIN está OK y todas las tareas están hechas. */
  canFinish = computed(() => this.allComplete() && this.vinState() === 'ok');

  /** Control del modal de confirmación para finalizar. */
  private _showFinishModal = signal(false);
  showFinishModal = () => this._showFinishModal();
  finish() { if (this.canFinish()) this._showFinishModal.set(true); }
  closeFinishModal() { this._showFinishModal.set(false); }

  /** Construye el payload de checks para API: { etiquetaOriginal: boolean }. */
  private buildChecksPayload(): Record<string, boolean> {
    const p: Record<string, boolean> = {};
    for (const t of this.tasks()) p[t.label] = !!t.done;
    return p;
  }

  /**
   * Confirma finalizar:
   * - Inicia/actualiza en BD con los checks actuales.
   * - Finaliza la tarea en BD (usando id existente o el devuelto).
   * - Incrementa el contador diario y limpia UI.
   */
  continueAndClear() {
    if (!this.canFinish()) return;
    const userId = this.getCurrentUserId();
    if (!userId) return;

    const vin = this.bastidor() || null;

    // Acción común al finalizar correctamente
    const afterFinish = () => {
      const newTotal = this.dailyCount() + 1;
      this.dailyCount.set(newTotal);
      localStorage.setItem(this.getCountKey(), String(newTotal));
      this.clearAll();
      this.closeFinishModal();
    };

    // Caso A: había pendiente con ID en BD -> upsert + finalizar
    if (this._pendingId) {
      this.tareasSrv.iniciarTarea({
        usuario_id: userId,
        area: this.PROCESO,
        bastidor: vin,
        checks: this.buildChecksPayload(),
      }).subscribe({
        next: (resp) => {
          const upsertId = (resp as any)?.id_area as number | undefined;
          const idToFinish = upsertId ?? this._pendingId!;
          this.tareasSrv.finalizarTarea(this.PROCESO, idToFinish).subscribe({
            next: afterFinish,
            error: (e) => console.error('Error al finalizar en BD', e),
          });
        },
        error: (e) => console.error('Error al actualizar pendiente antes de finalizar', e),
      });
      return;
    }

    // Caso B: no había pendiente -> iniciar y luego finalizar con el id devuelto
    this.tareasSrv.iniciarTarea({
      usuario_id: userId,
      area: this.PROCESO,
      bastidor: vin,
      checks: this.buildChecksPayload(),
    }).subscribe({
      next: (resp) => {
        const newId = (resp as any)?.id_area as number | undefined;
        if (!newId) { console.error('Respuesta iniciar sin id_area:', resp); return; }
        this.tareasSrv.finalizarTarea(this.PROCESO, newId).subscribe({
          next: afterFinish,
          error: (e) => console.error('Error al finalizar en BD', e),
        });
      },
      error: (e) => console.error('Error al iniciar en BD', e),
    });
  }

  // ===== Navegación / modal al salir con progreso =====

  /** Modal de "¿quieres guardar antes de salir?" */
  private _showLeaveModal = signal(false);
  showLeaveModal = () => this._showLeaveModal();
  private _leaveTarget: 'home' | 'logout' | null = null;

  /** ¿Hay progreso real? (algún check marcado y VIN presente). */
  private hasProgress(): boolean {
    const anyDone = this.tasks().some(t => t.done);
    const hasVin = !!this.bastidor();
    return anyDone && hasVin;
  }

  /** Solo preguntar al salir si hay progreso y el VIN actual es válido/OK. */
  private shouldPromptOnLeave(): boolean {
    return this.hasProgress() && this.vinState() === 'ok';
  }

  /**
   * Intento de salida (home/logout). Si hay progreso, lanza modal;
   * si no, navega inmediatamente.
   */
  private tryLeave(target: 'home' | 'logout') {
    if (this.shouldPromptOnLeave()) {
      this._leaveTarget = target;
      this._showLeaveModal.set(true);
    } else {
      this.leaveNow(target);
    }
  }

  /** Cierra modal sin navegar. */
  closeModalLeave() { this._showLeaveModal.set(false); this._leaveTarget = null; }

  /**
   * Guardar y salir (pendiente). Si el VIN no está en 'ok' o no hay userId,
   * se cancela el guardado y se navega igualmente (flujo defensivo).
   */
  confirmSaveAndLeave() {
    if (this.vinState() !== 'ok') { this.closeModalLeave(); this.leaveNow(this._leaveTarget || 'home'); return; }
    const userId = this.getCurrentUserId();
    if (!userId) { this.closeModalLeave(); this.leaveNow(this._leaveTarget || 'home'); return; }

    this.tareasSrv.iniciarTarea({
      usuario_id: userId,
      area: this.PROCESO,
      bastidor: this.bastidor(),
      checks: this.buildChecksPayload(),
    }).subscribe({
      next: () => { this.closeModalLeave(); this.clearAll(); this.leaveNow(this._leaveTarget || 'home'); },
      error: () => { this.closeModalLeave(); this.leaveNow(this._leaveTarget || 'home'); }
    });
  }

  /** Salir sin guardar progreso. */
  confirmLeaveWithoutSaving() {
    this.closeModalLeave();
    this.clearAll();
    this.leaveNow(this._leaveTarget || 'home');
  }

  /** Navegación inmediata según destino. */
  leaveNow(target: 'home' | 'logout') {
    if (target === 'logout') {
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('qp_user');
      this.router.navigate([''], { replaceUrl: true });
    } else {
      this.router.navigate(['/home']);
    }
  }

  // ===== SNAPSHOT (Retomar desde “Pendientes”) =====

  /**
   * Coloca VIN y checks venidos de "Pendientes".
   * Si el catálogo aún no está, encola en buffer para aplicarlo después.
   */
  private queueOrApplyChecks(vin: string, checks: Record<string, boolean>, id?: number | null) {
    this._pendingId = id ?? null;
    this._bastidor.set(vin);
    localStorage.setItem(this.LS_VIN_KEY, vin); // seguridad por si refresca
    if (this.tasks().length === 0) {
      this._buffered = { vin, checks, id: this._pendingId };
      return;
    }
    this.applyPendingChecks(checks);
  }

  /**
   * Consume y limpia el snapshot (one-shot). Si hay datos válidos:
   * - Pone VIN
   * - Aplica checks (o los deja en buffer)
   * - Lanza una revalidación del VIN
   */
  private consumeSnapshotIfAny(): boolean {
    const raw = localStorage.getItem(this.SNAP_KEY);
    if (!raw) return false;

    localStorage.removeItem(this.SNAP_KEY); // one-shot
    try {
      const snap = JSON.parse(raw) as {
        id?: number;
        bastidor?: string | null;
        checks?: Record<string, boolean>;
      };

      const vin = (snap?.bastidor || '').toUpperCase().trim();
      const checks = snap?.checks || {};
      this._pendingId = snap?.id ?? null;

      if (!vin) { this.vinState.set('idle'); return true; }

      this.queueOrApplyChecks(vin, checks, this._pendingId);
      this.vinState.set('ok');
      setTimeout(() => this.onBastidorInput(vin), 300);
      return true;
    } catch (e) {
      console.warn('SNAPSHOT_CHASIS inválido', e);
      return false;
    }
  }
}
