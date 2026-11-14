import { state, isAdmin } from './state.js';
import { escapeHtml } from './ui-helpers.js';
import {
  loadUserSession,
  renderLoginScreen,
  renderCongregationRequestScreen,
  renderStatusNoticeScreen,
  signOut
} from './auth.js';
import { loadBuildings, renderEdificiosView } from './edificios.js';
import {
  loadBlocksAndFaces,
  renderManzanasView,
  checkDnvProximityAlert
} from './manzanas.js';
import {
  loadSchedulesAndPoints,
  renderSalidasView,
  renderPublicCartelera
} from './salidas.js';
import { loadAdminData, renderAdminView } from './admin.js';
import { loadStatistics, renderEstadisticasView } from './estadisticas.js';

const root = document.getElementById('app-root');
let geoWatchId = null;

async function bootstrap() {
  // 1. Verificar si es acceso directo a cartelera pública (#/salidas/slug)
  const hash = window.location.hash || '';
  if (hash.startsWith('#/salidas/')) {
    const slug = decodeURIComponent(hash.replace('#/salidas/', '').split('?')[0]).trim();
    if (slug) {
      await renderPublicCartelera(root, slug);
      return;
    }
  }

  // 2. Verificar sesión autenticada
  const sessionResult = await loadUserSession();

  if (!sessionResult) {
    renderLoginScreen(root, bootstrap);
    return;
  }

  if (sessionResult.status === 'no_profile') {
    await renderCongregationRequestScreen(root, bootstrap);
    return;
  }

  if (sessionResult.status === 'pending' || sessionResult.status === 'blocked') {
    renderStatusNoticeScreen(root, sessionResult.status);
    return;
  }

  // 3. Usuario aprobado: cargar datos de la congregación y renderizar app
  await reloadAllData();
  startGpsProximityWatcher();
  renderMainShell();
}

async function reloadAllData() {
  const tasks = [
    loadBuildings(),
    loadBlocksAndFaces(),
    loadSchedulesAndPoints()
  ];
  if (isAdmin()) {
    tasks.push(loadAdminData());
  }
  await Promise.all(tasks);
  await loadStatistics();
}

function startGpsProximityWatcher() {
  if (!navigator.geolocation || geoWatchId !== null) return;
  geoWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      state.userLocation = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude
      };
      checkDnvProximityAlert(pos.coords.latitude, pos.coords.longitude);
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 15000 }
  );
}

function renderMainShell() {
  const adminMode = isAdmin();

  const tabs = [
    { id: 'edificios', icon: '🏢', label: 'Edificios' },
    { id: 'manzanas', icon: '🗺️', label: 'Manzanas' },
    { id: 'salidas', icon: '📅', label: 'Salidas' },
    { id: 'estadisticas', icon: '📊', label: 'Avance' },
    ...(adminMode ? [{ id: 'admin', icon: '⚙️', label: 'Admin' }] : [])
  ];

  root.innerHTML = `
    <div class="min-h-screen bg-slate-100 flex flex-col">
      <header class="bg-blue-950 text-white px-4 py-3.5 shadow-md sticky top-0 z-30 flex items-center justify-between print:hidden">
        <div>
          <h1 class="text-base font-black tracking-tight leading-tight">
            ${escapeHtml(state.congregation?.nombre || 'Territorios')}
          </h1>
          <p class="text-[11px] text-blue-200">
            ${escapeHtml(state.profile?.full_name || state.profile?.email || '')}
          </p>
        </div>
        <button id="btn-header-logout"
          class="text-xs font-bold bg-blue-900 hover:bg-blue-800 px-3 py-1.5 rounded-xl border border-blue-800">
          Salir
        </button>
      </header>

      <main id="tab-content" class="flex-1 max-w-xl w-full mx-auto p-4"></main>

      <nav class="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 z-30 shadow-lg print:hidden">
        <div class="max-w-xl mx-auto grid grid-cols-${tabs.length}">
          ${tabs
            .map(
              (t) => `
              <button data-tab="${t.id}"
                class="nav-tab-btn py-2.5 flex flex-col items-center justify-center gap-0.5 text-xs font-bold transition ${
                  state.currentTab === t.id
                    ? 'text-blue-950 bg-blue-50/70 border-t-2 border-blue-900'
                    : 'text-slate-500 hover:text-slate-800'
                }">
                <span class="text-lg leading-none">${t.icon}</span>
                <span>${t.label}</span>
              </button>
            `
            )
            .join('')}
        </div>
      </nav>
    </div>
  `;

  document.getElementById('btn-header-logout').onclick = signOut;

  document.querySelectorAll('.nav-tab-btn').forEach((btn) => {
    btn.onclick = () => {
      state.currentTab = btn.getAttribute('data-tab');
      renderMainShell();
    };
  });

  const contentEl = document.getElementById('tab-content');
  if (state.currentTab === 'edificios') {
    renderEdificiosView(contentEl);
  } else if (state.currentTab === 'manzanas') {
    renderManzanasView(contentEl);
  } else if (state.currentTab === 'salidas') {
    renderSalidasView(contentEl);
  } else if (state.currentTab === 'estadisticas') {
    renderEstadisticasView(contentEl);
  } else if (state.currentTab === 'admin' && adminMode) {
    renderAdminView(contentEl, async () => {
      await reloadAllData();
      renderMainShell();
    });
  }
}

window.addEventListener('hashchange', bootstrap);
bootstrap();
