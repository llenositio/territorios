import { supabase } from './supabase.js';
import { state } from './state.js';
import { escapeHtml, fetchAllRows } from './ui-helpers.js';

function getTodayIso() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().split('T')[0];
}

function getDaysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().split('T')[0];
}

let filterFrom = getDaysAgoIso(90);
let filterTo = getTodayIso();
let activePreset = '90';
let presentationMode = false;
let selectedSalidaSubIds = new Set();
let lastCongregationId = null;

// Estado del Buscador Urgente por Ubicación
let urgentOrigin = null; // { lat, lng, label }
let urgentAddressQuery = '';
let urgentPriorityMode = 'balanced'; // 'balanced' | 'closest' | 'oldest'
let urgentStatusMsg = '';
let urgentLoading = false;

let statsSummary = {
  totalApts: 0,
  visitedAptsCount: 0,
  totalFaces: 0,
  completedFacesCount: 0,
  bySubterritory: []
};

function extractCoordsFromAnyShape(obj, outList) {
  if (!obj) return;
  if (Array.isArray(obj)) {
    if (obj.length >= 2 && typeof obj[0] === 'number' && typeof obj[1] === 'number') {
      const a = obj[0];
      const b = obj[1];
      if (Math.abs(a) <= 90 && Math.abs(b) > 90) {
        outList.push({ lat: a, lng: b });
      } else if (Math.abs(b) <= 90 && Math.abs(a) > 90) {
        outList.push({ lat: b, lng: a });
      } else {
        // En Argentina ambos son negativos: lat ~ -20 a -55, lng ~ -53 a -73
        if (Math.abs(a) < Math.abs(b)) {
          outList.push({ lat: a, lng: b });
        } else {
          outList.push({ lat: b, lng: a });
        }
      }
      return;
    }
    obj.forEach((item) => extractCoordsFromAnyShape(item, outList));
    return;
  }
  if (typeof obj === 'object') {
    if (obj.lat !== undefined && obj.lng !== undefined) {
      outList.push({ lat: Number(obj.lat), lng: Number(obj.lng) });
    } else if (obj.latitude !== undefined && obj.longitude !== undefined) {
      outList.push({ lat: Number(obj.latitude), lng: Number(obj.longitude) });
    } else {
      if (obj.coordinates) extractCoordsFromAnyShape(obj.coordinates, outList);
      if (obj.geometry) extractCoordsFromAnyShape(obj.geometry, outList);
      if (obj.polygon) extractCoordsFromAnyShape(obj.polygon, outList);
      if (obj.geom) extractCoordsFromAnyShape(obj.geom, outList);
      if (obj.polygon_coords) extractCoordsFromAnyShape(obj.polygon_coords, outList);
      if (obj.line_coords) extractCoordsFromAnyShape(obj.line_coords, outList);
    }
  }
}

function computeSubCenter(subId) {
  const pts = [];
  (state.buildings || []).forEach((b) => {
    if (b.subterritory_id === subId && b.lat && b.lng) {
      pts.push({ lat: Number(b.lat), lng: Number(b.lng) });
    }
  });

  const subBlockIds = new Set();
  (state.blocks || []).forEach((blk) => {
    if (blk.subterritory_id === subId) {
      subBlockIds.add(blk.id);
      extractCoordsFromAnyShape(blk, pts);
    }
  });

  (state.blockFaces || []).forEach((f) => {
    if (subBlockIds.has(f.block_id)) {
      extractCoordsFromAnyShape(f, pts);
    }
  });

  if (pts.length === 0) return null;
  const sum = pts.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), {
    lat: 0,
    lng: 0
  });
  return { lat: sum.lat / pts.length, lng: sum.lng / pts.length };
}

