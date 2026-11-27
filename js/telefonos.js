import { supabase } from './supabase.js';
import { state, isAdmin } from './state.js';
import { showToast, formatRelativeDate, escapeHtml } from './ui-helpers.js';

const BATCH_SIZE = 10;

let activeBatch = [];
let selectedSubId = 'ALL';
let showImportBox = false;
let totalActivePool = 0;

export async function loadTelephonesBatch() {
  if (!state.congregation?.id) return;

  const nowIso = new Date().toISOString();

  let countQuery = supabase
    .from('terr_telephones')
    .select('id', { count: 'exact', head: true })
    .eq('congregation_id', state.congregation.id)
    .eq('status', 'active');

  if (selectedSubId !== 'ALL') {
    countQuery = countQuery.eq('subterritory_id', selectedSubId);
  }

  const { count } = await countQuery;
  totalActivePool = count || 0;

  let query = supabase
    .from('terr_telephones')
    .select('*, terr_subterritories(code)')
    .eq('congregation_id', state.congregation.id)
    .eq('status', 'active')
    .or(`skipped_until.is.null,skipped_until.lte.${nowIso}`)
    .order('last_called_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (selectedSubId !== 'ALL') {
    query = query.eq('subterritory_id', selectedSubId);
  }

  const { data, error } = await query;
  if (error) {
    showToast('Error al cargar lote telefónico: ' + error.message, 'error');
    activeBatch = [];
    return;
  }

  activeBatch = data || [];
  state.telephones = activeBatch;
}

function formatDialNumber(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('549')) return digits;
  if (digits.startsWith('54')) return '549' + digits.slice(2);
  if (digits.startsWith('0')) return '549' + digits.slice(1);
  if (digits.length === 10) return '549' + digits;
  return digits;
}

