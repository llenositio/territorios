import { supabase } from './supabase.js';
import { state } from './state.js';
import { showToast, escapeHtml } from './ui-helpers.js';
import {
  renderImportadorHtml,
  bindImportadorEvents,
  geocodeAddress
} from './importador.js';
import { loadAdminData } from './admin.js';

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

export function renderBuildingsAdminHtml({ pendingReports }) {
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

export function bindBuildingsAdminEvents(refreshView, onDataChanged, { pendingReports }) {
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
      refreshView();
    };
  });

  // Buscador de edificios cargados
  const searchInput = document.getElementById('admin-bldg-search');
  if (searchInput) {
    searchInput.oninput = (e) => {
      buildingAdminSearch = e.target.value;
      refreshView();
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
      refreshView();
      document.getElementById('edit-building-card')?.scrollIntoView({ behavior: 'smooth' });
      await fetchBuildingApartmentsForAdmin(editingBuildingId);
      refreshView();
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
      refreshView();
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
      refreshView();
    };
  });

  const cancelEditBldgBtn = document.getElementById('btn-cancel-edit-bldg');
  if (cancelEditBldgBtn) {
    cancelEditBldgBtn.onclick = () => {
      editingBuildingId = null;
      editingBuildingApartments = [];
      refreshView();
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
      refreshView();
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
      refreshView();
    };
  });

  bindImportadorEvents(onDataChanged);
}
