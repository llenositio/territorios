import { supabase } from './supabase.js';
import { state, isSuperadmin } from './state.js';
import { showToast, escapeHtml } from './ui-helpers.js';
import { renderImportadorHtml, bindImportadorEvents } from './importador.js';

let congUsers = [];
let pendingReports = [];
let allCongregations = [];
let activeCongSettings = [];

export async function loadAdminData() {
  if (!state.congregation?.id) return;

  const [usersRes, repRes] = await Promise.all([
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
      .order('created_at', { ascending: false })
  ]);

  if (!usersRes.error) congUsers = usersRes.data || [];
  if (!repRes.error) pendingReports = repRes.data || [];

  if (isSuperadmin()) {
    const [cRes, sRes] = await Promise.all([
      supabase.from('congregaciones').select('*').order('nombre', { ascending: true }),
      supabase.from('terr_congregation_settings').select('*, congregaciones(id, nombre)')
    ]);
    if (!cRes.error) allCongregations = cRes.data || [];
    if (!sRes.error) activeCongSettings = sRes.data || [];
  }
}

export function renderAdminView(container, onReloadAll) {
  const superMode = isSuperadmin();

  container.innerHTML = `
    <div class="space-y-5 pb-24">
      ${
        superMode
          ? `
          <div class="bg-slate-900 text-white p-4 rounded-2xl shadow-md space-y-4">
            <div class="flex items-center justify-between">
              <span class="text-xs font-extrabold uppercase tracking-wider text-amber-400">
                👑 Panel Superadministrador
              </span>
            </div>

            <div>
              <label class="block text-xs font-bold text-slate-300 mb-1">Congregación activa en pantalla</label>
              <select id="super-switch-cong"
                class="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm font-bold">
                ${activeCongSettings
                  .map(
                    (s) =>
                      `<option value="${s.congregation_id}" ${
                        state.congregation?.id === s.congregation_id ? 'selected' : ''
                      }>${escapeHtml(s.congregaciones?.nombre || s.slug)}</option>`
                  )
                  .join('')}
              </select>
            </div>

            <form id="super-activate-cong-form" class="pt-3 border-t border-slate-800 space-y-2.5">
              <p class="text-xs font-bold text-slate-200">Activar otra congregación existente en Territorios</p>
              <select id="super-new-cong-id" required
                class="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-xs">
                <option value="">-- Elegir congregación --</option>
                ${allCongregations
                  .map((c) => `<option value="${c.id}">${escapeHtml(c.nombre)}</option>`)
                  .join('')}
              </select>
              <div class="grid grid-cols-2 gap-2">
                <input type="text" id="super-new-slug" required placeholder="slug (ej: centro-mdp)"
                  class="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-xs" />
                <input type="text" id="super-new-city" required value="Mar del Plata"
                  class="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-xs" />
              </div>
              <button type="submit"
                class="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 rounded-xl text-xs">
                Activar Congregación
              </button>
            </form>

            <form id="super-create-admin-form" class="pt-3 border-t border-slate-800 space-y-2.5">
              <p class="text-xs font-bold text-slate-200">Crear Cuenta de Administrador (Usuario y Contraseña)</p>
              <div class="grid grid-cols-2 gap-2">
                <input type="text" id="new-adm-user" required placeholder="Usuario (ej: admin_vdp)"
                  class="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-xs" />
                <input type="password" id="new-adm-pass" required placeholder="Contraseña"
                  class="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-xs" />
              </div>
              <input type="text" id="new-adm-name" required placeholder="Nombre completo del Administrador"
                class="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-xs" />
              <button type="submit"
                class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-xl text-xs">
                Crear Admin para ${escapeHtml(state.congregation?.nombre || 'esta congregación')}
              </button>
            </form>
          </div>
        `
          : ''
      }

      <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
        <h3 class="text-base font-extrabold text-slate-900">
          🏢 Edificios Nuevos Reportados (${pendingReports.length})
        </h3>
        ${
          pendingReports.length === 0
            ? `<p class="text-xs text-slate-500">No hay reportes pendientes de revisión.</p>`
            : `<div class="space-y-3">
                ${pendingReports
                  .map(
                    (rep) => `
                    <div class="p-3.5 rounded-xl border border-amber-200 bg-amber-50/40 space-y-2">
                      <div class="flex items-start justify-between gap-2">
                        <div>
                          <div class="font-extrabold text-slate-900 text-sm">
                            ${escapeHtml(rep.street)} ${escapeHtml(rep.street_number)}
                          </div>
                          <div class="text-[11px] text-slate-500">
                            GPS: ${rep.lat.toFixed(5)}, ${rep.lng.toFixed(5)}
                          </div>
                        </div>
                        ${
                          rep.photo_url
                            ? `<a href="${rep.photo_url}" target="_blank" class="text-xs font-bold text-blue-800 underline">Ver foto 📷</a>`
                            : ''
                        }
                      </div>

                      <div class="flex gap-2 pt-1">
                        <button data-rep-id="${rep.id}"
                          class="approve-rep-btn flex-1 bg-emerald-600 text-white font-bold py-2 rounded-lg text-xs">
                          ✓ Aprobar y cargar timbres
                        </button>
                        <button data-rep-id="${rep.id}"
                          class="reject-rep-btn bg-slate-200 text-slate-700 font-bold px-3 py-2 rounded-lg text-xs">
                          Descartar
                        </button>
                      </div>
                    </div>
                  `
                  )
                  .join('')}
              </div>`
        }
      </div>

      <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
        <h3 class="text-base font-extrabold text-slate-900">
          👥 Hermanos de la Congregación (${congUsers.length})
        </h3>
        ${
          congUsers.length === 0
            ? `<p class="text-xs text-slate-500">Aún no hay hermanos registrados en esta congregación.</p>`
            : `<div class="space-y-2.5">
                ${congUsers
                  .map(
                    (u) => `
                    <div class="p-3 rounded-xl border border-slate-200 flex items-center justify-between gap-2">
                      <div class="min-w-0">
                        <div class="font-bold text-slate-900 text-sm truncate">${escapeHtml(
                          u.full_name || u.email
                        )}</div>
                        <div class="text-[11px] text-slate-500 truncate">${escapeHtml(u.email)}</div>
                        <div class="flex items-center gap-1.5 mt-1">
                          <span class="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded ${
                            u.status === 'approved'
                              ? 'bg-emerald-100 text-emerald-800'
                              : u.status === 'pending'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                          }">${u.status}</span>
                          <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-700">${
                            u.role
                          }</span>
                        </div>
                      </div>

                      <div class="flex flex-col gap-1 shrink-0">
                        ${
                          u.status !== 'approved'
                            ? `<button data-uid="${u.id}" data-new-status="approved"
                                class="user-status-btn bg-emerald-600 text-white font-bold px-3 py-1.5 rounded-lg text-xs">
                                Habilitar
                              </button>`
                            : `<button data-uid="${u.id}" data-new-status="blocked"
                                class="user-status-btn bg-rose-100 text-rose-700 font-bold px-3 py-1.5 rounded-lg text-xs">
                                Bloquear
                              </button>`
                        }
                        <select data-uid="${u.id}"
                          class="user-role-select text-[11px] font-bold border border-slate-300 rounded-lg px-2 py-1 bg-white">
                          <option value="publicador" ${u.role === 'publicador' ? 'selected' : ''}>Publicador</option>
                          <option value="conductor" ${u.role === 'conductor' ? 'selected' : ''}>Conductor</option>
                          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                        </select>
                      </div>
                    </div>
                  `
                  )
                  .join('')}
              </div>`
        }
      </div>

      <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
        <h3 class="text-base font-extrabold text-slate-900">📅 Cartelera Pública y Puntos de Encuentro</h3>
        <form id="cartelera-dates-form" class="space-y-2.5">
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-[11px] font-bold text-slate-600 mb-1">Publicar desde</label>
              <input type="date" id="set-pub-start" value="${state.settings?.public_schedule_start_date || ''}"
                class="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs" />
            </div>
            <div>
              <label class="block text-[11px] font-bold text-slate-600 mb-1">Publicar hasta</label>
              <input type="date" id="set-pub-end" value="${state.settings?.public_schedule_end_date || ''}"
                class="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs" />
            </div>
          </div>
          <button type="submit"
            class="w-full bg-blue-900 text-white font-bold py-2.5 rounded-xl text-xs">
            Guardar Fechas de Cartelera Pública
          </button>
        </form>

        <div class="pt-3 border-t border-slate-100 space-y-2">
          <label class="block text-xs font-bold text-slate-700">Agregar Punto de Encuentro</label>
          <div class="flex gap-2">
            <input type="text" id="new-mp-input" placeholder="Ej: Salón del Reino (Calle 123)"
              class="flex-1 px-3 py-2 rounded-xl border border-slate-300 text-xs" />
            <button id="btn-add-mp" class="bg-slate-800 text-white font-bold px-3.5 py-2 rounded-xl text-xs">
              Agregar
            </button>
          </div>
          <div class="flex flex-wrap gap-1.5 pt-1">
            ${state.meetingPoints
              .map(
                (mp) =>
                  `<span class="inline-flex items-center gap-1.5 bg-slate-100 text-slate-700 text-xs px-2.5 py-1 rounded-lg">
                    ${escapeHtml(mp.name_and_address)}
                    <button data-mp-id="${mp.id}" class="del-mp-btn text-rose-600 font-bold">✕</button>
                  </span>`
              )
              .join('')}
          </div>
        </div>
      </div>

      ${renderImportadorHtml()}
    </div>
  `;

  bindImportadorEvents(onReloadAll);

  // Eventos Superadmin
  if (superMode) {
    document.getElementById('super-switch-cong').onchange = async (e) => {
      const newCongId = e.target.value;
      const found = activeCongSettings.find((s) => s.congregation_id === newCongId);
      if (found) {
        state.congregation = found.congregaciones;
        state.settings = found;
        showToast(`Cambiado a ${found.congregaciones?.nombre}`, 'info');
        await onReloadAll();
      }
    };

    document.getElementById('super-activate-cong-form').onsubmit = async (e) => {
      e.preventDefault();
      const congId = document.getElementById('super-new-cong-id').value;
      const slug = document.getElementById('super-new-slug').value.trim().toLowerCase();
      const city = document.getElementById('super-new-city').value.trim();

      const { error } = await supabase.from('terr_congregation_settings').upsert({
        congregation_id: congId,
        slug,
        city,
        country: 'Argentina'
      });

      if (error) {
        showToast('Error: ' + error.message, 'error');
        return;
      }
      showToast('Congregación activada', 'success');
      await loadAdminData();
      renderAdminView(container, onReloadAll);
    };

    document.getElementById('super-create-admin-form').onsubmit = async (e) => {
      e.preventDefault();
      const username = document.getElementById('new-adm-user').value.trim();
      const password = document.getElementById('new-adm-pass').value;
      const fullName = document.getElementById('new-adm-name').value.trim();

      const { error } = await supabase.rpc('terr_create_admin_account', {
        p_username: username,
        p_password: password,
        p_full_name: fullName,
        p_congregation_id: state.congregation.id
      });

      if (error) {
        showToast('Error creando admin: ' + error.message, 'error');
        return;
      }

      showToast(`Administrador "${username}" creado correctamente`, 'success');
      e.target.reset();
      await loadAdminData();
      renderAdminView(container, onReloadAll);
    };
  }

  // Aprobar / Rechazar reporte de edificio nuevo
  document.querySelectorAll('.approve-rep-btn').forEach((btn) => {
    btn.onclick = async () => {
      const repId = btn.getAttribute('data-rep-id');
      const rep = pendingReports.find((r) => r.id === repId);
      if (!rep) return;

      const aptStr = prompt(
        `Aprobar ${rep.street} ${rep.street_number}.\nIngresá los timbres separados por coma (ej: PB A, PB B, 1A, 1B):`
      );
      if (aptStr === null) return;

      const { data: bldg, error } = await supabase
        .from('terr_buildings')
        .insert({
          congregation_id: state.congregation.id,
          street: rep.street,
          street_number: rep.street_number,
          lat: rep.lat,
          lng: rep.lng,
          status: 'active'
        })
        .select()
        .single();

      if (error) {
        showToast('Error al crear edificio: ' + error.message, 'error');
        return;
      }

      const labels = aptStr
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      if (labels.length > 0) {
        await supabase.from('terr_apartments').insert(
          labels.map((label) => ({
            congregation_id: state.congregation.id,
            building_id: bldg.id,
            label,
            status: 'active'
          }))
        );
      }

      await supabase
        .from('terr_new_building_reports')
        .update({ status: 'approved' })
        .eq('id', repId);

      showToast('Edificio aprobado y agregado al mapa', 'success');
      await onReloadAll();
    };
  });

  document.querySelectorAll('.reject-rep-btn').forEach((btn) => {
    btn.onclick = async () => {
      const repId = btn.getAttribute('data-rep-id');
      await supabase
        .from('terr_new_building_reports')
        .update({ status: 'rejected' })
        .eq('id', repId);
      pendingReports = pendingReports.filter((r) => r.id !== repId);
      renderAdminView(container, onReloadAll);
    };
  });

  // Gestión de usuarios
  document.querySelectorAll('.user-status-btn').forEach((btn) => {
    btn.onclick = async () => {
      const uid = btn.getAttribute('data-uid');
      const newStatus = btn.getAttribute('data-new-status');
      const { error } = await supabase
        .from('terr_users')
        .update({ status: newStatus })
        .eq('id', uid);
      if (!error) {
        showToast('Estado actualizado', 'success');
        await loadAdminData();
        renderAdminView(container, onReloadAll);
      }
    };
  });

  document.querySelectorAll('.user-role-select').forEach((sel) => {
    sel.onchange = async () => {
      const uid = sel.getAttribute('data-uid');
      const newRole = sel.value;
      const { error } = await supabase
        .from('terr_users')
        .update({ role: newRole })
        .eq('id', uid);
      if (!error) {
        showToast('Rol actualizado a ' + newRole, 'success');
        await loadAdminData();
      }
    };
  });

  // Fechas cartelera pública
  document.getElementById('cartelera-dates-form').onsubmit = async (e) => {
    e.preventDefault();
    const start = document.getElementById('set-pub-start').value || null;
    const end = document.getElementById('set-pub-end').value || null;

    const { error } = await supabase
      .from('terr_congregation_settings')
      .update({
        public_schedule_start_date: start,
        public_schedule_end_date: end
      })
      .eq('congregation_id', state.congregation.id);

    if (!error) {
      state.settings.public_schedule_start_date = start;
      state.settings.public_schedule_end_date = end;
      showToast('Fechas de cartelera pública guardadas', 'success');
    }
  };

  // Puntos de encuentro
  document.getElementById('btn-add-mp').onclick = async () => {
    const val = document.getElementById('new-mp-input').value.trim();
    if (!val) return;
    const { data, error } = await supabase
      .from('terr_meeting_points')
      .insert({ congregation_id: state.congregation.id, name_and_address: val })
      .select()
      .single();
    if (!error && data) {
      state.meetingPoints.push(data);
      renderAdminView(container, onReloadAll);
    }
  };

  document.querySelectorAll('.del-mp-btn').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-mp-id');
      await supabase.from('terr_meeting_points').delete().eq('id', id);
      state.meetingPoints = state.meetingPoints.filter((m) => m.id !== id);
      renderAdminView(container, onReloadAll);
    };
  });
}