export function renderTelefonosView(container) {
  const adminMode = isAdmin();

  container.innerHTML = `
    <div class="space-y-4 pb-24">
      <!-- Encabezado y controles -->
      <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
        <div class="flex items-center justify-between gap-2">
          <div>
            <h2 class="text-base font-extrabold text-slate-900">📞 Predicación Telefónica</h2>
            <p class="text-xs text-slate-500">
              Lote activo de hasta <b>${BATCH_SIZE} números</b> · Base disponible: <b>${totalActivePool}</b>
            </p>
          </div>
          <div class="flex items-center gap-1.5">
            <button id="btn-reload-tel-batch"
              class="bg-blue-900 hover:bg-blue-800 text-white font-bold px-3 py-2 rounded-xl text-xs shadow-xs">
              🔄 Nuevo lote (10)
            </button>
            ${
              adminMode
                ? `<button id="btn-toggle-tel-import"
                    class="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-3 py-2 rounded-xl text-xs">
                    ➕ Cargar
                  </button>`
                : ''
            }
          </div>
        </div>

        <select id="tel-sub-filter"
          class="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold bg-white">
          <option value="ALL" ${selectedSubId === 'ALL' ? 'selected' : ''}>Todos los territorios</option>
          ${(state.subterritories || [])
            .map(
              (s) =>
                `<option value="${s.id}" ${selectedSubId === s.id ? 'selected' : ''}>Territorio ${escapeHtml(
                  s.code
                )}</option>`
            )
            .join('')}
        </select>
      </div>

      ${adminMode && showImportBox ? renderImportTelephonesHtml() : ''}

      <!-- Lista del lote actual de 10 números -->
      ${
        activeBatch.length === 0
          ? `<div class="bg-white p-8 rounded-2xl border border-slate-200 text-center space-y-2">
              <div class="text-3xl">📭</div>
              <p class="font-extrabold text-slate-800 text-sm">No hay números disponibles en este lote</p>
              <p class="text-xs text-slate-500">
                Todos los números fueron trabajados recientemente o aún no se cargaron registros.
              </p>
            </div>`
          : `<div class="space-y-3">
              ${activeBatch
                .map((item, idx) => {
                  const waNum = formatDialNumber(item.phone_number);
                  return `
                    <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
                      <div class="flex items-start justify-between gap-2">
                        <div>
                          <div class="flex items-center gap-2">
                            <span class="bg-blue-900 text-white text-[11px] font-black px-2 py-0.5 rounded-md">
                              #${idx + 1}
                            </span>
                            ${
                              item.terr_subterritories?.code
                                ? `<span class="bg-slate-100 text-slate-700 text-[11px] font-bold px-2 py-0.5 rounded">
                                    Terr. ${escapeHtml(item.terr_subterritories.code)}
                                  </span>`
                                : ''
                            }
                            <span class="text-[11px] text-slate-500 font-semibold">
                              ${formatRelativeDate(item.last_called_at)}
                            </span>
                          </div>
                          <div class="text-lg font-black text-slate-900 mt-1 tracking-wide">
                            ${escapeHtml(item.phone_number)}
                          </div>
                          ${
                            item.holder_name || item.address_ref
                              ? `<div class="text-xs text-slate-600">
                                  ${escapeHtml(item.holder_name || '')}
                                  ${item.holder_name && item.address_ref ? ' · ' : ''}
                                  ${escapeHtml(item.address_ref || '')}
                                </div>`
                              : ''
                          }
                        </div>

                        <div class="flex items-center gap-1.5 shrink-0">
                          <a href="tel:${escapeHtml(item.phone_number)}"
                            class="bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold px-3 py-2 rounded-xl text-xs shadow-xs">
                            📞 Llamar
                          </a>
                          ${
                            waNum
                              ? `<a href="https://wa.me/${waNum}" target="_blank" rel="noopener noreferrer"
                                  class="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold px-2.5 py-2 rounded-xl text-xs">
                                  WA
                                </a>`
                              : ''
                          }
                        </div>
                      </div>

                      <!-- Botones de resultado de llamada -->
                      <div class="grid grid-cols-5 gap-1.5 pt-1 border-t border-slate-100">
                        <button data-tel-id="${item.id}" data-tel-action="answered"
                          class="tel-action-btn py-2 px-1 rounded-xl bg-emerald-100 hover:bg-emerald-200 text-emerald-900 font-extrabold text-[11px]">
                          ✅ Atendió
                        </button>
                        <button data-tel-id="${item.id}" data-tel-action="no_answer"
                          class="tel-action-btn py-2 px-1 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 font-extrabold text-[11px]">
                          🔔 No atendió
                        </button>
                        <button data-tel-id="${item.id}" data-tel-action="skipped"
                          class="tel-action-btn py-2 px-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px]">
                          ⏭️ Saltear
                        </button>
                        <button data-tel-id="${item.id}" data-tel-action="do_not_call"
                          class="tel-action-btn py-2 px-1 rounded-xl bg-rose-100 hover:bg-rose-200 text-rose-800 font-bold text-[11px]">
                          🚫 No llamar
                        </button>
                        <button data-tel-id="${item.id}" data-tel-action="invalid"
                          class="tel-action-btn py-2 px-1 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-[11px]">
                          ❓ Inválido
                        </button>
                      </div>
                    </div>
                  `;
                })
                .join('')}
            </div>`
      }
    </div>
  `;

  document.getElementById('btn-reload-tel-batch').onclick = async () => {
    await loadTelephonesBatch();
    renderTelefonosView(container);
    showToast(`Lote actualizado (${activeBatch.length} números)`, 'info');
  };

  document.getElementById('tel-sub-filter').onchange = async (e) => {
    selectedSubId = e.target.value;
    await loadTelephonesBatch();
    renderTelefonosView(container);
  };

  const toggleImportBtn = document.getElementById('btn-toggle-tel-import');
  if (toggleImportBtn) {
    toggleImportBtn.onclick = () => {
      showImportBox = !showImportBox;
      renderTelefonosView(container);
    };
  }

  document.querySelectorAll('.tel-action-btn').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-tel-id');
      const action = btn.getAttribute('data-tel-action');
      await handleTelephoneAction(id, action, container);
    };
  });

  if (adminMode && showImportBox) {
    bindImportTelephonesEvents(container);
  }
}

