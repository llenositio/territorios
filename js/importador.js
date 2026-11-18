import { supabase } from './supabase.js';
import { state } from './state.js';
import { showToast, escapeHtml } from './ui-helpers.js';

let isImporting = false;
let stopRequested = false;

function normalizeSubterritoryCode(rawCode) {
  const clean = String(rawCode || '').trim();
  if (!clean) return '';
  // Si coincide exacto con un territorio existente (ej: "26" o "4A"), usarlo tal cual
  const exact = state.subterritories.find(
    (s) => s.code.toLowerCase() === clean.toLowerCase()
  );
  if (exact) return exact.code;

  // Si escribieron "26E" (número + letra de manzana) y existe el territorio "26", mapearlo a "26"
  const numMatch = clean.match(/^(\d+)\s*[a-zA-Z]$/);
  if (numMatch) {
    const baseNum = numMatch[1];
    const baseSub = state.subterritories.find((s) => s.code === baseNum);
    if (baseSub) return baseSub.code;
  }
  return clean;
}

function parseInputRows(rawText) {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const firstLine = lines[0];
  const separator = firstLine.includes('\t')
    ? '\t'
    : firstLine.includes('|')
      ? '|'
      : firstLine.includes(';')
        ? ';'
        : ',';

  const rows = lines.map((line) =>
    line.split(separator).map((c) => c.trim().replace(/^"|"$/g, ''))
  );

  const firstRowJoined = rows[0].join(' ').toLowerCase();
  const hasHeader =
    firstRowJoined.includes('calle') ||
    firstRowJoined.includes('street') ||
    firstRowJoined.includes('altura') ||
    firstRowJoined.includes('territorio');

  const dataRows = hasHeader ? rows.slice(1) : rows;

  return dataRows
    .map((cols) => {
      if (cols.length >= 4) {
        return {
          subterritory: normalizeSubterritoryCode(cols[0]),
          street: cols[1],
          street_number: cols[2],
          apartments: cols.slice(3).join(', ')
        };
      }
      return {
        subterritory: '',
        street: cols[0] || '',
        street_number: cols[1] || '',
        apartments: cols[2] || ''
      };
    })
    .filter((r) => r.street && r.street_number);
}

