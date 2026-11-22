import { supabase } from './supabase.js';
import { state } from './state.js';
import { showToast, escapeHtml } from './ui-helpers.js';

export async function loadUserSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    state.authUser = null;
    state.profile = null;
    state.congregation = null;
    state.settings = null;
    return null;
  }

  state.authUser = session.user;
  const userEmail = (session.user.email || '').toLowerCase();

  // Leer perfil unificado en public.perfiles
  let { data: profileRow, error } = await supabase
    .from('perfiles')
    .select('*, congregaciones(id, nombre)')
    .eq('id', session.user.id)
    .maybeSingle();

  // Si aún no existía fila en public.perfiles, crearla en estado pending (o super_admin si corresponde)
  if (!profileRow && !error) {
    const esSuper = userEmail === 'claudiollenolio@gmail.com';
    const nuevoPerfil = {
      id: session.user.id,
      email: userEmail,
      full_name: session.user.user_metadata?.full_name || userEmail.split('@')[0],
      role: esSuper ? 'super_admin' : 'publicador',
      status: esSuper ? 'approved' : 'pending',
      congregacion_id: null
    };
    const resInsert = await supabase
      .from('perfiles')
      .upsert(nuevoPerfil)
      .select('*, congregaciones(id, nombre)')
      .single();

    profileRow = resInsert.data;
    error = resInsert.error;
  }

  if (error) {
    console.error('Error leyendo public.perfiles:', error);
    return { status: 'error', message: error.message };
  }

  if (!profileRow) {
    return { status: 'no_profile' };
  }

  // Normalizar campos para mantener compatibilidad total con toda la app de Territorios
  const normalizedProfile = {
    ...profileRow,
    congregation_id: profileRow.congregacion_id || null,
    role: profileRow.role || profileRow.rol || 'publicador',
    status: profileRow.status || 'pending'
  };

  // Si el usuario todavía no eligió congregación (y no es super_admin), mostrar selector de solicitud
  if (
    normalizedProfile.role !== 'super_admin' &&
    normalizedProfile.role !== 'superadmin' &&
    !normalizedProfile.congregation_id
  ) {
    state.profile = normalizedProfile;
    return { status: 'no_profile', profile: normalizedProfile };
  }

  state.profile = normalizedProfile;
  state.congregation = profileRow.congregaciones || null;

  // Si es super_admin sin congregación fija, cargar la primera congregación disponible
  if (
    (normalizedProfile.role === 'super_admin' || normalizedProfile.role === 'superadmin') &&
    !state.congregation
  ) {
    const { data: firstCong } = await supabase
      .from('congregaciones')
      .select('id, nombre')
      .order('nombre', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (firstCong) {
      state.congregation = firstCong;
    }
  }

  if (state.congregation?.id) {
    const { data: settings } = await supabase
      .from('terr_congregation_settings')
      .select('*')
      .eq('congregation_id', state.congregation.id)
      .maybeSingle();
    state.settings = settings;
  }

  const effectiveStatus =
    normalizedProfile.role === 'super_admin' || normalizedProfile.role === 'superadmin'
      ? 'approved'
      : normalizedProfile.status;

  return { status: effectiveStatus, profile: normalizedProfile };
}

export async function signInWithGoogle() {
  const redirectUrl = window.location.origin + window.location.pathname;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectUrl
    }
  });
  if (error) {
    showToast('Error al iniciar con Google: ' + error.message, 'error');
  }
}

export async function signOut() {
  await supabase.auth.signOut();
  state.authUser = null;
  state.profile = null;
  state.congregation = null;
  state.settings = null;
  window.location.reload();
}

export function renderLoginScreen(container) {
  container.innerHTML = `
    <div class="min-h-screen flex flex-col justify-center items-center px-4 bg-gradient-to-b from-blue-950 via-blue-900 to-slate-900 text-white">
      <div class="w-full max-w-sm bg-white text-slate-900 rounded-3xl shadow-2xl p-7">
        <div class="text-center mb-6">
          <div class="w-16 h-16 mx-auto mb-3 rounded-2xl bg-blue-900 text-white flex items-center justify-center text-3xl shadow-md">
            🗺️
          </div>
          <h1 class="text-2xl font-extrabold text-slate-900 tracking-tight">Territorios y Salidas</h1>
          <p class="text-sm text-slate-500 mt-1">Predicación en edificios, manzanas y salidas</p>
        </div>

        <button id="btn-google-login"
          class="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-50 active:scale-[0.99] text-slate-800 font-bold py-3.5 px-4 border-2 border-slate-200 rounded-2xl shadow-sm transition">
          <svg class="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"/>
            <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"/>
            <path fill="#FBBC05" d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"/>
            <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"/>
          </svg>
          <span>Continuar con Google</span>
        </button>

        <p class="mt-5 text-center text-xs text-slate-400">
          Acceso unificado con tu cuenta de Google. Si es tu primera vez, podrás solicitar ingreso a tu congregación.
        </p>
      </div>
    </div>
  `;

  document.getElementById('btn-google-login').onclick = signInWithGoogle;
}

