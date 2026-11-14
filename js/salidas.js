import { supabase } from './supabase.js';
import { state, isAdmin } from './state.js';
import { showToast, escapeHtml } from './ui-helpers.js';

let showNewScheduleModal = false;

export async function loadSchedulesAndPoints() {
  if (!state.congregation?.id) return;

  const [schedRes, mpRes] = await Promise.all([
    supabase
      .from('terr_schedules')
      .select('*')
      .eq('congregation_id', state.congregation.id)
      .gte('date', new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10))
      .order('date', { ascending: true })
      .order('time', { ascending: true }),
    supabase
      .from('terr_meeting_points')
      .select('*')
      .eq('congregation_id', state.congregation.id)
      .order('name_and_address', { ascending: true })
  ]);

  if (!schedRes.error) state.schedules = schedRes.data || [];
  if (!mpRes.error) state.meetingPoints = mpRes.data || [];
}

function formatDateSpanish(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'short'
  });
}

export function renderSalidasView(container) {
  const adminMode = isAdmin();
  const publicSlug = state.settings?.slug || '';
  const publicUrl = `${window.location.origin}${window.location.pathname}#/salidas/${publicSlug}`;

  container.innerHTML = `
    <div class="space-y-4 pb-24">
      ${
        adminMode
          ? `<div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
              <div class="flex items-center justify-between gap-2">
                <button id="btn-new-schedule"
                  class="flex-1 bg-blue-900 hover:bg-blue-800 text-white font-bold py-3 px-4 rounded-xl text-sm shadow-sm transition">
                  + Programar Salida
                </button>
                <button id="btn-copy-public-link"
                  class="bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold py-3 px-3.5 rounded-xl text-xs border border-slate-200 transition"
                  title="Copiar enlace público de cartelera">
                  🔗 Link Público
                </button>
              </div>
              <div class="text-[11px] text-slate-500">
                Cartelera pública habilitada:
                <b>${state.settings?.public_schedule_start_date || 'Sin definir'}</b> al
                <b>${state.settings?.public_schedule_end_date || 'Sin definir'}</b>
                (se configura en la pestaña Admin).
              </div>
            </div>`
          : ''
      }

      ${
        state.schedules.length === 0
          ? `<div class="bg-white p-8 rounded-2xl text-center text-slate-500 border border-slate-200">
              <p class="font-semibold">No hay salidas programadas próximamente</p>
            </div>`
          : `<div class="space-y-3">
              ${state.schedules
                .map(
                  (s) => `
                  <div class="bg-white p-4 rounded-2xl shadow-sm border ${
                    s.is_special_event ? 'border-amber-300 bg-amber-50/30' : 'border-slate-200'
                  } space-y-2">
                    <div class="flex items-center justify-between">
                      <span class="text-xs font-extrabold uppercase tracking-wide text-blue-900">
                        📅 ${escapeHtml(formatDateSpanish(s.date))} • ${escapeHtml(s.time)} hs
                      </span>
                      <div class="flex items-center gap-1.5">
                        <button data-sched-id="${s.id}"
                          class="copy-wa-btn bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold px-2.5 py-1 rounded-lg text-xs border border-emerald-200">
                          📲 WhatsApp
                        </button>
                        ${
                          adminMode
                            ? `<button data-del-sched="${s.id}"
                                class="del-sched-btn text-rose-500 hover:text-rose-700 font-bold px-2 py-1 text-xs">
                                🗑️
                              </button>`
                            : ''
                        }
                      </div>
                    </div>

                    <div class="font-extrabold text-slate-900 text-base">
                      📍 ${escapeHtml(s.meeting_point_text)}
                    </div>

                    <div class="grid grid-cols-2 gap-2 text-xs text-slate-600 pt-1">
                      ${
                        s.conductor_name
                          ? `<div><b>Conductor:</b> ${escapeHtml(s.conductor_name)}</div>`
                          : ''
                      }
                      ${
                        s.groups_assigned
                          ? `<div><b>Grupos:</b> ${escapeHtml(s.groups_assigned)}</div>`
                          : ''
                      }
                      ${
                        s.assigned_subterritories
                          ? `<div class="col-span-2"><b>Territorios:</b> <span class="font-bold text-blue-900">${escapeHtml(
                              s.assigned_subterritories
                            )}</span></div>`
                          : ''
                      }
                    </div>
                  </div>
                `
                )
                .join('')}
            </div>`
      }
    </div>
    ${showNewScheduleModal ? renderNewScheduleModalHtml() : ''}
  `;

  if (adminMode) {
    document.getElementById('btn-new-schedule').onclick = () => {
      showNewScheduleModal = true;
      renderSalidasView(container);
    };

    document.getElementById('btn-copy-public-link').onclick = async () => {
      await navigator.clipboard.writeText(publicUrl);
      showToast('Enlace de cartelera pública copiado', 'success');
    };

    document.querySelectorAll('.del-sched-btn').forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute('data-del-sched');
        if (!confirm('¿Eliminar esta salida?')) return;
        const { error } = await supabase.from('terr_schedules').delete().eq('id', id);
        if (!error) {
          state.schedules = state.schedules.filter((x) => x.id !== id);
          showToast('Salida eliminada', 'info');
          renderSalidasView(container);
        }
      };
    });
  }

  document.querySelectorAll('.copy-wa-btn').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-sched-id');
      const item = state.schedules.find((x) => x.id === id);
      if (!item) return;
      const text = [
        `*SALIDA AL SERVICIO*`,
        `📅 *Día:* ${formatDateSpanish(item.date)} - ${item.time} hs`,
        `📍 *Punto de encuentro:* ${item.meeting_point_text}`,
        item.conductor_name ? `👤 *Conductor:* ${item.conductor_name}` : null,
        item.groups_assigned ? `👥 *Grupos:* ${item.groups_assigned}` : null,
        item.assigned_subterritories ? `🗺️ *Territorios:* ${item.assigned_subterritories}` : null
      ]
        .filter(Boolean)
        .join('\n');

      await navigator.clipboard.writeText(text);
      showToast('Texto copiado listo para pegar en WhatsApp', 'success');
    };
  });

  if (showNewScheduleModal) {
    bindNewScheduleModalEvents(container);
  }
}

