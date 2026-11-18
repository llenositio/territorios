import { supabase } from './supabase.js';
import { state, isSuperadmin, isAdmin } from './state.js';
import {
  initAuth,
  signOutUser,
  renderAuthView,
  bindAuthEvents,
  renderPendingApprovalView
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
import { loadStatistics, renderEstadisticasView } from './estadisticas.js';
import { loadAdminData, renderAdminView } from './admin.js';
import { showToast, escapeHtml } from './ui-helpers.js';

let allCongregations = [];
let gpsWatchId = null;

async function bootstrap() {
  const root = document.getElementById('app-root');

  // Ruta pública sin login: #/salidas/:slug
  const hash = window.location.hash || '';
  if (hash.startsWith('#/salidas/')) {
    const slug = decodeURIComponent(hash.replace('#/salidas/', '').trim());
    await renderPublicCartelera(root, slug);
    return;
  }

  const session = await initAuth();
  if (!session) {
    root.innerHTML = renderAuthView();
    bindAuthEvents(async () => {
      await bootstrap();
    });
    return;
  }

  if (!state.profile || state.profile.status !== 'approved') {
    root.innerHTML = renderPendingApprovalView();
    document.getElementById('btn-logout-pending')?.addEventListener('click', signOutUser);
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
}

async function reloadAllData() {
  const tasks = [
    loadBuildings(),
    loadBlocksAndFaces(),
    loadSchedulesAndPoints()
  ];
  if (isAdmin()) {
    tasks.push(loadAdminData(), loadStatistics());
  }
  await Promise.all(tasks);
}

// GPS en segundo plano solo para alertas pasivas de casas "No Visitar"
function startGpsWatcher() {
  if (!navigator.geolocation || gpsWatchId !== null) return;
  gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      state.userLocation = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude
      };
      checkDnvProximityAlert(pos.coords.latitude, pos.coords.longitude);
    },
    () => {},
    { enableHighAccuracy: false, maximumAge: 60000, timeout: 15000 }
  );
}

// Solicitud explícita de GPS al tocar "Edificios cerca de mí" o entrar a un edificio
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

function renderMainShell() {
  const root = document.getElementById('app-root');
  const adminMode = isAdmin();
  const superMode = isSuperadmin();

  // Si el usuario no es admin y quedó en una pestaña restringida, volver a edificios
  if (!adminMode && (state.currentTab === 'estadisticas' || state.currentTab === 'admin')) {
    state.currentTab = 'edificios';
  }

  const tabs = [
    { id: 'edificios', icon: '🏢', label: 'Edificios' },
    { id: 'manzanas', icon: '🗺️', label: 'Manzanas' },
    { id: 'salidas', icon: '📅', label: 'Salidas' },
    ...(adminMode ? [{ id: 'estadisticas', icon: '📊', label: 'Avance' }] : []),
    ...(adminMode ? [{ id: 'admin', icon: '⚙️', label: 'Admin' }] : [])
  ];

  const gridColsClass = adminMode ? 'grid-cols-5' : 'grid-cols-3';

  root.innerHTML = `
    <div class="min-h-screen flex flex-col bg-slate-100">
      <!-- Header Superior -->
      <header class="bg-blue-950 text-white px-4 py-3 shadow-md sticky top-0 z-30">
        <div class="max-w-3xl mx-auto flex items-center justify-between gap-2">
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

          <button id="btn-logout-main"
            class="bg-blue-900 hover:bg-blue-800 text-blue-100 text-xs font-bold px-3 py-2 rounded-xl border border-blue-800 shrink-0">
            Salir
          </button>
        </div>
      </header>

      <!-- Contenedor Principal de Vista -->
      <main id="tab-content" class="flex-1 max-w-3xl w-full mx-auto p-4"></main>

      <!-- Barra de Navegación Inferior -->
      <nav class="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 z-30 shadow-lg">
        <div class="max-w-3xl mx-auto grid ${gridColsClass}">
          ${tabs
            .map((t) => {
              const active = state.currentTab === t.id;
              return `
                <button data-tab="${t.id}"
                  class="nav-tab-btn py-2.5 flex flex-col items-center justify-center gap-0.5 transition ${
                    active
                      ? 'text-blue-900 font-extrabold bg-blue-50/70 border-t-2 border-blue-900'
                      : 'text-slate-500 font-semibold hover:text-slate-800'
                  }">
                  <span class="text-lg leading-none">${t.icon}</span>
                  <span class="text-[11px]">${t.label}</span>
                </button>
              `;
            })
            .join('')}
        </div>
      </nav>
    </div>
  `;

  document.getElementById('btn-logout-main').onclick = signOutUser;

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
      if (tab === 'estadisticas') {
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
  } else if (state.currentTab === 'salidas') {
    renderSalidasView(content);
  } else if (state.currentTab === 'estadisticas' && adminMode) {
    renderEstadisticasView(content);
  } else if (state.currentTab === 'admin' && adminMode) {
    renderAdminView(content);
  }
}

window.addEventListener('hashchange', bootstrap);
bootstrap();