export async function renderCongregationRequestScreen(container, onSubmitted) {
  const { data: activeCongs } = await supabase
    .from('congregaciones')
    .select('id, nombre, ciudad')
    .eq('activa', true)
    .order('nombre', { ascending: true });

  const congregations = activeCongs || [];

  const defaultName =
    state.profile?.full_name ||
    state.authUser?.user_metadata?.full_name ||
    state.authUser?.email?.split('@')[0] ||
    '';

  container.innerHTML = `
    <div class="min-h-screen flex flex-col justify-center items-center px-4 bg-slate-100">
      <div class="w-full max-w-sm bg-white rounded-3xl shadow-xl p-7">
        <h2 class="text-xl font-extrabold text-slate-900">¡Bienvenido!</h2>
        <p class="text-sm text-slate-600 mt-1">
          Seleccioná tu congregación para solicitar acceso al administrador.
        </p>

        <form id="request-access-form" class="mt-5 space-y-4">
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">Tu Nombre y Apellido</label>
            <input type="text" id="req-fullname" required value="${escapeHtml(defaultName)}"
              class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm" />
          </div>

          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">Congregación</label>
            <select id="req-congregation" required
              class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm bg-white">
              <option value="">-- Elegir congregación --</option>
              ${congregations
                .map(
                  (c) =>
                    `<option value="${c.id}">${escapeHtml(c.nombre)}${
                      c.ciudad ? ` (${escapeHtml(c.ciudad)})` : ''
                    }</option>`
                )
                .join('')}
            </select>
          </div>

          <button type="submit" id="btn-send-request"
            class="w-full bg-blue-900 hover:bg-blue-800 text-white font-bold py-3 rounded-xl text-sm shadow">
            Enviar Solicitud
          </button>
        </form>

        <button id="btn-logout-req" class="w-full mt-4 text-xs text-slate-400 hover:text-slate-600">
          Cerrar sesión (${escapeHtml(state.authUser?.email || '')})
        </button>
      </div>
    </div>
  `;

  document.getElementById('btn-logout-req').onclick = signOut;

  document.getElementById('request-access-form').onsubmit = async (e) => {
    e.preventDefault();
    const congId = document.getElementById('req-congregation').value;
    const fullName = document.getElementById('req-fullname').value.trim();
    if (!congId) return;

    const btn = document.getElementById('btn-send-request');
    btn.disabled = true;
    btn.textContent = 'Enviando...';

    const { error } = await supabase
      .from('perfiles')
      .upsert({
        id: state.authUser.id,
        email: state.authUser.email.toLowerCase(),
        full_name: fullName,
        congregacion_id: congId,
        role: 'publicador',
        status: 'pending'
      });

    if (error) {
      showToast('Error al enviar solicitud: ' + error.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Enviar Solicitud';
      return;
    }

    await onSubmitted();
  };
}

export function renderStatusNoticeScreen(container, status) {
  const isBlocked = status === 'blocked';
  container.innerHTML = `
    <div class="min-h-screen flex flex-col justify-center items-center px-4 bg-slate-100 text-center">
      <div class="w-full max-w-sm bg-white rounded-3xl shadow-xl p-7">
        <div class="text-5xl mb-3">${isBlocked ? '🚫' : '⏳'}</div>
        <h2 class="text-xl font-extrabold text-slate-900">
          ${isBlocked ? 'Acceso Deshabilitado' : 'Solicitud Pendiente'}
        </h2>
        <p class="text-sm text-slate-600 mt-2 leading-relaxed">
          ${
            isBlocked
              ? 'Tu acceso a esta congregación se encuentra deshabilitado. Comunicate con el administrador si creés que es un error.'
              : 'Tu solicitud fue enviada al administrador de tu congregación. Apenas te habilite, vas a poder ingresar automáticamente.'
          }
        </p>
        <div class="mt-6 flex flex-col gap-2">
          <button onclick="window.location.reload()"
            class="w-full bg-blue-900 text-white font-bold py-3 rounded-xl text-sm">
            Verificar nuevamente
          </button>
          <button id="btn-status-logout"
            class="w-full bg-slate-100 text-slate-600 font-semibold py-2.5 rounded-xl text-xs">
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('btn-status-logout').onclick = signOut;
}
