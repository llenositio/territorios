import { supabase } from './supabase.js';
import { state } from './state.js';
import { showToast, escapeHtml } from './ui-helpers.js';
import { buildHermanosSelectOptions } from './admin.js';

export function renderGeneralAdminHtml(superMode, { congregationsList, hermanosCongList }) {
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

export function bindGeneralAdminEvents(refreshView, onDataChanged, superMode) {
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
      refreshView();
    }
  };

  document.querySelectorAll('.del-mp-btn').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-del-mp');
      await supabase.from('terr_meeting_points').delete().eq('id', id);
      state.meetingPoints = state.meetingPoints.filter((x) => x.id !== id);
      refreshView();
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
