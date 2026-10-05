"""
DEMO DATA ONLY - not used by the engine. Creates the simulation tables in data/asset.db and inserts
clearly-labelled demo rows (dates relative to today). Idempotent.   Run:  python -m backend.simulation.demo_seed
Scenario: Maitri fuel is resupplied by C001; EXP-DEMO-01 needs 400 L at Maitri; Bharati has spare fuel;
Food: DEMO-FOOD-MAITRI 500 kg, 20 kg/day (14 logged days), DEMO reserve 100 kg; C002 brings 300 kg on day +8;
EXP-DEMO-FOOD-01 needs 200 kg of food at Maitri from day +10 to +18. Outcomes are calculated by the engine.
The supplied LOC-* locations/assets (seed_supplied.sql) are applied with INSERT OR IGNORE and never touched otherwise.
Rebuild rule: all DEMO-LOG-* rows (fuel AND food) are deleted and recreated, so repeated runs never duplicate.
"""
from datetime import date, datetime, timedelta

from .. import db

today = date.today()
iso = lambda n: (today + timedelta(days=n)).isoformat()

LOCATIONS = [("station-maitri", "Maitri", "STATION"), ("station-bharati", "Bharati", "STATION"), ("basecamp-demo", "DEMO Basecamp", "BASECAMP")]
STOCK = [("DEMO-FUEL-MAITRI", "Fuel", "station-maitri", 1200, "L"), ("DEMO-FUEL-BHARATI", "Fuel", "station-bharati", 2000, "L"),
         ("DEMO-FUEL-BASECAMP", "Fuel", "basecamp-demo", 800, "L"), ("DEMO-FOOD-MAITRI", "Food Supplies", "station-maitri", 500, "kg")]
RESERVES = [("DEMO-FUEL-MAITRI", 300), ("DEMO-FUEL-BHARATI", 500), ("DEMO-FOOD-MAITRI", 100)]  # DEMO reserves; basecamp: deliberately none
DAILY_USE = {"DEMO-FUEL-MAITRI": 60, "DEMO-FUEL-BHARATI": 40, "DEMO-FOOD-MAITRI": 20}  # per logged day; basecamp: none on purpose
CARGO = [("C001", "Fuel", 1500, "L", "station-maitri", iso(10), "IN_TRANSIT"), ("C002", "Food Supplies", 300, "kg", "station-maitri", iso(8), "IN_TRANSIT")]
REQS = [("DEMO-REQ-1", "EXP-DEMO-01", "DEMO Traverse", iso(12), iso(20), "station-maitri", "Fuel", 400),
        ("DEMO-REQ-FOOD-1", "EXP-DEMO-FOOD-01", "DEMO Food Traverse", iso(10), iso(18), "station-maitri", "Food Supplies", 200)]


def seed():
    conn = db.connect_write()
    db.ensure_sim_schema(conn)
    db.apply_supplied_seed(conn)
    conn.executemany("INSERT OR REPLACE INTO locations VALUES (?,?,?)", LOCATIONS)
    conn.executemany("INSERT OR REPLACE INTO consumable_stock VALUES (?,?,?,?,?)", STOCK)
    conn.executemany("INSERT OR REPLACE INTO stock_reserves VALUES (?,?)", RESERVES)
    conn.executemany("INSERT OR REPLACE INTO cargo VALUES (?,?,?,?,?,?,?)", CARGO)
    conn.executemany("INSERT OR REPLACE INTO expedition_requirements VALUES (?,?,?,?,?,?,?,?)", REQS)
    conn.execute("DELETE FROM consumption_logs WHERE log_id LIKE 'DEMO-LOG-%'")
    for sid, qty in DAILY_USE.items():
        for back in range(14, 0, -1):
            ts = datetime.combine(today - timedelta(days=back), datetime.min.time()).replace(hour=12).isoformat(sep=" ")
            conn.execute("INSERT INTO consumption_logs (log_id, stock_id, quantity_used, logged_by_team, timestamp) VALUES (?,?,?,?,?)",
                         ("DEMO-LOG-%s-%d" % (sid, back), sid, qty, "DEMO", ts))
    conn.commit()
    conn.close()
    print("Demo data seeded into", db.DB_FILE)


if __name__ == "__main__":
    seed()
