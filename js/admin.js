import { supabase } from './supabase.js';
import { state, isSuperadmin } from './state.js';
import { showToast, escapeHtml } from './ui-helpers.js';
import {
  renderImportadorHtml,
  bindImportadorEvents,
  geocodeAddress
} from './importador.js';

let pendingUsers = [];
let allCongUsers = [];
let pendingReports = [];
let congregationsList = [];
let hermanosCongList = [];
let adminSubTab = 'general';

// Estado del mapeador poligonal por calles (creación y edición)
let polyPreviewCoords = [];
let polyStreetNames = [];
let polyPreviewMap = null;
let manualClickMode = false;
let editingPolygonState = null; // { type: 'territory'|'subterritory'|'block', id, name, parentTerritoryId, parentSubterritoryId }

export async function loadAdminData() {
  if (!state.congregation?.id) return;

  const [usersRes, repRes, hermRes] = await Promise.all([
    supabase
      .from('terr_users')
      .select('*')
      .eq('congregation_id', state.congregation.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('terr_new_building_reports')
      .select('*')
      .eq('congregation_id', state.congregation.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    supabase
      .from('hermanos')
      .select('id, nombre, celular')
      .eq('congregacion_id', state.congregation.id)
      .order('nombre', { ascending: true })
  ]);

  if (!usersRes.error) {
    allCongUsers = usersRes.data || [];
    pendingUsers = allCongUsers.filter((u) => u.status === 'pending');
  }
  if (!repRes.error) {
    pendingReports = repRes.data || [];
  }
  if (!hermRes.error) {
    hermanosCongList = hermRes.data || [];
  }

  if (isSuperadmin()) {
    const { data: congs } = await supabase
      .from('congregaciones')
      .select('id, nombre')
      .order('nombre');
    congregationsList = congs || [];
  }
}

function buildHermanosSelectOptions(selectedName) {
  const normalizedSelected = (selectedName || '').trim().toLowerCase();
  return `
    <option value="">-- Vincular con planilla Hermanos --</option>
    ${hermanosCongList
      .map((h) => {
        const isSelected = (h.nombre || '').trim().toLowerCase() === normalizedSelected;
        const telInfo =
          h.celular && !String(h.celular).toLowerCase().includes('sin tel')
            ? ` (${h.celular})`
            : ' (sin tel.)';
        return `<option value="${escapeHtml(h.nombre)}" ${
          isSelected ? 'selected' : ''
        }>${escapeHtml(h.nombre)}${escapeHtml(telInfo)}</option>`;
      })
      .join('')}
  `;
}

export function renderAdminView(container, onDataChanged) {
  const superMode = isSuperadmin();

  container.innerHTML = `
    <div class="space-y-4 pb-24">
      <div class="grid grid-cols-4 gap-1 bg-slate-200 p-1 rounded-2xl">
        <button data-subtab="general"
          class="admin-subtab-btn py-2 rounded-xl text-[11px] font-extrabold transition ${
            adminSubTab === 'general' ? 'bg-white text-blue-950 shadow-sm' : 'text-slate-600'
          }">
          ⚙️ Config
        </button>
        <button data-subtab="mapa"
          class="admin-subtab-btn py-2 rounded-xl text-[11px] font-extrabold transition ${
            adminSubTab === 'mapa' ? 'bg-white text-blue-950 shadow-sm' : 'text-slate-600'
          }">
          🗺️ Polígonos
        </button>
        <button data-subtab="usuarios"
          class="admin-subtab-btn py-2 rounded-xl text-[11px] font-extrabold transition relative ${
            adminSubTab === 'usuarios' ? 'bg-white text-blue-950 shadow-sm' : 'text-slate-600'
          }">
          👥 Usuarios
          ${
            pendingUsers.length > 0
              ? `<span class="ml-0.5 bg-rose-600 text-white text-[10px] px-1.5 py-0.2 rounded-full">${pendingUsers.length}</span>`
              : ''
          }
        </button>
        <button data-subtab="edificios"
          class="admin-subtab-btn py-2 rounded-xl text-[11px] font-extrabold transition relative ${
            adminSubTab === 'edificios' ? 'bg-white text-blue-950 shadow-sm' : 'text-slate-600'
          }">
          🏢 Edificios
          ${
            pendingReports.length > 0
              ? `<span class="ml-0.5 bg-amber-500 text-slate-950 text-[10px] px-1.5 py-0.2 rounded-full">${pendingReports.length}</span>`
              : ''
          }
        </button>
      </div>

      ${adminSubTab === 'general' ? renderGeneralAdminHtml(superMode) : ''}
      ${adminSubTab === 'mapa' ? renderPolygonMapperHtml() : ''}
      ${adminSubTab === 'usuarios' ? renderUsersAdminHtml() : ''}
      ${adminSubTab === 'edificios' ? renderBuildingsAdminHtml() : ''}
    </div>
  `;

  document.querySelectorAll('.admin-subtab-btn').forEach((btn) => {
    btn.onclick = () => {
      adminSubTab = btn.getAttribute('data-subtab');
      renderAdminView(container, onDataChanged);
    };
  });

  if (adminSubTab === 'general') bindGeneralAdminEvents(container, onDataChanged, superMode);
  if (adminSubTab === 'mapa') bindPolygonMapperEvents(container, onDataChanged);
  if (adminSubTab === 'usuarios') bindUsersAdminEvents(container, onDataChanged);
  if (adminSubTab === 'edificios') bindBuildingsAdminEvents(container, onDataChanged);
}

// ============================================================================
// SUBPESTAÑA 1: CONFIGURACIÓN Y PUNTOS DE ENCUENTRO
// ============================================================================
function renderGeneralAdminHtml(superMode) {
  return `
    <div class="space-y-4">
      <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
        <h3 class="text-base font-extrabold text-slate-900">📅 Cartelera Pública de Salidas</h3>
        <form id="public-dates-form" class="space-y-3">
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-xs font-bold text-slate-700 mb-1">Mostrar desde</label>
              <input type="date" id="pub-start-date" value="${
                state.settings?.public_schedule_start_date || ''
              }" class="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm" />
            </div>
            <div>
              <label class="block text-xs font-bold text-slate-700 mb-1">Mostrar hasta</label>
              <input type="date" id="pub-end-date" value="${
                state.settings?.public_schedule_end_date || ''
              }" class="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm" />
            </div>
          </div>
          <button type="submit"
            class="w-full bg-blue-900 hover:bg-blue-800 text-white font-bold py-2.5 rounded-xl text-xs shadow">
            Guardar fechas de cartelera
          </button>
        </form>
      </div>

      <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
        <h3 class="text-base font-extrabold text-slate-900">📍 Puntos de Encuentro Frecuentes</h3>
        <form id="add-mp-form" class="flex gap-2">
          <input type="text" id="new-mp-input" required placeholder="Ej: Salón del Reino / Plaza Mitre"
            class="flex-1 px-3 py-2 rounded-xl border border-slate-300 text-xs" />
          <button type="submit"
            class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3.5 py-2 rounded-xl text-xs">
            + Agregar
          </button>
        </form>

        <div class="space-y-1.5">
          ${state.meetingPoints
            .map(
              (mp) => `
              <div class="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-xl border border-slate-200 text-xs">
                <span class="font-semibold text-slate-800">${escapeHtml(mp.name_and_address)}</span>
                <button data-del-mp="${mp.id}" class="del-mp-btn text-rose-600 font-bold px-1.5">✕</button>
              </div>
            `
            )
            .join('')}
        </div>
      </div>

      ${
        superMode
          ? `<div class="bg-blue-950 text-white p-4 rounded-2xl shadow space-y-3">
              <h3 class="text-base font-extrabold">👑 Superadmin: Crear Administrador</h3>
              <form id="create-admin-form" class="space-y-2.5">
                <select id="sa-cong-select" required
                  class="w-full px-3 py-2 rounded-xl text-slate-900 text-xs font-bold bg-white">
                  <option value="">-- Elegir Congregación --</option>
                  ${congregationsList
                    .map(
                      (c) =>
                        `<option value="${c.id}" ${
                          c.id === state.congregation?.id ? 'selected' : ''
                        }>${escapeHtml(c.nombre)}</option>`
                    )
                    .join('')}
                </select>
                ${
                  hermanosCongList.length > 0
                    ? `<select id="sa-hermano-select" required
                        class="w-full px-3 py-2 rounded-xl text-slate-900 text-xs font-bold bg-white">
                        ${buildHermanosSelectOptions('')}
                      </select>`
                    : `<input type="text" id="sa-fullname" required placeholder="Nombre completo del hermano"
                        class="w-full px-3 py-2 rounded-xl text-slate-900 text-xs" />`
                }
                <div class="grid grid-cols-2 gap-2">
                  <input type="text" id="sa-username" required placeholder="Usuario (ej: juan.perez)"
                    class="w-full px-3 py-2 rounded-xl text-slate-900 text-xs" />
                  <input type="text" id="sa-password" required minlength="6" placeholder="Contraseña (mín 6)"
                    class="w-full px-3 py-2 rounded-xl text-slate-900 text-xs" />
                </div>
                <button type="submit"
                  class="w-full bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold py-2.5 rounded-xl text-xs">
                  Crear Cuenta de Administrador
                </button>
              </form>
            </div>`
          : ''
      }
    </div>
  `;
}

function bindGeneralAdminEvents(container, onDataChanged, superMode) {
  document.getElementById('public-dates-form').onsubmit = async (e) => {
    e.preventDefault();
    const start = document.getElementById('pub-start-date').value || null;
    const end = document.getElementById('pub-end-date').value || null;

    const { error } = await supabase
      .from('terr_congregation_settings')
      .update({
        public_schedule_start_date: start,
        public_schedule_end_date: end
      })
      .eq('congregation_id', state.congregation.id);

    if (error) {
      showToast('Error al guardar fechas: ' + error.message, 'error');
      return;
    }

    state.settings.public_schedule_start_date = start;
    state.settings.public_schedule_end_date = end;
    showToast('Fechas de cartelera pública actualizadas', 'success');
  };

  document.getElementById('add-mp-form').onsubmit = async (e) => {
    e.preventDefault();
    const text = document.getElementById('new-mp-input').value.trim();
    if (!text) return;

    const { data, error } = await supabase
      .from('terr_meeting_points')
      .insert({
        congregation_id: state.congregation.id,
        name_and_address: text
      })
      .select()
      .single();

    if (!error && data) {
      state.meetingPoints.push(data);
      showToast('Punto de encuentro agregado', 'success');
      renderAdminView(container, onDataChanged);
    }
  };

  document.querySelectorAll('.del-mp-btn').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-del-mp');
      await supabase.from('terr_meeting_points').delete().eq('id', id);
      state.meetingPoints = state.meetingPoints.filter((x) => x.id !== id);
      renderAdminView(container, onDataChanged);
    };
  });

  if (superMode) {
    document.getElementById('create-admin-form').onsubmit = async (e) => {
      e.preventDefault();
      const congId = document.getElementById('sa-cong-select').value;
      const hermSelect = document.getElementById('sa-hermano-select');
      const fullName = hermSelect
        ? hermSelect.value.trim()
        : document.getElementById('sa-fullname').value.trim();
      const username = document.getElementById('sa-username').value.trim();
      const password = document.getElementById('sa-password').value;

      if (!fullName) {
        showToast('Elegí un hermano de la planilla', 'error');
        return;
      }

      const { error } = await supabase.rpc('terr_create_admin_account', {
        p_username: username,
        p_password: password,
        p_full_name: fullName,
        p_congregation_id: congId
      });

      if (error) {
        showToast('Error: ' + error.message, 'error');
        return;
      }

      showToast(`Admin "${fullName}" creado correctamente`, 'success');
      document.getElementById('create-admin-form').reset();
      if (onDataChanged) await onDataChanged();
    };
  }
}

