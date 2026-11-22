import { useRooms } from '../../api/rooms';

/** Chambres actives, pour les listes de choix (le tableau de ménage ne propose jamais une chambre archivée). */
export const useCalendarRooms = () => {
  const q = useRooms({});
  return { ...q, data: (q.data ?? []).filter((r) => !r.isArchived) };
};
