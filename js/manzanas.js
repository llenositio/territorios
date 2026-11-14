import { supabase } from './supabase.js';
import { state } from './state.js';
import { requestOnDemandGps } from './app.js';
import {
  showToast,
  getDistanceMeters,
  daysAgo,
  formatRelativeDate,
  escapeHtml
} from './ui-helpers.js';

let selectedSubterritoryId = 'ALL';
let leafletMap = null;
let showDnvModal = false;

export async function loadBlocksAndFaces() {
  if (!state.congregation?.id) return;

  const [terrRes, subRes, blkRes, faceRes, dnvRes] = await Promise.all([
    supabase
      .from('terr_territories')
      .select('*')
      .eq('congregation_id', state.congregation.id)
      .order('code_or_name', { ascending: true }),
    supabase
      .from('terr_subterritories')
      .select('*, terr_territories(code_or_name)')
      .eq('congregation_id', state.congregation.id)
      .order('code', { ascending: true }),
    supabase
      .from('terr_blocks')
      .select('*')
      .eq('congregation_id', state.congregation.id)
      .order('name', { ascending: true }),
    supabase
      .from('terr_block_faces')
      .select('*')
      .eq('congregation_id', state.congregation.id)
      .order('street_name', { ascending: true }),
    supabase
      .from('terr_do_not_visit_houses')
      .select('*')
      .eq('congregation_id', state.congregation.id)
  ]);

  if (!terrRes.error) state.territories = terrRes.data || [];
  if (!subRes.error) state.subterritories = subRes.data || [];
  if (!blkRes.error) state.blocks = blkRes.data || [];
  if (!faceRes.error) state.blockFaces = faceRes.data || [];
  if (!dnvRes.error) state.dnvHouses = dnvRes.data || [];
}

function getFaceAgeColor(lastCompletedAt) {
  const days = daysAgo(lastCompletedAt);
  if (days === null || days > 90) {
    return { hex: '#e11d48', badge: 'bg-rose-100 text-rose-800', label: 'Atrasada' };
  }
  if (days > 45) {
    return { hex: '#f59e0b', badge: 'bg-amber-100 text-amber-800', label: 'Intermedia' };
  }
  return { hex: '#10b981', badge: 'bg-emerald-100 text-emerald-800', label: 'Reciente' };
}

