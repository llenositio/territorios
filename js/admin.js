import { state, isSuperadmin, canManageAnnualReviews } from './state.js';
import { renderImportadorHtml, bindImportadorEvents } from './importador.js';
import {
  loadBuildingsAdminData,
  renderBuildingsAdminHtml,
  bindBuildingsAdminEvents
} from './admin-edificios.js';
import {
  loadPolygonsAdminData,
  renderPolygonsAdminHtml,
  bindPolygonsAdminEvents
} from './admin-poligonos.js';
import {
  loadUsersAdminData,
  renderUsersAdminHtml,
  bindUsersAdminEvents
} from './admin-usuarios.js';
import {
  loadGeneralAdminData,
  renderGeneralAdminHtml,
  bindGeneralAdminEvents
} from './admin-general.js';
import {
  loadAnnualReviewData,
  renderRevisionAnualView
} from './revision-anual.js';

let activeAdminSubtab = 'edificios';

export async function loadAdminData() {
  if (!state.congregation?.id) return;
  const tasks = [
    loadBuildingsAdminData(),
    loadPolygonsAdminData(),
    loadUsersAdminData(),
    loadGeneralAdminData()
  ];
  if (canManageAnnualReviews()) {
    tasks.push(loadAnnualReviewData());
  }
  await Promise.all(tasks);
}

export function renderAdminView(container, onGlobalRefresh) {
  const showReviews = canManageAnnualReviews();
  const totalAlerts =
    (state.reviewAlertsCount?.yellow || 0) + (state.reviewAlertsCount?.red || 0);
  const hasRedAlert = (state.reviewAlertsCount?.red || 0) > 0;

  const subtabs = [
    { id: 'edificios', label: '🏢 Edificios' },
    { id: 'poligonos', label: '🗺️ Mapas' },
    ...(showReviews
      ? [
          {
            id: 'revision',
            label: totalAlerts > 0 ? `🔔 Revisión (${totalAlerts})` : '🚫 No Visitar',
            highlight: totalAlerts > 0 ? (hasRedAlert ? 'red' : 'yellow') : null
          }
        ]
      : []),
    { id: 'importar', label: '📥 Importar' },
    { id: 'usuarios', label: '👥 Usuarios' },
    { id: 'general', label: isSuperadmin() ? '🌐 Congregaciones' : '⚙️ General' }
  ];

  container.innerHTML = `
    <div class="space-y-4 pb-24">
      <!-- Sub-navegación de Administración -->
      <div class="bg-white p-2 rounded-2xl shadow-sm border border-slate-200 flex gap-1 overflow-x-auto">
        ${subtabs
          .map((t) => {
            const active = activeAdminSubtab === t.id;
            let extraClass = active
              ? 'bg-blue-900 text-white'
              : 'text-slate-600 hover:bg-slate-100';
            if (!active && t.highlight === 'red') {
              extraClass = 'bg-rose-50 text-rose-800 border border-rose-200';
            } else if (!active && t.highlight === 'yellow') {
              extraClass = 'bg-amber-50 text-amber-900 border border-amber-200';
            }

            return `
              <button data-subtab="${t.id}"
                class="admin-subtab-btn px-3 py-2 rounded-xl text-xs font-extrabold whitespace-nowrap transition ${extraClass}">
                ${t.label}
              </button>
            `;
          })
          .join('')}
      </div>

      <div id="admin-subtab-content"></div>
    </div>
  `;

  document.querySelectorAll('.admin-subtab-btn').forEach((btn) => {
    btn.onclick = () => {
      activeAdminSubtab = btn.getAttribute('data-subtab');
      renderAdminView(container, onGlobalRefresh);
    };
  });

  const subContainer = document.getElementById('admin-subtab-content');

  if (activeAdminSubtab === 'edificios') {
    subContainer.innerHTML = renderBuildingsAdminHtml();
    bindBuildingsAdminEvents(subContainer, async () => {
      await loadBuildingsAdminData();
      if (onGlobalRefresh) await onGlobalRefresh();
    });
  } else if (activeAdminSubtab === 'poligonos') {
    subContainer.innerHTML = renderPolygonsAdminHtml();
    bindPolygonsAdminEvents(subContainer, async () => {
      await loadPolygonsAdminData();
      if (onGlobalRefresh) await onGlobalRefresh();
    });
  } else if (activeAdminSubtab === 'revision' && showReviews) {
    renderRevisionAnualView(subContainer, async () => {
      if (onGlobalRefresh) await onGlobalRefresh();
    });
  } else if (activeAdminSubtab === 'importar') {
    subContainer.innerHTML = renderImportadorHtml();
    bindImportadorEvents(async () => {
      await loadBuildingsAdminData();
      if (onGlobalRefresh) await onGlobalRefresh();
    });
  } else if (activeAdminSubtab === 'usuarios') {
    subContainer.innerHTML = renderUsersAdminHtml();
    bindUsersAdminEvents(subContainer, async () => {
      await loadUsersAdminData();
    });
  } else if (activeAdminSubtab === 'general') {
    subContainer.innerHTML = renderGeneralAdminHtml();
    bindGeneralAdminEvents(subContainer, async () => {
      await loadGeneralAdminData();
      if (onGlobalRefresh) await onGlobalRefresh();
    });
  }
}