export async function geocodeAddress(street, number, city, country) {
  const resolvedCity = city || state.settings?.city || 'Mar del Plata';
  const resolvedCountry = country || state.settings?.country || 'Argentina';
  const query = encodeURIComponent(`${street} ${number}, ${resolvedCity}, ${resolvedCountry}`);
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${query}`;
  try {
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'es' }
    });
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon)
      };
    }
  } catch (e) {
    console.warn('Error geocodificando:', street, number, e);
  }
  return { lat: null, lng: null };
}

export function renderImportadorHtml() {
  const city = state.settings?.city || 'Mar del Plata';
  const country = state.settings?.country || 'Argentina';

  return `
    <div class="space-y-4">
      <!-- BLOQUE A: CARGA RÁPIDA DE 1 EDIFICIO (SIN ERRORES DE COLUMNAS) -->
      <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
        <div>
          <h3 class="text-base font-extrabold text-slate-900">🏢 Cargar un Edificio Manualmente</h3>
          <p class="text-xs text-slate-500 mt-0.5">
            Cargá cada dato en su campo correspondiente y ubicá automáticamente su GPS en <b>${escapeHtml(
              city
            )}</b>.
          </p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div>
            <label class="block text-[11px] font-bold text-slate-700 mb-1">Territorio *</label>
            <select id="single-bldg-sub"
              class="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold bg-white">
              <option value="">-- Elegir Territorio --</option>
              ${state.subterritories
                .map((s) => `<option value="${s.id}">Territorio ${escapeHtml(s.code)}</option>`)
                .join('')}
            </select>
          </div>
          <div>
            <label class="block text-[11px] font-bold text-slate-700 mb-1">Calle *</label>
            <input type="text" id="single-bldg-street" placeholder="Ej: Catamarca"
              class="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold" />
          </div>
          <div>
            <label class="block text-[11px] font-bold text-slate-700 mb-1">Altura *</label>
            <input type="text" id="single-bldg-number" placeholder="Ej: 2150"
              class="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold" />
          </div>
        </div>

        <!-- Asistente rápido para generar pisos/letras sin tipear uno por uno -->
        <div class="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
          <div class="text-[11px] font-extrabold text-slate-700">
            ⚡ Generador rápido de timbres (opcional)
          </div>
          <div class="grid grid-cols-3 gap-2">
            <div>
              <label class="block text-[10px] font-bold text-slate-500 mb-0.5">Piso desde</label>
              <input type="number" id="gen-floor-from" min="1" max="50" placeholder="1"
                class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white" />
            </div>
            <div>
              <label class="block text-[10px] font-bold text-slate-500 mb-0.5">Piso hasta</label>
              <input type="number" id="gen-floor-to" min="1" max="50" placeholder="8"
                class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white" />
            </div>
            <div>
              <label class="block text-[10px] font-bold text-slate-500 mb-0.5">Deptos por piso</label>
              <input type="text" id="gen-floor-units" placeholder="A, B, C, D"
                class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white" />
            </div>
          </div>
          <button type="button" id="btn-gen-apts-list"
            class="bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold px-3 py-1.5 rounded-lg text-[11px]">
            + Generar timbres en el cuadro de abajo
          </button>
        </div>

        <div>
          <label class="block text-[11px] font-bold text-slate-700 mb-1">
            Timbres del edificio (separados por coma) *
          </label>
          <textarea id="single-bldg-apts" rows="2"
            placeholder="Ej: PB A, PB B, 1A, 1B, 2A, 2B, Portería"
            class="w-full p-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-blue-800 outline-none"></textarea>
        </div>

        <button type="button" id="btn-save-single-bldg"
          class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold py-2.5 rounded-xl text-xs shadow">
          💾 Guardar Edificio y Ubicar GPS
        </button>
      </div>

      <!-- BLOQUE B: IMPORTACIÓN MASIVA DESDE EXCEL / SHEETS -->
      <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
        <div>
          <h3 class="text-base font-extrabold text-slate-900">📥 Importación Masiva (Excel / Sheets / CSV)</h3>
          <p class="text-xs text-slate-500 mt-0.5">
            Pegá 4 columnas separadas por tabulación, <code>;</code> o <code>|</code>:<br>
            <b>Territorio | Calle | Altura | Departamentos</b> (ej: <code>26 | Catamarca | 2150 | PB A, PB B, 1A, 1B</code>)
          </p>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-[11px] font-bold text-slate-600 mb-1">Ciudad para GPS</label>
            <input type="text" id="imp-city" value="${escapeHtml(city)}"
              class="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs" />
          </div>
          <div>
            <label class="block text-[11px] font-bold text-slate-600 mb-1">País</label>
            <input type="text" id="imp-country" value="${escapeHtml(country)}"
              class="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs" />
          </div>
        </div>

        <textarea id="imp-textarea" rows="4"
          placeholder="26&#9;Catamarca&#9;2150&#9;PB A, PB B, 1A, 1B, 2A, 2B&#10;26&#9;San Martín&#9;2310&#9;1, 2, 3, 4"
          class="w-full p-3 rounded-xl border border-slate-300 text-xs font-mono focus:ring-2 focus:ring-blue-800 outline-none"></textarea>

        <div id="imp-preview-box" class="hidden bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2"></div>

        <div class="flex flex-wrap items-center justify-between gap-2">
          <label class="text-xs font-bold text-blue-900 underline cursor-pointer">
            O subir archivo .CSV
            <input type="file" id="imp-csv-file" accept=".csv,.txt" class="hidden" />
          </label>

          <div class="flex flex-wrap gap-2">
            <button type="button" id="btn-preview-import"
              class="bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold px-3 py-2 rounded-xl text-xs">
              👁️ Vista previa
            </button>
            <button type="button" id="btn-stop-import"
              class="hidden bg-rose-600 text-white font-bold px-3 py-2 rounded-xl text-xs">
              Detener
            </button>
            <button type="button" id="btn-start-import"
              class="bg-blue-900 hover:bg-blue-800 text-white font-bold px-4 py-2 rounded-xl text-xs shadow">
              Iniciar Importación
            </button>
          </div>
        </div>

        <div id="imp-progress-box" class="hidden bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1.5">
          <div class="flex justify-between text-xs font-bold text-slate-700">
            <span id="imp-status-text">Preparando...</span>
            <span id="imp-counter-text">0 / 0</span>
          </div>
          <div class="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
            <div id="imp-progress-bar" class="bg-emerald-600 h-full transition-all" style="width: 0%"></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function bindImportadorEvents(onComplete) {
  // 1. Generador automático de timbres en formulario individual
  const genBtn = document.getElementById('btn-gen-apts-list');
  if (genBtn) {
    genBtn.onclick = () => {
      const from = parseInt(document.getElementById('gen-floor-from').value, 10);
      const to = parseInt(document.getElementById('gen-floor-to').value, 10);
      const unitsRaw = document.getElementById('gen-floor-units').value.trim();

      if (isNaN(from) || isNaN(to) || from > to || !unitsRaw) {
        showToast('Completá piso desde, piso hasta y deptos por piso (ej: A, B, C)', 'error');
        return;
      }

      const units = unitsRaw
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean);

      const generated = [];
      for (let p = from; p <= to; p++) {
        for (const u of units) {
          generated.push(`${p}${u}`);
        }
      }

      const aptsArea = document.getElementById('single-bldg-apts');
      const current = aptsArea.value.trim();
      aptsArea.value = current ? `${current}, ${generated.join(', ')}` : generated.join(', ');
      showToast(`${generated.length} timbres agregados al cuadro`, 'success');
    };
  }

  // 2. Guardar edificio individual
  const saveSingleBtn = document.getElementById('btn-save-single-bldg');
  if (saveSingleBtn) {
    saveSingleBtn.onclick = async () => {
      const subId = document.getElementById('single-bldg-sub').value || null;
      const street = document.getElementById('single-bldg-street').value.trim();
      const streetNumber = document.getElementById('single-bldg-number').value.trim();
      const aptsRaw = document.getElementById('single-bldg-apts').value.trim();

      if (!street || !streetNumber) {
        showToast('Ingresá calle y altura del edificio', 'error');
        return;
      }

      const aptLabels = aptsRaw
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);

      if (aptLabels.length === 0) {
        showToast('Ingresá al menos un timbre o departamento', 'error');
        return;
      }

      saveSingleBtn.disabled = true;
      saveSingleBtn.textContent = 'Ubicando dirección en GPS...';

      const city = document.getElementById('imp-city')?.value.trim() || state.settings?.city || 'Mar del Plata';
      const country = document.getElementById('imp-country')?.value.trim() || state.settings?.country || 'Argentina';
      const coords = await geocodeAddress(street, streetNumber, city, country);

      const { data: newBldg, error: bErr } = await supabase
        .from('terr_buildings')
        .insert({
          congregation_id: state.congregation.id,
          subterritory_id: subId,
          street,
          street_number: streetNumber,
          lat: coords.lat,
          lng: coords.lng,
          status: 'active'
        })
        .select()
        .single();

      if (bErr || !newBldg) {
        showToast('Error al guardar edificio: ' + (bErr?.message || ''), 'error');
        saveSingleBtn.disabled = false;
        saveSingleBtn.textContent = '💾 Guardar Edificio y Ubicar GPS';
        return;
      }

      const { error: aptErr } = await supabase.from('terr_apartments').insert(
        aptLabels.map((label) => ({
          congregation_id: state.congregation.id,
          building_id: newBldg.id,
          label,
          status: 'active'
        }))
      );

      if (aptErr) {
        showToast('Edificio creado, pero hubo error en los timbres: ' + aptErr.message, 'error');
      } else {
        showToast(
          `Edificio ${street} ${streetNumber} guardado (${aptLabels.length} timbres)`,
          'success'
        );
      }

      document.getElementById('single-bldg-street').value = '';
      document.getElementById('single-bldg-number').value = '';
      document.getElementById('single-bldg-apts').value = '';
      saveSingleBtn.disabled = false;
      saveSingleBtn.textContent = '💾 Guardar Edificio y Ubicar GPS';

      if (onComplete) await onComplete();
    };
  }

  // 3. Vista previa de importación masiva
  const previewBtn = document.getElementById('btn-preview-import');
  if (previewBtn) {
    previewBtn.onclick = () => {
      const raw = document.getElementById('imp-textarea').value;
      const items = parseInputRows(raw);
      const previewBox = document.getElementById('imp-preview-box');
      if (items.length === 0) {
        showToast('No se detectaron filas válidas. Usá tabulación, ; o | entre columnas.', 'error');
        previewBox.classList.add('hidden');
        return;
      }

      previewBox.classList.remove('hidden');
      previewBox.innerHTML = `
        <div class="text-xs font-extrabold text-slate-800">
          👁️ Vista previa (${items.length} edificios detectados):
        </div>
        <div class="space-y-1 max-h-40 overflow-y-auto text-[11px]">
          ${items
            .map((it) => {
              const aptCount = it.apartments
                ? it.apartments.split(',').map((x) => x.trim()).filter(Boolean).length
                : 0;
              const existsSub = state.subterritories.some(
                (s) => s.code.toLowerCase() === (it.subterritory || '').toLowerCase()
              );
              return `
                <div class="bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 flex items-center justify-between gap-2">
                  <div>
                    <span class="font-bold text-blue-900">Terr. ${escapeHtml(it.subterritory || 'S/A')}</span>
                    ${
                      it.subterritory && !existsSub
                        ? '<span class="text-amber-700 font-bold">(nuevo)</span>'
                        : ''
                    }
                    · <b>${escapeHtml(it.street)} ${escapeHtml(it.street_number)}</b>
                  </div>
                  <span class="font-bold text-emerald-700 shrink-0">${aptCount} timbres</span>
                </div>
              `;
            })
            .join('')}
        </div>
      `;
    };
  }

  const csvInput = document.getElementById('imp-csv-file');
  if (csvInput) {
    csvInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      document.getElementById('imp-textarea').value = text;
      showToast('Archivo cargado. Tocá Vista previa o Iniciar Importación.', 'info');
    };
  }

  const stopBtn = document.getElementById('btn-stop-import');
  if (stopBtn) {
    stopBtn.onclick = () => {
      stopRequested = true;
      showToast('Deteniendo importación al finalizar fila actual...', 'warning');
    };
  }

  const startBtn = document.getElementById('btn-start-import');
  if (!startBtn) return;

  startBtn.onclick = async () => {
    if (isImporting) return;
    const raw = document.getElementById('imp-textarea').value;
    const items = parseInputRows(raw);
    if (items.length === 0) {
      showToast('Pegá al menos una fila válida (Territorio | Calle | Altura | Deptos)', 'error');
      return;
    }

    const city = document.getElementById('imp-city').value.trim() || 'Mar del Plata';
    const country = document.getElementById('imp-country').value.trim() || 'Argentina';

    isImporting = true;
    stopRequested = false;
    startBtn.disabled = true;
    stopBtn.classList.remove('hidden');

    const box = document.getElementById('imp-progress-box');
    const statusText = document.getElementById('imp-status-text');
    const counterText = document.getElementById('imp-counter-text');
    const bar = document.getElementById('imp-progress-bar');
    box.classList.remove('hidden');

    const subMap = new Map(
      state.subterritories.map((s) => [s.code.toLowerCase(), s.id])
    );

    let importedCount = 0;

    for (let i = 0; i < items.length; i++) {
      if (stopRequested) break;
      const row = items[i];

      statusText.textContent = `Geocodificando: ${row.street} ${row.street_number}...`;
      counterText.textContent = `${i + 1} / ${items.length}`;
      bar.style.width = `${Math.round(((i + 1) / items.length) * 100)}%`;

      let subId = null;
      if (row.subterritory) {
        const key = row.subterritory.toLowerCase();
        if (subMap.has(key)) {
          subId = subMap.get(key);
        } else {
          const { data: newSub } = await supabase
            .from('terr_subterritories')
            .insert({
              congregation_id: state.congregation.id,
              code: row.subterritory
            })
            .select()
            .single();
          if (newSub) {
            subId = newSub.id;
            subMap.set(key, newSub.id);
            state.subterritories.push(newSub);
          }
        }
      }

      const coords = await geocodeAddress(row.street, row.street_number, city, country);

      const { data: newBldg, error: bErr } = await supabase
        .from('terr_buildings')
        .insert({
          congregation_id: state.congregation.id,
          subterritory_id: subId,
          street: row.street,
          street_number: row.street_number,
          lat: coords.lat,
          lng: coords.lng,
          status: 'active'
        })
        .select()
        .single();

      if (!bErr && newBldg && row.apartments) {
        const aptLabels = row.apartments
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);

        if (aptLabels.length > 0) {
          await supabase.from('terr_apartments').insert(
            aptLabels.map((label) => ({
              congregation_id: state.congregation.id,
              building_id: newBldg.id,
              label,
              status: 'active'
            }))
          );
        }
        importedCount++;
      }

      if (i < items.length - 1 && !stopRequested) {
        await new Promise((r) => setTimeout(r, 1100));
      }
    }

    isImporting = false;
    startBtn.disabled = false;
    stopBtn.classList.add('hidden');
    statusText.textContent = `¡Finalizado! ${importedCount} edificios guardados.`;
    showToast(`Importación completada: ${importedCount} edificios`, 'success');
    if (onComplete) await onComplete();
  };
}
