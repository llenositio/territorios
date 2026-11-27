import { supabase } from './supabase.js';
import { state, canManageAnnualReviews } from './state.js';
import { showToast, getDistanceMeters, escapeHtml, fetchAllRows } from './ui-helpers.js';

const CLUSTER_MAX_DIAMETER_M = 400; // Diámetro máximo de 400 m (radio <= 200 m)
const DAYS_10_MONTHS = 300;
const DAYS_12_MONTHS = 365;
const DAYS_14_MONTHS = 425;

let activeSubFilter = 'alerts'; // 'alerts' | 'clusters' | 'all_restricted'
let statusTypeFilter = 'ALL'; // 'ALL' | 'do_not_visit' | 'does_not_exist'
let searchFilter = '';
let selectedClusterId = null;

function getElapsedDays(isoDate) {
  if (!isoDate) return 999;
  const ms = Date.now() - new Date(isoDate).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function getAlertLevel(days) {
  if (days >= DAYS_12_MONTHS) return 'red';     // >= 12 meses (crítico 12-14m+)
  if (days >= DAYS_10_MONTHS) return 'yellow';  // 10-12 meses (aviso preventivo)
  return 'normal';
}

export async function loadAnnualReviewData() {
  if (!state.congregation?.id || !canManageAnnualReviews()) {
    state.reviewItems = [];
    state.reviewAlertsCount = { yellow: 0, red: 0 };
    return;
  }

  const [restrictedApts, dnvHousesRes] = await Promise.all([
    fetchAllRows(() =>
      supabase
        .from('terr_apartments')
        .select('id, building_id, label, status, status_changed_at, last_ratified_at, last_visited_at, notes')
        .eq('congregation_id', state.congregation.id)
        .in('status', ['do_not_visit', 'does_not_exist'])
        .order('id', { ascending: true })
    ),
    supabase
      .from('terr_do_not_visit_houses')
      .select('*')
      .eq('congregation_id', state.congregation.id)
  ]);

  const bldgMap = new Map((state.buildings || []).map((b) => [b.id, b]));
  const subMap = new Map((state.subterritories || []).map((s) => [s.id, s]));

  const items = [];

  for (const apt of restrictedApts || []) {
    const bldg = bldgMap.get(apt.building_id);
    const sub = bldg ? subMap.get(bldg.subterritory_id) : null;
    const refDate = apt.last_ratified_at || apt.status_changed_at || apt.last_visited_at;
    const elapsedDays = getElapsedDays(refDate);
    const alertLevel = getAlertLevel(elapsedDays);

    items.push({
      uid: `apt_${apt.id}`,
      entityType: 'apartment',
      id: apt.id,
      status: apt.status, // 'do_not_visit' | 'does_not_exist'
      subterritoryCode: sub?.code || 'S/A',
      address: bldg
        ? `${bldg.street} ${bldg.street_number} · Dpto. ${apt.label}`
        : `Edificio s/d · Dpto. ${apt.label}`,
      lat: bldg?.lat ?? null,
      lng: bldg?.lng ?? null,
      notes: apt.notes || '',
      refDate,
      elapsedDays,
      alertLevel
    });
  }

  const activeDnvHouses = (dnvHousesRes.data || []).filter((h) => h.status !== 'rectified');
  state.dnvHouses = activeDnvHouses;

  for (const h of activeDnvHouses) {
    const refDate = h.last_ratified_at || h.created_at;
    const elapsedDays = getElapsedDays(refDate);
    const alertLevel = getAlertLevel(elapsedDays);

    items.push({
      uid: `house_${h.id}`,
      entityType: 'house',
      id: h.id,
      status: 'do_not_visit',
      subterritoryCode: 'Casa',
      address: `${h.street} ${h.street_number} (Casa)`,
      lat: h.lat ?? null,
      lng: h.lng ?? null,
      notes: h.notes || '',
      refDate,
      elapsedDays,
      alertLevel
    });
  }

  items.sort((a, b) => b.elapsedDays - a.elapsedDays);
  state.reviewItems = items;

  state.reviewAlertsCount = {
    yellow: items.filter((i) => i.alertLevel === 'yellow').length,
    red: items.filter((i) => i.alertLevel === 'red').length
  };
}

/**
 * Agrupa puntos con diámetro máximo estricto de 400 metros:
 * ningún par de elementos dentro del mismo grupo supera los 400 m entre sí.
 */
function buildDiameter400Clusters(items) {
  const withCoords = items.filter((i) => i.lat != null && i.lng != null);
  const withoutCoords = items.filter((i) => i.lat == null || i.lng == null);
  const visited = new Set();
  const clusters = [];

  for (const seed of withCoords) {
    if (visited.has(seed.uid)) continue;
    const group = [seed];
    visited.add(seed.uid);

    for (const cand of withCoords) {
      if (visited.has(cand.uid)) continue;
      // Verificar diámetro estricto: distancia a TODOS los miembros del grupo <= 400 m
      const fitsDiameter = group.every(
        (member) => getDistanceMeters(member.lat, member.lng, cand.lat, cand.lng) <= CLUSTER_MAX_DIAMETER_M
      );
      if (fitsDiameter) {
        group.push(cand);
        visited.add(cand.uid);
      }
    }

    const centerLat = group.reduce((s, x) => s + Number(x.lat), 0) / group.length;
    const centerLng = group.reduce((s, x) => s + Number(x.lng), 0) / group.length;
    const hasRed = group.some((x) => x.alertLevel === 'red');
    const maxDays = Math.max(...group.map((x) => x.elapsedDays));

    clusters.push({
      id: `cluster_${clusters.length + 1}`,
      index: clusters.length + 1,
      items: group,
      centerLat,
      centerLng,
      hasRed,
      maxDays
    });
  }

  if (withoutCoords.length > 0) {
    clusters.push({
      id: 'cluster_unlocated',
      index: clusters.length + 1,
      items: withoutCoords,
      centerLat: null,
      centerLng: null,
      hasRed: withoutCoords.some((x) => x.alertLevel === 'red'),
      maxDays: Math.max(...withoutCoords.map((x) => x.elapsedDays))
    });
  }

  return clusters;
}

export async function handleRatifyItem(item) {
  const nowIso = new Date().toISOString();

  if (item.entityType === 'apartment') {
    const { error } = await supabase
      .from('terr_apartments')
      .update({
        last_ratified_at: nowIso,
        last_ratified_by: state.profile.id
      })
      .eq('id', item.id);

    if (error) {
      showToast('Error al ratificar: ' + error.message, 'error');
      return false;
    }

    await supabase.from('terr_apartment_logs').insert({
      congregation_id: state.congregation.id,
      apartment_id: item.id,
      user_id: state.profile.id,
      action: 'ratified_12m'
    });
  } else {
    const { error } = await supabase
      .from('terr_do_not_visit_houses')
      .update({
        last_ratified_at: nowIso,
        last_ratified_by: state.profile.id
      })
      .eq('id', item.id);

    if (error) {
      showToast('Error al ratificar casa: ' + error.message, 'error');
      return false;
    }
  }

  showToast('Ratificado: se reinició el ciclo de 12 meses', 'success');
  await loadAnnualReviewData();
  return true;
}

export async function handleRectifyItem(item) {
  const nowIso = new Date().toISOString();

  if (item.entityType === 'apartment') {
    const { error } = await supabase
      .from('terr_apartments')
      .update({
        status: 'active',
        status_changed_at: nowIso,
        status_changed_by: state.profile.id,
        last_ratified_at: null
      })
      .eq('id', item.id);

    if (error) {
      showToast('Error al rectificar: ' + error.message, 'error');
      return false;
    }

    await supabase.from('terr_apartment_logs').insert({
      congregation_id: state.congregation.id,
      apartment_id: item.id,
      user_id: state.profile.id,
      action: 'rectified_to_active'
    });
  } else {
    const { error } = await supabase
      .from('terr_do_not_visit_houses')
      .delete()
      .eq('id', item.id);

    if (error) {
      showToast('Error al rectificar casa: ' + error.message, 'error');
      return false;
    }
  }

  showToast('Rectificado: volvió al servicio activo', 'success');
  await loadAnnualReviewData();
  return true;
}

export function renderRevisionAnualView(container, onDataChanged) {
  if (!canManageAnnualReviews()) {
    container.innerHTML = `
      <div class="bg-white p-6 rounded-2xl border border-slate-200 text-center text-sm text-slate-600">
        No tenés permisos para gestionar revisiones anuales.
      </div>`;
    return;
  }

  const allItems = state.reviewItems || [];
  const yellowCount = state.reviewAlertsCount?.yellow || 0;
  const redCount = state.reviewAlertsCount?.red || 0;
  const alertItems = allItems.filter((i) => i.alertLevel !== 'normal');
  const clusters = buildDiameter400Clusters(alertItems);

  let visibleList = activeSubFilter === 'alerts' ? alertItems : allItems;
  if (statusTypeFilter !== 'ALL') {
    visibleList = visibleList.filter((i) => i.status === statusTypeFilter);
  }
  if (searchFilter.trim()) {
    const q = searchFilter.toLowerCase().trim();
    visibleList = visibleList.filter(
      (i) =>
        i.address.toLowerCase().includes(q) ||
        i.subterritoryCode.toLowerCase().includes(q) ||
        i.notes.toLowerCase().includes(q)
    );
  }

  container.innerHTML = `
    <div class="space-y-4">
      <!-- Banner de alertas por umbral (10 meses / 12 meses) -->
      <div class="grid grid-cols-2 gap-2.5">
        <div class="bg-amber-50 border border-amber-300 p-3.5 rounded-2xl">
          <div class="text-[11px] font-extrabold uppercase text-amber-900">⚠️ Aviso (10–12 meses)</div>
          <div class="text-2xl font-black text-amber-800 mt-0.5">${yellowCount}</div>
          <div class="text-[11px] text-amber-700">Próximos a revisión anual</div>
        </div>
        <div class="bg-rose-50 border border-rose-300 p-3.5 rounded-2xl">
          <div class="text-[11px] font-extrabold uppercase text-rose-900">🚨 Vencidos (≥ 12 meses)</div>
          <div class="text-2xl font-black text-rose-700 mt-0.5">${redCount}</div>
          <div class="text-[11px] text-rose-700">Ventana 12–14m para verificar</div>
        </div>
      </div>

      <!-- Sub-navegación del módulo -->
      <div class="bg-white p-2 rounded-2xl border border-slate-200 grid grid-cols-3 gap-1.5">
        <button data-rev-tab="alerts"
          class="rev-tab-btn py-2 px-2 rounded-xl text-xs font-extrabold transition ${
            activeSubFilter === 'alerts'
              ? 'bg-blue-900 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }">
          🔔 Alertas (${alertItems.length})
        </button>
        <button data-rev-tab="clusters"
          class="rev-tab-btn py-2 px-2 rounded-xl text-xs font-extrabold transition ${
            activeSubFilter === 'clusters'
              ? 'bg-blue-900 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }">
          📍 Zonas 400m (${clusters.length})
        </button>
        <button data-rev-tab="all_restricted"
          class="rev-tab-btn py-2 px-2 rounded-xl text-xs font-extrabold transition ${
            activeSubFilter === 'all_restricted'
              ? 'bg-blue-900 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }">
          🚫 Todos (${allItems.length})
        </button>
      </div>

      ${
        activeSubFilter === 'clusters'
          ? renderClustersSectionHtml(clusters)
          : renderItemsListSectionHtml(visibleList)
      }
    </div>
  `;

  document.querySelectorAll('.rev-tab-btn').forEach((btn) => {
    btn.onclick = () => {
      activeSubFilter = btn.getAttribute('data-rev-tab');
      renderRevisionAnualView(container, onDataChanged);
    };
  });

  const searchInput = document.getElementById('rev-search-input');
  if (searchInput) {
    searchInput.oninput = (e) => {
      searchFilter = e.target.value;
      renderRevisionAnualView(container, onDataChanged);
      const inp = document.getElementById('rev-search-input');
      if (inp) {
        inp.focus();
        inp.setSelectionRange(inp.value.length, inp.value.length);
      }
    };
  }

  const typeSelect = document.getElementById('rev-type-filter');
  if (typeSelect) {
    typeSelect.onchange = (e) => {
      statusTypeFilter = e.target.value;
      renderRevisionAnualView(container, onDataChanged);
    };
  }

  document.querySelectorAll('.btn-ratify-item').forEach((btn) => {
    btn.onclick = async () => {
      const uid = btn.getAttribute('data-uid');
      const item = state.reviewItems.find((x) => x.uid === uid);
      if (!item) return;
      btn.disabled = true;
      const ok = await handleRatifyItem(item);
      if (ok) {
        if (onDataChanged) await onDataChanged();
        renderRevisionAnualView(container, onDataChanged);
      } else {
        btn.disabled = false;
      }
    };
  });

  document.querySelectorAll('.btn-rectify-item').forEach((btn) => {
    btn.onclick = async () => {
      const uid = btn.getAttribute('data-uid');
      const item = state.reviewItems.find((x) => x.uid === uid);
      if (!item) return;
      if (!confirm(`¿Reactivar "${item.address}" para el servicio activo?`)) return;
      btn.disabled = true;
      const ok = await handleRectifyItem(item);
      if (ok) {
        if (onDataChanged) await onDataChanged();
        renderRevisionAnualView(container, onDataChanged);
      } else {
        btn.disabled = false;
      }
    };
  });

  document.querySelectorAll('.btn-ratify-cluster').forEach((btn) => {
    btn.onclick = async () => {
      const cId = btn.getAttribute('data-cluster-id');
      const cluster = clusters.find((c) => c.id === cId);
      if (!cluster) return;
      if (!confirm(`¿Ratificar los ${cluster.items.length} registros de esta zona de 400m?`)) return;
      btn.disabled = true;
      for (const it of cluster.items) {
        await handleRatifyItem(it);
      }
      if (onDataChanged) await onDataChanged();
      renderRevisionAnualView(container, onDataChanged);
    };
  });
}

function renderClustersSectionHtml(clusters) {
  if (clusters.length === 0) {
    return `
      <div class="bg-white p-8 rounded-2xl border border-slate-200 text-center text-sm text-slate-500">
        No hay registros pendientes de revisión (≥ 10 meses) para agrupar por proximidad.
      </div>`;
  }

  return `
    <div class="space-y-3">
      <div class="bg-blue-50 border border-blue-200 p-3 rounded-xl text-xs text-blue-950">
        📍 Agrupación automática con <b>diámetro máximo de 400 m</b> entre extremos para optimizar recorridos de verificación en campo.
      </div>
      ${clusters
        .map((c) => {
          const mapsLink =
            c.centerLat != null && c.centerLng != null
              ? `https://www.google.com/maps/search/?api=1&query=${c.centerLat},${c.centerLng}`
              : null;

          return `
            <div class="bg-white p-4 rounded-2xl shadow-sm border ${
              c.hasRed ? 'border-rose-300' : 'border-amber-300'
            } space-y-3">
              <div class="flex items-center justify-between gap-2">
                <div>
                  <span class="text-xs font-black uppercase px-2.5 py-0.5 rounded-full ${
                    c.hasRed ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                  }">
                    Zona #${c.index} · ${c.items.length} ${c.items.length === 1 ? 'punto' : 'puntos'}
                  </span>
                  <div class="text-xs text-slate-500 mt-1">
                    Antigüedad máx.: <b>${Math.round(c.maxDays / 30)} meses</b> (${c.maxDays} días)
                  </div>
                </div>
                <div class="flex items-center gap-1.5">
                  ${
                    mapsLink
                      ? `<a href="${mapsLink}" target="_blank" rel="noopener noreferrer"
                          class="bg-blue-50 hover:bg-blue-100 text-blue-900 font-bold px-3 py-2 rounded-xl text-xs border border-blue-200">
                          🗺️ Mapa
                        </a>`
                      : ''
                  }
                  <button data-cluster-id="${c.id}"
                    class="btn-ratify-cluster bg-slate-900 hover:bg-slate-800 text-white font-bold px-3 py-2 rounded-xl text-xs">
                    ✓ Ratificar zona
                  </button>
                </div>
              </div>

              <div class="divide-y divide-slate-100 border-t border-slate-100 pt-2">
                ${c.items
                  .map(
                    (it) => `
                    <div class="py-2 flex items-center justify-between gap-2 text-xs">
                      <div class="min-w-0">
                        <div class="font-bold text-slate-900 truncate">${escapeHtml(it.address)}</div>
                        <div class="text-[11px] text-slate-500">
                          Terr. ${escapeHtml(it.subterritoryCode)} · ${
                            it.status === 'do_not_visit' ? '🚫 No Visitar' : '❓ No Existe'
                          } · ${Math.round(it.elapsedDays / 30)} meses
                        </div>
                      </div>
                      <div class="flex items-center gap-1 shrink-0">
                        <button data-uid="${it.uid}"
                          class="btn-ratify-item bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold px-2.5 py-1.5 rounded-lg text-[11px]">
                          Ratificar
                        </button>
                        <button data-uid="${it.uid}"
                          class="btn-rectify-item bg-emerald-100 hover:bg-emerald-200 text-emerald-900 font-bold px-2.5 py-1.5 rounded-lg text-[11px]">
                          Rectificar
                        </button>
                      </div>
                    </div>
                  `
                  )
                  .join('')}
              </div>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

function renderItemsListSectionHtml(list) {
  return `
    <div class="space-y-3">
      <div class="bg-white p-3 rounded-2xl border border-slate-200 flex flex-col sm:flex-row gap-2">
        <input type="search" id="rev-search-input" value="${escapeHtml(searchFilter)}"
          placeholder="Buscar por calle, altura o territorio..."
          class="flex-1 px-3 py-2 rounded-xl border border-slate-300 text-xs" />
        <select id="rev-type-filter"
          class="px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold bg-white">
          <option value="ALL" ${statusTypeFilter === 'ALL' ? 'selected' : ''}>Todos los estados</option>
          <option value="do_not_visit" ${statusTypeFilter === 'do_not_visit' ? 'selected' : ''}>🚫 Solo No Visitar</option>
          <option value="does_not_exist" ${statusTypeFilter === 'does_not_exist' ? 'selected' : ''}>❓ Solo No Existe</option>
        </select>
      </div>

      ${
        list.length === 0
          ? `<div class="bg-white p-8 rounded-2xl border border-slate-200 text-center text-sm text-slate-500">
              No hay registros en esta categoría.
            </div>`
          : `<div class="space-y-2.5">
              ${list
                .map((it) => {
                  const months = Math.floor(it.elapsedDays / 30);
                  const isOverdue14 = it.elapsedDays > DAYS_14_MONTHS;
                  const badgeClass =
                    it.alertLevel === 'red'
                      ? 'bg-rose-100 text-rose-800 border-rose-200'
                      : it.alertLevel === 'yellow'
                        ? 'bg-amber-100 text-amber-900 border-amber-200'
                        : 'bg-slate-100 text-slate-700 border-slate-200';

                  return `
                    <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-2.5">
                      <div class="flex items-start justify-between gap-2">
                        <div>
                          <div class="flex flex-wrap items-center gap-1.5">
                            <span class="text-[11px] font-extrabold bg-blue-50 text-blue-900 px-2 py-0.5 rounded">
                              Terr. ${escapeHtml(it.subterritoryCode)}
                            </span>
                            <span class="text-[11px] font-bold px-2 py-0.5 rounded border ${badgeClass}">
                              ${months} ${months === 1 ? 'mes' : 'meses'} (${it.elapsedDays}d)${
                                isOverdue14 ? ' · +14m' : ''
                              }
                            </span>
                            <span class="text-[11px] font-bold ${
                              it.status === 'do_not_visit' ? 'text-rose-700' : 'text-slate-600'
                            }">
                              ${it.status === 'do_not_visit' ? '🚫 No Visitar' : '❓ No Existe'}
                            </span>
                          </div>
                          <div class="font-extrabold text-slate-900 text-sm mt-1">
                            ${escapeHtml(it.address)}
                          </div>
                          ${
                            it.notes
                              ? `<p class="text-xs text-slate-500 mt-0.5">${escapeHtml(it.notes)}</p>`
                              : ''
                          }
                        </div>
                      </div>

                      <div class="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
                        <button data-uid="${it.uid}"
                          class="btn-ratify-item py-2 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs transition">
                          ✓ Ratificar (12 meses)
                        </button>
                        <button data-uid="${it.uid}"
                          class="btn-rectify-item py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs transition">
                          ↺ Rectificar (Reactivar)
                        </button>
                      </div>
                    </div>
                  `;
                })
                .join('')}
            </div>`
      }
    </div>
  `;
}