// ============================================================================
// SUBPESTAÑA 2: MAPEADOR POR CALLES, EDICIÓN Y REINICIO DE PREDICACIÓN
// ============================================================================
function renderPolygonMapperHtml() {
  const city = state.settings?.city || 'Mar del Plata';
  const activeType = editingPolygonState?.type || 'subterritory';
  const activeName = editingPolygonState?.name || '';
  const activeParentTerr = editingPolygonState?.parentTerritoryId || '';
  const activeParentSub = editingPolygonState?.parentSubterritoryId || '';

  return `
    <div class="space-y-4">
      <!-- PANEL DE REINICIO PARA ARMAR SALIDAS -->
      <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
        <div>
          <h3 class="text-base font-extrabold text-slate-900">🔄 Reiniciar para Predicar de Nuevo</h3>
          <p class="text-xs text-slate-500 mt-0.5">
            Habilitá un territorio completo, una manzana o una cara puntual para volver a asignarlos en una salida.
          </p>
        </div>

        <div class="space-y-2.5">
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">¿Qué querés reiniciar?</label>
            <select id="reset-scope-select"
              class="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-xs font-bold bg-white">
              <option value="subterritory">Territorio completo (todas sus manzanas y caras)</option>
              <option value="block">Manzana individual (sus 4 caras)</option>
              <option value="face">Cara / Cuadra puntual</option>
            </select>
          </div>

          <div id="reset-subterritory-box">
            <label class="block text-xs font-bold text-slate-700 mb-1">Elegir Territorio</label>
            <select id="reset-subterritory-id"
              class="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white">
              <option value="">-- Elegir Territorio --</option>
              ${state.subterritories
                .map((s) => `<option value="${s.id}">Territorio ${escapeHtml(s.code)}</option>`)
                .join('')}
            </select>
          </div>

          <div id="reset-block-box" class="hidden">
            <label class="block text-xs font-bold text-slate-700 mb-1">Elegir Manzana</label>
            <select id="reset-block-id"
              class="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white">
              <option value="">-- Elegir Manzana --</option>
              ${state.blocks
                .map((b) => {
                  const sub = state.subterritories.find((s) => s.id === b.subterritory_id);
                  return `<option value="${b.id}">${
                    sub ? `T-${escapeHtml(sub.code)} · ` : ''
                  }Manzana ${escapeHtml(b.name)}</option>`;
                })
                .join('')}
            </select>
          </div>

          <div id="reset-face-box" class="hidden">
            <label class="block text-xs font-bold text-slate-700 mb-1">Elegir Cara / Cuadra</label>
            <select id="reset-face-id"
              class="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white">
              <option value="">-- Elegir Cuadra --</option>
              ${state.blockFaces
                .map((f) => {
                  const blk = state.blocks.find((b) => b.id === f.block_id);
                  const sub = state.subterritories.find((s) => s.id === blk?.subterritory_id);
                  return `<option value="${f.id}">${
                    sub ? `T-${escapeHtml(sub.code)} · ` : ''
                  }${blk ? `Mz. ${escapeHtml(blk.name)} · ` : ''}${escapeHtml(
                    f.street_name
                  )}</option>`;
                })
                .join('')}
            </select>
          </div>

          <button type="button" id="btn-reset-predicacion"
            class="w-full bg-rose-600 hover:bg-rose-500 text-white font-bold py-2.5 rounded-xl text-xs shadow transition">
            🔄 Reiniciar (Dejar listo para predicar)
          </button>
        </div>
      </div>

      <!-- MAPEADOR / EDITOR POR CALLES PERIMETRALES -->
      <div id="poly-mapper-card" class="bg-white p-4 rounded-2xl shadow-sm border ${
        editingPolygonState ? 'border-amber-400 ring-2 ring-amber-200' : 'border-slate-200'
      } space-y-3">
        <div class="flex items-start justify-between gap-2">
          <div>
            <h3 class="text-base font-extrabold text-slate-900">
              ${
                editingPolygonState
                  ? `✎ Editando: ${escapeHtml(editingPolygonState.name)}`
                  : '🗺️ Mapear por Calles Perimetrales'
              }
            </h3>
            <p class="text-xs text-slate-500 mt-0.5">
              ${
                editingPolygonState
                  ? 'Modificá el nombre, arrastrá los vértices en el mapa o recalculá las calles y guardá.'
                  : `Ingresá las calles en orden alrededor del perímetro. El sistema detectará las intersecciones en <b>${escapeHtml(
                      city
                    )}</b>.`
              }
            </p>
          </div>
          ${
            editingPolygonState
              ? `<button type="button" id="btn-cancel-edit-polygon"
                  class="bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold px-2.5 py-1.5 rounded-xl text-xs shrink-0">
                  Cancelar
                </button>`
              : ''
          }
        </div>

        <div class="space-y-2.5">
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">¿Qué querés mapear?</label>
            <select id="poly-entity-type" ${editingPolygonState ? 'disabled' : ''}
              class="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-xs font-bold bg-white disabled:bg-slate-100">
              <option value="territory" ${
                activeType === 'territory' ? 'selected' : ''
              }>Territorio asignado a la congregación (${escapeHtml(
                state.congregation?.nombre || ''
              )})</option>
              <option value="subterritory" ${
                activeType === 'subterritory' ? 'selected' : ''
              }>Territorios (numerados, ej: 26)</option>
              <option value="block" ${
                activeType === 'block' ? 'selected' : ''
              }>Manzana (con letra, ej: A, B, E)</option>
            </select>
          </div>

          <div id="poly-parent-territory-box" class="hidden">
            <label class="block text-xs font-bold text-slate-700 mb-1">
              Territorio asignado a la congregación (opcional)
            </label>
            <select id="poly-parent-territory"
              class="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white">
              <option value="">-- Ninguno / Independiente --</option>
              ${state.territories
                .map(
                  (t) =>
                    `<option value="${t.id}" ${
                      t.id === activeParentTerr ? 'selected' : ''
                    }>${escapeHtml(t.code_or_name)}</option>`
                )
                .join('')}
            </select>
          </div>

          <div id="poly-parent-subterritory-box" class="hidden">
            <label class="block text-xs font-bold text-slate-700 mb-1">Pertenece al Territorio *</label>
            <select id="poly-parent-subterritory"
              class="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white">
              <option value="">-- Elegir Territorio --</option>
              ${state.subterritories
                .map(
                  (s) =>
                    `<option value="${s.id}" ${
                      s.id === activeParentSub ? 'selected' : ''
                    }>Territorio ${escapeHtml(s.code)}</option>`
                )
                .join('')}
            </select>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div>
              <label id="poly-name-label" class="block text-xs font-bold text-slate-700 mb-1">
                Número de Territorio (ej: 26)
              </label>
              <input type="text" id="poly-entity-name" value="${escapeHtml(activeName)}" placeholder="Ej: 26"
                class="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold" />
            </div>
            <div>
              <label class="block text-xs font-bold text-slate-700 mb-1">Ciudad</label>
              <input type="text" id="poly-city" value="${escapeHtml(city)}"
                class="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs" />
            </div>
          </div>

          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">
              Calles del perímetro en orden (separadas por coma o una por línea)
            </label>
            <textarea id="poly-streets-input" rows="4"
              placeholder="Ej: 3 de Febrero, San Luis, 9 de Julio, Mitre"
              class="w-full p-3 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-blue-800 outline-none">${escapeHtml(
                polyStreetNames.join(', ')
              )}</textarea>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button type="button" id="btn-calc-polygon"
              class="w-full bg-blue-900 hover:bg-blue-800 text-white font-bold py-3 px-3 rounded-xl text-xs shadow transition">
              🔍 Calcular intersecciones
            </button>
            <button type="button" id="btn-manual-polygon"
              class="w-full bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold py-3 px-3 rounded-xl text-xs border border-slate-300 transition">
              📍 Marcar esquinas en el mapa
            </button>
          </div>
        </div>

        <div id="poly-preview-section" class="${polyPreviewCoords.length >= 3 || manualClickMode ? '' : 'hidden'} space-y-2.5 pt-2">
          <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span id="poly-preview-status" class="font-bold text-emerald-700">
              ${
                manualClickMode
                  ? `👆 Tocá las esquinas en el mapa (${polyPreviewCoords.length} puntos marcados)`
                  : `✅ Polígono de ${polyPreviewCoords.length} lados listo (podés arrastrar los puntos para ajustar)`
              }
            </span>
            <div class="flex items-center gap-2 shrink-0">
              <button type="button" id="btn-toggle-poly-map-size"
                class="bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold px-2.5 py-1 rounded-lg text-[11px]">
                ⤢ Agrandar / Achicar mapa
              </button>
              ${
                polyPreviewCoords.length > 0
                  ? `<button type="button" id="btn-clear-poly-points" class="text-rose-600 font-bold underline">Limpiar</button>`
                  : ''
              }
            </div>
          </div>
          <div id="admin-poly-map" class="w-full h-[500px] rounded-xl border border-slate-300 z-10 transition-all"></div>
          <button type="button" id="btn-save-polygon"
            class="w-full ${
              editingPolygonState ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500'
            } text-white font-extrabold py-3 rounded-xl text-sm shadow">
            ${editingPolygonState ? '💾 Actualizar Cambios' : '💾 Guardar en la Congregación'}
          </button>
        </div>
      </div>

      <!-- LISTADO EDITABLE DE LO CARGADO EN LA CONGREGACIÓN -->
      <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
        <h4 class="text-xs font-extrabold uppercase text-slate-500">
          Cargado en la Congregación (Tocá ✎ para editar)
        </h4>

        <!-- Territorio asignado a la congregación -->
        <div class="space-y-1.5">
          <div class="text-xs font-extrabold text-slate-800">
            • Territorio asignado a la congregación (${state.territories.length})
          </div>
          ${state.territories
            .map(
              (t) => `
              <div class="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-xl border border-slate-200 text-xs">
                <span class="font-bold text-slate-900">${escapeHtml(t.code_or_name)}</span>
                <div class="flex items-center gap-1.5">
                  <button type="button" data-edit-poly-type="territory" data-edit-poly-id="${t.id}"
                    class="edit-poly-btn bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold px-2.5 py-1 rounded-lg text-xs"
                    title="Editar territorio asignado">
                    ✎ Editar
                  </button>
                  <button type="button" data-del-poly-type="territory" data-del-poly-id="${t.id}"
                    class="del-poly-btn bg-rose-100 hover:bg-rose-200 text-rose-700 font-bold px-2 py-1 rounded-lg text-xs"
                    title="Eliminar">
                    ✕
                  </button>
                </div>
              </div>
            `
            )
            .join('')}
        </div>

        <!-- Territorios (subterritories) -->
        <div class="space-y-1.5 pt-2 border-t border-slate-100">
          <div class="text-xs font-extrabold text-slate-800">
            • Territorios (${state.subterritories.length})
          </div>
          ${state.subterritories
            .map((s) => {
              const blkCount = state.blocks.filter((b) => b.subterritory_id === s.id).length;
              return `
                <div class="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-xl border border-slate-200 text-xs">
                  <div>
                    <span class="font-bold text-slate-900">Territorio ${escapeHtml(s.code)}</span>
                    <span class="text-slate-500 ml-1">(${blkCount} manzanas)</span>
                  </div>
                  <div class="flex items-center gap-1.5">
                    <button type="button" data-edit-poly-type="subterritory" data-edit-poly-id="${s.id}"
                      class="edit-poly-btn bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold px-2.5 py-1 rounded-lg text-xs"
                      title="Editar territorio">
                      ✎ Editar
                    </button>
                    <button type="button" data-del-poly-type="subterritory" data-del-poly-id="${s.id}"
                      class="del-poly-btn bg-rose-100 hover:bg-rose-200 text-rose-700 font-bold px-2 py-1 rounded-lg text-xs"
                      title="Eliminar">
                      ✕
                    </button>
                  </div>
                </div>
              `;
            })
            .join('')}
        </div>

        <!-- Manzanas (blocks) -->
        <div class="space-y-1.5 pt-2 border-t border-slate-100">
          <div class="text-xs font-extrabold text-slate-800">
            • Manzanas (${state.blocks.length} · ${state.blockFaces.length} cuadras)
          </div>
          ${state.blocks
            .map((b) => {
              const sub = state.subterritories.find((s) => s.id === b.subterritory_id);
              const faces = state.blockFaces.filter((f) => f.block_id === b.id);
              const streetsSummary = faces.map((f) => f.street_name).join(', ');
              return `
                <div class="flex items-center justify-between gap-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200 text-xs">
                  <div class="min-w-0">
                    <div class="font-bold text-slate-900">
                      ${sub ? `T-${escapeHtml(sub.code)} · ` : ''}Manzana ${escapeHtml(b.name)}
                    </div>
                    ${
                      streetsSummary
                        ? `<div class="text-[11px] text-slate-500 truncate">${escapeHtml(streetsSummary)}</div>`
                        : ''
                    }
                  </div>
                  <div class="flex items-center gap-1.5 shrink-0">
                    <button type="button" data-edit-poly-type="block" data-edit-poly-id="${b.id}"
                      class="edit-poly-btn bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold px-2.5 py-1 rounded-lg text-xs"
                      title="Editar manzana">
                      ✎ Editar
                    </button>
                    <button type="button" data-del-poly-type="block" data-del-poly-id="${b.id}"
                      class="del-poly-btn bg-rose-100 hover:bg-rose-200 text-rose-700 font-bold px-2 py-1 rounded-lg text-xs"
                      title="Eliminar">
                      ✕
                    </button>
                  </div>
                </div>
              `;
            })
            .join('')}
        </div>
      </div>
    </div>
  `;
}

