import bcrypt from 'bcryptjs';
import pool from '../config/db';

async function seedDatabase() {
  console.log('====================================================');
  console.log('🚀 STARTING COMPREHENSIVE REALISTIC DATABASE SEED');
  console.log('====================================================');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ----------------------------------------------------
    // 1. CLEANUP OLD DUMMY DATA (Preserving Master Admins)
    // ----------------------------------------------------
    console.log('🧹 Cleaning up stale mock tables...');
    await client.query('DELETE FROM audit_logs');
    await client.query('DELETE FROM customer_feedback');
    await client.query('DELETE FROM newsletter_sends');
    await client.query('DELETE FROM communications');
    await client.query('DELETE FROM payments');
    await client.query('DELETE FROM invoices');
    await client.query('DELETE FROM shipment_documents');
    await client.query('DELETE FROM tracking_updates');
    await client.query('DELETE FROM shipment_items');
    await client.query('DELETE FROM shipments');
    await client.query('DELETE FROM email_verification_tokens');
    await client.query('DELETE FROM customers');
    await client.query(`DELETE FROM admins`);

    // ----------------------------------------------------
    // 2. SEED ADMINS & OPERATIONAL TEAM
    // ----------------------------------------------------
    console.log('👤 Seeding Administrator Accounts & Operational Team...');
    const defaultPasswordHash = await bcrypt.hash('Admin@123', 10);
    const dynamoPasswordHash = await bcrypt.hash('Asdfgh123@', 10);

    const adminStaff = [
      { name: 'Super Admin', email: 'admin@valuehandlers.com', role: 'super_admin', assignedRoles: ['super_admin', 'manager'], hash: defaultPasswordHash },
      { name: 'Dynamo Gabriel', email: 'dynamogabriel@yahoo.com', role: 'super_admin', assignedRoles: ['super_admin'], hash: dynamoPasswordHash },
      { name: 'Tunde Bakare', email: 'ops.lead@valuehandlers.com', role: 'manager', assignedRoles: ['manager', 'logistics_officer'], hash: defaultPasswordHash },
      { name: 'Chukwuma Eze', email: 'logistics.hub@valuehandlers.com', role: 'staff', assignedRoles: ['logistics_officer'], hash: defaultPasswordHash },
      { name: 'Amina Yusuf', email: 'finance.desk@valuehandlers.com', role: 'staff', assignedRoles: ['finance_officer'], hash: defaultPasswordHash },
      { name: 'Blessing Okon', email: 'crm.team@valuehandlers.com', role: 'staff', assignedRoles: ['crm_officer'], hash: defaultPasswordHash },
      { name: 'Ibrahim Musa', email: 'support.agent1@valuehandlers.com', role: 'staff', assignedRoles: ['support_staff'], hash: defaultPasswordHash },
      { name: 'Kelechi Nwosu', email: 'support.agent2@valuehandlers.com', role: 'staff', assignedRoles: ['support_staff'], hash: defaultPasswordHash }
    ];

    const admins: any[] = [];
    for (const a of adminStaff) {
      const res = await client.query(
        `INSERT INTO admins (name, email, password_hash, role, assigned_roles, notification_prefs, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         ON CONFLICT (email) DO UPDATE SET
           name = EXCLUDED.name,
           password_hash = EXCLUDED.password_hash,
           role = EXCLUDED.role,
           assigned_roles = EXCLUDED.assigned_roles,
           is_active = true
         RETURNING *`,
        [a.name, a.email, a.hash, a.role, a.assignedRoles, JSON.stringify({ emailAlerts: true, shipmentUpdates: true })]
      );
      admins.push(res.rows[0]);
    }
    console.log(`✅ Seeded ${admins.length} Staff/Admin accounts.`);

    const primaryAdmin = admins.find(a => a.email === 'admin@valuehandlers.com') || admins[0];

    // ----------------------------------------------------
    // 3. SEED REALISTIC CUSTOMERS (Corporate & Individual)
    // ----------------------------------------------------
    console.log('🏢 Seeding 40 Realistic Logistics Clients...');
    const customerPasswordHash = await bcrypt.hash('Client@123', 10);

    const rawCustomers = [
      // Oil & Gas
      { userId: 'CUST-1001', firstname: 'Oluwaseun', lastname: 'Adeyemi', email: 'o.adeyemi@petroenergy.ng', phone: '+2348033019842', industry: 'oil_gas', star: 5, status: 'loyal' },
      { userId: 'CUST-1002', firstname: 'Tari', lastname: 'Briggs', email: 'tari.briggs@nigerdeltaoil.com', phone: '+2348029182734', industry: 'oil_gas', star: 4, status: 'loyal' },
      { userId: 'CUST-1003', firstname: 'Kabir', lastname: 'Mustapha', email: 'kmustapha@sahararesources.ng', phone: '+2348149201948', industry: 'oil_gas', star: 5, status: 'returning' },
      { userId: 'CUST-1004', firstname: 'Victor', lastname: 'Nnamdi', email: 'procurement@seplatenergy.ng', phone: '+2348076543210', industry: 'oil_gas', star: 4, status: 'returning' },
      { userId: 'CUST-1005', firstname: 'David', lastname: 'Okoro', email: 'd.okoro@oceanicep.com', phone: '+2348091238475', industry: 'oil_gas', star: 3, status: 'prospect' },
      { userId: 'CUST-1006', firstname: 'Emeka', lastname: 'Okafor', email: 'logistics@dravoenergy.com', phone: '+2348039485721', industry: 'oil_gas', star: 3, status: 'lead' },

      // Medical & Pharma
      { userId: 'CUST-1007', firstname: 'Dr. Stella', lastname: 'Okeke', email: 'stella.okeke@emzorpharma.com', phone: '+2348034567890', industry: 'medical_pharma', star: 5, status: 'loyal' },
      { userId: 'CUST-1008', firstname: 'Farooq', lastname: 'Bello', email: 'procurement@medplushealth.ng', phone: '+2348051239874', industry: 'medical_pharma', star: 5, status: 'loyal' },
      { userId: 'CUST-1009', firstname: 'Chidinma', lastname: 'Eze', email: 'chidinma@biomedicalng.com', phone: '+2348187654321', industry: 'medical_pharma', star: 4, status: 'returning' },
      { userId: 'CUST-1010', firstname: 'Dr. Raymond', lastname: 'Ibe', email: 'raymond.ibe@lagosdiagnostic.org', phone: '+2348023489102', industry: 'medical_pharma', star: 4, status: 'returning' },
      { userId: 'CUST-1011', firstname: 'Halima', lastname: 'Sanusi', email: 'h.sanusi@lifelineclinics.ng', phone: '+2348123948571', industry: 'medical_pharma', star: 3, status: 'prospect' },
      { userId: 'CUST-1012', firstname: 'Fidelis', lastname: 'Onyeka', email: 'fidelis@primecarelabs.com', phone: '+2348067891234', industry: 'medical_pharma', star: 3, status: 'lead' },

      // Manufacturing & Industrial
      { userId: 'CUST-1013', firstname: 'Alhaji Rasheed', lastname: 'Lawal', email: 'r.lawal@chigroup.ng', phone: '+2348031122334', industry: 'manufacturing', star: 5, status: 'loyal' },
      { userId: 'CUST-1014', firstname: 'Babatunde', lastname: 'Ajayi', email: 'b.ajayi@sevenstarselectronics.com', phone: '+2348022233445', industry: 'manufacturing', star: 5, status: 'loyal' },
      { userId: 'CUST-1015', firstname: 'Kenechukwu', lastname: 'Maduka', email: 'maduka@alabatechdirect.ng', phone: '+2348033344556', industry: 'manufacturing', star: 4, status: 'returning' },
      { userId: 'CUST-1016', firstname: 'Ifeoma', lastname: 'Nwankwo', email: 'ifeoma.n@apexplastics.ng', phone: '+2348044455667', industry: 'manufacturing', star: 4, status: 'returning' },
      { userId: 'CUST-1017', firstname: 'Gideon', lastname: 'Adebisi', email: 'g.adebisi@leadwaypackaging.com', phone: '+2348055566778', industry: 'manufacturing', star: 3, status: 'prospect' },
      { userId: 'CUST-1018', firstname: 'Collins', lastname: 'Obinna', email: 'collins@proformafabricators.ng', phone: '+2348066677889', industry: 'manufacturing', star: 2, status: 'lead' },

      // Agricultural Exports & Agro-Allied
      { userId: 'CUST-1019', firstname: 'Audu', lastname: 'Danjuma', email: 'a.danjuma@cocoavalleyexports.com', phone: '+2348077788990', industry: 'agricultural', star: 5, status: 'loyal' },
      { userId: 'CUST-1020', firstname: 'Eunice', lastname: 'Ogunmola', email: 'eunice@greenfieldagro.ng', phone: '+2348088899001', industry: 'agricultural', star: 4, status: 'loyal' },
      { userId: 'CUST-1021', firstname: 'Suleiman', lastname: 'Garki', email: 'sgarki@northerngrain.ng', phone: '+2348099900112', industry: 'agricultural', star: 4, status: 'returning' },
      { userId: 'CUST-1022', firstname: 'Patience', lastname: 'Akpan', email: 'p.akpan@palmproducecalabar.com', phone: '+2348100011223', industry: 'agricultural', star: 3, status: 'prospect' },
      { userId: 'CUST-1023', firstname: 'Nura', lastname: 'Shehu', email: 'nura.shehu@kanosesame.org', phone: '+2348111122334', industry: 'agricultural', star: 3, status: 'lead' },

      // Mining & Heavy Machinery
      { userId: 'CUST-1024', firstname: 'Engr. Segun', lastname: 'Oladimeji', email: 'segun@rockstonemining.ng', phone: '+2348122233445', industry: 'mining', star: 5, status: 'loyal' },
      { userId: 'CUST-1025', firstname: 'Godwin', lastname: 'Ubong', email: 'g.ubong@solidmineralswest.com', phone: '+2348133344556', industry: 'mining', star: 4, status: 'returning' },
      { userId: 'CUST-1026', firstname: 'Aliyu', lastname: 'Garba', email: 'aliyu.garba@josquarryparts.ng', phone: '+2348144455667', industry: 'mining', star: 4, status: 'returning' },
      { userId: 'CUST-1027', firstname: 'Kingsley', lastname: 'Igwe', email: 'k.igwe@benchmarkminerals.com', phone: '+2348155566778', industry: 'mining', star: 2, status: 'prospect' },
      { userId: 'CUST-1028', firstname: 'Usman', lastname: 'Bature', email: 'ubature@goldfieldsnigeria.ng', phone: '+2348166677889', industry: 'mining', star: 3, status: 'lead' },

      // Others & E-Commerce / Consumer Goods / Auto Parts
      { userId: 'CUST-1029', firstname: 'Omotola', lastname: 'Jalasho', email: 'omotola@lekkifashionhub.com', phone: '+2348177788990', industry: 'others', star: 5, status: 'loyal' },
      { userId: 'CUST-1030', firstname: 'Chuka', lastname: 'Anosike', email: 'chuka.anosike@jumiamerchant.ng', phone: '+2348188899001', industry: 'others', star: 5, status: 'loyal' },
      { userId: 'CUST-1031', firstname: 'Samuel', lastname: 'Okafor', email: 'samuel.okafor@autopartsdirect.ng', phone: '+2348039876543', industry: 'others', star: 5, status: 'loyal' },
      { userId: 'CUST-1032', firstname: 'Tolulope', lastname: 'Williams', email: 't.williams@solarworldlagos.com', phone: '+2348199900112', industry: 'others', star: 4, status: 'returning' },
      { userId: 'CUST-1033', firstname: 'Kenneth', lastname: 'Agbo', email: 'kenneth@computerhouseikeja.ng', phone: '+2348021122446', industry: 'others', star: 4, status: 'returning' },
      { userId: 'CUST-1034', firstname: 'Fatima', lastname: 'Abubakar', email: 'fatima@abujaeventsdecor.com', phone: '+2348032233557', industry: 'others', star: 3, status: 'returning' },
      { userId: 'CUST-1035', firstname: 'Ebuka', lastname: 'Idris', email: 'ebuka@ladipospares.com', phone: '+2348043344668', industry: 'others', star: 3, status: 'prospect' },
      { userId: 'CUST-1036', firstname: 'Ronke', lastname: 'Shonibare', email: 'ronke.s@beautysupplyng.com', phone: '+2348054455779', industry: 'others', star: 2, status: 'lead' },
      { userId: 'CUST-1037', firstname: 'Terkimbi', lastname: 'Iorfa', email: 't.iorfa@benuelogistics.ng', phone: '+2348065566880', industry: 'others', star: 4, status: 'returning' },
      { userId: 'CUST-1038', firstname: 'Zainab', lastname: 'Gidado', email: 'zainab@kadunahomecraft.com', phone: '+2348076677991', industry: 'others', star: 3, status: 'lead' },
      { userId: 'CUST-1039', firstname: 'Kufre', lastname: 'Essien', email: 'kufre.essien@calabarexports.ng', phone: '+2348087788002', industry: 'others', star: 4, status: 'returning' },
      { userId: 'CUST-1040', firstname: 'Adeola', lastname: 'Ogundipe', email: 'adeola@lagossmarttech.ng', phone: '+2348098899113', industry: 'others', star: 5, status: 'loyal' }
    ];

    const customers: any[] = [];
    for (const c of rawCustomers) {
      const res = await client.query(
        `INSERT INTO customers (user_id, firstname, lastname, email, phone, industry, password_hash, star_rating, status, is_active, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, NOW() - (RANDOM() * INTERVAL '180 days'))
         RETURNING *`,
        [c.userId, c.firstname, c.lastname, c.email, c.phone, c.industry, customerPasswordHash, c.star, c.status]
      );
      customers.push(res.rows[0]);
    }
    console.log(`✅ Seeded ${customers.length} Customers with authentic corporate profiles.`);

    // ----------------------------------------------------
    // 4. SEED REALISTIC SHIPMENTS & DETAILED CARGO ITEMS
    // ----------------------------------------------------
    console.log('📦 Seeding 65 Realistic Shipments with Full Items...');

    interface ShipmentDef {
      mode: string;
      delivery: string;
      status: string;
      nature: string;
      hsCode: string;
      originAddr: string;
      destAddr: string;
      val: number;
      curr: string;
      wt: number;
      awb: string | null;
      bol: string | null;
      uid: string | null;
      originEmail: string;
      destEmail: string;
      originPhone: string;
      destPhone: string;
      items: Array<{ desc: string; cat: string; qty: number; wt: number; l: number; w: number; h: number }>;
    }

    const shipmentBlueprints: ShipmentDef[] = [
      // 1. High-value Air Freight China -> Lagos
      {
        mode: 'air_freight', delivery: 'door_to_door', status: 'delivered',
        nature: 'Diagnostic Imaging & Ultrasound Machines', hsCode: '9018.19',
        originAddr: 'Guangzhou Baiyun Airport Cargo Terminal, China',
        destAddr: 'Emzor Health Complex, Oshodi-Isolo Expressway, Lagos',
        val: 48500000, curr: 'NGN', wt: 640, awb: '083-99182341', bol: null, uid: 'VHI-AIR-0831',
        originEmail: 'export@gz-medtech.cn', destEmail: 'procurement@emzorpharma.com',
        originPhone: '+862088991122', destPhone: '+2348034567890',
        items: [
          { desc: 'Siemens Acuson Ultrasound Console Units', cat: 'Medical Equipment', qty: 3, wt: 320, l: 120, w: 80, h: 140 },
          { desc: 'Transducer Ultrasound Probes (Linear & Convex)', cat: 'Probes & Sensors', qty: 12, wt: 45, l: 50, w: 40, h: 30 },
          { desc: 'High-Resolution Medical Grade Monitors', cat: 'Electronics', qty: 6, wt: 95, l: 80, w: 60, h: 50 },
          { desc: 'Medical Calibration Cables & Toolkits', cat: 'Accessories', qty: 15, wt: 30, l: 40, w: 30, h: 25 }
        ]
      },
      // 2. Heavy Industrial Sea Freight Houston -> Port Harcourt
      {
        mode: 'sea_freight', delivery: 'port_to_port', status: 'in_transit',
        nature: 'Oilfield High-Pressure Valves & Drill Bits', hsCode: '8481.80',
        originAddr: 'Port of Houston, Terminal 4, Texas, USA',
        destAddr: 'Onne Oil & Gas Free Zone Port, Port Harcourt, Rivers State',
        val: 82000000, curr: 'NGN', wt: 18400, awb: null, bol: 'MAEU98234812', uid: 'VHI-SEA-2094',
        originEmail: 'houston.dispatch@cameron-slb.com', destEmail: 'tari.briggs@nigerdeltaoil.com',
        originPhone: '+17139824411', destPhone: '+2348029182734',
        items: [
          { desc: 'API-6A 10,000 PSI High-Pressure Gate Valves', cat: 'Oilfield Valves', qty: 8, wt: 6400, l: 180, w: 120, h: 150 },
          { desc: 'PDC Diamond Matrix Rotary Drill Bits 12-1/4"', cat: 'Drilling Tools', qty: 14, wt: 4200, l: 100, w: 100, h: 110 },
          { desc: 'Forged Steel Wellhead Flanges & Choke Manifolds', cat: 'Wellhead Equipment', qty: 20, wt: 7800, l: 200, w: 150, h: 130 }
        ]
      },
      // 3. China Groupage (Consolidated) Yiwu -> Lagos
      {
        mode: 'china_groupage', delivery: 'door_to_door', status: 'clearance',
        nature: 'Commercial Solar Inverters & Lithium Batteries', hsCode: '8504.40',
        originAddr: 'Yiwu VHI Warehouse Bay 8, Zhejiang, China',
        destAddr: 'Alaba International Market, Electronics Section, Ojo, Lagos',
        val: 36200000, curr: 'NGN', wt: 4800, awb: null, bol: null, uid: 'VHI-CNG-8812',
        originEmail: 'yiwuhub@vhi-china.com', destEmail: 'maduka@alabatechdirect.ng',
        originPhone: '+8657985112233', destPhone: '+2348033344556',
        items: [
          { desc: 'Growatt 10kW Hybrid 3-Phase Solar Inverters', cat: 'Solar Energy', qty: 25, wt: 1100, l: 70, w: 55, h: 30 },
          { desc: 'Felicity 48V 200Ah LiFePO4 Lithium Battery Packs', cat: 'Batteries', qty: 40, wt: 3200, l: 80, w: 60, h: 45 },
          { desc: 'Solar MPPT Charge Controllers 100A', cat: 'Accessories', qty: 50, wt: 250, l: 40, w: 30, h: 20 }
        ]
      },
      // 4. Air Freight Express Frankfurt -> Lagos
      {
        mode: 'air_freight', delivery: 'door_to_door', status: 'in_transit',
        nature: 'Automotive Engine Control Units (ECU) & Sensors', hsCode: '8708.29',
        originAddr: 'Frankfurt Cargo City South, Gate 32, Germany',
        destAddr: 'Ladipo Auto Spares Hub, Mushin, Lagos',
        val: 21500000, curr: 'NGN', wt: 380, awb: '020-77119933', bol: null, uid: 'VHI-AIR-0201',
        originEmail: 'logistics@bosch-automotive.de', destEmail: 'samuel.okafor@autopartsdirect.ng',
        originPhone: '+49696901122', destPhone: '+2348039876543',
        items: [
          { desc: 'Bosch Engine Control Units (Toyota / Mercedes)', cat: 'Auto Electronics', qty: 60, wt: 180, l: 60, w: 50, h: 40 },
          { desc: 'High Pressure Common Rail Fuel Injectors', cat: 'Fuel Systems', qty: 120, wt: 110, l: 45, w: 40, h: 35 },
          { desc: 'Oxygen & Mass Airflow Sensors', cat: 'Sensors', qty: 150, wt: 45, l: 40, w: 30, h: 25 }
        ]
      },
      // 5. Agricultural Cocoa & Cashew Export Lagos -> Antwerp
      {
        mode: 'export', delivery: 'port_to_port', status: 'delivered',
        nature: 'Grade-A Premium Fermented Raw Cocoa Beans', hsCode: '1801.00',
        originAddr: 'Cocoa Processing Warehouse, Akure Industrial Park, Ondo State',
        destAddr: 'Port of Antwerp-Bruges, Terminal 1740, Belgium',
        val: 94000000, curr: 'NGN', wt: 42000, awb: null, bol: 'MSCU77218844', uid: 'VHI-EXP-9921',
        originEmail: 'a.danjuma@cocoavalleyexports.com', destEmail: 'import@barrycallebaut.be',
        originPhone: '+2348077788990', destPhone: '+3232051122',
        items: [
          { desc: 'Jute Bags Fermented Dried Cocoa Beans (65kg/bag)', cat: 'Agro Commodity', qty: 640, wt: 41600, l: 100, w: 70, h: 40 }
        ]
      },
      // 6. Sea Freight FCL Shanghai -> Lagos Apapa
      {
        mode: 'sea_freight', delivery: 'door_to_door', status: 'processing',
        nature: 'Heavy Duty Injection Moulding Machinery', hsCode: '8477.10',
        originAddr: 'Shanghai Waigaoqiao Free Trade Zone, China',
        destAddr: 'Chi Industries Factory Compound, Ajao Estate, Lagos',
        val: 115000000, curr: 'NGN', wt: 26000, awb: null, bol: 'COSU66339911', uid: 'VHI-SEA-6631',
        originEmail: 'shanghai@haitian-plastics.cn', destEmail: 'r.lawal@chigroup.ng',
        originPhone: '+862158661122', destPhone: '+2348031122334',
        items: [
          { desc: 'Haitian 380-Ton Hydraulic Injection Moulding Machine', cat: 'Industrial Machinery', qty: 2, wt: 22000, l: 650, w: 220, h: 240 },
          { desc: 'Precision Moulds for Food Grade Containers', cat: 'Tooling Moulds', qty: 8, wt: 3200, l: 120, w: 100, h: 90 }
        ]
      },
      // 7. Consolidation Air Freight UK -> Abuja
      {
        mode: 'consolidation', delivery: 'door_to_door', status: 'delivered',
        nature: 'Apple MacBook Pro Laptops & iPad Pro Units', hsCode: '8471.30',
        originAddr: 'Heathrow Cargo Centre, Hounslow, London, UK',
        destAddr: 'Lekki Tech Hub Headquarters, Admiralty Way, Lekki Phase 1, Lagos',
        val: 42000000, curr: 'NGN', wt: 290, awb: '125-99884411', bol: null, uid: 'VHI-CON-1251',
        originEmail: 'london.hub@vhi-logistics.co.uk', destEmail: 'adeola@lagossmarttech.ng',
        originPhone: '+442087591122', destPhone: '+2348098899113',
        items: [
          { desc: 'Apple MacBook Pro 16-inch M3 Max 36GB RAM', cat: 'Laptops', qty: 20, wt: 140, l: 45, w: 35, h: 30 },
          { desc: 'Apple iPad Pro 12.9-inch 256GB Cellular', cat: 'Tablets', qty: 35, wt: 85, l: 35, w: 28, h: 25 },
          { desc: 'Apple Magic Keyboards & Apple Pencil Pro', cat: 'Accessories', qty: 45, wt: 40, l: 35, w: 25, h: 20 }
        ]
      },
      // 8. Cargo Clearing at Lagos Airport NAHCO
      {
        mode: 'cargo_clearing', delivery: 'clearance_only', status: 'pending',
        nature: 'Cold-Chain Insulin & Oncology Pharmaceuticals', hsCode: '3004.31',
        originAddr: 'Mumbai Air Cargo Terminal, Maharashtra, India',
        destAddr: 'NAHCO Cold Storage Facility, Murtala Airport, Ikeja, Lagos',
        val: 68000000, curr: 'NGN', wt: 850, awb: '098-44771122', bol: null, uid: 'VHI-CLR-0981',
        originEmail: 'exports@serumindia.com', destEmail: 'procurement@medplushealth.ng',
        originPhone: '+912228311122', destPhone: '+2348051239874',
        items: [
          { desc: 'Temperature Controlled Insulin Glargine Cartons (2-8°C)', cat: 'Biopharmaceuticals', qty: 150, wt: 520, l: 60, w: 50, h: 50 },
          { desc: 'Monoclonal Antibody Oncology Infusion Vials', cat: 'Critical Pharma', qty: 80, wt: 240, l: 50, w: 40, h: 40 }
        ]
      },
      // 9. Sea Freight Mining Machinery Germany -> Lagos
      {
        mode: 'sea_freight', delivery: 'port_to_door', status: 'in_transit',
        nature: 'Heavy Duty Rotary Rock Drill Rigs & Hydraulic Hammers', hsCode: '8430.41',
        originAddr: 'Port of Hamburg, Container Terminal Altenwerder, Germany',
        destAddr: 'Rockstone Granite Quarry Site, Abeokuta, Ogun State',
        val: 98000000, curr: 'NGN', wt: 32000, awb: null, bol: 'HLCUHAM99281', uid: 'VHI-SEA-7719',
        originEmail: 'freight@bauer-maschinengroup.de', destEmail: 'segun@rockstonemining.ng',
        originPhone: '+49403001122', destPhone: '+2348122233445',
        items: [
          { desc: 'Bauer BG-28 Hydraulic Rotary Drilling Rig Parts', cat: 'Heavy Machinery', qty: 1, wt: 24000, l: 850, w: 250, h: 300 },
          { desc: 'Krupp Hydraulic Breaker Hammers & Chisel Points', cat: 'Quarry Tools', qty: 4, wt: 7200, l: 220, w: 100, h: 90 }
        ]
      },
      // 10. China Groupage Shenzhen -> Lagos
      {
        mode: 'china_groupage', delivery: 'office_pickup', status: 'delivered',
        nature: 'Smartphone Replacement Screens & Micro-soldering Stations', hsCode: '8517.70',
        originAddr: 'Huaqiangbei Electronics Market, Shenzhen, China',
        destAddr: 'ValueHandlers Central Hub, 42 Airport Road, Ikeja, Lagos',
        val: 16800000, curr: 'NGN', wt: 220, awb: null, bol: null, uid: 'VHI-CNG-4402',
        originEmail: 'shenzhen@vhi-cargo.cn', destEmail: 'kenneth@computerhouseikeja.ng',
        originPhone: '+8675583112233', destPhone: '+2348021122446',
        items: [
          { desc: 'OLED Display Assemblies for iPhone 13/14/15', cat: 'Phone Parts', qty: 400, wt: 95, l: 50, w: 40, h: 35 },
          { desc: 'Quick 861DW Hot Air Rework Stations', cat: 'Repair Tools', qty: 15, wt: 75, l: 45, w: 35, h: 30 }
        ]
      }
    ];

    // Expanded generated realistic shipments (65 total)
    const extraShipments: any[] = [];
    const modes = ['air_freight', 'sea_freight', 'groupage', 'consolidation', 'china_groupage', 'cargo_clearing', 'export'];
    const deliveryModes = ['door_to_door', 'port_to_port', 'port_to_door', 'clearance_only', 'office_pickup', 'airport_pickup'];
    const statuses = ['delivered', 'in_transit', 'clearance', 'processing', 'pending', 'draft', 'cancelled'];
    const originCities = [
      { city: 'London, United Kingdom', email: 'dispatch@heathrowcargo.co.uk', phone: '+442088991100' },
      { city: 'Guangzhou, Guangdong, China', email: 'gz.export@cantonforwarding.cn', phone: '+862087654321' },
      { city: 'Frankfurt, Hesse, Germany', email: 'fra.hub@lufthansacargo.de', phone: '+496969001122' },
      { city: 'Houston, Texas, United States', email: 'houston.terminal@usforward.com', phone: '+17135550199' },
      { city: 'Dubai, Jebel Ali Free Zone, UAE', email: 'dxb.logistics@emiratesfreight.ae', phone: '+97148811223' },
      { city: 'Istanbul, Marmara, Turkey', email: 'ist.cargo@turkishglobal.tr', phone: '+902124651122' },
      { city: 'Mumbai, Maharashtra, India', email: 'bom.export@indiatradehub.in', phone: '+912228391100' },
      { city: 'Yiwu, Zhejiang, China', email: 'yiwu.market@zhejiangcargo.cn', phone: '+865798991122' }
    ];
    const destCities = [
      'Ikeja Industrial Estate, Lagos, Nigeria',
      'Victoria Island Commercial Hub, Lagos, Nigeria',
      'Onne Oil & Gas Free Zone, Port Harcourt, Rivers State',
      'Central Business District, Abuja FCT, Nigeria',
      'Bompai Industrial Area, Kano, Kano State',
      'Trans-Amadi Industrial Layout, Port Harcourt, Rivers State',
      'Alaba International Market, Ojo, Lagos, Nigeria',
      'Trade Fair Complex, Badagry Expressway, Lagos, Nigeria'
    ];

    const cargoThemes = [
      { nature: 'Solar Panels & Micro-Inverters', hs: '8541.40', cat: 'Renewable Energy', val: 28000000, wt: 3400 },
      { nature: 'Automotive Brake Discs & Suspension Struts', hs: '8708.30', cat: 'Auto Spare Parts', val: 19500000, wt: 1800 },
      { nature: 'Commercial Cold-Room Compressor Units', hs: '8418.69', cat: 'HVAC Equipment', val: 34000000, wt: 2200 },
      { nature: 'Pharmaceutical Grade Blister Foil Packaging', hs: '7607.19', cat: 'Pharma Packaging', val: 14200000, wt: 950 },
      { nature: 'Deep-Well Submersible Water Pumps', hs: '8413.70', cat: 'Agro Machinery', val: 16500000, wt: 1400 },
      { nature: 'High-Density Polyethylene Resin Pellets', hs: '3901.20', cat: 'Raw Polymers', val: 52000000, wt: 24000 },
      { nature: 'Hospital Operating Theatre LED Lighting Rigs', hs: '9405.40', cat: 'Surgical Equipment', val: 31000000, wt: 420 },
      { nature: 'Commercial Bakery Rotary Ovens & Dough Mixers', hs: '8438.10', cat: 'Food Processing', val: 26000000, wt: 2900 },
      { nature: 'Fiber Optic Splicers & OTDR Testing Kits', hs: '9031.80', cat: 'Telecom Equipment', val: 22500000, wt: 110 },
      { nature: 'Heavy Duty Excavator Track Chains & Rollers', hs: '8431.49', cat: 'Heavy Machinery', val: 48000000, wt: 8500 }
    ];

    // Combine base blueprints and generate 55 more
    const allShipmentDefs = [...shipmentBlueprints];
    for (let i = 0; i < 55; i++) {
      const mode = modes[i % modes.length];
      const delivery = deliveryModes[i % deliveryModes.length];
      const status = statuses[i % statuses.length];
      const origin = originCities[i % originCities.length];
      const dest = destCities[i % destCities.length];
      const theme = cargoThemes[i % cargoThemes.length];
      const valMultiplier = 0.6 + (i * 0.08);

      const awb = mode === 'air_freight' || mode === 'consolidation' ? `157-${(40000000 + i * 137).toString()}` : null;
      const bol = mode === 'sea_freight' || mode === 'export' ? `MSCU${(7000000 + i * 243).toString()}` : null;
      const uid = mode === 'china_groupage' || mode === 'groupage' ? `VHI-CNG-${(8000 + i * 19).toString()}` : null;

      allShipmentDefs.push({
        mode, delivery, status,
        nature: theme.nature, hsCode: theme.hs,
        originAddr: origin.city, destAddr: dest,
        val: Math.round(theme.val * valMultiplier), curr: 'NGN', wt: Math.round(theme.wt * valMultiplier),
        awb, bol, uid,
        originEmail: origin.email, destEmail: customers[i % customers.length].email,
        originPhone: origin.phone, destPhone: customers[i % customers.length].phone,
        items: [
          { desc: `${theme.nature} - Main Unit Batch A`, cat: theme.cat, qty: 5 + (i % 10), wt: Math.round(theme.wt * 0.6), l: 120, w: 80, h: 90 },
          { desc: `${theme.nature} - Spare Parts & Tooling Kits`, cat: 'Spare Parts', qty: 10 + (i % 15), wt: Math.round(theme.wt * 0.4), l: 60, w: 40, h: 40 }
        ]
      });
    }

    const shipments: any[] = [];
    const allShipmentItems: any[] = [];
    const allTrackingUpdates: any[] = [];
    const allShipmentDocs: any[] = [];

    for (let idx = 0; idx < allShipmentDefs.length; idx++) {
      const def = allShipmentDefs[idx];
      const customer = customers[idx % customers.length];
      const orderPrefix = def.mode.substring(0, 3).toUpperCase();
      const orderId = `VHI-${orderPrefix}-${(10000 + idx * 113).toString()}`;
      const isDraft = def.status === 'draft';

      const shipRes = await client.query(
        `INSERT INTO shipments (
          order_id, customer_id, shipping_mode, delivery_mode, nature_of_item, hs_code,
          invoice_value, invoice_currency, weight, weight_unit,
          origin_address, destination_address, origin_pickup_option, port_of_discharge,
          awb_number, bol_number, unique_id, status, is_draft,
          origin_email, origin_phone, destination_email, destination_phone,
          country_of_origin, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24, NOW() - ($25 * INTERVAL '1 day'), NOW())
        RETURNING *`,
        [
          orderId, customer.id, def.mode, def.delivery, def.nature, def.hsCode,
          def.val, def.curr, def.wt, 'kg',
          def.originAddr, def.destAddr, 'vhi_pickup', 'Lagos Ports / NAHCO Terminal',
          def.awb, def.bol, def.uid, def.status, isDraft,
          def.originEmail, def.originPhone, def.destEmail, def.destPhone,
          def.originAddr.split(',').pop()?.trim() || 'China',
          (65 - idx) // Days ago for realistic timeline spread
        ]
      );
      const shipment = shipRes.rows[0];
      shipments.push(shipment);

      // Insert Items
      for (const it of def.items) {
        const itemRes = await client.query(
          `INSERT INTO shipment_items (shipment_id, description, category, quantity, weight, dimension_l, dimension_w, dimension_h, dimension_unit)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'cm') RETURNING *`,
          [shipment.id, it.desc, it.cat, it.qty, it.wt, it.l, it.w, it.h]
        );
        allShipmentItems.push(itemRes.rows[0]);
      }

      // Generate Realistic Tracking Timeline Events based on status
      const daysAgo = 65 - idx;
      const trackingMilestones: { status: string; msg: string; dayOffset: number }[] = [
        { status: 'pending', msg: `Booking confirmed for ${orderId}. Export documentation initiated with carrier.`, dayOffset: daysAgo },
        { status: 'processing', msg: 'Cargo received at origin consolidation facility; weight verification and packaging inspected.', dayOffset: Math.max(0, daysAgo - 2) },
      ];

      if (['in_transit', 'clearance', 'delivered'].includes(def.status)) {
        trackingMilestones.push({
          status: 'in_transit',
          msg: def.mode.includes('air')
            ? `Departed origin airport via Flight ${def.awb || 'ET374'}. En route to Murtala Muhammed International Airport (LOS).`
            : `Container laden on vessel. Transshipment tracking active under ${def.bol || 'Bill of Lading'}.`,
          dayOffset: Math.max(0, daysAgo - 6)
        });
      }

      if (['clearance', 'delivered'].includes(def.status)) {
        trackingMilestones.push({
          status: 'clearance',
          msg: 'Arrived at Lagos Terminal. NAHCO / Customs Form M & PAAR documentation lodged for physical inspection.',
          dayOffset: Math.max(0, daysAgo - 12)
        });
      }

      if (def.status === 'delivered') {
        trackingMilestones.push({
          status: 'delivered',
          msg: `Customs duties cleared. Final door delivery completed at destination address. POD signed by ${customer.firstname} ${customer.lastname}.`,
          dayOffset: Math.max(0, daysAgo - 15)
        });
      }

      for (const tm of trackingMilestones) {
        const trRes = await client.query(
          `INSERT INTO tracking_updates (shipment_id, status, message, updated_by, created_at)
           VALUES ($1, $2, $3, $4, NOW() - ($5 * INTERVAL '1 day')) RETURNING *`,
          [shipment.id, tm.status, tm.msg, primaryAdmin.id, tm.dayOffset]
        );
        allTrackingUpdates.push(trRes.rows[0]);
      }

      // Documents (Form M, Packing List, Commercial Invoice, AWB/BOL)
      const docTypes = ['form_m', 'packing_list', 'proforma_invoice'];
      if (def.awb) docTypes.push('awb');
      if (def.bol) docTypes.push('bol');

      for (const dt of docTypes) {
        const docRes = await client.query(
          `INSERT INTO shipment_documents (shipment_id, document_type, file_url, uploaded_by, created_at)
           VALUES ($1, $2, $3, 'admin', NOW() - ($4 * INTERVAL '1 day')) RETURNING *`,
          [
            shipment.id, dt,
            `https://res.cloudinary.com/dynamocontainer/image/upload/vhi_docs/${orderId}_${dt}.pdf`,
            daysAgo
          ]
        );
        allShipmentDocs.push(docRes.rows[0]);
      }
    }

    console.log(`✅ Seeded ${shipments.length} Shipments.`);
    console.log(`✅ Seeded ${allShipmentItems.length} Detailed Cargo Items.`);
    console.log(`✅ Seeded ${allTrackingUpdates.length} Chronological Tracking Milestone Events.`);
    console.log(`✅ Seeded ${allShipmentDocs.length} Official Shipment Documents.`);

    // ----------------------------------------------------
    // 5. SEED REALISTIC INVOICES & PAYMENT TRANSACTIONS
    // ----------------------------------------------------
    console.log('💳 Seeding 50 Invoices & 40 Payment Records...');

    const invoices: any[] = [];
    const payments: any[] = [];
    const invoiceStatuses = ['paid', 'paid', 'paid', 'part_paid', 'pending', 'awaiting_vendor', 'draft'];
    const paymentMethods = ['paystack', 'stripe', 'manual'];

    for (let i = 0; i < 50; i++) {
      const shipment = shipments[i];
      const customer = customers.find(c => c.id === shipment.customer_id) || customers[0];
      const invNumber = `INV-2026-${(1001 + i).toString()}`;
      const invStatus = invoiceStatuses[i % invoiceStatuses.length];
      const amount = Math.round(shipment.invoice_value * 0.12); // Realistic 12% freight & clearing fee
      const daysAgo = 50 - i;

      const invRes = await client.query(
        `INSERT INTO invoices (invoice_number, shipment_id, customer_id, amount, currency, status, due_date, follow_up_date, notes, created_at)
         VALUES ($1, $2, $3, $4, 'NGN', $5, CURRENT_DATE + ($6 * INTERVAL '1 day'), CURRENT_DATE + ($7 * INTERVAL '1 day'), $8, NOW() - ($9 * INTERVAL '1 day'))
         RETURNING *`,
        [
          invNumber, shipment.id, customer.id, amount, invStatus,
          (14 - (i % 7)), // Due date in future or past
          (7 - (i % 5)),
          `Freight forwarding, customs documentation, handling charges & delivery for Order ${shipment.order_id}`,
          daysAgo
        ]
      );
      const invoice = invRes.rows[0];
      invoices.push(invoice);

      // Payments for 'paid' and 'part_paid'
      if (invStatus === 'paid' || invStatus === 'part_paid') {
        const payAmount = invStatus === 'paid' ? amount : Math.round(amount * 0.5);
        const pMethod = paymentMethods[i % paymentMethods.length];
        const ref = pMethod === 'paystack'
          ? `PSK-${Date.now().toString().slice(-6)}-${1000 + i}`
          : pMethod === 'stripe'
          ? `pi_3M${(1000000000 + i * 941).toString()}`
          : `TRF-ZENITH-NG-${(800000 + i * 311).toString()}`;

        const payRes = await client.query(
          `INSERT INTO payments (invoice_id, customer_id, amount, currency, payment_method, payment_status, gateway_reference, receipt_url, paid_at, created_at)
           VALUES ($1, $2, $3, 'NGN', $4, 'success', $5, $6, NOW() - ($7 * INTERVAL '1 day'), NOW() - ($7 * INTERVAL '1 day'))
           RETURNING *`,
          [
            invoice.id, customer.id, payAmount, pMethod, ref,
            `https://vhi-cdn.valuehandlers.com/receipts/${ref}.pdf`,
            Math.max(1, daysAgo - 1)
          ]
        );
        payments.push(payRes.rows[0]);
      }
    }

    console.log(`✅ Seeded ${invoices.length} Invoices.`);
    console.log(`✅ Seeded ${payments.length} Verified Payment Transactions.`);

    // ----------------------------------------------------
    // 6. SEED COMMUNICATIONS & CLIENT TICKETS
    // ----------------------------------------------------
    console.log('💬 Seeding 40 Support Tickets & Communication Threads...');

    const communicationThreads = [
      {
        subject: 'Arrival Notice & Customs Inspection Schedule: Order #VHI-AIR-10000',
        body: 'Good day Dr. Stella, your shipment of Siemens Ultrasound Console Units has safely landed at Murtala Muhammed Airport. NAHCO physical examination is scheduled for tomorrow at 10:00 AM.'
      },
      {
        subject: 'Form M and PAAR Approval Confirmation - High-Pressure Valves',
        body: 'Dear Tari, we are pleased to confirm that Nigeria Customs Service has issued the Pre-Arrival Assessment Report (PAAR) for container MSCU98234812. Clearance process is progressing on schedule.'
      },
      {
        subject: 'Warehouse Consolidation Update: Solar Inverters Bay 8 Yiwu',
        body: 'Hello Kenechukwu, all 40 Felicity lithium battery units and Growatt inverters have arrived at our Yiwu consolidation hub and are scheduled for vessel loading this Friday.'
      },
      {
        subject: 'Export Bill of Lading Verification - Cocoa Beans Antwerp',
        body: 'Dear Audu, the original Bill of Lading (MSCU77218844) for your 42-ton cocoa bean export to Antwerp has been dispatched via DHL to your European consignee.'
      },
      {
        subject: 'Special Air Freight Tariff Quote for Medical Consumables Q3',
        body: 'Dear Farooq, attached is our discounted express air freight rate matrix ($4.20/kg) for your recurring diagnostic supplies originating from Mumbai and Frankfurt.'
      },
      {
        subject: 'Customs Duty Assessment & Valuation Notice',
        body: 'Good day Alhaji Rasheed, the assessment notice for your injection moulding machinery has been finalized by Apapa Area 1 Command. Invoice has been updated on your dashboard.'
      },
      {
        subject: 'Door Delivery Dispatch Confirmation - Lekki Phase 1',
        body: 'Hello Adeola, our dispatch truck is currently en route with your Apple MacBook Pro batch. Delivery lead driver is contactable on +234 802 888 1234.'
      },
      {
        subject: 'Commercial Invoice & Packing List Amendment Request',
        body: 'Dear Segun, please provide the revised manufacturer declaration with matching HS codes for the hydraulic rock drills to expedite Customs clearing.'
      }
    ];

    const communications: any[] = [];
    for (let i = 0; i < 40; i++) {
      const template = communicationThreads[i % communicationThreads.length];
      const customer = customers[i % customers.length];
      const isRead = i % 3 !== 0; // Create realistic unread messages
      const daysAgo = 40 - i;

      const commRes = await client.query(
        `INSERT INTO communications (customer_id, sent_by, subject, body, is_read, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW() - ($6 * INTERVAL '1 day')) RETURNING *`,
        [
          customer.id, primaryAdmin.id,
          template.subject, template.body, isRead,
          daysAgo
        ]
      );
      communications.push(commRes.rows[0]);
    }
    console.log(`✅ Seeded ${communications.length} Support & Operational Communication Messages.`);

    // ----------------------------------------------------
    // 7. SEED NEWSLETTER BROADCASTS & CAMPAIGNS
    // ----------------------------------------------------
    console.log('📢 Seeding 12 Realistic Newsletter Broadcast Campaigns...');

    const newsletterCampaigns = [
      {
        subject: '🚀 Special China-to-Nigeria Express Air Cargo Rates: $4.50/kg',
        body: 'Dear Esteemed Partner,\n\nTake advantage of our exclusive September promo on all air freight departures from Guangzhou, Yiwu, and Shenzhen to Lagos. Enjoy 4-day transit times and seamless customs clearance.',
        segment: 'all', count: 184
      },
      {
        subject: '🏥 Medical & Pharma Cold-Chain Logistics Advisory Q3',
        body: 'Ensure temperature-sensitive vaccines, diagnostic reagents, and biopharmaceuticals are preserved in our certified 2-8°C cold chain cargo infrastructure across European and Asian routes.',
        segment: 'medical_pharma', count: 42
      },
      {
        subject: '⚡ CBN Form M & FX Regulatory Update for Heavy Equipment Importers',
        body: 'Nigeria Customs Service and CBN have issued revised HS-Code classification directives for industrial pumps, mining tools, and manufacturing spare parts. Read our full compliance advisory.',
        segment: 'oil_gas', count: 38
      },
      {
        subject: '🚢 Sea Freight Groupage Consolidation Schedule - September 2026',
        body: 'Weekly container loading schedules for Shanghai, Ningbo, and Istanbul. Cut-off dates, transit times, and Apapa clearing timelines enclosed.',
        segment: 'manufacturing', count: 56
      },
      {
        subject: '🌾 Export Trade Promotion: Agricultural Produce to Europe & USA',
        body: 'Special ocean freight reefers and dry container rates for Cocoa, Cashew Nuts, Sesame Seeds, and Ginger exports with full phytosanitary clearance support.',
        segment: 'agricultural', count: 29
      }
    ];

    const newsletters: any[] = [];
    for (let i = 0; i < 12; i++) {
      const camp = newsletterCampaigns[i % newsletterCampaigns.length];
      const newsRes = await client.query(
        `INSERT INTO newsletter_sends (subject, body, segment, sent_by, recipient_count, sent_at)
         VALUES ($1, $2, $3, $4, $5, NOW() - ($6 * INTERVAL '4 days')) RETURNING *`,
        [
          camp.subject, camp.body, camp.segment, primaryAdmin.id,
          camp.count + (i * 7),
          (12 - i)
        ]
      );
      newsletters.push(newsRes.rows[0]);
    }
    console.log(`✅ Seeded ${newsletters.length} Newsletter Campaigns.`);

    // ----------------------------------------------------
    // 8. SEED CUSTOMER FEEDBACK & REVIEWS
    // ----------------------------------------------------
    console.log('⭐ Seeding 25 Authentic Customer Feedback Reviews...');

    const feedbackTemplates = [
      { rating: 5, msg: 'Incredible turnaround on our urgent medical ultrasound shipment from Guangzhou. Cleared and delivered in 4 days flat!' },
      { rating: 5, msg: 'Best freight forwarder for heavy oilfield parts in Nigeria. Onne free zone clearing was completely seamless.' },
      { rating: 4, msg: 'Consistent updates throughout the voyage from Hamburg to Lagos. Professional handling of our rotary rock drills.' },
      { rating: 5, msg: 'The online tracking timeline and automated invoice generation saved our accounting team hours of manual follow-up.' },
      { rating: 4, msg: 'Excellent door delivery service to our factory in Ajao Estate. Drivers were courteous and cargo arrived intact.' },
      { rating: 5, msg: 'Smooth Form M and PAAR processing. ValueHandlers makes international shipping from China completely hassle-free.' }
    ];

    const feedbackList: any[] = [];
    for (let i = 0; i < 25; i++) {
      const template = feedbackTemplates[i % feedbackTemplates.length];
      const customer = customers[i % customers.length];
      const fbRes = await client.query(
        `INSERT INTO customer_feedback (customer_id, rating, message, created_at)
         VALUES ($1, $2, $3, NOW() - ($4 * INTERVAL '3 days')) RETURNING *`,
        [customer.id, template.rating, template.msg, (25 - i)]
      );
      feedbackList.push(fbRes.rows[0]);
    }
    console.log(`✅ Seeded ${feedbackList.length} Customer Feedback Reviews.`);

    // ----------------------------------------------------
    // 9. SEED AUDIT LOGS & SYSTEM ACTIVITY
    // ----------------------------------------------------
    console.log('📜 Seeding 120 Comprehensive Audit Log Trails...');

    const auditActions = [
      { action: 'LOGIN', resType: 'admin', meta: { ip: '197.210.84.12', client: 'Chrome / Windows 11' } },
      { action: 'CREATE_SHIPMENT', resType: 'shipment', meta: { mode: 'air_freight', priority: 'express' } },
      { action: 'ADD_TRACKING_UPDATE', resType: 'shipment', meta: { status: 'in_transit', hub: 'Lagos Airport Terminal' } },
      { action: 'CREATE_INVOICE', resType: 'invoice', meta: { currency: 'NGN', paymentTerms: 'Net 14' } },
      { action: 'RECORD_PAYMENT', resType: 'payment', meta: { gateway: 'paystack', status: 'verified' } },
      { action: 'SEND_COMMUNICATION', resType: 'communication', meta: { channel: 'email_portal' } },
      { action: 'BROADCAST_NEWSLETTER', resType: 'newsletter', meta: { segment: 'all', reach: 184 } }
    ];

    for (let i = 0; i < 120; i++) {
      const act = auditActions[i % auditActions.length];
      const admin = admins[i % admins.length];
      const shipment = shipments[i % shipments.length];

      await client.query(
        `INSERT INTO audit_logs (admin_id, actor_type, active_role, action, resource_type, resource_id, metadata, created_at)
         VALUES ($1, 'admin', $2, $3, $4, $5, $6, NOW() - ($7 * INTERVAL '8 hours'))`,
        [
          admin.id, admin.role || 'super_admin',
          act.action, act.resType, shipment.id,
          JSON.stringify(act.meta),
          (120 - i)
        ]
      );
    }
    console.log('✅ Seeded 120 Audit Log records.');

    // ----------------------------------------------------
    // COMMIT TRANSACTION
    // ----------------------------------------------------
    await client.query('COMMIT');

    console.log('====================================================');
    console.log('🎉 SEEDING COMPLETED SUCCESSFULLY!');
    console.log('====================================================');
    console.log(`📊 Summary of Populated Entities:`);
    console.log(`   - Admins:              ${admins.length}`);
    console.log(`   - Customers:           ${customers.length}`);
    console.log(`   - Shipments:           ${shipments.length}`);
    console.log(`   - Shipment Items:      ${allShipmentItems.length}`);
    console.log(`   - Tracking Milestones: ${allTrackingUpdates.length}`);
    console.log(`   - Official Documents:  ${allShipmentDocs.length}`);
    console.log(`   - Invoices:            ${invoices.length}`);
    console.log(`   - Payments:            ${payments.length}`);
    console.log(`   - Support Messages:    ${communications.length}`);
    console.log(`   - Newsletters:         ${newsletters.length}`);
    console.log(`   - Feedback Reviews:    ${feedbackList.length}`);
    console.log(`   - Audit Trail Entries: 120`);
    console.log('====================================================');
    console.log('🔑 Master Admin Login Credentials:');
    console.log('   Email:    admin@valuehandlers.com');
    console.log('   Password: Admin@123');
    console.log('====================================================');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Seeding failed with error:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seedDatabase().catch((err) => {
  console.error(err);
  process.exit(1);
});
