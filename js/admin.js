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
let adminSubTab = 'general';

// Estado del mapeador poligonal por calles
let polyPreviewCoords = [];
let polyStreetNames = [];
let polyPreviewMap = null;

export async function loadAdminData() {
  if (!state.congregation?.id) return;

  const [usersRes, repRes] = await Promise.all([
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
      .order('created_at', { ascending: false })
  ]);

  if (!usersRes.error) {
    allCongUsers = usersRes.data || [];
    pendingUsers = allCongUsers.filter((u) => u.status === 'pending');
  }
  if (!repRes.error) {
    pendingReports = repRes.data || [];
  }

  if (isSuperadmin()) {
    const { data: congs } = await supabase
      .from('congregaciones')
      .select('id, nombre')
      .order('nombre');
    congregationsList = congs || [];
  }
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
  if (adminSubTab === 'usuarios') bindUsersAdminEvents(container);
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
                <input type="text" id="sa-fullname" required placeholder="Nombre completo del hermano"
                  class="w-full px-3 py-2 rounded-xl text-slate-900 text-xs" />
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
      const fullName = document.getElementById('sa-fullname').value.trim();
      const username = document.getElementById('sa-username').value.trim();
      const password = document.getElementById('sa-password').value;

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

      showToast(`Admin "${username}" creado correctamente`, 'success');
      document.getElementById('create-admin-form').reset();
    };
  }
}