function renderNewScheduleModalHtml() {
  return `
    <div class="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4 overflow-y-auto">
      <div class="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl space-y-3 my-6">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-extrabold text-slate-900">Nueva Salida</h3>
          <button id="close-sched-modal" class="text-slate-400 hover:text-slate-700 text-xl font-bold">✕</button>
        </div>

        <form id="new-schedule-form" class="space-y-3">
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-xs font-bold text-slate-700 mb-1">Fecha</label>
              <input type="date" id="sched-date" required
                class="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm" />
            </div>
            <div>
              <label class="block text-xs font-bold text-slate-700 mb-1">Hora</label>
              <input type="time" id="sched-time" required value="09:30"
                class="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm" />
            </div>
          </div>

          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">Punto de encuentro</label>
            ${
              state.meetingPoints.length > 0
                ? `<select id="sched-mp-select" class="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white mb-1.5">
                    <option value="">-- Elegir guardado o escribir abajo --</option>
                    ${state.meetingPoints
                      .map(
                        (mp) =>
                          `<option value="${escapeHtml(mp.name_and_address)}">${escapeHtml(
                            mp.name_and_address
                          )}</option>`
                      )
                      .join('')}
                  </select>`
                : ''
            }
            <input type="text" id="sched-mp-text" required placeholder="Ej: Salón del Reino / Casa flia. Pérez"
              class="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm" />
          </div>

          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">Conductor</label>
            <input type="text" id="sched-conductor" placeholder="Nombre del hermano"
              class="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm" />
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-xs font-bold text-slate-700 mb-1">Grupos</label>
              <input type="text" id="sched-groups" placeholder="Ej: 1 y 2 / Todos"
                class="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm" />
            </div>
            <div>
              <label class="block text-xs font-bold text-slate-700 mb-1">Territorios</label>
              <input type="text" id="sched-terrs" placeholder="Ej: 4A, 4B"
                class="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm" />
            </div>
          </div>

          <label class="flex items-center gap-2 text-xs font-semibold text-slate-700 pt-1">
            <input type="checkbox" id="sched-special" class="rounded" />
            <span>Campaña o evento especial</span>
          </label>

          <button type="submit"
            class="w-full bg-blue-900 hover:bg-blue-800 text-white font-bold py-3 rounded-xl text-sm shadow">
            Guardar Salida
          </button>
        </form>
      </div>
    </div>
  `;
}

