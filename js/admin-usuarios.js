import { supabase } from './supabase.js';
import { state } from './state.js';
import { showToast, escapeHtml } from './ui-helpers.js';
import { loadAdminData, buildHermanosSelectOptions } from './admin.js';

const ROLE_LABELS = {
  admin_congregacion: 'Admin Congregación',
  editor_territorios: 'Editor Territorios',
  mensajero_territorios: 'Mensajero Territorios',
  conductor: 'Conductor',
  publicador: 'Publicador',
  editor_vymc: 'Editor VyMC',
  mensajero_vymc: 'Mensajero VyMC',
  editor_av: 'Editor Acomodadores/AV',
  mensajero_acomodador: 'Mensajero Acomodador'
};

function getAssignableRolesForCurrentUser() {
  const myRole = state.profile?.role;
  if (myRole === 'super_admin' || myRole === 'superadmin' || myRole === 'admin_congregacion' || myRole === 'admin') {
    return [
      'admin_congregacion',
      'editor_territorios',
      'mensajero_territorios',
      'conductor',
      'publicador',
      'editor_vymc',
      'mensajero_vymc',
      'editor_av',
      'mensajero_acomodador'
    ];
  }
  if (myRole === 'editor_territorios') {
    return ['conductor', 'mensajero_territorios', 'publicador'];
  }
  return [];
}

function buildRoleSelectOptions(currentRole, assignableRoles) {
  const list = assignableRoles.includes(currentRole)
    ? assignableRoles
    : [currentRole, ...assignableRoles];

  return list
    .filter(Boolean)
    .map(
      (r) =>
        `<option value="${r}" ${currentRole === r ? 'selected' : ''}>${escapeHtml(
          ROLE_LABELS[r] || r
        )}</option>`
    )
    .join('');
}

export function renderUsersAdminHtml({ pendingUsers, allCongUsers, hermanosCongList }) {
  const assignableRoles = getAssignableRolesForCurrentUser();
  const myRole = state.profile?.role;
  const isTopAdmin =
    myRole === 'super_admin' || myRole === 'superadmin' || myRole === 'admin_congregacion' || myRole === 'admin';

  return `
    <div class="space-y-4">
      <div class="bg-blue-50 border border-blue-200 text-blue-950 px-3.5 py-2.5 rounded-2xl text-xs">
        💡 Vinculá cada usuario con su registro oficial de la planilla <b>Hermanos</b> y asignale su rol (<b>Conductor</b>, <b>Mensajero Territorios</b>, <b>Editor Territorios</b> o <b>Publicador</b>) para que aparezca en <b>Salidas</b> y funcione el envío directo por WhatsApp.
      </div>

      ${
        pendingUsers.length > 0
          ? `<div class="bg-amber-50 border border-amber-300 p-4 rounded-2xl space-y-2.5">
              <h3 class="text-sm font-extrabold text-amber-950">⏳ Solicitudes Pendientes (${pendingUsers.length})</h3>
              ${pendingUsers
                .map(
                  (u) => `
                  <div class="bg-white p-3.5 rounded-xl border border-amber-200 space-y-2">
                    <div class="flex items-start justify-between gap-2">
                      <div>
                        <div class="font-bold text-sm text-slate-900">${escapeHtml(u.full_name || 'Sin nombre')}</div>
                        <div class="text-xs text-slate-500">${escapeHtml(u.email || '')}</div>
                      </div>
                      <div class="flex gap-1.5 shrink-0">
                        <button data-approve-user="${u.id}"
                          class="approve-user-btn bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1.5 rounded-lg text-xs">
                          ✓ Aprobar
                        </button>
                        <button data-block-user="${u.id}"
                          class="block-user-btn bg-rose-100 text-rose-700 font-bold px-2.5 py-1.5 rounded-lg text-xs">
                          Rechazar
                        </button>
                      </div>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      <select id="pending-hermano-${u.id}"
                        class="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-bold bg-white">
                        ${buildHermanosSelectOptions(u.full_name)}
                      </select>
                      <select id="pending-role-${u.id}"
                        class="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-bold bg-white">
                        ${buildRoleSelectOptions(u.role || 'publicador', assignableRoles)}
                      </select>
                    </div>
                  </div>
                `
                )
                .join('')}
            </div>`
          : ''
      }

      <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-2.5">
        <h3 class="text-base font-extrabold text-slate-900">👥 Hermanos de la Congregación</h3>
        ${allCongUsers
          .filter((u) => u.status !== 'pending')
          .map((u) => {
            const canEditRow = isTopAdmin || assignableRoles.includes(u.role);
            return `
            <div class="py-2.5 border-b border-slate-100 last:border-0 text-xs space-y-2">
              <div class="flex items-center justify-between gap-2">
                <div class="min-w-0">
                  <div class="font-bold text-slate-900 truncate">${escapeHtml(u.full_name || u.email || 'Sin nombre')}</div>
                  <div class="text-slate-400 truncate">${escapeHtml(u.email || '')}</div>
                </div>
                ${
                  canEditRow
                    ? `<select data-role-user="${u.id}"
                        class="change-role-select px-2.5 py-1.5 rounded-lg border border-slate-300 font-bold bg-white shrink-0">
                        ${buildRoleSelectOptions(u.role, assignableRoles)}
                      </select>`
                    : `<span class="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-bold shrink-0">${escapeHtml(
                        ROLE_LABELS[u.role] || u.role
                      )}</span>`
                }
              </div>
              ${
                hermanosCongList.length > 0 && canEditRow
                  ? `<div>
                      <select data-hermano-user="${u.id}"
                        class="link-hermano-select w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 font-semibold text-slate-800">
                        ${buildHermanosSelectOptions(u.full_name)}
                      </select>
                    </div>`
                  : ''
              }
            </div>
          `;
          })
          .join('')}
      </div>
    </div>
  `;
}