function parsePerimeterStreets(raw) {
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeStreetRegex(name) {
  let clean = name
    .trim()
    .replace(/^av\.?\s+/i, '(Avenida|Av\\.?) ')
    .replace(/^bv\.?\s+/i, '(Boulevard|Bv\\.?) ')
    .replace(/^diag\.?\s+/i, '(Diagonal|Diag\\.?) ')
    .replace(/^sgo\.?\s+/i, '(Santiago|Sgo\\.?) ')
    .replace(/^santiago\b/i, '(Santiago|Sgo\\.?)')
    .replace(/^9\s+de\s+julio\b/i, '(9|Nueve) de Julio')
    .replace(/^25\s+de\s+mayo\b/i, '(25|Veinticinco) de Mayo')
    .replace(/^3\s+de\s+febrero\b/i, '(3|Tres) de Febrero')
    .replace(/"/g, '\\"');
  clean = clean
    .replace(/[aá]/gi, '[aá]')
    .replace(/[eé]/gi, '[eé]')
    .replace(/[ií]/gi, '[ií]')
    .replace(/[oó]/gi, '[oó]')
    .replace(/[uú]/gi, '[uú]');
  return clean;
}

// Deduplica esquinas de avenidas doble mano (si están a menos de 45m, promedia el punto)
function deduplicateCorners(rawNodes) {
  const unique = [];
  for (const pt of rawNodes) {
    const nearIdx = unique.findIndex(
      (u) => Math.hypot(u[0] - pt[0], u[1] - pt[1]) < 0.00045
    );
    if (nearIdx === -1) {
      unique.push([...pt]);
    } else {
      unique[nearIdx][0] = (unique[nearIdx][0] + pt[0]) / 2;
      unique[nearIdx][1] = (unique[nearIdx][1] + pt[1]) / 2;
    }
  }
  return unique;
}

async function queryOverpassWithFallback(query) {
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ];

  for (const url of endpoints) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 14000);
      const res = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = await res.json();
      if (data && Array.isArray(data.elements)) {
        return data;
      }
    } catch (e) {
      console.warn(`Overpass fallo en ${url}:`, e);
    }
  }
  return null;
}

