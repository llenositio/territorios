import { supabase } from './supabase.js';
import { state, isSuperadmin, isAdmin, canManageAnnualReviews } from './state.js';
import {
  loadUserSession,
  signOut,
  renderLoginScreen,
  renderCongregationRequestScreen,
  renderStatusNoticeScreen
} from './auth.js';
import { loadBuildings, renderEdificiosView } from './edificios.js';
import {
  loadBlocksAndFaces,
  renderManzanasView,
  checkDnvProximityAlert
} from './manzanas.js';
import { loadTelephonesBatch, renderTelefonosView } from './telefonos.js';
import {
  loadSchedulesAndPoints,
  renderSalidasView,
  renderPublicCartelera
} from './salidas.js';
import { loadStatistics, renderEstadisticasView } from './estadisticas.js';
import { loadAdminData, renderAdminView } from './admin.js';
import { loadAnnualReviewData } from './revision-anual.js';
import { showToast, escapeHtml } from './ui-helpers.js';

let allCongregations = [];
let gpsWatchId = null;
let isBootstrapping = false;

async function bootstrap() {
  if (isBootstrapping) return;
  isBootstrapping = true;

  try {
    const root = document.getElementById('app-root');

    // Ruta pública sin login: #/salidas/:slug
    const hash = window.location.hash || '';
    if (hash.startsWith('#/salidas/')) {
      const slug = decodeURIComponent(hash.replace('#/salidas/', '').trim());
      await renderPublicCartelera(root, slug);
      return;
    }

    const sessionResult = await loadUserSession();
    if (!sessionResult) {
      renderLoginScreen(root, async () => {
        await bootstrap();
      });
      return;
    }

    if (sessionResult.status === 'no_profile') {
      await renderCongregationRequestScreen(root, async () => {
        await bootstrap();
      });
      return;
    }

    if (sessionResult.status !== 'approved') {
      renderStatusNoticeScreen(root, sessionResult.status);
      return;
    }

    if (isSuperadmin()) {
      const { data } = await supabase
        .from('congregaciones')
        .select('id, nombre')
        .order('nombre', { ascending: true });
      allCongregations = data || [];
    }

    await reloadAllData();
    startGpsWatcher();
    renderMainShell();
  } catch (err) {
    console.error('Error al iniciar la aplicación:', err);
    const root = document.getElementById('app-root');
    if (root) {
      root.innerHTML = `
        <div class="min-h-screen flex items-center justify-center p-4 bg-slate-100">
          <div class="bg-white p-6 rounded-2xl shadow max-w-md w-full text-center space-y-3 border border-rose-200">
            <div class="text-2xl">⚠️</div>
            <h2 class="text-base font-extrabold text-slate-900">Error al cargar la aplicación</h2>
            <p class="text-xs text-slate-600">${escapeHtml(err?.message || 'Error inesperado')}</p>
            <button onclick="location.href=location.pathname"
              class="bg-blue-900 text-white font-bold px-4 py-2 rounded-xl text-xs">
              Reintentar
            </button>
          </div>
        </div>
      `;
    }
  } finally {
    isBootstrapping = false;
  }
}

async function reloadAllData() {
  const tasks = [
    loadBuildings(),
    loadBlocksAndFaces(),
    loadTelephonesBatch(),
    loadSchedulesAndPoints()
  ];
  if (isAdmin()) {
    tasks.push(loadAdminData(), loadStatistics());
  } else if (canManageAnnualReviews()) {
    tasks.push(loadAnnualReviewData());
  }
  await Promise.all(tasks);
}

// GPS en tiempo real para ubicar al usuario en los mapas y alertas de casas "No Visitar"
function startGpsWatcher() {
  if (!navigator.geolocation || gpsWatchId !== null) return;
  gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      state.userLocation = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude
      };
      window.dispatchEvent(
        new CustomEvent('user-location-updated', { detail: state.userLocation })
      );
      checkDnvProximityAlert(pos.coords.latitude, pos.coords.longitude);
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}