export function renderManzanasView(container) {
  // Encender GPS bajo demanda al entrar a Manzanas para alertas de proximidad y mapa en vivo
  if (!state.userLocation) {
    requestOnDemandGps({
      silent: true,
      onSuccess: () => renderManzanasView(container)
    });
  }

  const filteredSubterritories =
    selectedSubterritoryId === 'ALL'
      ? state.subterritories
      : state.subterritories.filter((s) => s.id === selectedSubterritoryId);

  const filteredBlocks =
    selectedSubterritoryId === 'ALL'
      ? state.blocks
      : state.blocks.filter((b) => b.subterritory_id === selectedSubterritoryId);

  const blockIds = new Set(filteredBlocks.map((b) => b.id));
  const filteredFaces = state.blockFaces.filter((f) => blockIds.has(f.block_id));

  container.innerHTML = `
    <div class="space-y-4 pb-24">
      <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
        <div class="flex gap-2">
          <select id="filter-subterritory"
            class="flex-1 px-3 py-2.5 rounded-xl border border-slate-300 text-sm font-bold bg-white">
            <option value="ALL">Todos los territorios (${state.subterritories.length})</option>
            ${state.subterritories
              .map(
                (s) =>
                  `<option value="${s.id}" ${
                    selectedSubterritoryId === s.id ? 'selected' : ''
                  }>Territorio ${escapeHtml(s.code)}</option>`
              )
              .join('')}
          </select>

          <button id="btn-add-dnv"
            class="bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-bold px-3.5 py-2.5 rounded-xl text-xs shadow-sm transition"
            title="Marcar casa No Visitar">
            🚫 Casa
          </button>
        </div>

        <div id="terr-leaflet-map" class="w-full h-64 rounded-xl border border-slate-200 z-10"></div>

        <div class="flex items-center justify-between text-[11px] text-slate-600 px-1">
          <span class="flex items-center gap-1"><i class="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></i> &lt;45 días</span>
          <span class="flex items-center gap-1"><i class="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block"></i> 45-90 días</span>
          <span class="flex items-center gap-1"><i class="w-2.5 h-2.5 rounded-full bg-rose-600 inline-block"></i> &gt;90d / Nunca</span>
          <span class="flex items-center gap-1 font-bold text-rose-700">🚫 ${state.dnvHouses.length} No Visitar</span>
        </div>
      </div>

      <div class="space-y-2.5">
        <h3 class="text-xs font-extrabold uppercase tracking-wider text-slate-500 px-1">
          Cuadras / Caras de Manzana (${filteredFaces.length})
        </h3>

        ${
          filteredFaces.length === 0
            ? `<div class="bg-white p-6 rounded-2xl text-center text-slate-500 border border-slate-200 text-sm">
                No hay manzanas cargadas todavía para este filtro.
              </div>`
            : filteredFaces
                .map((face) => {
                  const block = state.blocks.find((b) => b.id === face.block_id);
                  const sub = state.subterritories.find((s) => s.id === block?.subterritory_id);
                  const colorInfo = getFaceAgeColor(face.last_completed_at);

                  return `
                    <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex items-center justify-between gap-3">
                      <div>
                        <div class="flex items-center gap-2">
                          ${
                            sub
                              ? `<span class="text-[11px] font-extrabold bg-blue-50 text-blue-900 px-2 py-0.5 rounded">T-${escapeHtml(
                                  sub.code
                                )}</span>`
                              : ''
                          }
                          ${
                            block
                              ? `<span class="text-xs font-bold text-slate-500">Mz. ${escapeHtml(
                                  block.name
                                )}</span>`
                              : ''
                          }
                        </div>
                        <div class="font-extrabold text-slate-900 text-base mt-1">
                          ${escapeHtml(face.street_name)} ${escapeHtml(face.number_range || '')}
                        </div>
                        <div class="mt-1">
                          <span class="text-xs font-semibold px-2 py-0.5 rounded-full ${colorInfo.badge}">
                            ${formatRelativeDate(face.last_completed_at)}
                          </span>
                        </div>
                      </div>

                      <button data-face-id="${face.id}"
                        class="complete-face-btn min-h-[48px] bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold px-4 py-2.5 rounded-xl text-xs shadow-sm transition shrink-0">
                        ✓ Hecha hoy
                      </button>
                    </div>
                  `;
                })
                .join('')
        }
      </div>
    </div>
    ${showDnvModal ? renderDnvModalHtml() : ''}
  `;

  initLeafletMap(filteredSubterritories, filteredBlocks, filteredFaces);

  document.getElementById('filter-subterritory').onchange = (e) => {
    selectedSubterritoryId = e.target.value;
    renderManzanasView(container);
  };

  document.getElementById('btn-add-dnv').onclick = () => {
    showDnvModal = true;
    renderManzanasView(container);
  };

  document.querySelectorAll('.complete-face-btn').forEach((btn) => {
    btn.onclick = async () => {
      const faceId = btn.getAttribute('data-face-id');
      await markFaceCompleted(faceId, container);
    };
  });

  if (showDnvModal) {
    bindDnvModalEvents(container);
  }
}

