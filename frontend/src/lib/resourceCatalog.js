/*
 * resourceCatalog.js
 * ---------------------------------------------------------------
 * TEMPORARY STATIC PLACEHOLDER DATA - NOT a database and NOT real inventory.
 * The final inventory / personnel / asset database does not exist yet.
 *
 * This is the ONLY place the planning page gets its option lists from. When the
 * FastAPI -> SQLite endpoint exists, replace the body of loadPlanningCatalog() with
 *     return fetch("/api/planning-catalog").then((r) => r.json());
 * returning the same shape; the planning page needs no other change.
 *
 * Shape:
 *   resources: [{ resource_id, name, unit }]
 *   personnel: [{ id, name }]
 *   assets:    [{ id, name }]
 * (Source stations are NOT placeholders: they come from the real station list.)
 * ---------------------------------------------------------------
 */

const STATIC_PLACEHOLDER_CATALOG = {
  resources: [
    { resource_id: "RES-FUEL", name: "Fuel", unit: "L" },
    { resource_id: "RES-FOOD", name: "Food Supplies", unit: "kg" },
    { resource_id: "RES-WATER", name: "Water", unit: "L" },
    { resource_id: "RES-MED", name: "Medical Supplies", unit: "kits" },
    { resource_id: "RES-SPARES", name: "Spare Parts", unit: "sets" }
  ],
  personnel: [
    { id: "PER-0007", name: "Field Team Alpha" },
    { id: "PER-0008", name: "Logistics Team Bravo" },
    { id: "PER-0009", name: "Medical Team" }
  ],
  assets: [
    { id: "VEH-001", name: "Tracked Vehicle 01" },
    { id: "VEH-002", name: "Snow Vehicle 02" },
    { id: "AST-001", name: "Sled Train 01" }
  ]
};

export async function loadPlanningCatalog() {
  return STATIC_PLACEHOLDER_CATALOG;
}
