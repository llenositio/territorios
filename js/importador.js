import { supabase } from './supabase.js';
import { state } from './state.js';
import { showToast, escapeHtml } from './ui-helpers.js';

let isImporting = false;
let stopRequested = false;

function parseInputRows(rawText) {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const separator = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const rows = lines.map((line) => line.split(separator).map((c) => c.trim().replace(/^"|"$/g, '')));

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
          subterritory: cols[0],
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
    <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
      <div>
        <h3 class="text-base font-extrabold text-slate-900">📥 Importar Edificios y Deptos</h3>
        <p class="text-xs text-slate-500 mt-0.5">
          Copiá y pegá directamente desde Google Sheets o Excel con 4 columnas:<br>
          <b>Territorio | Calle | Altura | Departamentos</b> (ej: <code>4A | Rivadavia | 2450 | 1A, 1B, 2A, 2B</code>)
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

      <textarea id="imp-textarea" rows="5"
        placeholder="4A&#9;Av. Independencia&#9;1850&#9;PB A, PB B, 1A, 1B, 2A, 2B&#10;4A&#9;San Martín&#9;2310&#9;1, 2, 3, 4"
        class="w-full p-3 rounded-xl border border-slate-300 text-xs font-mono focus:ring-2 focus:ring-blue-800 outline-none"></textarea>

      <div class="flex items-center justify-between gap-2">
        <label class="text-xs font-bold text-blue-900 underline cursor-pointer">
          O subir archivo .CSV
          <input type="file" id="imp-csv-file" accept=".csv,.txt" class="hidden" />
        </label>

        <div class="flex gap-2">
          <button id="btn-stop-import" class="hidden bg-rose-600 text-white font-bold px-3 py-2 rounded-xl text-xs">
            Detener
          </button>
          <button id="btn-start-import"
            class="bg-blue-900 hover:bg-blue-800 text-white font-bold px-4 py-2.5 rounded-xl text-xs shadow">
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
  `;
}

export function bindImportadorEvents(onComplete) {
  const csvInput = document.getElementById('imp-csv-file');
  if (csvInput) {
    csvInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      document.getElementById('imp-textarea').value = text;
      showToast('Archivo cargado. Tocá Iniciar Importación.', 'info');
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
