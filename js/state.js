export const state = {
  authUser: null,        // Usuario autenticado de Supabase Auth
  profile: null,         // Fila normalizada de public.perfiles (role, status, congregation_id)
  congregation: null,    // { id, nombre } de public.congregaciones
  settings: null,        // Fila de public.terr_congregation_settings
  currentTab: 'edificios',
  userLocation: null,    // { lat, lng }
  territories: [],
  subterritories: [],
  blocks: [],
  blockFaces: [],
  buildings: [],
  dnvHouses: [],
  telephones: [],
  reviewItems: [],
  reviewAlertsCount: { yellow: 0, red: 0 },
  meetingPoints: [],
  schedules: [],
  proposedTerritories: []
};

export function isSuperadmin() {
  const r = state.profile?.role;
  return (r === 'super_admin' || r === 'superadmin') && state.profile?.status === 'approved';
}

export function isAdmin() {
  const r = state.profile?.role;
  return (
    ['super_admin', 'superadmin', 'admin_congregacion', 'admin', 'editor_territorios'].includes(r) &&
    state.profile?.status === 'approved'
  );
}

export function canManageAnnualReviews() {
  const r = state.profile?.role;
  return (
    ['super_admin', 'superadmin', 'admin_congregacion', 'admin', 'editor_territorios'].includes(r) &&
    state.profile?.status === 'approved'
  );
}

export function isConductorOrAdmin() {
  const r = state.profile?.role;
  return (
    [
      'super_admin',
      'superadmin',
      'admin_congregacion',
      'admin',
      'editor_territorios',
      'conductor'
    ].includes(r) &&
    state.profile?.status === 'approved'
  );
}

export function isMensajeroTerritorios() {
  const r = state.profile?.role;
  return r === 'mensajero_territorios' && state.profile?.status === 'approved';
}