function bindNewScheduleModalEvents(container) {
  document.getElementById('close-sched-modal').onclick = () => {
    showNewScheduleModal = false;
    renderSalidasView(container);
  };

  const mpSelect = document.getElementById('sched-mp-select');
  if (mpSelect) {
    mpSelect.onchange = () => {
      if (mpSelect.value) {
        document.getElementById('sched-mp-text').value = mpSelect.value;
      }
    };
  }

  document.getElementById('new-schedule-form').onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      congregation_id: state.congregation.id,
      date: document.getElementById('sched-date').value,
      time: document.getElementById('sched-time').value,
      meeting_point_text: document.getElementById('sched-mp-text').value.trim(),
      conductor_name: document.getElementById('sched-conductor').value.trim() || null,
      groups_assigned: document.getElementById('sched-groups').value.trim() || null,
      assigned_subterritories: document.getElementById('sched-terrs').value.trim() || null,
      is_special_event: document.getElementById('sched-special').checked
    };

    const { data, error } = await supabase
      .from('terr_schedules')
      .insert(payload)
      .select()
      .single();

    if (error) {
      showToast('Error al guardar salida: ' + error.message, 'error');
      return;
    }

    state.schedules.push(data);
    state.schedules.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    showNewScheduleModal = false;
    showToast('Salida programada correctamente', 'success');
    renderSalidasView(container);
  };
}

// Vista Pública sin Login: #/salidas/:slug
export async function renderPublicCartelera(container, slug) {
  container.innerHTML = `<div class="p-8 text-center text-slate-500">Cargando cartelera pública...</div>`;

  const { data: settings } = await supabase
    .from('terr_congregation_settings')
    .select('*, congregaciones(nombre)')
    .eq('slug', slug)
    .maybeSingle();

  if (!settings) {
    container.innerHTML = `
      <div class="min-h-screen flex items-center justify-center p-4 bg-slate-100 text-center">
        <div class="bg-white p-8 rounded-3xl shadow max-w-sm">
          <h2 class="text-lg font-extrabold text-slate-900">Congregación no encontrada</h2>
          <p class="text-sm text-slate-500 mt-1">Verificá que el enlace sea correcto.</p>
        </div>
      </div>`;
    return;
  }

  const { data: schedules } = await supabase
    .from('terr_schedules')
    .select('*')
    .eq('congregation_id', settings.congregation_id)
    .order('date', { ascending: true })
    .order('time', { ascending: true });

  const list = schedules || [];

  container.innerHTML = `
    <div class="min-h-screen bg-slate-100 pb-12">
      <header class="bg-blue-950 text-white px-4 py-6 text-center shadow">
        <p class="text-xs uppercase tracking-widest text-blue-300 font-bold">Salidas al Servicio</p>
        <h1 class="text-2xl font-black mt-1">${escapeHtml(settings.congregaciones?.nombre || '')}</h1>
        ${
          settings.public_schedule_start_date && settings.public_schedule_end_date
            ? `<p class="text-xs text-blue-200 mt-1">Período: ${settings.public_schedule_start_date} al ${settings.public_schedule_end_date}</p>`
            : ''
        }
      </header>

      <main class="max-w-lg mx-auto p-4 space-y-3">
        ${
          list.length === 0
            ? `<div class="bg-white p-8 rounded-2xl text-center text-slate-500 shadow-sm">
                No hay salidas publicadas en este período.
              </div>`
            : list
                .map(
                  (s) => `
                  <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-1.5">
                    <div class="text-xs font-extrabold uppercase text-blue-900">
                      📅 ${escapeHtml(formatDateSpanish(s.date))} • ${escapeHtml(s.time)} hs
                    </div>
                    <div class="font-extrabold text-slate-900 text-base">
                      📍 ${escapeHtml(s.meeting_point_text)}
                    </div>
                    <div class="text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1 pt-1">
                      ${s.conductor_name ? `<span><b>Conductor:</b> ${escapeHtml(s.conductor_name)}</span>` : ''}
                      ${s.groups_assigned ? `<span><b>Grupos:</b> ${escapeHtml(s.groups_assigned)}</span>` : ''}
                      ${s.assigned_subterritories ? `<span><b>Territorios:</b> ${escapeHtml(s.assigned_subterritories)}</span>` : ''}
                    </div>
                  </div>
                `
                )
                .join('')
        }

        <div class="pt-4 text-center">
          <a href="${window.location.pathname}" class="text-xs font-bold text-blue-900 underline">
            Ingresar a la app de Territorios →
          </a>
        </div>
      </main>
    </div>
  `;
}