async function handleTelephoneAction(id, action, container) {
  const nowIso = new Date().toISOString();
  let payload = {};

  if (action === 'answered' || action === 'no_answer') {
    payload = {
      last_called_at: nowIso,
      last_called_by: state.profile.id,
      last_result: action,
      skipped_until: null
    };
  } else if (action === 'skipped') {
    payload = {
      skipped_until: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    };
  } else if (action === 'do_not_call') {
    payload = {
      status: 'do_not_call',
      last_called_at: nowIso,
      last_called_by: state.profile.id,
      last_result: 'do_not_call'
    };
  } else if (action === 'invalid') {
    payload = {
      status: 'invalid',
      last_called_at: nowIso,
      last_called_by: state.profile.id,
      last_result: 'invalid'
    };
  }

  const { error } = await supabase
    .from('terr_telephones')
    .update(payload)
    .eq('id', id);

  if (error) {
    showToast('Error al registrar llamada: ' + error.message, 'error');
    return;
  }

  // Quitar del lote visible actual para avanzar rápido en los 10 números
  activeBatch = activeBatch.filter((x) => x.id !== id);
  if (action === 'do_not_call' || action === 'invalid') {
    totalActivePool = Math.max(0, totalActivePool - 1);
  }

  const msgs = {
    answered: 'Registrado: Atendió',
    no_answer: 'Registrado: No atendió',
    skipped: 'Saltado por 15 minutos',
    do_not_call: 'Marcado como No llamar',
    invalid: 'Marcado como Número inválido'
  };
  showToast(msgs[action] || 'Guardado', 'success');

  // Si se completó el lote de 10, recargar automáticamente los siguientes 10
  if (activeBatch.length === 0) {
    await loadTelephonesBatch();
  }
  renderTelefonosView(container);
}

function renderImportTelephonesHtml() {
  return `
    <div class="bg-white p-4 rounded-2xl shadow-sm border border-amber-300 space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-extrabold text-slate-900">📥 Cargar Números Telefónicos</h3>
        <button id="close-tel-import" class="text-slate-400 hover:text-slate-700 font-bold">✕</button>
      </div>
      <p class="text-[11px] text-slate-500">
        Pegá uno por línea con formato: <b>Teléfono | Nombre (opcional) | Dirección (opcional)</b>
      </p>
      <select id="tel-import-sub"
        class="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold bg-white">
        <option value="">-- Sin territorio específico --</option>
        ${(state.subterritories || [])
          .map((s) => `<option value="${s.id}">Territorio ${escapeHtml(s.code)}</option>`)
          .join('')}
      </select>
      <textarea id="tel-import-raw" rows="4"
        placeholder="2235123456 | Juan Pérez | Av. Colón 2410&#10;2234987654"
        class="w-full p-2.5 rounded-xl border border-slate-300 text-xs font-mono"></textarea>
      <button id="btn-save-tel-import"
        class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold py-2.5 rounded-xl text-xs shadow">
        Guardar Números
      </button>
    </div>
  `;
}

function bindImportTelephonesEvents(container) {
  document.getElementById('close-tel-import').onclick = () => {
    showImportBox = false;
    renderTelefonosView(container);
  };

  document.getElementById('btn-save-tel-import').onclick = async () => {
    const raw = document.getElementById('tel-import-raw').value;
    const subId = document.getElementById('tel-import-sub').value || null;

    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      showToast('Ingresá al menos un número de teléfono', 'error');
      return;
    }

    const rows = lines
      .map((line) => {
        const sep = line.includes('\t') ? '\t' : line.includes('|') ? '|' : ';';
        const parts = line.split(sep).map((p) => p.trim());
        return {
          congregation_id: state.congregation.id,
          subterritory_id: subId,
          phone_number: parts[0] || '',
          holder_name: parts[1] || null,
          address_ref: parts[2] || null,
          status: 'active'
        };
      })
      .filter((r) => r.phone_number.length >= 6);

    if (rows.length === 0) {
      showToast('No se detectaron números válidos', 'error');
      return;
    }

    const { error } = await supabase.from('terr_telephones').insert(rows);
    if (error) {
      showToast('Error al guardar números: ' + error.message, 'error');
      return;
    }

    showToast(`${rows.length} números cargados correctamente`, 'success');
    showImportBox = false;
    await loadTelephonesBatch();
    renderTelefonosView(container);
  };
}
