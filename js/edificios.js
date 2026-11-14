import { supabase } from './supabase.js';
import { state } from './state.js';
import {
  showToast,
  getDistanceMeters,
  formatRelativeDate,
  escapeHtml
} from './ui-helpers.js';

let searchQuery = '';
let selectedBuilding = null;
let buildingApartments = [];
let showNewReportModal = false;

export async function loadBuildings() {
  if (!state.congregation?.id) return;
  const { data, error } = await supabase
    .from('terr_buildings')
    .select('*, terr_subterritories(code)')
    .eq('congregation_id', state.congregation.id)
    .eq('status', 'active')
    .order('street', { ascending: true });

  if (!error) {
    state.buildings = data || [];
  }
}

export function renderEdificiosView(container) {
  if (selectedBuilding) {
    renderIntercomBoard(container);
    return;
  }

  let list = state.buildings.map((b) => ({
    ...b,
    distance: state.userLocation
      ? getDistanceMeters(state.userLocation.lat, state.userLocation.lng, b.lat, b.lng)
      : null
  }));

  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    list = list.filter(
      (b) =>
        b.street.toLowerCase().includes(q) ||
        String(b.street_number).includes(q) ||
        (b.terr_subterritories?.code || '').toLowerCase().includes(q)
    );
  } else if (state.userLocation) {
    list.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  }

  const nearbyCount = list.filter((b) => b.distance !== null && b.distance <= 300).length;

  container.innerHTML = `
    <div class="space-y-4 pb-24">
      <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
        <div class="flex gap-2">
          <button id="btn-gps-radar"
            class="flex-1 bg-blue-900 hover:bg-blue-800 active:scale-[0.99] text-white font-bold py-3 px-4 rounded-xl text-sm flex items-center justify-center gap-2 shadow-sm transition">
            <span>📡</span>
            <span>${state.userLocation ? `Radar GPS (${nearbyCount} cerca)` : 'Edificios cerca de mí'}</span>
          </button>
          <button id="btn-report-building"
            class="bg-amber-500 hover:bg-amber-400 active:scale-[0.99] text-slate-950 font-bold py-3 px-3.5 rounded-xl text-sm flex items-center gap-1 shadow-sm transition"
            title="Reportar edificio nuevo">
            <span>➕🏢</span>
          </button>
        </div>

        <input type="search" id="building-search" value="${escapeHtml(searchQuery)}"
          placeholder="Buscar por calle, altura o territorio..."
          class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-blue-800 outline-none" />
      </div>

      ${
        list.length === 0
          ? `<div class="bg-white p-8 rounded-2xl text-center text-slate-500 border border-slate-200">
              <p class="font-semibold">No se encontraron edificios</p>
              <p class="text-xs mt-1">Probá otra búsqueda o reportá un edificio nuevo con el botón ➕🏢.</p>
            </div>`
          : `<div class="space-y-2.5">
              ${list
                .slice(0, 60)
                .map((b) => {
                  const isNear = b.distance !== null && b.distance <= 300;
                  return `
                    <button data-building-id="${b.id}"
                      class="open-building-btn w-full text-left bg-white hover:bg-blue-50/40 active:scale-[0.99] p-4 rounded-2xl shadow-sm border ${
                        isNear ? 'border-emerald-300 ring-1 ring-emerald-200' : 'border-slate-200'
                      } flex items-center justify-between transition">
                      <div>
                        <div class="font-extrabold text-slate-900 text-base">
                          ${escapeHtml(b.street)} ${escapeHtml(b.street_number)}
                        </div>
                        <div class="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                          ${
                            b.terr_subterritories?.code
                              ? `<span class="bg-slate-100 text-slate-700 font-bold px-2 py-0.5 rounded-md">Terr. ${escapeHtml(
                                  b.terr_subterritories.code
                                )}</span>`
                              : ''
                          }
                          ${
                            b.distance !== null && b.distance !== Infinity
                              ? `<span class="${
                                  isNear ? 'text-emerald-700 font-bold' : 'text-slate-400'
                                }">📍 a ${b.distance} m</span>`
                              : ''
                          }
                        </div>
                      </div>
                      <span class="text-blue-900 font-bold text-sm">Abrir →</span>
                    </button>
                  `;
                })
                .join('')}
            </div>`
      }
    </div>
    ${showNewReportModal ? renderNewBuildingModalHtml() : ''}
  `;

  document.getElementById('btn-gps-radar').onclick = () => {
    if (!navigator.geolocation) {
      showToast('Tu navegador no soporta GPS', 'error');
      return;
    }
    showToast('Buscando ubicación GPS...', 'info');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        showToast('Edificios ordenados por cercanía', 'success');
        renderEdificiosView(container);
      },
      () => showToast('Activá el permiso de ubicación en el celular', 'error'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  document.getElementById('building-search').oninput = (e) => {
    searchQuery = e.target.value;
    renderEdificiosView(container);
    const input = document.getElementById('building-search');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  };

  document.getElementById('btn-report-building').onclick = () => {
    showNewReportModal = true;
    renderEdificiosView(container);
  };

  document.querySelectorAll('.open-building-btn').forEach((btn) => {
    btn.onclick = async () => {
      const bId = btn.getAttribute('data-building-id');
      selectedBuilding = state.buildings.find((x) => x.id === bId) || null;
      if (selectedBuilding) {
        await fetchBuildingApartments(selectedBuilding.id);
        renderEdificiosView(container);
      }
    };
  });

  if (showNewReportModal) {
    bindNewBuildingModalEvents(container);
  }
}

async function fetchBuildingApartments(buildingId) {
  const { data, error } = await supabase
    .from('terr_apartments')
    .select('*')
    .eq('building_id', buildingId)
    .eq('status', 'active')
    .order('last_visited_at', { ascending: true, nullsFirst: true })
    .order('label', { ascending: true });

  if (error) {
    showToast('Error cargando departamentos', 'error');
    buildingApartments = [];
    return;
  }

  const now = Date.now();
  buildingApartments = (data || []).filter(
    (apt) => !apt.skipped_until || new Date(apt.skipped_until).getTime() <= now
  );
}

function renderIntercomBoard(container) {
  container.innerHTML = `
    <div class="space-y-4 pb-24">
      <div class="bg-blue-950 text-white p-4 rounded-2xl shadow-md flex items-center justify-between">
        <div>
          <button id="btn-back-buildings" class="text-xs font-bold text-blue-200 hover:text-white mb-1">
            ← Volver a edificios
          </button>
          <h2 class="text-xl font-extrabold">
            ${escapeHtml(selectedBuilding.street)} ${escapeHtml(selectedBuilding.street_number)}
          </h2>
          <p class="text-xs text-blue-200 mt-0.5">
            ${buildingApartments.length} timbres pendientes en cola
          </p>
        </div>
        <button id="btn-refresh-apts" class="bg-blue-800 hover:bg-blue-700 p-2.5 rounded-xl text-sm font-bold">
          🔄
        </button>
      </div>

      ${
        buildingApartments.length === 0
          ? `<div class="bg-emerald-50 border border-emerald-200 p-8 rounded-2xl text-center">
              <div class="text-4xl mb-2">✅</div>
              <h3 class="font-extrabold text-emerald-900 text-lg">¡Edificio al día!</h3>
              <p class="text-sm text-emerald-700 mt-1">
                No quedan timbres pendientes o salteados para tocar ahora.
              </p>
            </div>`
          : `<div class="space-y-3">
              ${buildingApartments
                .map(
                  (apt) => `
                  <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
                    <div class="flex items-center justify-between">
                      <span class="text-2xl font-black text-slate-900 tracking-tight">
                        Timbre ${escapeHtml(apt.label)}
                      </span>
                      <span class="text-xs font-semibold px-2.5 py-1 rounded-full ${
                        !apt.last_visited_at
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-slate-100 text-slate-600'
                      }">
                        ${formatRelativeDate(apt.last_visited_at)}
                      </span>
                    </div>

                    <div class="grid grid-cols-4 gap-2">
                      <button data-apt="${apt.id}" data-action="answered"
                        class="apt-action-btn min-h-[52px] bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold rounded-xl text-xs flex flex-col items-center justify-center shadow-sm transition">
                        <span class="text-base">✅</span>
                        <span>Atendió</span>
                      </button>

                      <button data-apt="${apt.id}" data-action="no_answer"
                        class="apt-action-btn min-h-[52px] bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 font-bold rounded-xl text-xs flex flex-col items-center justify-center shadow-sm transition">
                        <span class="text-base">🔔</span>
                        <span>No cont.</span>
                      </button>

                      <button data-apt="${apt.id}" data-action="skipped"
                        class="apt-action-btn min-h-[52px] bg-slate-200 hover:bg-slate-300 active:scale-95 text-slate-800 font-bold rounded-xl text-xs flex flex-col items-center justify-center transition">
                        <span class="text-base">⏭️</span>
                        <span>Saltear</span>
                      </button>

                      <button data-apt="${apt.id}" data-label="${escapeHtml(apt.label)}"
                        class="apt-config-btn min-h-[52px] bg-slate-100 hover:bg-rose-100 text-slate-600 hover:text-rose-700 font-bold rounded-xl text-xs flex flex-col items-center justify-center border border-slate-200 transition">
                        <span class="text-base">⚙️</span>
                        <span>Estado</span>
                      </button>
                    </div>
                  </div>
                `
                )
                .join('')}
            </div>`
      }
    </div>
  `;

  document.getElementById('btn-back-buildings').onclick = () => {
    selectedBuilding = null;
    renderEdificiosView(container);
  };

  document.getElementById('btn-refresh-apts').onclick = async () => {
    await fetchBuildingApartments(selectedBuilding.id);
    renderEdificiosView(container);
  };

  document.querySelectorAll('.apt-action-btn').forEach((btn) => {
    btn.onclick = async () => {
      const aptId = btn.getAttribute('data-apt');
      const action = btn.getAttribute('data-action');
      await handleApartmentAction(aptId, action, container);
    };
  });

  document.querySelectorAll('.apt-config-btn').forEach((btn) => {
    btn.onclick = async () => {
      const aptId = btn.getAttribute('data-apt');
      const label = btn.getAttribute('data-label');
      const choice = prompt(
        `Timbre ${label}:\nEscribí 1 para marcar "NO VISITAR"\nEscribí 2 para marcar "NO EXISTE"`
      );
      if (choice === '1') {
        await handleApartmentAction(aptId, 'do_not_visit', container);
      } else if (choice === '2') {
        await handleApartmentAction(aptId, 'does_not_exist', container);
      }
    };
  });
}

async function handleApartmentAction(aptId, action, container) {
  const nowIso = new Date().toISOString();
  let updatePayload = {};

  if (action === 'answered' || action === 'no_answer') {
    updatePayload = { last_visited_at: nowIso, skipped_until: null };
  } else if (action === 'skipped') {
    const skip48h = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    updatePayload = { skipped_until: skip48h };
  } else if (action === 'do_not_visit') {
    updatePayload = { status: 'do_not_visit' };
  } else if (action === 'does_not_exist') {
    updatePayload = { status: 'does_not_exist' };
  }

  const { error } = await supabase
    .from('terr_apartments')
    .update(updatePayload)
    .eq('id', aptId);

  if (error) {
    showToast('Error al guardar: ' + error.message, 'error');
    return;
  }

  await supabase.from('terr_apartment_logs').insert({
    congregation_id: state.congregation.id,
    apartment_id: aptId,
    user_id: state.profile.id,
    action
  });

  // Actualizar cola en pantalla inmediatamente
  buildingApartments = buildingApartments.filter((a) => a.id !== aptId);
  const labels = {
    answered: 'Registrado: Atendieron',
    no_answer: 'Registrado: No contestaron',
    skipped: 'Salteado por 48 horas',
    do_not_visit: 'Marcado como No Visitar',
    does_not_exist: 'Marcado como No Existe'
  };
  showToast(labels[action] || 'Guardado', 'success');
  renderEdificiosView(container);
}

function renderNewBuildingModalHtml() {
  return `
    <div class="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4">
      <div class="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-extrabold text-slate-900">Reportar Edificio Nuevo</h3>
          <button id="close-new-bldg-modal" class="text-slate-400 hover:text-slate-700 text-xl font-bold">✕</button>
        </div>

        <form id="new-building-report-form" class="space-y-3">
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">Calle</label>
            <input type="text" id="rep-bldg-street" required placeholder="Ej: Av. Independencia"
              class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm" />
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">Altura / Número</label>
            <input type="text" id="rep-bldg-number" required placeholder="Ej: 2450"
              class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm" />
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">Foto del portero eléctrico (opcional)</label>
            <input type="file" id="rep-bldg-photo" accept="image/*" capture="environment"
              class="w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-900 file:font-bold" />
          </div>
          <button type="submit" id="btn-submit-bldg-report"
            class="w-full bg-blue-900 hover:bg-blue-800 text-white font-bold py-3 rounded-xl text-sm shadow">
            Enviar al Administrador con GPS
          </button>
        </form>
      </div>
    </div>
  `;
}

function bindNewBuildingModalEvents(container) {
  document.getElementById('close-new-bldg-modal').onclick = () => {
    showNewReportModal = false;
    renderEdificiosView(container);
  };

  document.getElementById('new-building-report-form').onsubmit = async (e) => {
    e.preventDefault();
    const street = document.getElementById('rep-bldg-street').value.trim();
    const streetNumber = document.getElementById('rep-bldg-number').value.trim();
    const photoFile = document.getElementById('rep-bldg-photo').files[0];
    const btn = document.getElementById('btn-submit-bldg-report');

    btn.disabled = true;
    btn.textContent = 'Obteniendo GPS y enviando...';

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        let photoUrl = null;
        if (photoFile) {
          const ext = photoFile.name.split('.').pop() || 'jpg';
          const filePath = `${state.congregation.id}/${Date.now()}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from('terr-building-photos')
            .upload(filePath, photoFile);

          if (!upErr) {
            const { data: pub } = supabase.storage
              .from('terr-building-photos')
              .getPublicUrl(filePath);
            photoUrl = pub?.publicUrl || null;
          }
        }

        const { error } = await supabase.from('terr_new_building_reports').insert({
          congregation_id: state.congregation.id,
          street,
          street_number: streetNumber,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          photo_url: photoUrl,
          reported_by: state.profile.id,
          status: 'pending'
        });

        if (error) {
          showToast('Error al enviar reporte: ' + error.message, 'error');
          btn.disabled = false;
          btn.textContent = 'Enviar al Administrador con GPS';
          return;
        }

        showToast('¡Edificio reportado! El administrador lo revisará.', 'success');
        showNewReportModal = false;
        renderEdificiosView(container);
      },
      () => {
        showToast('Necesitamos tu ubicación GPS para ubicar el edificio', 'error');
        btn.disabled = false;
        btn.textContent = 'Enviar al Administrador con GPS';
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };
}
