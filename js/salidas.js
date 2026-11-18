import { supabase } from './supabase.js';
import { state, isAdmin } from './state.js';
import { showToast, escapeHtml } from './ui-helpers.js';

let showScheduleModal = false;
let editingScheduleId = null;
let prefilledTerritories = '';
let hermanosList = [];
let conductoresList = [];

function getDraftProposalTerritories() {
  if (Array.isArray(state.proposedTerritories) && state.proposedTerritories.length > 0) {
    return state.proposedTerritories.map(String);
  }
  try {
    const raw = localStorage.getItem('terr_proposed_territories');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function clearDraftProposalTerritories() {
  state.proposedTerritories = [];
  try {
    localStorage.removeItem('terr_proposed_territories');
  } catch {}
}

export async function loadSchedulesAndPoints() {
  if (!state.congregation?.id) return;

  const [schedRes, mpRes, hermRes, usersRes] = await Promise.all([
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
      .order('name_and_address', { ascending: true }),
    supabase
      .from('hermanos')
      .select('id, nombre, celular')
      .eq('congregacion_id', state.congregation.id)
      .order('nombre', { ascending: true }),
    supabase
      .from('terr_users')
      .select('id, full_name, role, status')
      .eq('congregation_id', state.congregation.id)
      .eq('status', 'approved')
      .in('role', ['conductor', 'admin'])
  ]);

  if (!schedRes.error) state.schedules = schedRes.data || [];
  if (!mpRes.error) state.meetingPoints = mpRes.data || [];
  if (!hermRes.error) hermanosList = hermRes.data || [];

  if (!usersRes.error) {
    const approvedUsers = usersRes.data || [];
    const seen = new Set();
    conductoresList = [];

    for (const u of approvedUsers) {
      const rawName = (u.full_name || '').trim();
      if (!rawName) continue;
      const hermMatch = findHermanoRecord(rawName);
      const officialName = hermMatch ? hermMatch.nombre : rawName;
      const key = normalizeName(officialName);
      if (seen.has(key)) continue;
      seen.add(key);

      conductoresList.push({
        nombre: officialName,
        celular: hermMatch?.celular || null,
        role: u.role
      });
    }

    conductoresList.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }
}

function getDayAndDateLabel(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const dayName = dt
    .toLocaleDateString('es-AR', { weekday: 'long' })
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  const dd = String(d).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return `${dayName} ${dd}/${mm}`;
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

function formatTimeShort(timeStr) {
  if (!timeStr) return '';
  return timeStr.slice(0, 5);
}

function normalizeName(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[,.\-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatearNumeroWhatsApp(telefonoRaw) {
  if (!telefonoRaw) return null;
  const strRaw = String(telefonoRaw).trim();
  if (!strRaw || strRaw.toLowerCase().includes('sin tel')) return null;

  let num = strRaw.replace(/\D/g, '');
  if (!num || num.length < 8) return null;

  if (num.startsWith('549') && num.length >= 12) {
    return num;
  }
  if (num.startsWith('54') && !num.startsWith('549')) {
    return '549' + num.substring(2);
  }
  if (num.startsWith('0')) {
    num = num.substring(1);
  }
  if (num.length === 10) {
    return '549' + num;
  }

  return num.length >= 10 ? '549' + num : num;
}

function findHermanoRecord(conductorName) {
  if (!conductorName) return null;
  const target = normalizeName(conductorName);
  if (!target) return null;

  let match = hermanosList.find((h) => normalizeName(h.nombre) === target);
  if (match) return match;

  const targetTokens = target.split(' ').filter((t) => t.length >= 2);
  if (targetTokens.length >= 2) {
    match = hermanosList.find((h) => {
      const hTokens = normalizeName(h.nombre).split(' ');
      return targetTokens.every((tk) => hTokens.includes(tk));
    });
    if (match) return match;
  }

  match = hermanosList.find(
    (h) =>
      normalizeName(h.nombre).includes(target) ||
      target.includes(normalizeName(h.nombre))
  );
  return match || null;
}

function findConductorPhone(conductorName) {
  const match = findHermanoRecord(conductorName);
  if (!match || !match.celular) return null;
  return formatearNumeroWhatsApp(match.celular);
}

function getWhatsAppSvgIcon() {
  return `
    <svg viewBox="0 0 32 32" class="w-5 h-5 fill-current" aria-hidden="true">
      <path d="M16.004 3.2c-7.06 0-12.8 5.74-12.8 12.8 0 2.256.59 4.46 1.71 6.402L3.1 28.8l6.564-1.722a12.74 12.74 0 0 0 6.34 1.682h.006c7.058 0 12.798-5.74 12.798-12.8 0-3.42-1.332-6.634-3.75-9.052A12.714 12.714 0 0 0 16.004 3.2zm0 23.394h-.004a10.58 10.58 0 0 1-5.394-1.478l-.388-.23-3.896 1.022 1.04-3.798-.252-.402a10.556 10.556 0 0 1-1.622-5.648c0-5.842 4.754-10.596 10.602-10.596 2.83 0 5.49 1.104 7.49 3.106a10.526 10.526 0 0 1 3.102 7.494c0 5.844-4.756 10.53-10.688 10.53zm5.816-7.938c-.318-.16-1.884-.93-2.176-1.036-.292-.106-.504-.16-.716.16-.212.318-.822 1.036-1.008 1.248-.186.212-.372.238-.69.08-.318-.16-1.344-.496-2.56-1.58-.946-.844-1.584-1.886-1.77-2.204-.186-.318-.02-.49.14-.648.144-.142.318-.372.478-.558.16-.186.212-.318.318-.53.106-.212.054-.398-.026-.558-.08-.16-.716-1.726-.982-2.364-.258-.62-.52-.536-.716-.546l-.61-.01c-.212 0-.558.08-.85.398-.292.318-1.114 1.088-1.114 2.654 0 1.566 1.14 3.078 1.3 3.29.16.212 2.244 3.426 5.436 4.804.76.328 1.352.524 1.814.67.762.242 1.456.208 2.004.126.612-.092 1.884-.77 2.15-1.514.266-.744.266-1.38.186-1.514-.08-.132-.292-.212-.61-.372z"/>
    </svg>
  `;
}

function buildScheduleTableHtml(list, { adminMode = false } = {}) {
  if (!list || list.length === 0) {
    return `
      <div class="bg-white p-8 rounded-2xl text-center text-slate-500 border border-slate-200">
        <p class="font-semibold">No hay salidas programadas próximamente</p>
      </div>`;
  }

  return `
    <div class="w-full bg-white rounded-2xl shadow-sm border border-slate-300 overflow-hidden">
      <div class="overflow-x-auto w-full">
        <table class="w-full border-collapse text-center text-xs sm:text-[13px]">
          <thead>
            <tr class="bg-[#2b6cb0] text-white font-extrabold tracking-wide uppercase">
              <th class="py-2.5 px-2.5 border border-[#1e4e8c] whitespace-nowrap">DÍA</th>
              <th class="py-2.5 px-2 border border-[#1e4e8c] whitespace-nowrap">HORA</th>
              <th class="py-2.5 px-4 border border-[#1e4e8c] min-w-[230px] sm:min-w-[270px]">LUGAR</th>
              <th class="py-2.5 px-2.5 border border-[#1e4e8c] whitespace-nowrap">GRUPOS</th>
              <th class="py-2.5 px-3 border border-[#1e4e8c] min-w-[140px]">CONDUCTOR</th>
              <th class="py-2.5 px-2 border border-[#1e4e8c] whitespace-nowrap">TERRITORIO</th>
              ${adminMode ? `<th class="py-2.5 px-2.5 border border-[#1e4e8c] whitespace-nowrap">ACCIÓN</th>` : ''}
            </tr>
          </thead>
          <tbody>
            ${list
              .map((s, idx) => {
                const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-[#dceaf7]';
                const dayLabel = getDayAndDateLabel(s.date);
                const timeLabel = formatTimeShort(s.time);
                const placeLabel = (s.meeting_point_text || '').toUpperCase();
                const groupsLabel = (s.groups_assigned || '').toUpperCase();
                const conductorLabel = (s.conductor_name || '').toUpperCase();
                const terrLabel = (s.assigned_subterritories || '').toUpperCase();

                return `
                  <tr class="${rowBg} text-slate-900">
                    <td class="py-2.5 px-2.5 border border-slate-300 font-extrabold whitespace-nowrap">
                      ${escapeHtml(dayLabel)}
                    </td>
                    <td class="py-2.5 px-2 border border-slate-300 font-extrabold whitespace-nowrap">
                      ${escapeHtml(timeLabel)}
                    </td>
                    <td class="py-2.5 px-4 border border-slate-300 font-semibold leading-snug min-w-[230px] sm:min-w-[270px]">
                      ${escapeHtml(placeLabel)}
                    </td>
                    <td class="py-2.5 px-2.5 border border-slate-300 font-semibold whitespace-nowrap">
                      ${escapeHtml(groupsLabel)}
                    </td>
                    <td class="py-2.5 px-3 border border-slate-300 font-semibold min-w-[140px]">
                      ${escapeHtml(conductorLabel)}
                    </td>
                    <td class="py-2.5 px-2 border border-slate-300 font-extrabold whitespace-nowrap">
                      ${escapeHtml(terrLabel)}
                    </td>
                    ${
                      adminMode
                        ? `<td class="py-2 px-2.5 border border-slate-300 whitespace-nowrap">
                            <div class="inline-flex items-center justify-center gap-1.5">
                              <button data-sched-id="${s.id}"
                                class="send-wa-btn inline-flex items-center justify-center w-8 h-8 rounded-full border-2 border-[#25D366] text-[#128C7E] bg-white hover:bg-[#25D366] hover:text-white transition shadow-xs"
                                title="Enviar WhatsApp al conductor">
                                ${getWhatsAppSvgIcon()}
                              </button>
                              <button data-edit-sched="${s.id}"
                                class="edit-sched-btn inline-flex items-center justify-center w-8 h-8 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-800 font-bold text-sm transition"
                                title="Editar salida">
                                ✎
                              </button>
                              <button data-del-sched="${s.id}"
                                class="del-sched-btn inline-flex items-center justify-center w-8 h-8 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-700 font-bold text-xs transition"
                                title="Eliminar fila">
                                ✕
                              </button>
                            </div>
                          </td>`
                        : ''
                    }
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

export function renderSalidasView(container) {
  const adminMode = isAdmin();
  const publicSlug = state.settings?.slug || '';
  const publicUrl = `${window.location.origin}${window.location.pathname}#/salidas/${publicSlug}`;
  const draftTerrs = getDraftProposalTerritories();

  container.innerHTML = `
    <div class="space-y-4 pb-24 w-full">
      ${
        adminMode && draftTerrs.length > 0
          ? `<div class="bg-amber-50 border border-amber-300 p-3.5 rounded-2xl shadow-sm flex flex-wrap items-center justify-between gap-2">
              <div class="text-xs text-amber-950">
                <span class="font-extrabold">📌 Propuesta desde Avance:</span>
                Territorios <b>${escapeHtml(draftTerrs.join(', '))}</b> listos para asignar.
              </div>
              <div class="flex items-center gap-2">
                <button id="btn-use-draft-terrs"
                  class="bg-amber-600 hover:bg-amber-700 text-white font-bold px-3 py-1.5 rounded-xl text-xs shadow-xs">
                  + Programar con estos
                </button>
                <button id="btn-clear-draft-terrs"
                  class="bg-white hover:bg-amber-100 text-amber-900 font-semibold px-2.5 py-1.5 rounded-xl text-xs border border-amber-300">
                  Descartar
                </button>
              </div>
            </div>`
          : ''
      }

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
                  Link Público
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

      ${buildScheduleTableHtml(state.schedules, { adminMode })}
    </div>
    ${showScheduleModal ? renderScheduleModalHtml() : ''}
  `;

  if (adminMode) {
    document.getElementById('btn-use-draft-terrs')?.addEventListener('click', () => {
      editingScheduleId = null;
      prefilledTerritories = draftTerrs.join(', ');
      showScheduleModal = true;
      renderSalidasView(container);
    });

    document.getElementById('btn-clear-draft-terrs')?.addEventListener('click', () => {
      clearDraftProposalTerritories();
      renderSalidasView(container);
    });

    document.getElementById('btn-new-schedule').onclick = () => {
      editingScheduleId = null;
      prefilledTerritories = draftTerrs.join(', ');
      showScheduleModal = true;
      renderSalidasView(container);
    };

    document.getElementById('btn-copy-public-link').onclick = async () => {
      await navigator.clipboard.writeText(publicUrl);
      showToast('Enlace de cartelera pública copiado', 'success');
    };

    document.querySelectorAll('.edit-sched-btn').forEach((btn) => {
      btn.onclick = () => {
        editingScheduleId = btn.getAttribute('data-edit-sched');
        prefilledTerritories = '';
        showScheduleModal = true;
        renderSalidasView(container);
      };
    });

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

  document.querySelectorAll('.send-wa-btn').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-sched-id');
      const item = state.schedules.find((x) => x.id === id);
      if (!item) return;

      const phone = findConductorPhone(item.conductor_name);

      let displayName = (item.conductor_name || '').trim();
      if (displayName.includes(',')) {
        const [apellido, nombre] = displayName.split(',').map((s) => s.trim());
        const apellidoCap =
          apellido.charAt(0).toUpperCase() + apellido.slice(1).toLowerCase();
        displayName = `${nombre} ${apellidoCap}`.trim();
      }
      const saludo = displayName ? `Hola ${displayName}, ` : 'Hola, ';

      const text = [
        `${saludo}te paso los datos de la salida al servicio que tenés asignada:`,
        ``,
        `• *Día:* ${formatDateSpanish(item.date)}`,
        `• *Hora:* ${formatTimeShort(item.time)} hs`,
        `• *Lugar:* ${item.meeting_point_text}`,
        item.groups_assigned ? `• *Grupos:* ${item.groups_assigned}` : null,
        item.assigned_subterritories ? `• *Territorios:* ${item.assigned_subterritories}` : null,
        ``,
        `Por favor, mandame un OK como respuesta`
      ]
        .filter((line) => line !== null)
        .join('\n');

      const encoded = encodeURIComponent(text);

      if (phone) {
        window.open(`https://wa.me/${phone}?text=${encoded}`, '_blank');
      } else {
        showToast(
          item.conductor_name
            ? `No se encontró celular para "${item.conductor_name}". Elegí el contacto en WhatsApp.`
            : 'Elegí el contacto en WhatsApp',
          'warning'
        );
        window.open(`https://wa.me/?text=${encoded}`, '_blank');
      }
    };
  });

  if (showScheduleModal) {
    bindScheduleModalEvents(container);
  }
}

function renderScheduleModalHtml() {
  const sourceList = conductoresList.length > 0 ? conductoresList : hermanosList;
  const editingItem = editingScheduleId
    ? state.schedules.find((x) => x.id === editingScheduleId)
    : null;

  const dateVal = editingItem?.date || '';
  const timeVal = editingItem?.time ? formatTimeShort(editingItem.time) : '09:45';
  const placeVal = editingItem?.meeting_point_text || '';
  const conductorVal = editingItem?.conductor_name || '';
  const groupsVal = editingItem ? (editingItem.groups_assigned || '') : 'CONGREGACIONAL';
  const terrsVal = editingItem ? (editingItem.assigned_subterritories || '') : prefilledTerritories;
  const isSpecial = Boolean(editingItem?.is_special_event);

  return `
    <div class="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4 overflow-y-auto">
      <div class="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl space-y-3 my-6">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-extrabold text-slate-900">
            ${editingItem ? 'Editar Salida' : 'Nueva Salida'}
          </h3>
          <button id="close-sched-modal" class="text-slate-400 hover:text-slate-700 text-xl font-bold">✕</button>
        </div>

        <form id="new-schedule-form" class="space-y-3">
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-xs font-bold text-slate-700 mb-1">Fecha</label>
              <input type="date" id="sched-date" required value="${escapeHtml(dateVal)}"
                class="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm" />
            </div>
            <div>
              <label class="block text-xs font-bold text-slate-700 mb-1">Hora</label>
              <input type="time" id="sched-time" required value="${escapeHtml(timeVal)}"
                class="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm" />
            </div>
          </div>

          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">Lugar / Actividad</label>
            ${
              state.meetingPoints.length > 0
                ? `<select id="sched-mp-select" class="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white mb-1.5">
                    <option value="">-- Elegir guardado o escribir abajo --</option>
                    ${state.meetingPoints
                      .map(
                        (mp) =>
                          `<option value="${escapeHtml(mp.name_and_address)}" ${
                            mp.name_and_address === placeVal ? 'selected' : ''
                          }>${escapeHtml(mp.name_and_address)}</option>`
                      )
                      .join('')}
                  </select>`
                : ''
            }
            <input type="text" id="sched-mp-text" required value="${escapeHtml(placeVal)}"
              placeholder="Ej: FLIA. RESSIA (BOLIVAR 3020) o REUNION"
              class="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm" />
          </div>

          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">Conductor</label>
            <select id="sched-conductor-select"
              class="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold bg-white">
              <option value="">-- Sin conductor asignado --</option>
              ${sourceList
                .map((h) => {
                  const hasPhone =
                    h.celular && !String(h.celular).toLowerCase().includes('sin tel');
                  const phoneTag = hasPhone ? ` · Tel: ${h.celular}` : ' · sin tel.';
                  const isSelected = normalizeName(h.nombre) === normalizeName(conductorVal);
                  return `<option value="${escapeHtml(h.nombre)}" ${
                    isSelected ? 'selected' : ''
                  }>${escapeHtml(h.nombre)}${escapeHtml(phoneTag)}</option>`;
                })
                .join('')}
            </select>
            ${
              conductoresList.length === 0
                ? `<p class="text-[11px] text-amber-700 mt-1">
                    Sugerencia: asigná el rol <b>Conductor</b> en <b>Admin → Usuarios</b> para filtrar solo conductores habilitados.
                  </p>`
                : ''
            }
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-xs font-bold text-slate-700 mb-1">Grupos</label>
              <input type="text" id="sched-groups" value="${escapeHtml(groupsVal)}"
                placeholder="Ej: CONGREGACIONAL o 1, 2"
                class="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm" />
            </div>
            <div>
              <label class="block text-xs font-bold text-slate-700 mb-1">Territorio</label>
              <input type="text" id="sched-terrs" value="${escapeHtml(terrsVal)}"
                placeholder="Ej: 26, 25, 24"
                class="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm" />
            </div>
          </div>

          <label class="flex items-center gap-2 text-xs font-semibold text-slate-700 pt-1">
            <input type="checkbox" id="sched-special" ${isSpecial ? 'checked' : ''} class="rounded" />
            <span>Campaña o evento especial</span>
          </label>

          <button type="submit"
            class="w-full bg-blue-900 hover:bg-blue-800 text-white font-bold py-3 rounded-xl text-sm shadow">
            ${editingItem ? 'Guardar Cambios' : 'Guardar Salida'}
          </button>
        </form>
      </div>
    </div>
  `;
}

function bindScheduleModalEvents(container) {
  document.getElementById('close-sched-modal').onclick = () => {
    showScheduleModal = false;
    editingScheduleId = null;
    prefilledTerritories = '';
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
    const selectedConductor = document.getElementById('sched-conductor-select')?.value.trim() || null;

    const payload = {
      congregation_id: state.congregation.id,
      date: document.getElementById('sched-date').value,
      time: document.getElementById('sched-time').value,
      meeting_point_text: document.getElementById('sched-mp-text').value.trim(),
      conductor_name: selectedConductor,
      groups_assigned: document.getElementById('sched-groups').value.trim() || null,
      assigned_subterritories: document.getElementById('sched-terrs').value.trim() || null,
      is_special_event: document.getElementById('sched-special').checked
    };

    if (editingScheduleId) {
      const { data, error } = await supabase
        .from('terr_schedules')
        .update(payload)
        .eq('id', editingScheduleId)
        .select()
        .single();

      if (error) {
        showToast('Error al actualizar salida: ' + error.message, 'error');
        return;
      }

      const idx = state.schedules.findIndex((x) => x.id === editingScheduleId);
      if (idx !== -1) state.schedules[idx] = data;
      state.schedules.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      showScheduleModal = false;
      editingScheduleId = null;
      prefilledTerritories = '';
      showToast('Salida actualizada correctamente', 'success');
      renderSalidasView(container);
      return;
    }

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
    clearDraftProposalTerritories();
    showScheduleModal = false;
    editingScheduleId = null;
    prefilledTerritories = '';
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

  let query = supabase
    .from('terr_schedules')
    .select('*')
    .eq('congregation_id', settings.congregation_id)
    .order('date', { ascending: true })
    .order('time', { ascending: true });

  if (settings.public_schedule_start_date) {
    query = query.gte('date', settings.public_schedule_start_date);
  }
  if (settings.public_schedule_end_date) {
    query = query.lte('date', settings.public_schedule_end_date);
  }

  const { data: schedules } = await query;
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

      <main class="max-w-5xl mx-auto p-4 space-y-4">
        ${buildScheduleTableHtml(list, { adminMode: false })}

        <div class="pt-4 text-center">
          <a href="${window.location.pathname}" class="text-xs font-bold text-blue-900 underline">
            Ingresar a la app de Territorios →
          </a>
        </div>
      </main>
    </div>
  `;
}