function initLeafletMap(subterritories, blocks, faces) {
  const mapEl = document.getElementById('terr-leaflet-map');
  if (!mapEl || typeof window.L === 'undefined') return;

  if (leafletMap) {
    leafletMap.remove();
    leafletMap = null;
  }

  const defaultLat = state.userLocation?.lat || -38.0055;
  const defaultLng = state.userLocation?.lng || -57.5426;

  leafletMap = window.L.map('terr-leaflet-map').setView([defaultLat, defaultLng], 15);
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(leafletMap);

  const bounds = [];

  // 1. Dibujar polígonos de territorios generales (solo cuando se ven todos)
  if (selectedSubterritoryId === 'ALL') {
    state.territories.forEach((t) => {
      if (Array.isArray(t.polygon_coords) && t.polygon_coords.length >= 3) {
        const poly = window.L.polygon(t.polygon_coords, {
          color: '#475569',
          weight: 2,
          dashArray: '6, 6',
          fillOpacity: 0.04
        }).addTo(leafletMap);
        poly.bindPopup(`<b>${escapeHtml(t.code_or_name)}</b>`);
        t.polygon_coords.forEach((pt) => bounds.push(pt));
      }
    });
  }

  // 2. Dibujar polígonos de subterritorios ("Territorio XX")
  subterritories.forEach((sub) => {
    if (Array.isArray(sub.polygon_coords) && sub.polygon_coords.length >= 3) {
      const poly = window.L.polygon(sub.polygon_coords, {
        color: '#1e3a8a',
        weight: 3,
        fillColor: '#3b82f6',
        fillOpacity: 0.08
      }).addTo(leafletMap);
      poly.bindPopup(`<b>Territorio ${escapeHtml(sub.code)}</b>`);
      sub.polygon_coords.forEach((pt) => bounds.push(pt));
    }
  });

  // 3. Dibujar polígonos de manzanas ("Manzana X")
  blocks.forEach((b) => {
    if (Array.isArray(b.polygon_coords) && b.polygon_coords.length >= 3) {
      const poly = window.L.polygon(b.polygon_coords, {
        color: '#334155',
        weight: 1.5,
        fillColor: '#94a3b8',
        fillOpacity: 0.1
      }).addTo(leafletMap);
      poly.bindPopup(`<b>Manzana ${escapeHtml(b.name)}</b>`);
      b.polygon_coords.forEach((pt) => bounds.push(pt));
    } else if (b.center_lat && b.center_lng) {
      const marker = window.L.circleMarker([b.center_lat, b.center_lng], {
        radius: 8,
        color: '#1e3a8a',
        fillColor: '#3b82f6',
        fillOpacity: 0.85
      }).addTo(leafletMap);
      marker.bindPopup(`<b>Manzana ${escapeHtml(b.name)}</b>`);
      bounds.push([b.center_lat, b.center_lng]);
    }
  });

  // 4. Dibujar caras de manzana con línea de color según antigüedad
  faces.forEach((face) => {
    const colorInfo = getFaceAgeColor(face.last_completed_at);
    if (Array.isArray(face.line_coords) && face.line_coords.length >= 2) {
      const poly = window.L.polyline(face.line_coords, {
        color: colorInfo.hex,
        weight: 6,
        opacity: 0.9
      }).addTo(leafletMap);
      poly.bindPopup(
        `<b>${escapeHtml(face.street_name)} ${escapeHtml(face.number_range || '')}</b><br>${formatRelativeDate(
          face.last_completed_at
        )}`
      );
      face.line_coords.forEach((pt) => bounds.push(pt));
    }
  });

  // 5. Dibujar casas No Visitar
  state.dnvHouses.forEach((h) => {
    if (h.lat && h.lng) {
      const dnvMarker = window.L.circleMarker([h.lat, h.lng], {
        radius: 9,
        color: '#881337',
        fillColor: '#e11d48',
        fillOpacity: 1
      }).addTo(leafletMap);
      dnvMarker.bindPopup(
        `<b>🚫 NO VISITAR</b><br>${escapeHtml(h.street)} ${escapeHtml(h.street_number)}<br><small>${escapeHtml(
          h.notes || ''
        )}</small>`
      );
      bounds.push([h.lat, h.lng]);
    }
  });

  // 6. Ubicación actual del publicador si activó GPS
  if (state.userLocation) {
    window.L.circleMarker([state.userLocation.lat, state.userLocation.lng], {
      radius: 7,
      color: '#ffffff',
      weight: 2,
      fillColor: '#2563eb',
      fillOpacity: 1
    })
      .addTo(leafletMap)
      .bindPopup('Tu ubicación actual');
  }

  if (bounds.length > 0) {
    leafletMap.fitBounds(bounds, { padding: [25, 25], maxZoom: 16 });
  }
}

