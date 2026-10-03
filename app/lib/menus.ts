import { database } from './database';

export type MenuItem = { id:string; label:string };

// The dishes each slot serves, in the chef's library order.
export async function menusForSlots(slotIds: string[]) {
  const menus = new Map<string, MenuItem[]>();
  if (!slotIds.length) return menus;
  const rows = await database().prepare(`SELECT sm.slot_id, o.id, o.label FROM slot_menu_options sm JOIN menu_options o ON o.id = sm.option_id WHERE sm.slot_id IN (${slotIds.map(() => '?').join(',')}) ORDER BY o.sort_order ASC, o.label ASC`).bind(...slotIds).all<{ slot_id:string; id:string; label:string }>();
  for (const r of rows.results) { const list = menus.get(r.slot_id) ?? []; list.push({ id:r.id, label:r.label }); menus.set(r.slot_id, list); }
  return menus;
}