// ============================================================================
// SUBPESTAÑA 2: MAPEADOR POR CALLES PERIMETRALES
// ============================================================================
function renderPolygonMapperHtml() {
  const city = state.settings?.city || 'Mar del Plata';

  return `
    <div class="space-y-4">
      <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
        <div>
          <h3 class="text-base font-extrabold text-slate-900">🗺️ Mapear por Calles Perimetrales</h3>
          <p class="text-xs text-slate-500 mt-0.5">
            Ingresá las calles en orden alrededor del perímetro (3, 4, 8 o las que formen el polígono).
            El sistema detectará las intersecciones en <b>${escapeHtml(city)}</b>.
          </p>
        </div>

        <div class="space-y-2.5">
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">¿Qué querés mapear?</label>
            <select id="poly-entity-type"
              class="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-xs font-bold bg-white">
              <option value="territory">Territorio asignado a la congregación (${escapeHtml(
                state.congregation?.nombre || ''
              )})</option>
              <option value="subterritory" selected>Territorios (numerados, ej: 26)</option>
              <option value="block">Manzana (con letra, ej: A, B, E)</option>
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
                .map((t) => `<option value="${t.id}">${escapeHtml(t.code_or_name)}</option>`)
                .join('')}
            </select>
          </div>

          <div id="poly-parent-subterritory-box" class="hidden">
            <label class="block text-xs font-bold text-slate-700 mb-1">Pertenece al Territorio *</label>
            <select id="poly-parent-subterritory"
              class="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white">
              <option value="">-- Elegir Territorio --</option>
              ${state.subterritories
                .map((s) => `<option value="${s.id}">Territorio ${escapeHtml(s.code)}</option>`)
                .join('')}
            </select>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div>
              <label id="poly-name-label" class="block text-xs font-bold text-slate-700 mb-1">
                Número de Territorio (ej: 26)
              </label>
              <input type="text" id="poly-entity-name" placeholder="Ej: 26"
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
              placeholder="Ej: 3 de Febrero, Santa Fe, Av Colón, Córdoba, Alvarado, 20 de Septiembre, Av Pedro Luro, Av Independencia"
              class="w-full p-3 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-blue-800 outline-none">${escapeHtml(
                polyStreetNames.join(', ')
              )}</textarea>
          </div>

          <button type="button" id="btn-calc-polygon"
            class="w-full bg-blue-900 hover:bg-blue-800 text-white font-bold py-3 rounded-xl text-xs shadow transition">
            🔍 Calcular intersecciones y previsualizar en mapa
          </button>
        </div>

        <div id="poly-preview-section" class="${polyPreviewCoords.length >= 3 ? '' : 'hidden'} space-y-2.5 pt-2">
          <div class="flex items-center justify-between text-xs">
            <span id="poly-preview-status" class="font-bold text-emerald-700">
              ✅ Polígono de ${polyPreviewCoords.length} lados listo (podés arrastrar los puntos para ajustar)
            </span>
          </div>
          <div id="admin-poly-map" class="w-full h-64 rounded-xl border border-slate-300 z-10"></div>
          <button type="button" id="btn-save-polygon"
            class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold py-3 rounded-xl text-sm shadow">
            💾 Guardar en la Congregación
          </button>
        </div>
      </div>

      <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-2">
        <h4 class="text-xs font-extrabold uppercase text-slate-500">
          Cargado en la Congregación
        </h4>
        <div class="text-xs text-slate-600 space-y-1">
          <div>• <b>Territorio asignado a la congregación:</b> ${state.territories.length}</div>
          <div>• <b>Territorios:</b> ${state.subterritories.length}</div>
          <div>• <b>Manzanas:</b> ${state.blocks.length} (${state.blockFaces.length} cuadras)</div>
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

// UNA sola consulta unificada a Overpass para todo el perímetro (evita bloqueo 429)
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
      return `way(around:18000,${centerLat},${centerLon})["highway"]["name"~"${rx}",i]->.s${idx};`;
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

  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: 'data=' + encodeURIComponent(singleBatchQuery)
    });
    const data = await res.json();
    const nodes = (data.elements || [])
      .filter((el) => el.type === 'node')
      .map((n) => [n.lat, n.lon]);

    const cleanCorners = deduplicateCorners(nodes);
    if (cleanCorners.length >= 3) {
      return cleanCorners;
    }
  } catch (e) {
    console.warn('Error en consulta Overpass unificada:', e);
  }

  return [];
}

function initAdminPolyPreviewMap() {
  const mapEl = document.getElementById('admin-poly-map');
  if (!mapEl || typeof window.L === 'undefined' || polyPreviewCoords.length < 3) return;

  if (polyPreviewMap) {
    polyPreviewMap.remove();
    polyPreviewMap = null;
  }

  polyPreviewMap = window.L.map('admin-poly-map').setView(polyPreviewCoords[0], 15);
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(polyPreviewMap);

  const polygonLayer = window.L.polygon(polyPreviewCoords, {
    color: '#1e3a8a',
    fillColor: '#3b82f6',
    fillOpacity: 0.25,
    weight: 4
  }).addTo(polyPreviewMap);

  polyPreviewCoords.forEach((pt, idx) => {
    const nextStreet = polyStreetNames[(idx + 1) % polyStreetNames.length] || '';
    const marker = window.L.marker(pt, {
      draggable: true,
      title: `Esquina: ${polyStreetNames[idx] || ''} y ${nextStreet}`
    }).addTo(polyPreviewMap);

    marker.bindPopup(
      `<b>Esquina ${idx + 1}</b><br>${escapeHtml(polyStreetNames[idx] || '')} y ${escapeHtml(nextStreet)}`
    );

    marker.on('dragend', (ev) => {
      const pos = ev.target.getLatLng();
      polyPreviewCoords[idx] = [pos.lat, pos.lng];
      polygonLayer.setLatLngs(polyPreviewCoords);
    });
  });

  polyPreviewMap.fitBounds(polygonLayer.getBounds(), { padding: [25, 25] });
}

function bindPolygonMapperEvents(container, onDataChanged) {
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

  if (polyPreviewCoords.length >= 3) {
    setTimeout(initAdminPolyPreviewMap, 50);
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
    btn.textContent = `Buscando ${streets.length} esquinas en 1 consulta...`;

    const coords = await findAllPerimeterIntersections(streets, city);

    btn.disabled = false;
    btn.textContent = '🔍 Calcular intersecciones y previsualizar en mapa';

    if (coords.length < 3) {
      showToast('No se pudieron detectar las esquinas automáticamente. Revisá los nombres de calles.', 'error');
      return;
    }

    polyStreetNames = streets;
    polyPreviewCoords = coords;
    document.getElementById('poly-preview-status').textContent =
      `✅ Polígono de ${coords.length} lados listo (podés arrastrar los puntos para ajustar)`;
    document.getElementById('poly-preview-section').classList.remove('hidden');
    initAdminPolyPreviewMap();
    showToast(`Polígono calculado con ${coords.length} vértices`, 'success');
  };

  document.getElementById('btn-save-polygon').onclick = async () => {
    const entityType = typeSelect.value;
    const entityName = nameInput.value.trim();

    if (!entityName) {
      showToast('Ingresá el nombre, número o letra antes de guardar', 'error');
      return;
    }
    if (polyPreviewCoords.length < 3) {
      showToast('Primero calculá el polígono en el mapa', 'error');
      return;
    }

    const saveBtn = document.getElementById('btn-save-polygon');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando...';

    if (entityType === 'territory') {
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
    } else if (entityType === 'subterritory') {
      const parentTerrId = document.getElementById('poly-parent-territory').value || null;
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
    } else if (entityType === 'block') {
      const subId = document.getElementById('poly-parent-subterritory').value;
      if (!subId) {
        showToast('Elegí a qué Territorio pertenece esta manzana', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 Guardar en la Congregación';
        return;
      }

      const avgLat =
        polyPreviewCoords.reduce((acc, p) => acc + p[0], 0) / polyPreviewCoords.length;
      const avgLng =
        polyPreviewCoords.reduce((acc, p) => acc + p[1], 0) / polyPreviewCoords.length;

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
        const streetLabel = polyStreetNames[(i + 1) % polyStreetNames.length] || `Cara ${i + 1}`;
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

    polyPreviewCoords = [];
    polyStreetNames = [];
    if (onDataChanged) await onDataChanged();
  };
}

// ============================================================================
// SUBPESTAÑA 3: GESTIÓN DE USUARIOS
// ============================================================================
function renderUsersAdminHtml() {
  return `
    <div class="space-y-4">
      ${
        pendingUsers.length > 0
          ? `<div class="bg-amber-50 border border-amber-300 p-4 rounded-2xl space-y-2.5">
              <h3 class="text-sm font-extrabold text-amber-950">⏳ Solicitudes Pendientes (${pendingUsers.length})</h3>
              ${pendingUsers
                .map(
                  (u) => `
                  <div class="bg-white p-3 rounded-xl border border-amber-200 flex items-center justify-between gap-2">
                    <div>
                      <div class="font-bold text-sm text-slate-900">${escapeHtml(u.full_name || 'Sin nombre')}</div>
                      <div class="text-xs text-slate-500">${escapeHtml(u.email)}</div>
                    </div>
                    <div class="flex gap-1.5">
                      <button data-approve-user="${u.id}"
                        class="approve-user-btn bg-emerald-600 text-white font-bold px-3 py-1.5 rounded-lg text-xs">
                        Aprobar
                      </button>
                      <button data-block-user="${u.id}"
                        class="block-user-btn bg-rose-100 text-rose-700 font-bold px-2.5 py-1.5 rounded-lg text-xs">
                        Rechazar
                      </button>
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
            <div class="flex items-center justify-between py-2 border-b border-slate-100 last:border-0 text-xs">
              <div>
                <div class="font-bold text-slate-900">${escapeHtml(u.full_name || u.email)}</div>
                <div class="text-slate-400">${escapeHtml(u.email)}</div>
              </div>
              <select data-role-user="${u.id}"
                class="change-role-select px-2.5 py-1.5 rounded-lg border border-slate-300 font-bold bg-white">
                <option value="publicador" ${u.role === 'publicador' ? 'selected' : ''}>Publicador</option>
                <option value="conductor" ${u.role === 'conductor' ? 'selected' : ''}>Conductor</option>
                <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
              </select>
            </div>
          `
          )
          .join('')}
      </div>
    </div>
  `;
}

function bindUsersAdminEvents(container) {
  document.querySelectorAll('.approve-user-btn').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-approve-user');
      await supabase.from('terr_users').update({ status: 'approved' }).eq('id', id);
      showToast('Hermano aprobado', 'success');
      await loadAdminData();
      renderAdminView(container);
    };
  });

  document.querySelectorAll('.block-user-btn').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-block-user');
      await supabase.from('terr_users').update({ status: 'blocked' }).eq('id', id);
      showToast('Solicitud rechazada', 'info');
      await loadAdminData();
      renderAdminView(container);
    };
  });

  document.querySelectorAll('.change-role-select').forEach((sel) => {
    sel.onchange = async () => {
      const id = sel.getAttribute('data-role-user');
      await supabase.from('terr_users').update({ role: sel.value }).eq('id', id);
      showToast('Rol actualizado', 'success');
    };
  });
}

// ============================================================================
// SUBPESTAÑA 4: EDIFICIOS NUEVOS REPORTADOS E IMPORTADOR MASIVO
// ============================================================================
function renderBuildingsAdminHtml() {
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

  bindImportadorEvents(onDataChanged);
}