function getReferenceStreetsForSubs(subIds) {
  const center = (() => {
    const centers = Array.from(subIds)
      .map((id) => computeSubCenter(id))
      .filter(Boolean);
    if (centers.length === 0) return null;
    const sum = centers.reduce((a, c) => ({ lat: a.lat + c.lat, lng: a.lng + c.lng }), {
      lat: 0,
      lng: 0
    });
    return { lat: sum.lat / centers.length, lng: sum.lng / centers.length };
  })();

  const blockIds = new Set(
    (state.blocks || []).filter((b) => subIds.has(b.subterritory_id)).map((b) => b.id)
  );
  const faces = (state.blockFaces || []).filter(
    (f) => blockIds.has(f.block_id) && f.street_name
  );

  // Calcular posición y orientación (horizontal vs vertical) de cada calle de la zona
  const streetInfo = [];
  faces.forEach((f) => {
    const blk = (state.blocks || []).find((b) => b.id === f.block_id);
    let pt = null;
    let isHorizontal = null;

    if (Array.isArray(f.line_coords) && f.line_coords.length >= 2) {
      const p0 = f.line_coords[0];
      const p1 = f.line_coords[f.line_coords.length - 1];
      const lat0 = Array.isArray(p0) ? Number(p0[0]) : Number(p0.lat);
      const lng0 = Array.isArray(p0) ? Number(p0[1]) : Number(p0.lng);
      const lat1 = Array.isArray(p1) ? Number(p1[0]) : Number(p1.lat);
      const lng1 = Array.isArray(p1) ? Number(p1[1]) : Number(p1.lng);
      pt = { lat: (lat0 + lat1) / 2, lng: (lng0 + lng1) / 2 };
      isHorizontal = Math.abs(lng1 - lng0) >= Math.abs(lat1 - lat0);
    } else if (f.lat && f.lng) {
      pt = { lat: Number(f.lat), lng: Number(f.lng) };
    } else if (blk) {
      const blkPts = [];
      extractCoordsFromAnyShape(blk, blkPts);
      if (blkPts.length > 0) pt = blkPts[0];
    }

    if (pt) {
      streetInfo.push({
        name: f.street_name.trim(),
        pt,
        isHorizontal,
        dist: center ? distanceBetween(center, pt) : 0
      });
    }
  });

  // Ordenar caras por cercanía al centro exacto de la zona seleccionada
  streetInfo.sort((a, b) => a.dist - b.dist);

  if (streetInfo.length > 0) {
    const first = streetInfo[0];
    // Buscar la calle más cercana al centro que tenga orientación perpendicular (o nombre distinto)
    const cross =
      streetInfo.find(
        (s) =>
          s.name.toLowerCase() !== first.name.toLowerCase() &&
          first.isHorizontal !== null &&
          s.isHorizontal !== null &&
          s.isHorizontal !== first.isHorizontal
      ) ||
      streetInfo.find((s) => s.name.toLowerCase() !== first.name.toLowerCase());

    if (cross) {
      return `${first.name} y ${cross.name}`;
    }
    return first.name;
  }

  const bldgs = (state.buildings || []).filter(
    (b) => subIds.has(b.subterritory_id) && b.street
  );
  if (bldgs.length > 0) {
    return `${bldgs[0].street} ${bldgs[0].street_number || ''}`.trim();
  }

  return 'Centro de la zona seleccionada';
}