// UNA sola consulta unificada a Overpass para todo el perímetro (con servidor de respaldo)
async function findAllPerimeterIntersections(streets, city) {
  const country = state.settings?.country || 'Argentina';

  let centerLat = -38.0055;
  let centerLon = -57.5426;
  try {
    const cityRes = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
        `${city}, ${country}`
      )}`,
      { headers: { 'Accept-Language': 'es' } }
    );
    const cityData = await cityRes.json();
    if (Array.isArray(cityData) && cityData.length > 0) {
      centerLat = parseFloat(cityData[0].lat);
      centerLon = parseFloat(cityData[0].lon);
    }
  } catch (_) {}

  const uniqueStreets = [...new Set(streets)];
  const wayDefs = uniqueStreets
    .map((st, idx) => {
      const rx = normalizeStreetRegex(st);
      return `way(around:20000,${centerLat},${centerLon})["highway"]["name"~"${rx}",i]->.s${idx};`;
    })
    .join('\n    ');

  const cornerDefs = streets
    .map((s1, i) => {
      const s2 = streets[(i + 1) % streets.length];
      const idx1 = uniqueStreets.indexOf(s1);
      const idx2 = uniqueStreets.indexOf(s2);
      return `node(w.s${idx1})(w.s${idx2})->.c${i};\n    .c${i} out body;`;
    })
    .join('\n    ');

  const singleBatchQuery = `
    [out:json][timeout:15];
    ${wayDefs}
    ${cornerDefs}
  `;

  const data = await queryOverpassWithFallback(singleBatchQuery);
  if (!data) return [];

  const nodes = (data.elements || [])
    .filter((el) => el.type === 'node')
    .map((n) => [n.lat, n.lon]);

  const cleanCorners = deduplicateCorners(nodes);
  if (cleanCorners.length >= 3) {
    return cleanCorners;
  }

  return [];
}

function initAdminPolyPreviewMap() {
  const mapEl = document.getElementById('admin-poly-map');
  if (!mapEl || typeof window.L === 'undefined') return;

  const prevCenter = polyPreviewMap ? polyPreviewMap.getCenter() : null;
  const prevZoom = polyPreviewMap ? polyPreviewMap.getZoom() : null;

  if (polyPreviewMap) {
    polyPreviewMap.remove();
    polyPreviewMap = null;
  }

  const parentSubId = document.getElementById('poly-parent-subterritory')?.value;
  const parentSub = state.subterritories.find((s) => s.id === parentSubId);
  const initialPt =
    prevCenter
      ? [prevCenter.lat, prevCenter.lng]
      : polyPreviewCoords[0] ||
        (Array.isArray(parentSub?.polygon_coords) && parentSub.polygon_coords[0]) ||
        [-38.0005, -57.5475];

  polyPreviewMap = window.L.map('admin-poly-map').setView(initialPt, prevZoom || 16);
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(polyPreviewMap);

  if (Array.isArray(parentSub?.polygon_coords) && parentSub.polygon_coords.length >= 3) {
    window.L.polygon(parentSub.polygon_coords, {
      color: '#64748b',
      weight: 2,
      dashArray: '5, 5',
      fillOpacity: 0.04,
      interactive: false
    }).addTo(polyPreviewMap);
  }

  let polygonLayer = null;
  if (polyPreviewCoords.length >= 3) {
    polygonLayer = window.L.polygon(polyPreviewCoords, {
      color: '#1e3a8a',
      fillColor: '#3b82f6',
      fillOpacity: 0.25,
      weight: 4
    }).addTo(polyPreviewMap);
  } else if (polyPreviewCoords.length === 2) {
    polygonLayer = window.L.polyline(polyPreviewCoords, {
      color: '#1e3a8a',
      weight: 4
    }).addTo(polyPreviewMap);
  }

  polyPreviewCoords.forEach((pt, idx) => {
    const nextStreet = polyStreetNames[(idx + 1) % polyStreetNames.length] || '';
    const marker = window.L.marker(pt, {
      draggable: true,
      title: `Esquina: ${polyStreetNames[idx] || ''} y ${nextStreet}`
    }).addTo(polyPreviewMap);

    marker.bindPopup(
      `<b>Esquina ${idx + 1}</b>${
        polyStreetNames[idx]
          ? `<br>${escapeHtml(polyStreetNames[idx])} y ${escapeHtml(nextStreet)}`
          : ''
      }`
    );

    marker.on('dragend', (ev) => {
      const pos = ev.target.getLatLng();
      polyPreviewCoords[idx] = [pos.lat, pos.lng];
      if (polygonLayer) {
        polygonLayer.setLatLngs(polyPreviewCoords);
      }
    });
  });

  polyPreviewMap.on('click', (ev) => {
    if (!manualClickMode) return;
    polyPreviewCoords.push([ev.latlng.lat, ev.latlng.lng]);
    const statusEl = document.getElementById('poly-preview-status');
    if (statusEl) {
      statusEl.textContent =
        polyPreviewCoords.length >= 3
          ? `✅ ${polyPreviewCoords.length} esquinas marcadas (podés arrastrarlas o seguir tocando)`
          : `👆 Tocá las esquinas en el mapa (${polyPreviewCoords.length} puntos marcados)`;
    }
    initAdminPolyPreviewMap();
  });

  if (!prevCenter && polygonLayer && polyPreviewCoords.length >= 3) {
    polyPreviewMap.fitBounds(polygonLayer.getBounds(), { padding: [25, 25] });
  } else if (
    !prevCenter &&
    Array.isArray(parentSub?.polygon_coords) &&
    parentSub.polygon_coords.length >= 3
  ) {
    polyPreviewMap.fitBounds(parentSub.polygon_coords, { padding: [20, 20] });
  }

  setTimeout(() => {
    if (polyPreviewMap) polyPreviewMap.invalidateSize();
  }, 100);
}

function bindPolygonMapperEvents(container, onDataChanged) {
  // Eventos del panel de Reinicio para Armar Salidas
  const resetScope = document.getElementById('reset-scope-select');
  const resetSubBox = document.getElementById('reset-subterritory-box');
  const resetBlockBox = document.getElementById('reset-block-box');
  const resetFaceBox = document.getElementById('reset-face-box');

  resetScope.onchange = () => {
    const val = resetScope.value;
    resetSubBox.classList.toggle('hidden', val !== 'subterritory');
    resetBlockBox.classList.toggle('hidden', val !== 'block');
    resetFaceBox.classList.toggle('hidden', val !== 'face');
  };

  document.getElementById('btn-reset-predicacion').onclick = async () => {
    const scope = resetScope.value;
    let faceIdsToReset = [];
    let label = '';

    if (scope === 'subterritory') {
      const subId = document.getElementById('reset-subterritory-id').value;
      if (!subId) {
        showToast('Elegí un Territorio para reiniciar', 'error');
        return;
      }
      const sub = state.subterritories.find((s) => s.id === subId);
      const blockIds = new Set(
        state.blocks.filter((b) => b.subterritory_id === subId).map((b) => b.id)
      );
      faceIdsToReset = state.blockFaces.filter((f) => blockIds.has(f.block_id)).map((f) => f.id);
      label = `Territorio ${sub?.code || ''}`;
    } else if (scope === 'block') {
      const blkId = document.getElementById('reset-block-id').value;
      if (!blkId) {
        showToast('Elegí una Manzana para reiniciar', 'error');
        return;
      }
      const blk = state.blocks.find((b) => b.id === blkId);
      faceIdsToReset = state.blockFaces.filter((f) => f.block_id === blkId).map((f) => f.id);
      label = `Manzana ${blk?.name || ''}`;
    } else if (scope === 'face') {
      const faceId = document.getElementById('reset-face-id').value;
      if (!faceId) {
        showToast('Elegí una Cuadra para reiniciar', 'error');
        return;
      }
      const face = state.blockFaces.find((f) => f.id === faceId);
      faceIdsToReset = [faceId];
      label = `Cuadra ${face?.street_name || ''}`;
    }

    if (faceIdsToReset.length === 0) {
      showToast('No hay caras cargadas en esa selección', 'warning');
      return;
    }

    if (!confirm(`¿Seguro que querés reiniciar ${label} (${faceIdsToReset.length} caras)?`)) {
      return;
    }

    const { error } = await supabase
      .from('terr_block_faces')
      .update({
        last_completed_at: null,
        last_completed_by: null
      })
      .in('id', faceIdsToReset);

    if (error) {
      showToast('Error al reiniciar: ' + error.message, 'error');
      return;
    }

    const idSet = new Set(faceIdsToReset);
    state.blockFaces.forEach((f) => {
      if (idSet.has(f.id)) {
        f.last_completed_at = null;
        f.last_completed_by = null;
      }
    });

    showToast(`🔄 ${label} reiniciado (${faceIdsToReset.length} caras habilitadas)`, 'success');
    if (onDataChanged) await onDataChanged();
  };

  // Botón Cancelar Edición de Polígono
  const cancelEditBtn = document.getElementById('btn-cancel-edit-polygon');
  if (cancelEditBtn) {
    cancelEditBtn.onclick = () => {
      editingPolygonState = null;
      manualClickMode = false;
      polyPreviewCoords = [];
      polyStreetNames = [];
      renderAdminView(container, onDataChanged);
    };
  }

  // Botones Editar en el listado de Cargado en la Congregación
  document.querySelectorAll('.edit-poly-btn').forEach((btn) => {
    btn.onclick = () => {
      const pType = btn.getAttribute('data-edit-poly-type');
      const pId = btn.getAttribute('data-edit-poly-id');

      if (pType === 'territory') {
        const item = state.territories.find((t) => t.id === pId);
        if (!item) return;
        editingPolygonState = {
          type: 'territory',
          id: item.id,
          name: item.code_or_name || '',
          parentTerritoryId: '',
          parentSubterritoryId: ''
        };
        polyPreviewCoords = Array.isArray(item.polygon_coords)
          ? item.polygon_coords.map((p) => [...p])
          : [];
        polyStreetNames = [];
      } else if (pType === 'subterritory') {
        const item = state.subterritories.find((s) => s.id === pId);
        if (!item) return;
        editingPolygonState = {
          type: 'subterritory',
          id: item.id,
          name: item.code || '',
          parentTerritoryId: item.territory_id || '',
          parentSubterritoryId: ''
        };
        polyPreviewCoords = Array.isArray(item.polygon_coords)
          ? item.polygon_coords.map((p) => [...p])
          : [];
        polyStreetNames = [];
      } else if (pType === 'block') {
        const item = state.blocks.find((b) => b.id === pId);
        if (!item) return;
        const blockFaces = state.blockFaces.filter((f) => f.block_id === item.id);
        editingPolygonState = {
          type: 'block',
          id: item.id,
          name: item.name || '',
          parentTerritoryId: '',
          parentSubterritoryId: item.subterritory_id || ''
        };
        polyPreviewCoords = Array.isArray(item.polygon_coords)
          ? item.polygon_coords.map((p) => [...p])
          : [];
        // Reconstruir el orden original de calles guardadas en las caras de la manzana
        if (blockFaces.length > 0) {
          const ordered = [];
          for (let i = 0; i < blockFaces.length; i++) {
            const prevIdx = (i - 1 + blockFaces.length) % blockFaces.length;
            ordered.push(blockFaces[prevIdx].street_name);
          }
          polyStreetNames = ordered;
        } else {
          polyStreetNames = [];
        }
      }

      manualClickMode = false;
      renderAdminView(container, onDataChanged);
      document.getElementById('poly-mapper-card')?.scrollIntoView({ behavior: 'smooth' });
    };
  });

  // Botones Eliminar en el listado de Cargado en la Congregación
  document.querySelectorAll('.del-poly-btn').forEach((btn) => {
    btn.onclick = async () => {
      const pType = btn.getAttribute('data-del-poly-type');
      const pId = btn.getAttribute('data-del-poly-id');
      if (!confirm('¿Seguro que querés eliminar este elemento?')) return;

      if (pType === 'territory') {
        const { error } = await supabase.from('terr_territories').delete().eq('id', pId);
        if (error) {
          showToast('Error al eliminar: ' + error.message, 'error');
          return;
        }
      } else if (pType === 'subterritory') {
        const { error } = await supabase.from('terr_subterritories').delete().eq('id', pId);
        if (error) {
          showToast('Error al eliminar: ' + error.message, 'error');
          return;
        }
      } else if (pType === 'block') {
        await supabase.from('terr_block_faces').delete().eq('block_id', pId);
        const { error } = await supabase.from('terr_blocks').delete().eq('id', pId);
        if (error) {
          showToast('Error al eliminar: ' + error.message, 'error');
          return;
        }
      }

      if (editingPolygonState?.id === pId) {
        editingPolygonState = null;
        polyPreviewCoords = [];
        polyStreetNames = [];
      }
      showToast('Elemento eliminado correctamente', 'info');
      if (onDataChanged) await onDataChanged();
      renderAdminView(container, onDataChanged);
    };
  });

  // Eventos del Mapeador Poligonal
  const typeSelect = document.getElementById('poly-entity-type');
  const parentTerrBox = document.getElementById('poly-parent-territory-box');
  const parentSubBox = document.getElementById('poly-parent-subterritory-box');
  const nameLabel = document.getElementById('poly-name-label');
  const nameInput = document.getElementById('poly-entity-name');

  const syncTypeFields = () => {
    const val = typeSelect.value;
    parentTerrBox.classList.toggle('hidden', val !== 'subterritory');
    parentSubBox.classList.toggle('hidden', val !== 'block');

    if (val === 'territory') {
      nameLabel.textContent = 'Nombre del Territorio de la congregación';
      nameInput.placeholder = 'Ej: Centro';
    } else if (val === 'subterritory') {
      nameLabel.textContent = 'Número de Territorio (ej: 26)';
      nameInput.placeholder = 'Ej: 26';
    } else {
      nameLabel.textContent = 'Letra de Manzana (ej: A, B, E)';
      nameInput.placeholder = 'Ej: E';
    }
  };

  typeSelect.onchange = syncTypeFields;
  syncTypeFields();

  if (polyPreviewCoords.length >= 3 || manualClickMode) {
    setTimeout(initAdminPolyPreviewMap, 50);
  }

  const toggleSizeBtn = document.getElementById('btn-toggle-poly-map-size');
  if (toggleSizeBtn) {
    toggleSizeBtn.onclick = () => {
      const mapDiv = document.getElementById('admin-poly-map');
      if (!mapDiv) return;
      const isExpanded = mapDiv.classList.contains('h-[80vh]');
      mapDiv.classList.toggle('h-[80vh]', !isExpanded);
      mapDiv.classList.toggle('h-[500px]', isExpanded);
      if (polyPreviewMap) {
        setTimeout(() => polyPreviewMap.invalidateSize(), 150);
      }
    };
  }

  document.getElementById('btn-manual-polygon').onclick = () => {
    const rawStreets = document.getElementById('poly-streets-input').value;
    polyStreetNames = parsePerimeterStreets(rawStreets);
    manualClickMode = true;
    polyPreviewCoords = [];
    document.getElementById('poly-preview-section').classList.remove('hidden');
    document.getElementById('poly-preview-status').textContent =
      '👆 Tocá en orden las esquinas en el mapa';
    initAdminPolyPreviewMap();
  };

  const clearBtn = document.getElementById('btn-clear-poly-points');
  if (clearBtn) {
    clearBtn.onclick = () => {
      polyPreviewCoords = [];
      initAdminPolyPreviewMap();
    };
  }

  document.getElementById('btn-calc-polygon').onclick = async () => {
    const rawStreets = document.getElementById('poly-streets-input').value;
    const streets = parsePerimeterStreets(rawStreets);
    const city = document.getElementById('poly-city').value.trim() || state.settings?.city || 'Mar del Plata';

    if (streets.length < 3) {
      showToast('Ingresá al menos 3 calles que formen un perímetro cerrado', 'error');
      return;
    }

    const btn = document.getElementById('btn-calc-polygon');
    btn.disabled = true;
    btn.textContent = `Buscando ${streets.length} esquinas...`;

    const coords = await findAllPerimeterIntersections(streets, city);

    btn.disabled = false;
    btn.textContent = '🔍 Calcular intersecciones';

    if (coords.length < 3) {
      showToast(
        'No se hallaron automáticamente. Tocá "📍 Marcar esquinas en el mapa" para marcarlas con un clic.',
        'error'
      );
      return;
    }

    manualClickMode = false;
    polyStreetNames = streets;
    polyPreviewCoords = coords;
    document.getElementById('poly-preview-status').textContent =
      `✅ Polígono de ${coords.length} lados listo (podés arrastrar los puntos para ajustar)`;
    document.getElementById('poly-preview-section').classList.remove('hidden');
    initAdminPolyPreviewMap();
    showToast(`Polígono calculado con ${coords.length} vértices`, 'success');
  };

  document.getElementById('btn-save-polygon').onclick = async () => {
    const entityType = editingPolygonState ? editingPolygonState.type : typeSelect.value;
    const entityName = nameInput.value.trim();

    if (!entityName) {
      showToast('Ingresá el nombre, número o letra antes de guardar', 'error');
      return;
    }
    if (polyPreviewCoords.length < 3) {
      showToast('Primero marcá o calculá al menos 3 esquinas en el mapa', 'error');
      return;
    }

    const rawStreets = document.getElementById('poly-streets-input').value;
    const parsedStreets = parsePerimeterStreets(rawStreets);
    if (parsedStreets.length > 0) {
      polyStreetNames = parsedStreets;
    }

    // Validación para evitar desfase entre cantidad de lados y nombres de calles en manzanas
    if (
      entityType === 'block' &&
      polyStreetNames.length > 0 &&
      polyStreetNames.length !== polyPreviewCoords.length
    ) {
      const proceed = confirm(
        `El polígono tiene ${polyPreviewCoords.length} lados pero ingresaste ${polyStreetNames.length} calles.\n` +
          `Si continuás sin ajustar las ${polyPreviewCoords.length} calles en orden, algunas cuadras quedarán con nombres genéricos ("Cara N").\n\n` +
          `¿Querés guardar igual? (Cancelar para corregir las calles)`
      );
      if (!proceed) {
        const streetsInput = document.getElementById('poly-streets-input');
        streetsInput?.focus();
        showToast(
          `Ingresá exactamente ${polyPreviewCoords.length} calles en orden alrededor de la manzana`,
          'warning'
        );
        return;
      }
    }

    const saveBtn = document.getElementById('btn-save-polygon');
    saveBtn.disabled = true;
    saveBtn.textContent = editingPolygonState ? 'Actualizando...' : 'Guardando...';

    if (entityType === 'territory') {
      if (editingPolygonState) {
        const { error } = await supabase
          .from('terr_territories')
          .update({
            code_or_name: entityName,
            polygon_coords: polyPreviewCoords
          })
          .eq('id', editingPolygonState.id);

        if (error) {
          showToast('Error al actualizar: ' + error.message, 'error');
          saveBtn.disabled = false;
          saveBtn.textContent = '💾 Actualizar Cambios';
          return;
        }
        showToast(`Territorio asignado "${entityName}" actualizado`, 'success');
      } else {
        const { error } = await supabase.from('terr_territories').insert({
          congregation_id: state.congregation.id,
          code_or_name: entityName,
          polygon_coords: polyPreviewCoords
        });
        if (error) {
          showToast('Error al guardar: ' + error.message, 'error');
          saveBtn.disabled = false;
          saveBtn.textContent = '💾 Guardar en la Congregación';
          return;
        }
        showToast(`Territorio asignado "${entityName}" guardado`, 'success');
      }
    } else if (entityType === 'subterritory') {
      const parentTerrId = document.getElementById('poly-parent-territory').value || null;
      if (editingPolygonState) {
        const { error } = await supabase
          .from('terr_subterritories')
          .update({
            territory_id: parentTerrId,
            code: entityName,
            polygon_coords: polyPreviewCoords
          })
          .eq('id', editingPolygonState.id);

        if (error) {
          showToast('Error al actualizar Territorio: ' + error.message, 'error');
          saveBtn.disabled = false;
          saveBtn.textContent = '💾 Actualizar Cambios';
          return;
        }
        showToast(`Territorio ${entityName} actualizado`, 'success');
      } else {
        const { error } = await supabase.from('terr_subterritories').insert({
          congregation_id: state.congregation.id,
          territory_id: parentTerrId,
          code: entityName,
          polygon_coords: polyPreviewCoords
        });
        if (error) {
          showToast('Error al guardar Territorio: ' + error.message, 'error');
          saveBtn.disabled = false;
          saveBtn.textContent = '💾 Guardar en la Congregación';
          return;
        }
        showToast(`Territorio ${entityName} guardado`, 'success');
      }
    } else if (entityType === 'block') {
      const subId = document.getElementById('poly-parent-subterritory').value;
      if (!subId) {
        showToast('Elegí a qué Territorio pertenece esta manzana', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = editingPolygonState
          ? '💾 Actualizar Cambios'
          : '💾 Guardar en la Congregación';
        return;
      }

      const avgLat =
        polyPreviewCoords.reduce((acc, p) => acc + p[0], 0) / polyPreviewCoords.length;
      const avgLng =
        polyPreviewCoords.reduce((acc, p) => acc + p[1], 0) / polyPreviewCoords.length;

      const hasExactStreetMatch = polyStreetNames.length === polyPreviewCoords.length;

      if (editingPolygonState) {
        const { error: updErr } = await supabase
          .from('terr_blocks')
          .update({
            subterritory_id: subId,
            name: entityName.toUpperCase(),
            center_lat: avgLat,
            center_lng: avgLng,
            polygon_coords: polyPreviewCoords
          })
          .eq('id', editingPolygonState.id);

        if (updErr) {
          showToast('Error al actualizar manzana: ' + updErr.message, 'error');
          saveBtn.disabled = false;
          saveBtn.textContent = '💾 Actualizar Cambios';
          return;
        }

        const existingFaces = state.blockFaces.filter(
          (f) => f.block_id === editingPolygonState.id
        );

        // Si mantiene la misma cantidad de lados, actualizar calle y coordenadas conservando historial
        if (existingFaces.length === polyPreviewCoords.length) {
          for (let i = 0; i < polyPreviewCoords.length; i++) {
            const pt = polyPreviewCoords[i];
            const nextPt = polyPreviewCoords[(i + 1) % polyPreviewCoords.length];
            const streetLabel = hasExactStreetMatch
              ? polyStreetNames[(i + 1) % polyStreetNames.length]
              : existingFaces[i].street_name || `Cara ${i + 1}`;
            await supabase
              .from('terr_block_faces')
              .update({
                street_name: streetLabel,
                line_coords: [pt, nextPt]
              })
              .eq('id', existingFaces[i].id);
          }
        } else {
          await supabase
            .from('terr_block_faces')
            .delete()
            .eq('block_id', editingPolygonState.id);

          const facesPayload = polyPreviewCoords.map((pt, i) => {
            const nextPt = polyPreviewCoords[(i + 1) % polyPreviewCoords.length];
            const streetLabel = hasExactStreetMatch
              ? polyStreetNames[(i + 1) % polyStreetNames.length]
              : `Cara ${i + 1}`;
            return {
              congregation_id: state.congregation.id,
              block_id: editingPolygonState.id,
              street_name: streetLabel,
              line_coords: [pt, nextPt]
            };
          });
          await supabase.from('terr_block_faces').insert(facesPayload);
        }

        showToast(`Manzana ${entityName.toUpperCase()} actualizada`, 'success');
      } else {
        const { data: newBlock, error: blkErr } = await supabase
          .from('terr_blocks')
          .insert({
            congregation_id: state.congregation.id,
            subterritory_id: subId,
            name: entityName.toUpperCase(),
            center_lat: avgLat,
            center_lng: avgLng,
            polygon_coords: polyPreviewCoords
          })
          .select()
          .single();

        if (blkErr || !newBlock) {
          showToast('Error al guardar manzana: ' + (blkErr?.message || ''), 'error');
          saveBtn.disabled = false;
          saveBtn.textContent = '💾 Guardar en la Congregación';
          return;
        }

        const facesPayload = polyPreviewCoords.map((pt, i) => {
          const nextPt = polyPreviewCoords[(i + 1) % polyPreviewCoords.length];
          const streetLabel = hasExactStreetMatch
            ? polyStreetNames[(i + 1) % polyStreetNames.length]
            : `Cara ${i + 1}`;
          return {
            congregation_id: state.congregation.id,
            block_id: newBlock.id,
            street_name: streetLabel,
            line_coords: [pt, nextPt]
          };
        });

        await supabase.from('terr_block_faces').insert(facesPayload);
        showToast(`Manzana ${entityName.toUpperCase()} guardada con ${facesPayload.length} caras`, 'success');
      }
    }

    editingPolygonState = null;
    manualClickMode = false;
    polyPreviewCoords = [];
    polyStreetNames = [];
    if (onDataChanged) await onDataChanged();
  };
}

// ============================================================================
// SUBPESTAÑA 3: GESTIÓN DE USUARIOS (VINCULADOS A PLANILLA HERMANOS)
// ============================================================================
function renderUsersAdminHtml() {
  return `
    <div class="space-y-4">
      <div class="bg-blue-50 border border-blue-200 text-blue-950 px-3.5 py-2.5 rounded-2xl text-xs">
        💡 Vinculá cada usuario con su registro oficial de la planilla <b>Hermanos</b> y asignale su rol (<b>Conductor</b>, <b>Admin</b> o <b>Publicador</b>) para que aparezca sin errores en <b>Salidas</b> y funcione el envío directo por WhatsApp.
      </div>

      ${
        pendingUsers.length > 0
          ? `<div class="bg-amber-50 border border-amber-300 p-4 rounded-2xl space-y-2.5">
              <h3 class="text-sm font-extrabold text-amber-950">⏳ Solicitudes Pendientes (${pendingUsers.length})</h3>
              ${pendingUsers
                .map(
                  (u) => `
                  <div class="bg-white p-3.5 rounded-xl border border-amber-200 space-y-2">
                    <div class="flex items-start justify-between gap-2">
                      <div>
                        <div class="font-bold text-sm text-slate-900">${escapeHtml(u.full_name || 'Sin nombre')}</div>
                        <div class="text-xs text-slate-500">${escapeHtml(u.email)}</div>
                      </div>
                      <div class="flex gap-1.5 shrink-0">
                        <button data-approve-user="${u.id}"
                          class="approve-user-btn bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1.5 rounded-lg text-xs">
                          ✓ Aprobar
                        </button>
                        <button data-block-user="${u.id}"
                          class="block-user-btn bg-rose-100 text-rose-700 font-bold px-2.5 py-1.5 rounded-lg text-xs">
                          Rechazar
                        </button>
                      </div>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      <select id="pending-hermano-${u.id}"
                        class="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-bold bg-white">
                        ${buildHermanosSelectOptions(u.full_name)}
                      </select>
                      <select id="pending-role-${u.id}"
                        class="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-bold bg-white">
                        <option value="publicador" ${u.role === 'publicador' ? 'selected' : ''}>Rol: Publicador</option>
                        <option value="conductor" ${u.role === 'conductor' ? 'selected' : ''}>Rol: Conductor</option>
                        <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Rol: Admin</option>
                      </select>
                    </div>
                  </div>
                `
                )
                .join('')}
            </div>`
          : ''
      }

      <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-2.5">
        <h3 class="text-base font-extrabold text-slate-900">👥 Hermanos de la Congregación</h3>
        ${allCongUsers
          .filter((u) => u.status !== 'pending')
          .map(
            (u) => `
            <div class="py-2.5 border-b border-slate-100 last:border-0 text-xs space-y-2">
              <div class="flex items-center justify-between gap-2">
                <div class="min-w-0">
                  <div class="font-bold text-slate-900 truncate">${escapeHtml(u.full_name || u.email)}</div>
                  <div class="text-slate-400 truncate">${escapeHtml(u.email)}</div>
                </div>
                <select data-role-user="${u.id}"
                  class="change-role-select px-2.5 py-1.5 rounded-lg border border-slate-300 font-bold bg-white shrink-0">
                  <option value="publicador" ${u.role === 'publicador' ? 'selected' : ''}>Publicador</option>
                  <option value="conductor" ${u.role === 'conductor' ? 'selected' : ''}>Conductor</option>
                  <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                </select>
              </div>
              ${
                hermanosCongList.length > 0
                  ? `<div>
                      <select data-hermano-user="${u.id}"
                        class="link-hermano-select w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 font-semibold text-slate-800">
                        ${buildHermanosSelectOptions(u.full_name)}
                      </select>
                    </div>`
                  : ''
              }
            </div>
          `
          )
          .join('')}
      </div>
    </div>
  `;
}

function bindUsersAdminEvents(container, onDataChanged) {
  document.querySelectorAll('.approve-user-btn').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-approve-user');
      const hermanoSel = document.getElementById(`pending-hermano-${id}`);
      const roleSel = document.getElementById(`pending-role-${id}`);
      const chosenName = hermanoSel ? hermanoSel.value.trim() : '';
      const chosenRole = roleSel ? roleSel.value : 'publicador';

      if (hermanosCongList.length > 0 && !chosenName) {
        showToast('Elegí primero el nombre desde la planilla Hermanos', 'error');
        return;
      }

      const updatePayload = {
        status: 'approved',
        role: chosenRole
      };
      if (chosenName) {
        updatePayload.full_name = chosenName;
      }

      const { error } = await supabase
        .from('terr_users')
        .update(updatePayload)
        .eq('id', id);

      if (error) {
        showToast('Error al aprobar: ' + error.message, 'error');
        return;
      }

      showToast('Hermano aprobado y vinculado', 'success');
      await loadAdminData();
      renderAdminView(container, onDataChanged);
    };
  });

  document.querySelectorAll('.block-user-btn').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-block-user');
      await supabase.from('terr_users').update({ status: 'blocked' }).eq('id', id);
      showToast('Solicitud rechazada', 'info');
      await loadAdminData();
      renderAdminView(container, onDataChanged);
    };
  });

  document.querySelectorAll('.change-role-select').forEach((sel) => {
    sel.onchange = async () => {
      const id = sel.getAttribute('data-role-user');
      const { error } = await supabase
        .from('terr_users')
        .update({ role: sel.value })
        .eq('id', id);
      if (error) {
        showToast('Error al actualizar rol: ' + error.message, 'error');
        return;
      }
      showToast('Rol actualizado', 'success');
      if (onDataChanged) await onDataChanged();
    };
  });

  document.querySelectorAll('.link-hermano-select').forEach((sel) => {
    sel.onchange = async () => {
      const id = sel.getAttribute('data-hermano-user');
      const chosenName = sel.value.trim();
      if (!chosenName) return;

      const { error } = await supabase
        .from('terr_users')
        .update({ full_name: chosenName })
        .eq('id', id);

      if (error) {
        showToast('Error al vincular hermano: ' + error.message, 'error');
        return;
      }

      showToast(`Vinculado con ${chosenName}`, 'success');
      await loadAdminData();
      renderAdminView(container, onDataChanged);
    };
  });
}

// ============================================================================
// SUBPESTAÑA 4: EDIFICIOS REPORTADOS, IMPORTADOR Y GESTIÓN DE EDIFICIOS CARGADOS
// ============================================================================
let buildingAdminSearch = '';
let editingBuildingId = null;
let editingBuildingApartments = [];
let loadingEditApts = false;

async function fetchBuildingApartmentsForAdmin(buildingId) {
  loadingEditApts = true;
  const { data, error } = await supabase
    .from('terr_apartments')
    .select('*')
    .eq('building_id', buildingId)
    .order('label', { ascending: true });

  loadingEditApts = false;
  if (error) {
    showToast('Error al cargar timbres del edificio: ' + error.message, 'error');
    editingBuildingApartments = [];
    return;
  }

  editingBuildingApartments = (data || []).sort((a, b) =>
    String(a.label || '').localeCompare(String(b.label || ''), 'es', {
      numeric: true,
      sensitivity: 'base'
    })
  );
}

function renderBuildingsAdminHtml() {
  const q = buildingAdminSearch.trim().toLowerCase();
  const filteredBuildings = (state.buildings || []).filter((b) => {
    if (!q) return true;
    const subCode = (b.terr_subterritories?.code || '').toLowerCase();
    return (
      (b.street || '').toLowerCase().includes(q) ||
      String(b.street_number || '').toLowerCase().includes(q) ||
      subCode.includes(q)
    );
  });

  const editingBldg = editingBuildingId
    ? (state.buildings || []).find((b) => b.id === editingBuildingId)
    : null;

  return `
    <div class="space-y-4">
      ${
        pendingReports.length > 0
          ? `<div class="bg-amber-50 border border-amber-300 p-4 rounded-2xl space-y-3">
              <h3 class="text-sm font-extrabold text-amber-950">🏗️ Edificios Reportados por Hermanos (${pendingReports.length})</h3>
              ${pendingReports
                .map(
                  (r) => `
                  <div class="bg-white p-3.5 rounded-xl border border-amber-200 space-y-2.5">
                    <div class="flex items-start justify-between">
                      <div>
                        <div class="font-extrabold text-sm text-slate-900">
                          ${escapeHtml(r.street)} ${escapeHtml(r.street_number)}
                        </div>
                        <div class="text-[11px] text-slate-500">
                          Ubicación GPS se calculará por dirección al aprobar
                        </div>
                      </div>
                      ${
                        r.photo_url
                          ? `<a href="${r.photo_url}" target="_blank"
                              class="text-xs font-bold text-blue-900 underline">📷 Ver foto</a>`
                          : ''
                      }
                    </div>

                    <div>
                      <label class="block text-[11px] font-bold text-slate-600 mb-1">Asignar a Territorio</label>
                      <select id="rep-sub-${r.id}"
                        class="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs bg-white">
                        <option value="">-- Sin territorio asignado --</option>
                        ${state.subterritories
                          .map((s) => `<option value="${s.id}">Territorio ${escapeHtml(s.code)}</option>`)
                          .join('')}
                      </select>
                    </div>

                    <input type="text" id="rep-apts-${r.id}"
                      placeholder="Timbres separados por coma (ej: 1A, 1B, 2A, 2B)"
                      class="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs" />

                    <div class="flex gap-2">
                      <button data-approve-rep="${r.id}"
                        class="approve-rep-btn flex-1 bg-emerald-600 text-white font-bold py-2 rounded-lg text-xs">
                        ✓ Geocodificar y Aprobar
                      </button>
                      <button data-reject-rep="${r.id}"
                        class="reject-rep-btn bg-rose-100 text-rose-700 font-bold px-3 py-2 rounded-lg text-xs">
                        Descartar
                      </button>
                    </div>
                  </div>
                `
                )
                .join('')}
            </div>`
          : ''
      }

      ${renderImportadorHtml()}

      <!-- EDITOR COMPLETO DE EDIFICIO Y SUS TIMBRES -->
      ${
        editingBldg
          ? `<div id="edit-building-card" class="bg-amber-50 border-2 border-amber-400 p-4 rounded-2xl space-y-3.5 shadow-sm">
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-extrabold text-amber-950">
                  ✎ Editando: ${escapeHtml(editingBldg.street)} ${escapeHtml(editingBldg.street_number)}
                </h3>
                <button type="button" id="btn-cancel-edit-bldg"
                  class="bg-white border border-slate-300 text-slate-700 font-bold px-2.5 py-1 rounded-lg text-xs">
                  Cerrar
                </button>
              </div>

              <div class="grid grid-cols-3 gap-2">
                <div class="col-span-2">
                  <label class="block text-[11px] font-bold text-slate-700 mb-1">Calle</label>
                  <input type="text" id="edit-bldg-street" value="${escapeHtml(editingBldg.street)}"
                    class="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white font-semibold" />
                </div>
                <div>
                  <label class="block text-[11px] font-bold text-slate-700 mb-1">Altura</label>
                  <input type="text" id="edit-bldg-number" value="${escapeHtml(editingBldg.street_number)}"
                    class="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white font-semibold" />
                </div>
              </div>

              <div>
                <label class="block text-[11px] font-bold text-slate-700 mb-1">Territorio asignado</label>
                <select id="edit-bldg-sub"
                  class="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white font-bold">
                  <option value="">-- Sin territorio asignado --</option>
                  ${state.subterritories
                    .map(
                      (s) =>
                        `<option value="${s.id}" ${
                          s.id === editingBldg.subterritory_id ? 'selected' : ''
                        }>Territorio ${escapeHtml(s.code)}</option>`
                    )
                    .join('')}
                </select>
              </div>

              <!-- VISUALIZADOR Y EDITOR DE TODOS LOS TIMBRES CARGADOS -->
              <div class="bg-white p-3 rounded-xl border border-amber-200 space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-[11px] font-extrabold text-slate-800">
                    🔔 Timbres cargados (${editingBuildingApartments.length})
                  </span>
                  <span class="text-[10px] text-slate-500">
                    Tocá el nombre para renombrar o ✕ para borrar
                  </span>
                </div>

                ${
                  loadingEditApts
                    ? `<div class="text-xs text-slate-500 py-2">Cargando timbres...</div>`
                    : editingBuildingApartments.length === 0
                      ? `<div class="text-xs text-slate-400 italic py-1">Este edificio no tiene timbres cargados todavía.</div>`
                      : `<div class="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto p-1">
                          ${editingBuildingApartments
                            .map((apt) => {
                              const statusBadge =
                                apt.status === 'do_not_visit'
                                  ? 'border-rose-300 bg-rose-50 text-rose-800'
                                  : apt.status === 'does_not_exist'
                                    ? 'border-slate-300 bg-slate-100 text-slate-500 line-through'
                                    : 'border-slate-300 bg-slate-50 text-slate-800';
                              const statusTag =
                                apt.status === 'do_not_visit'
                                  ? ' (No visitar)'
                                  : apt.status === 'does_not_exist'
                                    ? ' (No existe)'
                                    : '';
                              return `
                                <div class="inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-bold ${statusBadge}">
                                  <button type="button" data-rename-apt="${apt.id}" data-apt-label="${escapeHtml(apt.label)}"
                                    class="rename-apt-btn hover:underline text-left"
                                    title="Tocá para cambiar el nombre del timbre">
                                    ${escapeHtml(apt.label)}${statusTag}
                                  </button>
                                  <button type="button" data-del-apt="${apt.id}" data-apt-label="${escapeHtml(apt.label)}"
                                    class="del-apt-btn text-rose-600 hover:text-rose-800 font-black pl-1"
                                    title="Eliminar este timbre">
                                    ✕
                                  </button>
                                </div>
                              `;
                            })
                            .join('')}
                        </div>`
                }
              </div>

              <div>
                <label class="block text-[11px] font-bold text-slate-700 mb-1">
                  Agregar timbres faltantes (separados por coma)
                </label>
                <input type="text" id="edit-bldg-new-apts" placeholder="Ej: 5A, 5B, Portería"
                  class="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white" />
              </div>

              <label class="flex items-center gap-2 text-xs text-slate-700 font-semibold">
                <input type="checkbox" id="edit-bldg-regeocode" class="rounded" />
                <span>Recalcular ubicación GPS por dirección</span>
              </label>

              <button type="button" id="btn-save-edit-bldg"
                class="w-full bg-amber-600 hover:bg-amber-500 text-white font-extrabold py-2.5 rounded-xl text-xs shadow">
                💾 Guardar Cambios del Edificio
              </button>
            </div>`
          : ''
      }

      <!-- LISTADO DE EDIFICIOS CARGADOS (CON EDITAR Y ELIMINAR EN CASCADA) -->
      <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-sm font-extrabold text-slate-900">
            🏢 Edificios Cargados (${(state.buildings || []).length})
          </h3>
        </div>

        <input type="search" id="admin-bldg-search" value="${escapeHtml(buildingAdminSearch)}"
          placeholder="Buscar por calle, altura o territorio..."
          class="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-blue-800 outline-none" />

        ${
          filteredBuildings.length === 0
            ? `<p class="text-xs text-slate-500 text-center py-4">No hay edificios que coincidan.</p>`
            : `<div class="space-y-1.5 max-h-[420px] overflow-y-auto pr-0.5">
                ${filteredBuildings
                  .map((b) => {
                    const sub = state.subterritories.find((s) => s.id === b.subterritory_id);
                    const subLabel = sub?.code || b.terr_subterritories?.code || '';
                    return `
                      <div class="flex items-center justify-between gap-2 bg-slate-50 px-3 py-2.5 rounded-xl border border-slate-200 text-xs">
                        <div class="min-w-0">
                          <div class="font-bold text-slate-900 truncate">
                            ${escapeHtml(b.street)} ${escapeHtml(b.street_number)}
                          </div>
                          <div class="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                            ${
                              subLabel
                                ? `<span class="bg-blue-100 text-blue-900 font-bold px-1.5 py-0.5 rounded">Terr. ${escapeHtml(
                                    subLabel
                                  )}</span>`
                                : `<span class="text-amber-700 font-semibold">Sin territorio</span>`
                            }
                            ${b.lat && b.lng ? '<span>📍 GPS</span>' : '<span class="text-slate-400">Sin GPS</span>'}
                          </div>
                        </div>
                        <div class="flex items-center gap-1.5 shrink-0">
                          <button type="button" data-edit-bldg="${b.id}"
                            class="edit-bldg-btn bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold px-2.5 py-1 rounded-lg text-xs"
                            title="Ver timbres y editar edificio">
                            ✎ Editar / Timbres
                          </button>
                          <button type="button" data-del-bldg="${b.id}"
                            class="del-bldg-btn bg-rose-100 hover:bg-rose-200 text-rose-700 font-bold px-2 py-1 rounded-lg text-xs"
                            title="Eliminar edificio y todos sus timbres">
                            ✕
                          </button>
                        </div>
                      </div>
                    `;
                  })
                  .join('')}
              </div>`
        }
      </div>
    </div>
  `;
}

function bindBuildingsAdminEvents(container, onDataChanged) {
  document.querySelectorAll('.approve-rep-btn').forEach((btn) => {
    btn.onclick = async () => {
      const repId = btn.getAttribute('data-approve-rep');
      const rep = pendingReports.find((x) => x.id === repId);
      if (!rep) return;

      btn.disabled = true;
      btn.textContent = 'Ubicando dirección...';

      const subId = document.getElementById(`rep-sub-${repId}`)?.value || null;
      const aptsRaw = document.getElementById(`rep-apts-${repId}`)?.value || '';
      const aptList = aptsRaw
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);

      const coords =
        rep.lat && rep.lng
          ? { lat: rep.lat, lng: rep.lng }
          : await geocodeAddress(rep.street, rep.street_number);

      const { data: newBldg, error } = await supabase
        .from('terr_buildings')
        .insert({
          congregation_id: state.congregation.id,
          subterritory_id: subId,
          street: rep.street,
          street_number: rep.street_number,
          lat: coords.lat,
          lng: coords.lng,
          status: 'active'
        })
        .select()
        .single();

      if (error || !newBldg) {
        showToast('Error al aprobar edificio: ' + (error?.message || ''), 'error');
        btn.disabled = false;
        btn.textContent = '✓ Geocodificar y Aprobar';
        return;
      }

      if (aptList.length > 0) {
        await supabase.from('terr_apartments').insert(
          aptList.map((label) => ({
            congregation_id: state.congregation.id,
            building_id: newBldg.id,
            label,
            status: 'active'
          }))
        );
      }

      await supabase
        .from('terr_new_building_reports')
        .update({ status: 'approved' })
        .eq('id', repId);

      showToast(
        coords.lat
          ? 'Edificio ubicado en GPS y aprobado'
          : 'Edificio aprobado (no se halló altura exacta en mapa)',
        'success'
      );
      if (onDataChanged) await onDataChanged();
    };
  });

  document.querySelectorAll('.reject-rep-btn').forEach((btn) => {
    btn.onclick = async () => {
      const repId = btn.getAttribute('data-reject-rep');
      await supabase
        .from('terr_new_building_reports')
        .update({ status: 'rejected' })
        .eq('id', repId);
      showToast('Reporte descartado', 'info');
      await loadAdminData();
      renderAdminView(container, onDataChanged);
    };
  });

  // Buscador de edificios cargados
  const searchInput = document.getElementById('admin-bldg-search');
  if (searchInput) {
    searchInput.oninput = (e) => {
      buildingAdminSearch = e.target.value;
      renderAdminView(container, onDataChanged);
      const inp = document.getElementById('admin-bldg-search');
      if (inp) {
        inp.focus();
        inp.setSelectionRange(inp.value.length, inp.value.length);
      }
    };
  }

  // Botones Editar edificio (carga todos sus timbres para revisarlos)
  document.querySelectorAll('.edit-bldg-btn').forEach((btn) => {
    btn.onclick = async () => {
      editingBuildingId = btn.getAttribute('data-edit-bldg');
      editingBuildingApartments = [];
      renderAdminView(container, onDataChanged);
      document.getElementById('edit-building-card')?.scrollIntoView({ behavior: 'smooth' });
      await fetchBuildingApartmentsForAdmin(editingBuildingId);
      renderAdminView(container, onDataChanged);
    };
  });

  // Renombrar un timbre individual
  document.querySelectorAll('.rename-apt-btn').forEach((btn) => {
    btn.onclick = async () => {
      const aptId = btn.getAttribute('data-rename-apt');
      const oldLabel = btn.getAttribute('data-apt-label') || '';
      const newLabel = prompt('Nuevo nombre o número para este timbre:', oldLabel);
      if (!newLabel || newLabel.trim() === '' || newLabel.trim() === oldLabel) return;

      const { error } = await supabase
        .from('terr_apartments')
        .update({ label: newLabel.trim() })
        .eq('id', aptId);

      if (error) {
        showToast('Error al renombrar timbre: ' + error.message, 'error');
        return;
      }

      showToast(`Timbre actualizado a "${newLabel.trim()}"`, 'success');
      await fetchBuildingApartmentsForAdmin(editingBuildingId);
      renderAdminView(container, onDataChanged);
    };
  });

  // Eliminar un timbre individual (limpiando primero su historial en terr_apartment_logs)
  document.querySelectorAll('.del-apt-btn').forEach((btn) => {
    btn.onclick = async () => {
      const aptId = btn.getAttribute('data-del-apt');
      const aptLabel = btn.getAttribute('data-apt-label') || '';
      if (!confirm(`¿Eliminar el timbre "${aptLabel}" de este edificio?`)) return;

      await supabase.from('terr_apartment_logs').delete().eq('apartment_id', aptId);
      const { error } = await supabase.from('terr_apartments').delete().eq('id', aptId);

      if (error) {
        showToast('Error al eliminar timbre: ' + error.message, 'error');
        return;
      }

      showToast(`Timbre "${aptLabel}" eliminado`, 'info');
      await fetchBuildingApartmentsForAdmin(editingBuildingId);
      renderAdminView(container, onDataChanged);
    };
  });

  const cancelEditBldgBtn = document.getElementById('btn-cancel-edit-bldg');
  if (cancelEditBldgBtn) {
    cancelEditBldgBtn.onclick = () => {
      editingBuildingId = null;
      editingBuildingApartments = [];
      renderAdminView(container, onDataChanged);
    };
  }

  const saveEditBldgBtn = document.getElementById('btn-save-edit-bldg');
  if (saveEditBldgBtn && editingBuildingId) {
    saveEditBldgBtn.onclick = async () => {
      const street = document.getElementById('edit-bldg-street').value.trim();
      const streetNumber = document.getElementById('edit-bldg-number').value.trim();
      const subId = document.getElementById('edit-bldg-sub').value || null;
      const newAptsRaw = document.getElementById('edit-bldg-new-apts').value.trim();
      const regeocode = document.getElementById('edit-bldg-regeocode').checked;

      if (!street || !streetNumber) {
        showToast('Completá calle y altura', 'error');
        return;
      }

      saveEditBldgBtn.disabled = true;
      saveEditBldgBtn.textContent = 'Guardando cambios...';

      const payload = {
        street,
        street_number: streetNumber,
        subterritory_id: subId
      };

      if (regeocode) {
        const coords = await geocodeAddress(street, streetNumber);
        if (coords.lat && coords.lng) {
          payload.lat = coords.lat;
          payload.lng = coords.lng;
        }
      }

      const { error } = await supabase
        .from('terr_buildings')
        .update(payload)
        .eq('id', editingBuildingId);

      if (error) {
        showToast('Error al actualizar edificio: ' + error.message, 'error');
        saveEditBldgBtn.disabled = false;
        saveEditBldgBtn.textContent = '💾 Guardar Cambios del Edificio';
        return;
      }

      if (newAptsRaw) {
        const newLabels = newAptsRaw
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);
        if (newLabels.length > 0) {
          await supabase.from('terr_apartments').insert(
            newLabels.map((label) => ({
              congregation_id: state.congregation.id,
              building_id: editingBuildingId,
              label,
              status: 'active'
            }))
          );
        }
      }

      showToast('Edificio actualizado correctamente', 'success');
      await fetchBuildingApartmentsForAdmin(editingBuildingId);
      if (onDataChanged) await onDataChanged();
      renderAdminView(container, onDataChanged);
    };
  }

  // Botones Eliminar edificio en cascada (logs -> departamentos -> edificio)
  document.querySelectorAll('.del-bldg-btn').forEach((btn) => {
    btn.onclick = async () => {
      const bId = btn.getAttribute('data-del-bldg');
      const bldg = (state.buildings || []).find((x) => x.id === bId);
      const label = bldg ? `${bldg.street} ${bldg.street_number}` : 'este edificio';

      if (
        !confirm(
          `¿Seguro que querés eliminar "${label}" y todos sus departamentos e historial?`
        )
      ) {
        return;
      }

      btn.disabled = true;
      btn.textContent = '...';

      const { data: apts } = await supabase
        .from('terr_apartments')
        .select('id')
        .eq('building_id', bId);

      const aptIds = (apts || []).map((a) => a.id);
      if (aptIds.length > 0) {
        await supabase.from('terr_apartment_logs').delete().in('apartment_id', aptIds);
        const { error: delAptsErr } = await supabase
          .from('terr_apartments')
          .delete()
          .eq('building_id', bId);

        if (delAptsErr) {
          showToast('Error al eliminar departamentos: ' + delAptsErr.message, 'error');
          btn.disabled = false;
          btn.textContent = '✕';
          return;
        }
      }

      const { error: delBldgErr } = await supabase
        .from('terr_buildings')
        .delete()
        .eq('id', bId);

      if (delBldgErr) {
        showToast('Error al eliminar edificio: ' + delBldgErr.message, 'error');
        btn.disabled = false;
        btn.textContent = '✕';
        return;
      }

      if (editingBuildingId === bId) {
        editingBuildingId = null;
        editingBuildingApartments = [];
      }

      showToast(`Edificio "${label}" eliminado por completo`, 'info');
      if (onDataChanged) await onDataChanged();
      renderAdminView(container, onDataChanged);
    };
  });

  bindImportadorEvents(onDataChanged);
}
