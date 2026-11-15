import { supabase } from './supabase.js';
import { state, isSuperadmin } from './state.js';
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

function canMarkTerritory() {
  const role = state.profile?.role;
  return isSuperadmin() || role === 'admin' || role === 'conductor';
}

function isCompletedToday(lastCompletedAt) {
  const d = daysAgo(lastCompletedAt);
  return d !== null && d === 0;
}

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
  if (!state.userLocation) {
    requestOnDemandGps({
      silent: true,
      onSuccess: () => renderManzanasView(container)
    });
  }

  const editable = canMarkTerritory();

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

        ${
          editable
            ? `<div class="bg-blue-50 border border-blue-200 text-blue-950 px-3 py-2 rounded-xl text-[11px] font-semibold">
                👆 <b>Modo Conductor:</b> Tocá una <b>cuadra</b> para marcar/desmarcar esa cara, o tocá el <b>centro de la manzana</b> para marcar/desmarcar las 4 caras juntas.
              </div>`
            : ''
        }

        <div id="terr-leaflet-map" class="w-full h-72 rounded-xl border border-slate-200 z-10"></div>

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
                  const doneToday = isCompletedToday(face.last_completed_at);

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

                      ${
                        editable
                          ? `<button data-face-id="${face.id}"
                              class="toggle-face-btn min-h-[44px] ${
                                doneToday
                                  ? 'bg-slate-200 hover:bg-slate-300 text-slate-800'
                                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                              } active:scale-95 font-bold px-3.5 py-2 rounded-xl text-xs shadow-sm transition shrink-0">
                              ${doneToday ? '↩ Desmarcar' : '✓ Hecha hoy'}
                            </button>`
                          : ''
                      }
                    </div>
                  `;
                })
                .join('')
        }
      </div>
    </div>
    ${showDnvModal ? renderDnvModalHtml() : ''}
  `;

  initLeafletMap(container, filteredSubterritories, filteredBlocks, filteredFaces, editable);

  document.getElementById('filter-subterritory').onchange = (e) => {
    selectedSubterritoryId = e.target.value;
    renderManzanasView(container);
  };

  document.getElementById('btn-add-dnv').onclick = () => {
    showDnvModal = true;
    renderManzanasView(container);
  };

  if (editable) {
    document.querySelectorAll('.toggle-face-btn').forEach((btn) => {
      btn.onclick = async () => {
        const faceId = btn.getAttribute('data-face-id');
        await toggleFaceCompleted(faceId, container);
      };
    });
  }

  if (showDnvModal) {
    bindDnvModalEvents(container);
  }
}

