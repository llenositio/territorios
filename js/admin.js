import { supabase } from './supabase.js';
import { state, isSuperadmin } from './state.js';
import { escapeHtml } from './ui-helpers.js';
import { renderGeneralAdminHtml, bindGeneralAdminEvents } from './admin-general.js';
import { renderPolygonMapperHtml, bindPolygonMapperEvents } from './admin-poligonos.js';
import { renderUsersAdminHtml, bindUsersAdminEvents } from './admin-usuarios.js';
import { renderBuildingsAdminHtml, bindBuildingsAdminEvents } from './admin-edificios.js';

let pendingUsers = [];
let allCongUsers = [];
let pendingReports = [];
let congregationsList = [];
let hermanosCongList = [];
let adminSubTab = 'general';

export async function loadAdminData() {
  if (!state.congregation?.id) return;

  const [usersRes, repRes, hermRes] = await Promise.all([
    supabase
      .from('terr_users')
      .select('*')
      .eq('congregation_id', state.congregation.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('terr_new_building_reports')
      .select('*')
      .eq('congregation_id', state.congregation.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    supabase
      .from('hermanos')
      .select('id, nombre, celular')
      .eq('congregacion_id', state.congregation.id)
      .order('nombre', { ascending: true })
  ]);

  if (!usersRes.error) {
    allCongUsers = usersRes.data || [];
    pendingUsers = allCongUsers.filter((u) => u.status === 'pending');
  }
  if (!repRes.error) {
    pendingReports = repRes.data || [];
  }
  if (!hermRes.error) {
    hermanosCongList = hermRes.data || [];
  }

  if (isSuperadmin()) {
    const { data: congs } = await supabase
      .from('congregaciones')
      .select('id, nombre')
      .order('nombre');
    congregationsList = congs || [];
  }
}

export function buildHermanosSelectOptions(selectedName) {
  const normalizedSelected = (selectedName || '').trim().toLowerCase();
  return `
    <option value="">-- Vincular con planilla Hermanos --</option>
    ${hermanosCongList
      .map((h) => {
        const isSelected = (h.nombre || '').trim().toLowerCase() === normalizedSelected;
        const telInfo =
          h.celular && !String(h.celular).toLowerCase().includes('sin tel')
            ? ` (${h.celular})`
            : ' (sin tel.)';
        return `<option value="${escapeHtml(h.nombre)}" ${
          isSelected ? 'selected' : ''
        }>${escapeHtml(h.nombre)}${escapeHtml(telInfo)}</option>`;
      })
      .join('')}
  `;
}

export function renderAdminView(container, onDataChanged) {
  const superMode = isSuperadmin();
  const refreshView = () => renderAdminView(container, onDataChanged);

  const sharedData = {
    pendingUsers,
    allCongUsers,
    pendingReports,
    congregationsList,
    hermanosCongList
  };

  container.innerHTML = `
    <div class="space-y-4 pb-24">
      <div class="grid grid-cols-4 gap-1 bg-slate-200 p-1 rounded-2xl">
        <button data-subtab="general"
          class="admin-subtab-btn py-2 rounded-xl text-[11px] font-extrabold transition ${
            adminSubTab === 'general' ? 'bg-white text-blue-950 shadow-sm' : 'text-slate-600'
          }">
          ⚙️ Config
        </button>
        <button data-subtab="mapa"
          class="admin-subtab-btn py-2 rounded-xl text-[11px] font-extrabold transition ${
            adminSubTab === 'mapa' ? 'bg-white text-blue-950 shadow-sm' : 'text-slate-600'
          }">
          🗺️ Polígonos
        </button>
        <button data-subtab="usuarios"
          class="admin-subtab-btn py-2 rounded-xl text-[11px] font-extrabold transition relative ${
            adminSubTab === 'usuarios' ? 'bg-white text-blue-950 shadow-sm' : 'text-slate-600'
          }">
          👥 Usuarios
          ${
            pendingUsers.length > 0
              ? `<span class="ml-0.5 bg-rose-600 text-white text-[10px] px-1.5 py-0.2 rounded-full">${pendingUsers.length}</span>`
              : ''
          }
        </button>
        <button data-subtab="edificios"
          class="admin-subtab-btn py-2 rounded-xl text-[11px] font-extrabold transition relative ${
            adminSubTab === 'edificios' ? 'bg-white text-blue-950 shadow-sm' : 'text-slate-600'
          }">
          🏢 Edificios
          ${
            pendingReports.length > 0
              ? `<span class="ml-0.5 bg-amber-500 text-slate-950 text-[10px] px-1.5 py-0.2 rounded-full">${pendingReports.length}</span>`
              : ''
          }
        </button>
      </div>

      ${adminSubTab === 'general' ? renderGeneralAdminHtml(superMode, sharedData) : ''}
      ${adminSubTab === 'mapa' ? renderPolygonMapperHtml() : ''}
      ${adminSubTab === 'usuarios' ? renderUsersAdminHtml(sharedData) : ''}
      ${adminSubTab === 'edificios' ? renderBuildingsAdminHtml(sharedData) : ''}
    </div>
  `;

  document.querySelectorAll('.admin-subtab-btn').forEach((btn) => {
    btn.onclick = () => {
      adminSubTab = btn.getAttribute('data-subtab');
      refreshView();
    };
  });

  if (adminSubTab === 'general') {
    bindGeneralAdminEvents(refreshView, onDataChanged, superMode);
  }
  if (adminSubTab === 'mapa') {
    bindPolygonMapperEvents(refreshView, onDataChanged);
  }
  if (adminSubTab === 'usuarios') {
    bindUsersAdminEvents(refreshView, onDataChanged, sharedData);
  }
  if (adminSubTab === 'edificios') {
    bindBuildingsAdminEvents(refreshView, onDataChanged, sharedData);
  }
}