function distanceBetween(c1, c2) {
  if (!c1 || !c2) return 999999;
  const dLat = c1.lat - c2.lat;
  const dLng = c1.lng - c2.lng;
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

// Distancia real en metros (Fórmula de Haversine)
function haversineMeters(c1, c2) {
  if (!c1 || !c2) return null;
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(c2.lat - c1.lat);
  const dLng = toRad(c2.lng - c1.lng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(c1.lat)) *
      Math.cos(toRad(c2.lat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function formatDistanceLabel(meters) {
  if (meters === null || meters === undefined) return 'Sin ubicación';
  const blocks = Math.max(1, Math.round(meters / 100));
  if (meters < 1000) {
    return `${meters} m (~${blocks} ${blocks === 1 ? 'cuadra' : 'cuadras'})`;
  }
  return `${(meters / 1000).toFixed(1)} km (~${blocks} cuadras)`;
}

function computeDaysSinceLastWorked(subApts, subFaces) {
  let latestMs = 0;

  subApts.forEach((a) => {
    if (a.last_visited_at) {
      const ms = new Date(a.last_visited_at).getTime();
      if (!Number.isNaN(ms) && ms > latestMs) latestMs = ms;
    }
  });

  subFaces.forEach((f) => {
    if (f.last_completed_at) {
      const ms = new Date(f.last_completed_at).getTime();
      if (!Number.isNaN(ms) && ms > latestMs) latestMs = ms;
    }
  });

  if (latestMs === 0) return null; // Nunca trabajado registrado
  const diffDays = Math.floor((Date.now() - latestMs) / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

export async function loadStatistics() {
  if (!state.congregation?.id) return;

  const fromIsoStart = `${filterFrom}T00:00:00.000Z`;
  const toIsoEnd = `${filterTo}T23:59:59.999Z`;

  // 1. Todos los timbres activos de la congregación (paginado completo >1000 filas)
  const allApts = await fetchAllRows(() =>
    supabase
      .from('terr_apartments')
      .select('id, building_id, status, last_visited_at')
      .eq('congregation_id', state.congregation.id)
      .eq('status', 'active')
      .order('id', { ascending: true })
  );

  const activeAptIds = new Set(allApts.map((a) => a.id));

  // 2. Logs de timbres tocados en el rango de fechas (paginado completo >1000 filas)
  const logs = await fetchAllRows(() =>
    supabase
      .from('terr_apartment_logs')
      .select('apartment_id, created_at')
      .eq('congregation_id', state.congregation.id)
      .gte('created_at', fromIsoStart)
      .lte('created_at', toIsoEnd)
      .order('id', { ascending: true })
  );

  const touchedAptIdsInRange = new Set();
  (logs || []).forEach((l) => {
    if (activeAptIds.has(l.apartment_id)) {
      touchedAptIdsInRange.add(l.apartment_id);
    }
  });

  // Fallback: si un departamento tiene last_visited_at dentro del rango sin log explícito
  allApts.forEach((a) => {
    if (a.last_visited_at && a.last_visited_at >= fromIsoStart && a.last_visited_at <= toIsoEnd) {
      touchedAptIdsInRange.add(a.id);
    }
  });

  // 3. Caras de manzana (casas/cuadras) completadas dentro del rango
  const allFaces = state.blockFaces || [];
  const completedFacesInRange = allFaces.filter(
    (f) =>
      f.last_completed_at &&
      f.last_completed_at >= fromIsoStart &&
      f.last_completed_at <= toIsoEnd
  );
  const completedFaceIds = new Set(completedFacesInRange.map((f) => f.id));

  const bldgSubMap = new Map((state.buildings || []).map((b) => [b.id, b.subterritory_id]));
  const blkSubMap = new Map((state.blocks || []).map((b) => [b.id, b.subterritory_id]));

  const sortedSubs = [...(state.subterritories || [])].sort((a, b) =>
    String(a.code || '').localeCompare(String(b.code || ''), 'es', {
      numeric: true,
      sensitivity: 'base'
    })
  );

  const rows = sortedSubs.map((sub) => {
    const subApts = allApts.filter((a) => bldgSubMap.get(a.building_id) === sub.id);
    const subAptsDone = subApts.filter((a) => touchedAptIdsInRange.has(a.id));

    const subFaces = allFaces.filter((f) => blkSubMap.get(f.block_id) === sub.id);
    const subFacesDone = subFaces.filter((f) => completedFaceIds.has(f.id));

    const totalItems = subApts.length + subFaces.length;
    const doneItems = subAptsDone.length + subFacesDone.length;
    const pct = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;
    const daysSinceLastWorked = computeDaysSinceLastWorked(subApts, subFaces);

    return {
      id: sub.id,
      code: sub.code,
      aptsTotal: subApts.length,
      aptsDone: subAptsDone.length,
      facesTotal: subFaces.length,
      facesDone: subFacesDone.length,
      totalItems,
      doneItems,
      pct,
      daysSinceLastWorked,
      center: computeSubCenter(sub.id)
    };
  });

  statsSummary = {
    totalApts: allApts.length,
    visitedAptsCount: touchedAptIdsInRange.size,
    totalFaces: allFaces.length,
    completedFacesCount: completedFacesInRange.length,
    bySubterritory: rows
  };

  // Recalcular sugerencia inteligente al entrar o cambiar de congregación
  if (lastCongregationId !== state.congregation.id) {
    selectedSalidaSubIds = new Set();
    urgentOrigin = null;
    urgentStatusMsg = '';
    if (rows.length > 0) {
      applySmartSalidaSuggestion();
    }
    lastCongregationId = state.congregation.id;
  }
}

function applySmartSalidaSuggestion() {
  const candidates = statsSummary.bySubterritory.filter((r) => r.totalItems > 0);
  if (candidates.length === 0) return;

  // 1. Elegir el territorio más atrasado como semilla
  const leastWorked = [...candidates].sort((a, b) => a.pct - b.pct);
  const seed = leastWorked[0];

  const picked = [seed];
  const others = leastWorked.slice(1).filter((c) => c.pct < 80);

  // 2. Priorizar los vecinos geográficamente MÁS CERCANOS para que formen un bloque contiguo
  if (seed.center) {
    others.sort((a, b) => {
      const distA = distanceBetween(seed.center, a.center);
      const distB = distanceBetween(seed.center, b.center);
      // Si la diferencia de avance es menor al 25%, manda la cercanía física
      if (Math.abs(a.pct - b.pct) <= 25) return distA - distB;
      return a.pct - b.pct;
    });
  }

  for (const cand of others) {
    if (picked.length >= 3) break;
    picked.push(cand);
  }

  selectedSalidaSubIds = new Set(picked.map((p) => p.id));
}

function getUrgentRecommendations() {
  if (!urgentOrigin) return [];

  const candidates = statsSummary.bySubterritory
    .filter((r) => r.totalItems > 0 && r.center)
    .map((r) => {
      const meters = haversineMeters(urgentOrigin, r.center);
      // Si nunca fue trabajado, le damos antigüedad alta equivalente a 365 días para el ranking
      const effectiveAgeDays = r.daysSinceLastWorked === null ? 365 : r.daysSinceLastWorked;
      return {
        ...r,
        meters,
        effectiveAgeDays
      };
    });

  candidates.sort((a, b) => {
    if (urgentPriorityMode === 'closest') {
      return (a.meters ?? 999999) - (b.meters ?? 999999);
    }
    if (urgentPriorityMode === 'oldest') {
      if (b.effectiveAgeDays !== a.effectiveAgeDays) {
        return b.effectiveAgeDays - a.effectiveAgeDays;
      }
      return (a.meters ?? 999999) - (b.meters ?? 999999);
    }
    // Modo equilibrado: penaliza distancia en metros y premia días sin predicar
    // Cada 100m (1 cuadra) equivale a ~15 días de antigüedad
    const scoreA = (a.meters ?? 999999) * 0.15 - a.effectiveAgeDays;
    const scoreB = (b.meters ?? 999999) * 0.15 - b.effectiveAgeDays;
    return scoreA - scoreB;
  });

  return candidates.slice(0, 4);
}

async function geocodePlannedAddress(queryText) {
  const clean = String(queryText || '').trim();
  if (!clean) return null;

  // Calcular centro de referencia de la congregación actual usando los territorios ya mapeados
  const knownCenters = statsSummary.bySubterritory.map((r) => r.center).filter(Boolean);
  let viewboxParam = '';
  let cityHint = '';

  const congName = state.congregation?.nombre || '';
  const parenMatch = congName.match(/\(([^)]+)\)/);
  if (parenMatch) cityHint = parenMatch[1].trim();

  if (knownCenters.length > 0) {
    const avgLat = knownCenters.reduce((a, c) => a + c.lat, 0) / knownCenters.length;
    const avgLng = knownCenters.reduce((a, c) => a + c.lng, 0) / knownCenters.length;
    // Caja de ~15 km alrededor de la congregación (viewbox = left,top,right,bottom)
    const delta = 0.15;
    viewboxParam = `&viewbox=${avgLng - delta},${avgLat + delta},${avgLng + delta},${avgLat - delta}&bounded=1`;
  }

  // Normalizar "calle1 y calle2" -> Nominatim suele entender mejor "calle1 & calle2"
  const normalizedStreet = clean.replace(/\s+y\s+/gi, ' & ');
  const fullQuery =
    cityHint && !normalizedStreet.toLowerCase().includes(cityHint.toLowerCase())
      ? `${normalizedStreet}, ${cityHint}, Argentina`
      : `${normalizedStreet}, Argentina`;

  let url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
    fullQuery
  )}${viewboxParam}`;

  let res = await fetch(url, { headers: { 'Accept-Language': 'es' } });
  let data = res.ok ? await res.json() : [];

  // Fallback sin bounded=1 si no encontró intersección exacta pero manteniendo viewbox de preferencia
  if ((!Array.isArray(data) || data.length === 0) && viewboxParam) {
    url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
      fullQuery
    )}${viewboxParam.replace('&bounded=1', '')}`;
    res = await fetch(url, { headers: { 'Accept-Language': 'es' } });
    data = res.ok ? await res.json() : [];
  }

  if (!Array.isArray(data) || data.length === 0) return null;

  return {
    lat: Number(data[0].lat),
    lng: Number(data[0].lon),
    label: clean
  };
}

function buildPictogramGridHtml(pct, filledIcon, emptyIcon, activeBgClass, inactiveBgClass) {
  const safePct = Math.max(0, Math.min(100, pct));
  const cells = [];
  for (let i = 1; i <= 100; i++) {
    const isFilled = i <= safePct;
    cells.push(`
      <div class="aspect-square rounded flex items-center justify-center text-[11px] sm:text-xs select-none transition-all ${
        isFilled ? `${activeBgClass} shadow-xs scale-100` : `${inactiveBgClass} opacity-45 grayscale`
      }">
        ${isFilled ? filledIcon : emptyIcon}
      </div>
    `);
  }
  return `
    <div class="grid grid-cols-10 gap-1 p-2.5 bg-slate-50 rounded-xl border border-slate-200">
      ${cells.join('')}
    </div>
  `;
}

function formatShortDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function renderEstadisticasView(container) {
  const aptPct =
    statsSummary.totalApts > 0
      ? Math.round((statsSummary.visitedAptsCount / statsSummary.totalApts) * 100)
      : 0;
  const aptPending = Math.max(0, statsSummary.totalApts - statsSummary.visitedAptsCount);

  const facePct =
    statsSummary.totalFaces > 0
      ? Math.round((statsSummary.completedFacesCount / statsSummary.totalFaces) * 100)
      : 0;
  const facePending = Math.max(0, statsSummary.totalFaces - statsSummary.completedFacesCount);

  // Territorios ordenados de menor a mayor cobertura para sugerencia de salidas
  const rankedForSalidas = [...statsSummary.bySubterritory]
    .filter((r) => r.totalItems > 0)
    .sort((a, b) => a.pct - b.pct);

  const chosenSubs = statsSummary.bySubterritory.filter((r) => selectedSalidaSubIds.has(r.id));
  const suggestedPoint = getReferenceStreetsForSubs(selectedSalidaSubIds);
  const chosenPendingApts = chosenSubs.reduce((acc, s) => acc + (s.aptsTotal - s.aptsDone), 0);
  const chosenPendingFaces = chosenSubs.reduce((acc, s) => acc + (s.facesTotal - s.facesDone), 0);

  const urgentRecs = getUrgentRecommendations();

  container.innerHTML = `
    <div class="space-y-4 pb-24" id="printable-stats-area">
      <!-- ENCABEZADO -->
      <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 class="text-lg font-extrabold text-slate-900">📊 Informe de Predicación</h2>
          <p class="text-xs text-slate-500">
            Período: <b>${formatShortDate(filterFrom)}</b> al <b>${formatShortDate(filterTo)}</b> • ${escapeHtml(
              state.congregation?.nombre || ''
            )}
          </p>
        </div>
        <div class="flex items-center gap-2 print:hidden">
          <button type="button" id="btn-toggle-presentation"
            class="${
              presentationMode
                ? 'bg-amber-500 text-white'
                : 'bg-blue-50 text-blue-900 border border-blue-200'
            } font-bold px-3 py-2 rounded-xl text-xs">
            ${presentationMode ? '👁️ Salir Modo Pantalla' : '📽️ Modo Presentación'}
          </button>
          <button type="button" onclick="window.print()"
            class="bg-slate-900 hover:bg-slate-800 text-white font-bold px-3.5 py-2 rounded-xl text-xs shadow">
            🖨️ Guardar PDF
          </button>
        </div>
      </div>

      <!-- FILTRO DE FECHAS (IDEAL PARA CAMPAÑAS) -->
      ${
        presentationMode
          ? ''
          : `<div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3 print:hidden">
              <div class="flex items-center justify-between">
                <span class="text-xs font-extrabold text-slate-800">📅 Rango de fechas (Campañas / Períodos)</span>
                <div class="flex gap-1">
                  ${[
                    { id: '7', label: '7 días' },
                    { id: '30', label: '30 días' },
                    { id: '90', label: '90 días' }
                  ]
                    .map(
                      (p) => `
                      <button type="button" data-preset-days="${p.id}"
                        class="preset-days-btn px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                          activePreset === p.id
                            ? 'bg-blue-900 text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }">
                        ${p.label}
                      </button>
                    `
                    )
                    .join('')}
                </div>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                <div>
                  <label class="block text-[11px] font-bold text-slate-600 mb-1">Desde</label>
                  <input type="date" id="stats-date-from" value="${filterFrom}"
                    class="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold" />
                </div>
                <div>
                  <label class="block text-[11px] font-bold text-slate-600 mb-1">Hasta</label>
                  <input type="date" id="stats-date-to" value="${filterTo}"
                    class="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold" />
                </div>
                <button type="button" id="btn-apply-stats-dates"
                  class="w-full bg-blue-900 hover:bg-blue-800 text-white font-extrabold py-2.5 rounded-xl text-xs shadow">
                  Actualizar Estadísticas
                </button>
              </div>
            </div>`
      }

      <!-- DOS PICTOGRAMAS VISUALES PARA LA CONGREGACIÓN -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <!-- PICTOGRAMA 1: DEPARTAMENTOS EN EDIFICIOS -->
        <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
          <div class="flex items-start justify-between gap-2">
            <div>
              <span class="inline-block bg-blue-100 text-blue-950 font-extrabold text-[11px] px-2.5 py-0.5 rounded-full">
                EDIFICIOS (TIMBRES TOCADOS)
              </span>
              <div class="flex items-baseline gap-2 mt-1.5">
                <span class="text-3xl font-black text-blue-950">${aptPct}%</span>
                <span class="text-xs font-bold text-slate-500">cubierto en el período</span>
              </div>
            </div>
            <div class="text-right text-[11px] space-y-0.5">
              <div class="font-extrabold text-blue-900">🏢 ${statsSummary.visitedAptsCount} tocados</div>
              <div class="font-semibold text-slate-500">⬜ ${aptPending} pendientes</div>
              <div class="text-[10px] text-slate-400">Total: ${statsSummary.totalApts} timbres</div>
            </div>
          </div>

          ${buildPictogramGridHtml(aptPct, '🏢', '🏢', 'bg-blue-600 text-white', 'bg-slate-200')}

          <div class="flex items-center justify-between text-[11px] text-slate-500 pt-0.5">
            <span>Cada ícono = 1% de los departamentos</span>
            <span class="font-semibold">Incluye todo timbre tocado</span>
          </div>
        </div>

        <!-- PICTOGRAMA 2: CASAS / CUADRAS -->
        <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
          <div class="flex items-start justify-between gap-2">
            <div>
              <span class="inline-block bg-emerald-100 text-emerald-950 font-extrabold text-[11px] px-2.5 py-0.5 rounded-full">
                CASAS (CUADRAS TRABAJADAS)
              </span>
              <div class="flex items-baseline gap-2 mt-1.5">
                <span class="text-3xl font-black text-emerald-700">${facePct}%</span>
                <span class="text-xs font-bold text-slate-500">cubierto en el período</span>
              </div>
            </div>
            <div class="text-right text-[11px] space-y-0.5">
              <div class="font-extrabold text-emerald-700">🏠 ${statsSummary.completedFacesCount} trabajadas</div>
              <div class="font-semibold text-slate-500">⬜ ${facePending} pendientes</div>
              <div class="text-[10px] text-slate-400">Total: ${statsSummary.totalFaces} cuadras</div>
            </div>
          </div>

          ${buildPictogramGridHtml(facePct, '🏠', '🏠', 'bg-emerald-600 text-white', 'bg-slate-200')}

          <div class="flex items-center justify-between text-[11px] text-slate-500 pt-0.5">
            <span>Cada ícono = 1% de las cuadras</span>
            <span class="font-semibold">Veredas completadas</span>
          </div>
        </div>
      </div>

      <!-- SUGERIDOR INTELIGENTE DE SALIDAS (EDITABLE POR EL ORGANIZADOR) -->
      ${
        presentationMode
          ? ''
          : `<div class="bg-amber-50 border border-amber-300 p-4 rounded-2xl space-y-3 print:hidden">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 class="text-sm font-extrabold text-amber-950">
                    🧭 Sugerencia Inteligente para Próxima Salida
                  </h3>
                  <p class="text-[11px] text-amber-900">
                    Prioriza territorios cercanos con menor porcentaje trabajado. Tocá los territorios para personalizar la salida:
                  </p>
                </div>
                <button type="button" id="btn-reset-salida-suggestion"
                  class="bg-white border border-amber-300 hover:bg-amber-100 text-amber-950 font-bold px-2.5 py-1 rounded-lg text-[11px]">
                  ↻ Recalcular sugerencia
                </button>
              </div>

              <!-- Chips interactivos ordenados del menos trabajado al más trabajado -->
              <div class="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1">
                ${rankedForSalidas
                  .map((sub) => {
                    const isSelected = selectedSalidaSubIds.has(sub.id);
                    return `
                      <button type="button" data-toggle-salida-sub="${sub.id}"
                        class="toggle-salida-sub-btn px-2.5 py-1 rounded-lg text-xs font-bold border transition-all ${
                          isSelected
                            ? 'bg-amber-600 text-white border-amber-700 shadow-xs'
                            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                        }">
                        Terr. ${escapeHtml(sub.code)} (${sub.pct}%)
                      </button>
                    `;
                  })
                  .join('')}
              </div>

              <!-- Tarjeta resumen de la salida armándose -->
              <div class="bg-white p-3.5 rounded-xl border border-amber-200 space-y-2">
                ${
                  chosenSubs.length === 0
                    ? `<p class="text-xs text-slate-500">Seleccioná al menos un territorio arriba para armar la propuesta de salida.</p>`
                    : `
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div class="text-[11px] font-bold text-slate-500 uppercase">Territorios elegidos</div>
                          <div class="text-sm font-extrabold text-slate-900">
                            ${chosenSubs.map((s) => `Territorio ${escapeHtml(s.code)}`).join(' • ')}
                          </div>
                        </div>
                        <button type="button" id="btn-copy-salida-plan"
                          class="bg-slate-900 hover:bg-slate-800 text-white font-bold px-3 py-1.5 rounded-lg text-xs">
                          📋 Copiar propuesta
                        </button>
                      </div>
                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-100">
                        <div>
                          <span class="text-slate-500 font-semibold">📍 Punto de encuentro sugerido:</span><br>
                          <b class="text-slate-800">${escapeHtml(suggestedPoint)}</b>
                        </div>
                        <div>
                          <span class="text-slate-500 font-semibold">📋 Pendiente en esta zona:</span><br>
                          <b class="text-emerald-700">${chosenPendingFaces} cuadras</b> y
                          <b class="text-blue-900">${chosenPendingApts} timbres</b>
                        </div>
                      </div>
                    `
                }
              </div>
            </div>`
      }

      <!-- BUSCADOR URGENTE POR UBICACIÓN (IDEAL PARA VISITA DEL VIAJANTE / CAMPO) -->
      ${
        presentationMode
          ? ''
          : `<div class="bg-rose-50 border border-rose-300 p-4 rounded-2xl space-y-3 print:hidden">
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 class="text-sm font-extrabold text-rose-950">
                    🚨 Buscador Urgente por Ubicación
                  </h3>
                  <p class="text-[11px] text-rose-900">
                    Combiná tu ubicación actual (o una esquina donde vas a estar) con los territorios que hace más tiempo que no se predican:
                  </p>
                </div>
              </div>

              <!-- Controles de ubicación: GPS o Dirección planificada -->
              <div class="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
                <div class="md:col-span-4">
                  <button type="button" id="btn-urgent-gps" ${urgentLoading ? 'disabled' : ''}
                    class="w-full bg-rose-700 hover:bg-rose-800 disabled:opacity-60 text-white font-extrabold py-2.5 px-3 rounded-xl text-xs shadow flex items-center justify-center gap-1.5">
                    <span>📍</span>
                    <span>${urgentLoading ? 'Localizando...' : 'Usar mi ubicación actual (GPS)'}</span>
                  </button>
                </div>

                <div class="md:col-span-8 flex gap-1.5">
                  <input type="text" id="input-urgent-address"
                    value="${escapeHtml(urgentAddressQuery)}"
                    placeholder="O escribí esquina/dirección (ej. Córdoba y 9 de Julio)"
                    class="flex-1 px-3 py-2 rounded-xl border border-rose-300 bg-white text-xs font-semibold text-slate-800" />
                  <button type="button" id="btn-urgent-search-address" ${urgentLoading ? 'disabled' : ''}
                    class="bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white font-bold px-3.5 py-2 rounded-xl text-xs">
                    Buscar
                  </button>
                </div>
              </div>

              <!-- Selector de criterio de prioridad -->
              <div class="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <span class="text-[11px] font-bold text-rose-950">Criterio de búsqueda:</span>
                <div class="flex flex-wrap gap-1">
                  ${[
                    { id: 'balanced', label: '⚖️ Equilibrado (Cerca + Atrasado)' },
                    { id: 'closest', label: '📍 Más cercanos primero' },
                    { id: 'oldest', label: '⏳ Más tiempo sin predicar' }
                  ]
                    .map(
                      (m) => `
                      <button type="button" data-urgent-mode="${m.id}"
                        class="urgent-mode-btn px-2.5 py-1 rounded-lg text-[11px] font-bold border ${
                          urgentPriorityMode === m.id
                            ? 'bg-rose-800 text-white border-rose-900'
                            : 'bg-white text-rose-950 border-rose-200 hover:bg-rose-100'
                        }">
                        ${m.label}
                      </button>
                    `
                    )
                    .join('')}
                </div>
              </div>

              ${
                urgentStatusMsg
                  ? `<div class="text-xs font-semibold text-rose-900 bg-white/80 px-3 py-2 rounded-xl border border-rose-200">
                      ${escapeHtml(urgentStatusMsg)}
                    </div>`
                  : ''
              }

              <!-- Resultados recomendados -->
              ${
                urgentOrigin
                  ? `<div class="space-y-2 pt-1">
                      <div class="text-[11px] font-extrabold text-rose-950 uppercase tracking-wide">
                        📌 Mejores opciones desde: ${escapeHtml(urgentOrigin.label)}
                      </div>
                      ${
                        urgentRecs.length === 0
                          ? `<p class="text-xs text-slate-600 bg-white p-3 rounded-xl border border-rose-200">
                              No se encontraron territorios con coordenadas cargadas en esta congregación.
                            </p>`
                          : `<div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                              ${urgentRecs
                                .map((rec, idx) => {
                                  const isAlreadyInSalida = selectedSalidaSubIds.has(rec.id);
                                  const pendingFaces = Math.max(0, rec.facesTotal - rec.facesDone);
                                  const pendingApts = Math.max(0, rec.aptsTotal - rec.aptsDone);
                                  const ageText =
                                    rec.daysSinceLastWorked === null
                                      ? 'Nunca trabajado en el sistema'
                                      : rec.daysSinceLastWorked === 0
                                        ? 'Trabajado hoy'
                                        : `Hace ${rec.daysSinceLastWorked} días sin predicar`;
                                  const mapsUrl = rec.center
                                    ? `https://www.google.com/maps/dir/?api=1&destination=${rec.center.lat},${rec.center.lng}&travelmode=walking`
                                    : null;

                                  return `
                                    <div class="bg-white p-3.5 rounded-xl border border-rose-200 shadow-2xs flex flex-col justify-between gap-2.5">
                                      <div class="space-y-1">
                                        <div class="flex items-center justify-between gap-2">
                                          <span class="text-sm font-black text-slate-900">
                                            #${idx + 1} • Territorio ${escapeHtml(rec.code)}
                                          </span>
                                          <span class="text-[11px] font-extrabold px-2 py-0.5 rounded-full bg-rose-100 text-rose-900">
                                            ${formatDistanceLabel(rec.meters)}
                                          </span>
                                        </div>
                                        <div class="text-xs font-bold ${
                                          rec.daysSinceLastWorked === null || rec.daysSinceLastWorked >= 60
                                            ? 'text-amber-700'
                                            : 'text-slate-600'
                                        }">
                                          ⏳ ${ageText}
                                        </div>
                                        <div class="text-[11px] text-slate-500">
                                          Pendiente: <b>${pendingFaces} cuadras</b> • <b>${pendingApts} timbres</b> (${rec.pct}% cubierto en el rango)
                                        </div>
                                      </div>

                                      <div class="flex items-center gap-2 pt-1 border-t border-slate-100">
                                        <button type="button" data-add-urgent-sub="${rec.id}"
                                          class="add-urgent-sub-btn flex-1 py-1.5 px-2.5 rounded-lg text-xs font-bold transition-all ${
                                            isAlreadyInSalida
                                              ? 'bg-amber-100 text-amber-950 border border-amber-300'
                                              : 'bg-slate-900 hover:bg-slate-800 text-white'
                                          }">
                                          ${isAlreadyInSalida ? '✓ En propuesta de salida' : '➕ Sumar a salida'}
                                        </button>
                                        ${
                                          mapsUrl
                                            ? `<a href="${mapsUrl}" target="_blank" rel="noopener noreferrer"
                                                class="py-1.5 px-2.5 rounded-lg text-xs font-bold bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200">
                                                🗺️ Ir
                                              </a>`
                                            : ''
                                        }
                                      </div>
                                    </div>
                                  `;
                                })
                                .join('')}
                            </div>`
                      }
                    </div>`
                  : ''
              }
            </div>`
      }

      <!-- AVANCE DETALLADO POR SUBTERRITORIO -->
      ${
        presentationMode
          ? ''
          : `<div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
              <h3 class="text-sm font-extrabold text-slate-900">Avance por Subterritorio</h3>
              ${
                statsSummary.bySubterritory.length === 0
                  ? `<p class="text-xs text-slate-500">Todavía no hay territorios cargados.</p>`
                  : `<div class="space-y-3">
                      ${statsSummary.bySubterritory
                        .map(
                          (row) => `
                          <div class="space-y-1">
                            <div class="flex items-center justify-between text-xs">
                              <span class="font-extrabold text-slate-800">Territorio ${escapeHtml(row.code)}</span>
                              <span class="font-bold text-slate-600">
                                ${row.pct}% (${row.aptsDone}/${row.aptsTotal} deptos • ${row.facesDone}/${row.facesTotal} cuadras)
                              </span>
                            </div>
                            <div class="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                              <div class="bg-blue-900 h-full rounded-full" style="width: ${row.pct}%"></div>
                            </div>
                          </div>
                        `
                        )
                        .join('')}
                    </div>`
              }
            </div>`
      }
    </div>
  `;

  bindEstadisticasEvents(container, chosenSubs, suggestedPoint, chosenPendingFaces, chosenPendingApts);
}

function bindEstadisticasEvents(
  container,
  chosenSubs,
  suggestedPoint,
  chosenPendingFaces,
  chosenPendingApts
) {
  const presBtn = document.getElementById('btn-toggle-presentation');
  if (presBtn) {
    presBtn.onclick = () => {
      presentationMode = !presentationMode;
      renderEstadisticasView(container);
    };
  }

  document.querySelectorAll('.preset-days-btn').forEach((btn) => {
    btn.onclick = async () => {
      const days = parseInt(btn.getAttribute('data-preset-days'), 10);
      activePreset = String(days);
      filterFrom = getDaysAgoIso(days);
      filterTo = getTodayIso();
      await loadStatistics();
      renderEstadisticasView(container);
    };
  });

  const applyDatesBtn = document.getElementById('btn-apply-stats-dates');
  if (applyDatesBtn) {
    applyDatesBtn.onclick = async () => {
      const fromVal = document.getElementById('stats-date-from')?.value;
      const toVal = document.getElementById('stats-date-to')?.value;
      if (!fromVal || !toVal) return;
      filterFrom = fromVal;
      filterTo = toVal;
      activePreset = 'custom';
      applyDatesBtn.disabled = true;
      applyDatesBtn.textContent = 'Calculando...';
      await loadStatistics();
      renderEstadisticasView(container);
    };
  }

  document.querySelectorAll('.toggle-salida-sub-btn').forEach((btn) => {
    btn.onclick = () => {
      const subId = btn.getAttribute('data-toggle-salida-sub');
      if (selectedSalidaSubIds.has(subId)) {
        selectedSalidaSubIds.delete(subId);
      } else {
        selectedSalidaSubIds.add(subId);
      }
      renderEstadisticasView(container);
    };
  });

  const resetSugBtn = document.getElementById('btn-reset-salida-suggestion');
  if (resetSugBtn) {
    resetSugBtn.onclick = () => {
      applySmartSalidaSuggestion();
      renderEstadisticasView(container);
    };
  }

  const copyPlanBtn = document.getElementById('btn-copy-salida-plan');
  if (copyPlanBtn) {
    copyPlanBtn.onclick = async () => {
      const terrList = chosenSubs.map((s) => `Terr. ${s.code}`).join(', ');
      const text = `📍 Salida sugerida: ${terrList}\n📌 Punto de referencia: ${suggestedPoint}\n📋 Pendiente: ${chosenPendingFaces} cuadras y ${chosenPendingApts} timbres`;
      try {
        await navigator.clipboard.writeText(text);
        copyPlanBtn.textContent = '✓ ¡Copiado!';
        setTimeout(() => {
          copyPlanBtn.textContent = '📋 Copiar propuesta';
        }, 2000);
      } catch (e) {
        alert(text);
      }
    };
  }

  // --- Eventos del Buscador Urgente por Ubicación ---
  const gpsBtn = document.getElementById('btn-urgent-gps');
  if (gpsBtn) {
    gpsBtn.onclick = () => {
      if (!navigator.geolocation) {
        urgentStatusMsg = 'Tu navegador no soporta geolocalización GPS.';
        renderEstadisticasView(container);
        return;
      }
      urgentLoading = true;
      urgentStatusMsg = 'Obteniendo ubicación GPS...';
      renderEstadisticasView(container);

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          urgentLoading = false;
          urgentStatusMsg = '';
          urgentOrigin = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            label: 'Mi ubicación actual (GPS)'
          };
          renderEstadisticasView(container);
        },
        (err) => {
          urgentLoading = false;
          urgentStatusMsg =
            'No se pudo obtener el GPS (verificá permisos de ubicación) o escribí una esquina manualmente.';
          renderEstadisticasView(container);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    };
  }

  const addrInput = document.getElementById('input-urgent-address');
  if (addrInput) {
    addrInput.oninput = () => {
      urgentAddressQuery = addrInput.value;
    };
    addrInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('btn-urgent-search-address')?.click();
      }
    };
  }

  const searchAddrBtn = document.getElementById('btn-urgent-search-address');
  if (searchAddrBtn) {
    searchAddrBtn.onclick = async () => {
      const q = (document.getElementById('input-urgent-address')?.value || '').trim();
      urgentAddressQuery = q;
      if (!q) {
        urgentStatusMsg = 'Escribí una calle y altura o intersección (ej. "Córdoba y 9 de Julio").';
        renderEstadisticasView(container);
        return;
      }
      urgentLoading = true;
      urgentStatusMsg = `Buscando "${q}" en el mapa...`;
      renderEstadisticasView(container);

      try {
        const coords = await geocodePlannedAddress(q);
        urgentLoading = false;
        if (!coords) {
          urgentStatusMsg = `No se encontró la dirección "${q}". Probá agregando la ciudad o una esquina cercana.`;
        } else {
          urgentStatusMsg = '';
          urgentOrigin = coords;
        }
      } catch (e) {
        urgentLoading = false;
        urgentStatusMsg = 'Error al buscar la dirección. Verificá tu conexión.';
      }
      renderEstadisticasView(container);
    };
  }

  document.querySelectorAll('.urgent-mode-btn').forEach((btn) => {
    btn.onclick = () => {
      urgentPriorityMode = btn.getAttribute('data-urgent-mode');
      renderEstadisticasView(container);
    };
  });

  document.querySelectorAll('.add-urgent-sub-btn').forEach((btn) => {
    btn.onclick = () => {
      const subId = btn.getAttribute('data-add-urgent-sub');
      if (selectedSalidaSubIds.has(subId)) {
        selectedSalidaSubIds.delete(subId);
      } else {
        selectedSalidaSubIds.add(subId);
      }
      renderEstadisticasView(container);
    };
  });
}
