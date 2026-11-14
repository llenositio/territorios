export const state = {
  authUser: null,        // Usuario autenticado de Supabase Auth
  profile: null,         // Fila en public.terr_users (role, status, congregation_id)
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
  meetingPoints: [],
  schedules: []
};

export function isSuperadmin() {
  return state.profile?.role === 'superadmin' && state.profile?.status === 'approved';
}

export function isAdmin() {
  return (
    (state.profile?.role === 'admin' || state.profile?.role === 'superadmin') &&
    state.profile?.status === 'approved'
  );
}

export function isConductorOrAdmin() {
  return (
    ['conductor', 'admin', 'superadmin'].includes(state.profile?.role) &&
    state.profile?.status === 'approved'
  );
}