function initLeafletMap(container, subterritories, blocks, faces, editable) {
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

  // 1. Polígonos de territorio general (solo en vista general)
  if (selectedSubterritoryId === 'ALL') {
    state.territories.forEach((t) => {
      if (Array.isArray(t.polygon_coords) && t.polygon_coords.length >= 3) {
        const poly = window.L.polygon(t.polygon_coords, {
          color: '#475569',
          weight: 2,
          dashArray: '6, 6',
          fillOpacity: 0.03,
          interactive: false
        }).addTo(leafletMap);
        t.polygon_coords.forEach((pt) => bounds.push(pt));
      }
    });
  }

  // 2. Polígonos de Territorios ("Territorio XX")
  subterritories.forEach((sub) => {
    if (Array.isArray(sub.polygon_coords) && sub.polygon_coords.length >= 3) {
      window.L.polygon(sub.polygon_coords, {
        color: '#1e3a8a',
        weight: 3,
        fillColor: '#3b82f6',
        fillOpacity: 0.05,
        interactive: false
      }).addTo(leafletMap);
      sub.polygon_coords.forEach((pt) => bounds.push(pt));
    }
  });

  // 3. Polígonos de Manzanas (toque en el centro marca/desmarca toda la manzana)
  blocks.forEach((b) => {
    const blockFaces = state.blockFaces.filter((f) => f.block_id === b.id);
    const allDoneToday =
      blockFaces.length > 0 && blockFaces.every((f) => isCompletedToday(f.last_completed_at));

    if (Array.isArray(b.polygon_coords) && b.polygon_coords.length >= 3) {
      const poly = window.L.polygon(b.polygon_coords, {
        color: '#334155',
        weight: 1,
        fillColor: allDoneToday ? '#10b981' : '#94a3b8',
        fillOpacity: allDoneToday ? 0.32 : 0.14
      }).addTo(leafletMap);

      if (editable) {
        poly.on('click', async (ev) => {
          window.L.DomEvent.stopPropagation(ev);
          await toggleWholeBlock(b.id, container);
        });
      } else {
        poly.bindPopup(`<b>Manzana ${escapeHtml(b.name)}</b>`);
      }

      // Etiqueta central con la letra de la manzana
      const centerLat =
        b.center_lat ||
        b.polygon_coords.reduce((acc, p) => acc + p[0], 0) / b.polygon_coords.length;
      const centerLng =
        b.center_lng ||
        b.polygon_coords.reduce((acc, p) => acc + p[1], 0) / b.polygon_coords.length;

      const labelIcon = window.L.divIcon({
        className: 'block-center-label',
        html: `<div style="
          background:${allDoneToday ? '#059669' : '#1e293b'};
          color:#fff;
          font-weight:800;
          font-size:11px;
          width:22px;
          height:22px;
          border-radius:9999px;
          display:flex;
          align-items:center;
          justify-content:center;
          border:2px solid #fff;
          box-shadow:0 1px 4px rgba(0,0,0,0.35);
          cursor:pointer;
        ">${escapeHtml(b.name)}</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });

      const labelMarker = window.L.marker([centerLat, centerLng], { icon: labelIcon }).addTo(
        leafletMap
      );
      if (editable) {
        labelMarker.on('click', async (ev) => {
          window.L.DomEvent.stopPropagation(ev);
          await toggleWholeBlock(b.id, container);
        });
      }

      b.polygon_coords.forEach((pt) => bounds.push(pt));
    }
  });

  // 4. Caras de manzana (toque directo en la línea marca/desmarca esa cara)
  faces.forEach((face) => {
    const colorInfo = getFaceAgeColor(face.last_completed_at);
    if (Array.isArray(face.line_coords) && face.line_coords.length >= 2) {
      const line = window.L.polyline(face.line_coords, {
        color: colorInfo.hex,
        weight: 8,
        opacity: 0.95
      }).addTo(leafletMap);

      if (editable) {
        line.on('click', async (ev) => {
          window.L.DomEvent.stopPropagation(ev);
          await toggleFaceCompleted(face.id, container);
        });
      } else {
        line.bindPopup(
          `<b>${escapeHtml(face.street_name)} ${escapeHtml(face.number_range || '')}</b><br>${formatRelativeDate(
            face.last_completed_at
          )}`
        );
      }

      face.line_coords.forEach((pt) => bounds.push(pt));
    }
  });

  // 5. Casas No Visitar
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

  // 6. Ubicación actual del publicador
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
    leafletMap.fitBounds(bounds, { padding: [25, 25], maxZoom: 17 });
  }
}

// Alterna una cara individual: si ya está hecha hoy, la desmarca; si no, la marca hecha hoy
async function toggleFaceCompleted(faceId, container) {
  const idx = state.blockFaces.findIndex((f) => f.id === faceId);
  if (idx === -1) return;

  const face = state.blockFaces[idx];
  const alreadyToday = isCompletedToday(face.last_completed_at);

  if (alreadyToday) {
    const { error } = await supabase
      .from('terr_block_faces')
      .update({
        last_completed_at: null,
        last_completed_by: null
      })
      .eq('id', faceId);

    if (error) {
      showToast('Error al desmarcar cuadra: ' + error.message, 'error');
      return;
    }

    state.blockFaces[idx].last_completed_at = null;
    state.blockFaces[idx].last_completed_by = null;
    showToast(`↩ Desmarcada: ${face.street_name}`, 'info');
    renderManzanasView(container);
    return;
  }

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

  state.blockFaces[idx].last_completed_at = nowIso;
  showToast(`✓ Marcada hecha hoy: ${face.street_name}`, 'success');
  renderManzanasView(container);
}

// Alterna toda la manzana completa: si todas las caras están hechas hoy, desmarca todas; si no, marca todas
async function toggleWholeBlock(blockId, container) {
  const block = state.blocks.find((b) => b.id === blockId);
  const blockFaces = state.blockFaces.filter((f) => f.block_id === blockId);
  if (!block || blockFaces.length === 0) return;

  const allDoneToday = blockFaces.every((f) => isCompletedToday(f.last_completed_at));
  const faceIds = blockFaces.map((f) => f.id);

  if (allDoneToday) {
    const { error } = await supabase
      .from('terr_block_faces')
      .update({
        last_completed_at: null,
        last_completed_by: null
      })
      .in('id', faceIds);

    if (error) {
      showToast('Error al desmarcar manzana: ' + error.message, 'error');
      return;
    }

    state.blockFaces.forEach((f) => {
      if (f.block_id === blockId) {
        f.last_completed_at = null;
        f.last_completed_by = null;
      }
    });

    showToast(`↩ Manzana ${block.name} desmarcada por completo`, 'info');
    renderManzanasView(container);
    return;
  }

  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from('terr_block_faces')
    .update({
      last_completed_at: nowIso,
      last_completed_by: state.profile.id
    })
    .in('id', faceIds);

  if (error) {
    showToast('Error al marcar manzana completa: ' + error.message, 'error');
    return;
  }

  const pendingFaces = blockFaces.filter((f) => !isCompletedToday(f.last_completed_at));
  if (pendingFaces.length > 0) {
    await supabase.from('terr_block_face_logs').insert(
      pendingFaces.map((f) => ({
        congregation_id: state.congregation.id,
        face_id: f.id,
        user_id: state.profile.id,
        completed_at: nowIso
      }))
    );
  }

  state.blockFaces.forEach((f) => {
    if (f.block_id === blockId) {
      f.last_completed_at = nowIso;
    }
  });

  showToast(`✓ Manzana ${block.name} completa marcada hoy`, 'success');
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
