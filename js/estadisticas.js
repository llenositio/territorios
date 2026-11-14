import { supabase } from './supabase.js';
import { state } from './state.js';
import { daysAgo, formatRelativeDate, escapeHtml } from './ui-helpers.js';

let statsSummary = {
  totalApts: 0,
  visitedLast90d: 0,
  totalFaces: 0,
  facesLast90d: 0,
  bySubterritory: []
};

export async function loadStatistics() {
  if (!state.congregation?.id) return;

  const { data: apts } = await supabase
    .from('terr_apartments')
    .select('id, building_id, status, last_visited_at')
    .eq('congregation_id', state.congregation.id)
    .eq('status', 'active');

  const allApts = apts || [];
  const visited90 = allApts.filter((a) => {
    const d = daysAgo(a.last_visited_at);
    return d !== null && d <= 90;
  });

  const allFaces = state.blockFaces || [];
  const faces90 = allFaces.filter((f) => {
    const d = daysAgo(f.last_completed_at);
    return d !== null && d <= 90;
  });

  const bldgSubMap = new Map(state.buildings.map((b) => [b.id, b.subterritory_id]));
  const blkSubMap = new Map(state.blocks.map((b) => [b.id, b.subterritory_id]));

  const rows = state.subterritories.map((sub) => {
    const subApts = allApts.filter((a) => bldgSubMap.get(a.building_id) === sub.id);
    const subAptsDone = subApts.filter((a) => {
      const d = daysAgo(a.last_visited_at);
      return d !== null && d <= 90;
    });

    const subFaces = allFaces.filter((f) => blkSubMap.get(f.block_id) === sub.id);
    const subFacesDone = subFaces.filter((f) => {
      const d = daysAgo(f.last_completed_at);
      return d !== null && d <= 90;
    });

    const totalItems = subApts.length + subFaces.length;
    const doneItems = subAptsDone.length + subFacesDone.length;
    const pct = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;

    return {
      code: sub.code,
      aptsTotal: subApts.length,
      aptsDone: subAptsDone.length,
      facesTotal: subFaces.length,
      facesDone: subFacesDone.length,
      pct
    };
  });

  statsSummary = {
    totalApts: allApts.length,
    visitedLast90d: visited90.length,
    totalFaces: allFaces.length,
    facesLast90d: faces90.length,
    bySubterritory: rows
  };
}

export function renderEstadisticasView(container) {
  const aptPct =
    statsSummary.totalApts > 0
      ? Math.round((statsSummary.visitedLast90d / statsSummary.totalApts) * 100)
      : 0;
  const facePct =
    statsSummary.totalFaces > 0
      ? Math.round((statsSummary.facesLast90d / statsSummary.totalFaces) * 100)
      : 0;

  container.innerHTML = `
    <div class="space-y-4 pb-24" id="printable-stats-area">
      <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex items-center justify-between">
        <div>
          <h2 class="text-lg font-extrabold text-slate-900">📊 Cobertura de Territorios</h2>
          <p class="text-xs text-slate-500">Últimos 90 días • ${escapeHtml(state.congregation?.nombre || '')}</p>
        </div>
        <button onclick="window.print()"
          class="bg-slate-900 hover:bg-slate-800 text-white font-bold px-3.5 py-2.5 rounded-xl text-xs shadow print:hidden">
          🖨️ Guardar PDF
        </button>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
          <div class="text-xs font-bold text-slate-500">Departamentos (90d)</div>
          <div class="text-2xl font-black text-blue-950 mt-1">${aptPct}%</div>
          <div class="text-xs text-slate-500 mt-0.5">
            ${statsSummary.visitedLast90d} de ${statsSummary.totalApts} timbres
          </div>
        </div>

        <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
          <div class="text-xs font-bold text-slate-500">Cuadras / Casas (90d)</div>
          <div class="text-2xl font-black text-emerald-700 mt-1">${facePct}%</div>
          <div class="text-xs text-slate-500 mt-0.5">
            ${statsSummary.facesLast90d} de ${statsSummary.totalFaces} cuadras
          </div>
        </div>
      </div>

      <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
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
      </div>
    </div>
  `;
}
