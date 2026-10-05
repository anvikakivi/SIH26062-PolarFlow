-- Supplied locations and assets (idempotent: INSERT OR IGNORE, existing rows left unchanged).
INSERT OR IGNORE INTO locations (location_id, name, type) VALUES
('LOC-NCPOR', 'NCPOR Logistics Warehouse (Goa)', 'WAREHOUSE'),
('LOC-BHARATI', 'Bharati Research Station (Larsemann Hills)', 'STATION'),
('LOC-MAITRI', 'Maitri Research Station (Schiermacher Oasis)', 'STATION'),
('LOC-TRAVERSE', 'Mobile Traverse Unit (Piston Bully Route)', 'MOBILE_UNIT');

INSERT OR IGNORE INTO assets (asset_id, barcode_id, content_id, name, category, status, current_location_id) VALUES
('AST-MED-001', 'BC-45ISEA-0101', '45ISEA-BOX-1', 'Portable ECG Monitor', 'Medical Equipment', 'AVAILABLE', 'LOC-BHARATI'),
('AST-MED-002', 'BC-45ISEA-0102', '45ISEA-BOX-1', 'Automated External Defibrillator (AED)', 'Medical Equipment', 'AVAILABLE', 'LOC-BHARATI'),
('AST-MED-003', 'BC-45ISEA-0201', '45ISEA-BOX-2', 'Hyperbaric Chamber Deflation Pump', 'Medical Equipment', 'MAINTENANCE', 'LOC-BHARATI'),
('AST-MED-004', 'BC-45ISEA-0202', '45ISEA-BOX-2', 'Field Trauma Surgery Kit', 'Medical Equipment', 'AVAILABLE', 'LOC-BHARATI'),
('AST-MED-005', 'BC-45ISEA-0301', '45ISEA-BOX-3', 'Pulse Oximeter & Resuscitation Unit', 'Medical Equipment', 'ISSUED', 'LOC-TRAVERSE'),
('AST-SKI-001', 'BC-45ISEA-0401', '45ISEA-BOX-4', 'Backcountry Alpine Touring Skis (Pair)', 'Ski Equipment', 'AVAILABLE', 'LOC-MAITRI'),
('AST-SKI-002', 'BC-45ISEA-0402', '45ISEA-BOX-4', 'Carbon Fiber Expedition Ski Poles', 'Ski Equipment', 'AVAILABLE', 'LOC-MAITRI'),
('AST-SKI-003', 'BC-45ISEA-0501', '45ISEA-BOX-5', 'Polar Climbing Crampons (12-Point)', 'Ski Equipment', 'ISSUED', 'LOC-TRAVERSE'),
('AST-SKI-004', 'BC-45ISEA-0502', '45ISEA-BOX-5', 'Glacier Ice Axe 70cm', 'Ski Equipment', 'ISSUED', 'LOC-TRAVERSE'),
('AST-SKI-005', 'BC-45ISEA-0601', '45ISEA-BOX-6', 'Cross-Country Ski Bindings Set', 'Ski Equipment', 'IN_TRANSIT', 'LOC-NCPOR'),
('AST-TNT-001', 'BC-45ISEA-0701', '45ISEA-BOX-7', 'Geodesic 4-Man Polar Dome Tent', 'Expedition Tents', 'AVAILABLE', 'LOC-MAITRI'),
('AST-TNT-002', 'BC-45ISEA-0702', '45ISEA-BOX-7', 'Heavy-Duty Snow Anchors & Staking Set', 'Expedition Tents', 'AVAILABLE', 'LOC-MAITRI'),
('AST-TNT-003', 'BC-45ISEA-0801', '45ISEA-BOX-8', 'Weather Haven Modular Field Shelter', 'Expedition Tents', 'AVAILABLE', 'LOC-NCPOR'),
('AST-TNT-004', 'BC-45ISEA-0802', '45ISEA-BOX-8', 'Sub-Zero Thermal Ground Insulation Mat', 'Expedition Tents', 'AVAILABLE', 'LOC-NCPOR'),
('AST-TNT-005', 'BC-45ISEA-0901', '45ISEA-BOX-9', 'Single-Man Emergency Bivy Tent', 'Expedition Tents', 'ISSUED', 'LOC-TRAVERSE'),
('AST-CKG-001', 'BC-45ISEA-1001', '45ISEA-BOX-10', 'Multi-Fuel Expedition Pressure Stove', 'Cooking Hardware', 'AVAILABLE', 'LOC-BHARATI'),
('AST-CKG-002', 'BC-45ISEA-1002', '45ISEA-BOX-10', 'Anodized Aluminum Mess Kit (6-Person)', 'Cooking Hardware', 'AVAILABLE', 'LOC-BHARATI'),
('AST-CKG-003', 'BC-45ISEA-1101', '45ISEA-BOX-11', 'Insulated Stainless Steel Snow Melter', 'Cooking Hardware', 'AVAILABLE', 'LOC-MAITRI'),
('AST-CKG-004', 'BC-45ISEA-1102', '45ISEA-BOX-11', 'High-Altitude Kerosene Primus Stove', 'Cooking Hardware', 'ISSUED', 'LOC-TRAVERSE'),
('AST-CKG-005', 'BC-45ISEA-1201', '45ISEA-BOX-12', 'Heavy-Duty Propane Heat Burner', 'Cooking Hardware', 'IN_TRANSIT', 'LOC-NCPOR');