export function requestOnDemandGps({ silent = false, onSuccess = null } = {}) {
  if (!navigator.geolocation) {
    if (!silent) showToast('Tu dispositivo no soporta GPS', 'error');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.userLocation = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude
      };
      window.dispatchEvent(
        new CustomEvent('user-location-updated', { detail: state.userLocation })
      );
      checkDnvProximityAlert(pos.coords.latitude, pos.coords.longitude);
      if (onSuccess) onSuccess(state.userLocation);
    },
    (err) => {
      if (!silent) {
        if (err.code === 1) {
          showToast('Activá el permiso de ubicación en tu navegador para ordenar por cercanía', 'warning');
        } else {
          showToast('No se pudo obtener la señal GPS. Intentá de nuevo.', 'warning');
        }
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
  );
}

window.goToSalidasWithTerritories = (territories = []) => {
  if (Array.isArray(territories) && territories.length > 0) {
    state.proposedTerritories = territories.map(String);
    try {
      localStorage.setItem('terr_proposed_territories', JSON.stringify(state.proposedTerritories));
    } catch {}
  }
  state.currentTab = 'salidas';
  renderMainShell();
};

function renderMainShell() {
  const root = document.getElementById('app-root');
  const adminMode = isAdmin();
  const superMode = isSuperadmin();
  const reviewMode = canManageAnnualReviews();

  if (!adminMode && (state.currentTab === 'estadisticas' || state.currentTab === 'admin')) {
    state.currentTab = 'edificios';
  }

  const redAlerts = state.reviewAlertsCount?.red || 0;
  const yellowAlerts = state.reviewAlertsCount?.yellow || 0;
  const totalReviewAlerts = redAlerts + yellowAlerts;

  const tabs = [
    { id: 'edificios', icon: '🏢', label: 'Edificios' },
    { id: 'manzanas', icon: '🗺️', label: 'Manzanas' },
    { id: 'telefonos', icon: '📞', label: 'Teléfonos' },
    { id: 'salidas', icon: '📅', label: 'Salidas' },
    ...(adminMode ? [{ id: 'estadisticas', icon: '📊', label: 'Avance' }] : []),
    ...(adminMode
      ? [
          {
            id: 'admin',
            icon: '⚙️',
            label: 'Admin',
            badge: totalReviewAlerts > 0 ? totalReviewAlerts : null,
            badgeColor: redAlerts > 0 ? 'bg-rose-600' : 'bg-amber-500'
          }
        ]
      : [])
  ];

  const gridColsClass = adminMode ? 'grid-cols-6' : 'grid-cols-4';

  root.innerHTML = `
    <div class="min-h-screen flex flex-col bg-slate-100">
      <!-- Header Superior -->
      <header class="bg-blue-950 text-white px-4 py-3 shadow-md sticky top-0 z-30">
        <div class="max-w-6xl mx-auto flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="text-[10px] uppercase tracking-widest text-blue-300 font-bold">
              Territorios • ${escapeHtml(state.profile?.role || '')}
            </div>
            ${
              superMode && allCongregations.length > 0
                ? `<select id="superadmin-cong-select"
                    class="mt-0.5 bg-blue-900 text-white font-extrabold text-sm rounded-lg px-2 py-1 border border-blue-700 max-w-[230px]">
                    ${allCongregations
                      .map(
                        (c) =>
                          `<option value="${c.id}" ${
                            c.id === state.congregation?.id ? 'selected' : ''
                          }>${escapeHtml(c.nombre)}</option>`
                      )
                      .join('')}
                  </select>`
                : `<h1 class="text-base font-extrabold truncate">${escapeHtml(
                    state.congregation?.nombre || 'Congregación'
                  )}</h1>`
            }
          </div>

          <div class="flex items-center gap-2 shrink-0">
            ${
              reviewMode && totalReviewAlerts > 0
                ? `<button id="btn-header-review-alert"
                    class="${
                      redAlerts > 0
                        ? 'bg-rose-600 hover:bg-rose-500 text-white'
                        : 'bg-amber-400 hover:bg-amber-300 text-slate-950'
                    } text-xs font-extrabold px-2.5 py-2 rounded-xl shadow-xs transition">
                    ${redAlerts > 0 ? `🚨 ${redAlerts} venc.` : `⚠️ ${yellowAlerts} rev.`}
                  </button>`
                : ''
            }
            <button id="btn-logout-main"
              class="bg-blue-900 hover:bg-blue-800 text-blue-100 text-xs font-bold px-3 py-2 rounded-xl border border-blue-800">
              Salir
            </button>
          </div>
        </div>
      </header>

      <!-- Contenedor Principal de Vista -->
      <main id="tab-content" class="flex-1 max-w-6xl w-full mx-auto p-4"></main>

      <!-- Barra de Navegación Inferior -->
      <nav class="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 z-30 shadow-lg">
        <div class="max-w-6xl mx-auto grid ${gridColsClass}">
          ${tabs
            .map((t) => {
              const active = state.currentTab === t.id;
              return `
                <button data-tab="${t.id}"
                  class="nav-tab-btn relative py-2.5 flex flex-col items-center justify-center gap-0.5 transition ${
                    active
                      ? 'text-blue-900 font-extrabold bg-blue-50/70 border-t-2 border-blue-900'
                      : 'text-slate-500 font-semibold hover:text-slate-800'
                  }">
                  ${
                    t.badge
                      ? `<span class="absolute top-1.5 right-2 ${t.badgeColor} text-white text-[9px] font-black px-1.5 py-0.2 rounded-full">
                          ${t.badge}
                        </span>`
                      : ''
                  }
                  <span class="text-lg leading-none">${t.icon}</span>
                  <span class="text-[10px] sm:text-[11px]">${t.label}</span>
                </button>
              `;
            })
            .join('')}
        </div>
      </nav>
    </div>
  `;

  document.getElementById('btn-logout-main').onclick = signOut;

  const headerAlertBtn = document.getElementById('btn-header-review-alert');
  if (headerAlertBtn) {
    headerAlertBtn.onclick = async () => {
      state.currentTab = 'admin';
      await loadAdminData();
      renderMainShell();
    };
  }

  const superSelect = document.getElementById('superadmin-cong-select');
  if (superSelect) {
    superSelect.onchange = async (e) => {
      const newId = e.target.value;
      const found = allCongregations.find((c) => c.id === newId);
      if (!found) return;
      state.congregation = found;
      const { data: settings } = await supabase
        .from('terr_congregation_settings')
        .select('*')
        .eq('congregation_id', newId)
        .maybeSingle();
      state.settings = settings || null;
      showToast(`Cambiado a ${found.nombre}`, 'info');
      await reloadAllData();
      renderMainShell();
    };
  }

  document.querySelectorAll('.nav-tab-btn').forEach((btn) => {
    btn.onclick = async () => {
      const tab = btn.getAttribute('data-tab');
      if ((tab === 'estadisticas' || tab === 'admin') && !isAdmin()) return;
      state.currentTab = tab;
      if (tab === 'telefonos') {
        await loadTelephonesBatch();
      } else if (tab === 'estadisticas') {
        await loadStatistics();
      } else if (tab === 'admin') {
        await loadAdminData();
      }
      renderMainShell();
    };
  });

  const content = document.getElementById('tab-content');
  if (state.currentTab === 'edificios') {
    renderEdificiosView(content);
  } else if (state.currentTab === 'manzanas') {
    renderManzanasView(content);
  } else if (state.currentTab === 'telefonos') {
    renderTelefonosView(content);
  } else if (state.currentTab === 'salidas') {
    renderSalidasView(content);
  } else if (state.currentTab === 'estadisticas' && adminMode) {
    renderEstadisticasView(content);
  } else if (state.currentTab === 'admin' && adminMode) {
    renderAdminView(content, async () => {
      await reloadAllData();
      renderMainShell();
    });
  }
}

window.addEventListener('hashchange', () => {
  const h = window.location.hash || '';
  if (h.startsWith('#/salidas/') || h === '') {
    bootstrap();
  }
});

bootstrap();