export function bindUsersAdminEvents(refreshView, onDataChanged, { hermanosCongList }) {
  document.querySelectorAll('.approve-user-btn').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-approve-user');
      const hermanoSel = document.getElementById(`pending-hermano-${id}`);
      const roleSel = document.getElementById(`pending-role-${id}`);
      const chosenName = hermanoSel ? hermanoSel.value.trim() : '';
      const chosenRole = roleSel ? roleSel.value : 'publicador';

      if (hermanosCongList.length > 0 && !chosenName) {
        showToast('Elegí primero el nombre desde la planilla Hermanos', 'error');
        return;
      }

      const updatePayload = {
        status: 'approved',
        role: chosenRole
      };
      if (chosenName) {
        updatePayload.full_name = chosenName;
      }

      const { error } = await supabase
        .from('perfiles')
        .update(updatePayload)
        .eq('id', id);

      if (error) {
        showToast('Error al aprobar: ' + error.message, 'error');
        return;
      }

      showToast('Hermano aprobado y vinculado', 'success');
      await loadAdminData();
      refreshView();
    };
  });

  document.querySelectorAll('.block-user-btn').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-block-user');
      const { error } = await supabase
        .from('perfiles')
        .update({ status: 'blocked' })
        .eq('id', id);

      if (error) {
        showToast('Error al rechazar: ' + error.message, 'error');
        return;
      }
      showToast('Solicitud rechazada', 'info');
      await loadAdminData();
      refreshView();
    };
  });

  document.querySelectorAll('.change-role-select').forEach((sel) => {
    sel.onchange = async () => {
      const id = sel.getAttribute('data-role-user');
      const { error } = await supabase
        .from('perfiles')
        .update({ role: sel.value })
        .eq('id', id);
      if (error) {
        showToast('Error al actualizar rol: ' + error.message, 'error');
        return;
      }
      showToast('Rol actualizado', 'success');
      if (onDataChanged) await onDataChanged();
    };
  });

  document.querySelectorAll('.link-hermano-select').forEach((sel) => {
    sel.onchange = async () => {
      const id = sel.getAttribute('data-hermano-user');
      const chosenName = sel.value.trim();
      if (!chosenName) return;

      const { error } = await supabase
        .from('perfiles')
        .update({ full_name: chosenName })
        .eq('id', id);

      if (error) {
        showToast('Error al vincular hermano: ' + error.message, 'error');
        return;
      }

      showToast(`Vinculado con ${chosenName}`, 'success');
      await loadAdminData();
      refreshView();
    };
  });
}
