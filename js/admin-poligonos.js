import { supabase } from './supabase.js';
import { state } from './state.js';
import { showToast, escapeHtml } from './ui-helpers.js';

// Estado del mapeador poligonal por calles (creación y edición)
let polyPreviewCoords = [];
let polyStreetNames = [];
let polyPreviewMap = null;
let manualClickMode = false;
let editingPolygonState = null; // { type: 'territory'|'subterritory'|'block', id, name, parentTerritoryId, parentSubterritoryId }

export function renderPolygonMapperHtml() {
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

export function bindPolygonMapperEvents(refreshView, onDataChanged) {
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
      refreshView();
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
      refreshView();
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
      refreshView();
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