async function markFaceCompleted(faceId, container) {
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from('terr_block_faces')
    .update({
      last_completed_at: nowIso,
      last_completed_by: state.profile.id
    })
    .eq('id', faceId);

  if (error) {
    showToast('Error al registrar cuadra: ' + error.message, 'error');
    return;
  }

  await supabase.from('terr_block_face_logs').insert({
    congregation_id: state.congregation.id,
    face_id: faceId,
    user_id: state.profile.id,
    completed_at: nowIso
  });

  const idx = state.blockFaces.findIndex((f) => f.id === faceId);
  if (idx !== -1) {
    state.blockFaces[idx].last_completed_at = nowIso;
  }

  showToast('¡Cuadra marcada como completada hoy!', 'success');
  renderManzanasView(container);
}

export function checkDnvProximityAlert(lat, lng) {
  if (!state.dnvHouses?.length) return;
  for (const house of state.dnvHouses) {
    const dist = getDistanceMeters(lat, lng, house.lat, house.lng);
    if (dist <= 25) {
      showToast(
        `⚠️ ALERTA NO VISITAR a ${dist} m: ${house.street} ${house.street_number}`,
        'error'
      );
      break;
    }
  }
}

function renderDnvModalHtml() {
  return `
    <div class="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4">
      <div class="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-extrabold text-rose-700">🚫 Agregar Casa No Visitar</h3>
          <button id="close-dnv-modal" class="text-slate-400 hover:text-slate-700 text-xl font-bold">✕</button>
        </div>

        <form id="dnv-house-form" class="space-y-3">
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">Calle</label>
            <input type="text" id="dnv-street" required placeholder="Ej: San Martín"
              class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm" />
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">Número de puerta</label>
            <input type="text" id="dnv-number" required placeholder="Ej: 1842"
              class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm" />
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">Observación (opcional)</label>
            <input type="text" id="dnv-notes" placeholder="Ej: Pidió no recibir visitas"
              class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm" />
          </div>
          <button type="submit" id="btn-save-dnv"
            class="w-full bg-rose-600 hover:bg-rose-500 text-white font-bold py-3 rounded-xl text-sm shadow">
            Guardar con mi ubicación GPS actual
          </button>
        </form>
      </div>
    </div>
  `;
}

function bindDnvModalEvents(container) {
  document.getElementById('close-dnv-modal').onclick = () => {
    showDnvModal = false;
    renderManzanasView(container);
  };

  document.getElementById('dnv-house-form').onsubmit = (e) => {
    e.preventDefault();
    const street = document.getElementById('dnv-street').value.trim();
    const streetNumber = document.getElementById('dnv-number').value.trim();
    const notes = document.getElementById('dnv-notes').value.trim();
    const btn = document.getElementById('btn-save-dnv');

    btn.disabled = true;
    btn.textContent = 'Obteniendo GPS...';

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { data, error } = await supabase
          .from('terr_do_not_visit_houses')
          .insert({
            congregation_id: state.congregation.id,
            street,
            street_number: streetNumber,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            notes,
            created_by: state.profile.id
          })
          .select()
          .single();

        if (error) {
          showToast('Error al guardar: ' + error.message, 'error');
          btn.disabled = false;
          btn.textContent = 'Guardar con mi ubicación GPS actual';
          return;
        }

        state.dnvHouses.push(data);
        showDnvModal = false;
        showToast('Casa No Visitar guardada en el mapa', 'success');
        renderManzanasView(container);
      },
      () => {
        showToast('Activá el GPS para marcar la casa exacta', 'error');
        btn.disabled = false;
        btn.textContent = 'Guardar con mi ubicación GPS actual';
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };
}
