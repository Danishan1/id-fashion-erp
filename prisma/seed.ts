import pkg from "@prisma/client";
const { PrismaClient } = pkg;
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { MODULES, ACTIONS, ROLES, ROLE_PERMISSIONS, permissionKey } from "../src/config/rbac.ts";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding currencies...");
  await prisma.currency.createMany({
    data: [
      { code: "USD", name: "US Dollar", symbol: "$", decimalPlaces: 2 },
      { code: "INR", name: "Indian Rupee", symbol: "₹", decimalPlaces: 2 },
      { code: "EUR", name: "Euro", symbol: "€", decimalPlaces: 2 },
    ],
    skipDuplicates: true,
  });

  console.log("Seeding company + branch...");
  const company = await prisma.company.upsert({
    where: { taxRegistrationNo: "DEMO-TAX-0001" },
    update: {},
    create: {
      name: "Indradhar Garments Pvt. Ltd.",
      legalName: "Indradhar Garments Pvt. Ltd.",
      taxRegistrationNo: "DEMO-TAX-0001",
      baseCurrencyCode: "INR",
      fiscalYearStartMonth: 4,
      isActive: true,
    },
  });

  const branch = await prisma.branch.upsert({
    where: { companyId_code: { companyId: company.id, code: "HO" } },
    update: {},
    create: {
      companyId: company.id,
      code: "HO",
      name: "Head Office & Factory",
      type: "FACTORY",
    },
  });

  console.log("Seeding permission catalog...");
  const permissionRows = MODULES.flatMap((module) =>
    ACTIONS.map((action) => ({
      key: permissionKey(module, action),
      module,
      description: `${action} access for ${module}`,
    }))
  );
  await prisma.permission.createMany({ data: permissionRows, skipDuplicates: true });
  const allPermissions = await prisma.permission.findMany();
  const permissionIdByKey = new Map(allPermissions.map((p) => [p.key, p.id]));

  console.log("Seeding roles + role_permissions...");
  const roleIdByName = new Map<string, string>();
  for (const roleName of ROLES) {
    const role = await prisma.role.upsert({
      where: { companyId_name: { companyId: company.id, name: roleName } },
      update: {},
      create: {
        companyId: company.id,
        name: roleName,
        isSystemRole: true,
      },
    });
    roleIdByName.set(roleName, role.id);

    const modulesForRole = ROLE_PERMISSIONS[roleName];
    const rolePermissionData = Object.entries(modulesForRole).flatMap(([module, actions]) =>
      (actions ?? []).map((action) => {
        const key = permissionKey(module as (typeof MODULES)[number], action);
        const permissionId = permissionIdByKey.get(key);
        if (!permissionId) throw new Error(`Unknown permission key: ${key}`);
        return { roleId: role.id, permissionId };
      })
    );

    for (const rp of rolePermissionData) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: rp.roleId, permissionId: rp.permissionId } },
        update: {},
        create: rp,
      });
    }
  }

  console.log("Seeding Super Admin user...");
  const superAdminEmail = "admin@indradhar.com";
  const superAdminPassword = "ChangeMe123!";
  const passwordHash = await bcrypt.hash(superAdminPassword, 12);

  const superAdminUser = await prisma.user.upsert({
    where: { email: superAdminEmail },
    update: {},
    create: {
      companyId: company.id,
      defaultBranchId: branch.id,
      email: superAdminEmail,
      passwordHash,
      fullName: "Super Admin",
      status: "ACTIVE",
    },
  });

  // Platform SaaS Phase 1 (PLAT-001): platform operators are a separate
  // identity with no company. The dev seed creates one with the same
  // credentials, signing in at /platform/login.
  await prisma.platformUser.upsert({
    where: { email: superAdminEmail },
    update: {},
    create: { email: superAdminEmail, passwordHash, fullName: "Platform Super Admin", role: "PLATFORM_SUPER_ADMIN" },
  });

  const superAdminRoleId = roleIdByName.get("SUPER_ADMIN")!;
  await prisma.userBranchRole.upsert({
    where: {
      userId_branchId_roleId: {
        userId: superAdminUser.id,
        branchId: branch.id,
        roleId: superAdminRoleId,
      },
    },
    update: {},
    create: {
      userId: superAdminUser.id,
      branchId: branch.id,
      roleId: superAdminRoleId,
    },
  });

  const companyId = company.id;
  const branchId = branch.id;

  console.log("Seeding Colors, Sizes, Units of Measure...");
  await prisma.color.createMany({
    data: [
      { companyId, code: "BLK", name: "Black", hexValue: "#000000" },
      { companyId, code: "WHT", name: "White", hexValue: "#FFFFFF" },
      { companyId, code: "NVY", name: "Navy Blue", hexValue: "#1B1F3B" },
      { companyId, code: "RED", name: "Red", hexValue: "#C41E3A" },
      { companyId, code: "RBL", name: "Royal Blue", hexValue: "#4169E1" },
      { companyId, code: "GRM", name: "Grey Melange", hexValue: "#9B9B9B" },
      { companyId, code: "OLV", name: "Olive Green", hexValue: "#556B2F" },
      { companyId, code: "MRN", name: "Maroon", hexValue: "#800000" },
      { companyId, code: "SKB", name: "Sky Blue", hexValue: "#87CEEB" },
      { companyId, code: "BEG", name: "Beige", hexValue: "#F5F5DC" },
      { companyId, code: "CHR", name: "Charcoal", hexValue: "#36454F" },
      { companyId, code: "MUS", name: "Mustard Yellow", hexValue: "#E1AD01" },
    ],
    skipDuplicates: true,
  });

  await prisma.size.createMany({
    data: [
      { companyId, code: "XS", name: "Extra Small", sortOrder: 1 },
      { companyId, code: "S", name: "Small", sortOrder: 2 },
      { companyId, code: "M", name: "Medium", sortOrder: 3 },
      { companyId, code: "L", name: "Large", sortOrder: 4 },
      { companyId, code: "XL", name: "Extra Large", sortOrder: 5 },
      { companyId, code: "XXL", name: "2X Large", sortOrder: 6 },
      { companyId, code: "XXXL", name: "3X Large", sortOrder: 7 },
    ],
    skipDuplicates: true,
  });

  await prisma.unitOfMeasure.createMany({
    data: [
      { code: "PCS", name: "Pieces" },
      { code: "MTR", name: "Meters" },
      { code: "KG", name: "Kilograms" },
      { code: "DZN", name: "Dozen" },
      { code: "SET", name: "Set" },
      { code: "YDS", name: "Yards" },
      { code: "ROL", name: "Roll" },
      { code: "IN", name: "Inches" },
      { code: "CM", name: "Centimeters" },
    ],
    skipDuplicates: true,
  });

  // Real, universal, unambiguous conversions only — DZN->PCS and YDS->MTR are fixed physical
  // constants. ROL/SET/KG deliberately stay roots with no conversion: a roll's or a set's
  // quantity has no fixed universal factor to any other unit.
  const seededUnits = await prisma.unitOfMeasure.findMany({ where: { code: { in: ["PCS", "MTR", "DZN", "YDS"] } } });
  const seededUnitIdByCode = new Map(seededUnits.map((u) => [u.code, u.id]));
  await prisma.unitOfMeasure.update({
    where: { id: seededUnitIdByCode.get("DZN") },
    data: { baseUnitId: seededUnitIdByCode.get("PCS"), conversionFactor: 12 },
  });
  await prisma.unitOfMeasure.update({
    where: { id: seededUnitIdByCode.get("YDS") },
    data: { baseUnitId: seededUnitIdByCode.get("MTR"), conversionFactor: 0.9144 },
  });

  console.log("Seeding Departments, Designations, Employee Categories, Shifts, Holidays...");
  await prisma.department.createMany({
    data: [
      { companyId, branchId, code: "CUT", name: "Cutting" },
      { companyId, branchId, code: "SEW", name: "Sewing" },
      { companyId, branchId, code: "FIN", name: "Finishing" },
      { companyId, branchId, code: "QC", name: "Quality Control" },
      { companyId, branchId, code: "PAK", name: "Packing" },
      { companyId, branchId, code: "STR", name: "Stores" },
      { companyId, branchId, code: "ACC", name: "Accounts" },
      { companyId, branchId, code: "HR", name: "HR & Admin" },
      { companyId, branchId, code: "MER", name: "Merchandising" },
    ],
    skipDuplicates: true,
  });

  await prisma.designation.createMany({
    data: [
      { companyId, code: "MERCH", name: "Merchandiser" },
      { companyId, code: "PM", name: "Production Manager" },
      { companyId, code: "CM", name: "Cutting Master" },
      { companyId, code: "SS", name: "Sewing Supervisor" },
      { companyId, code: "QCC", name: "Quality Checker" },
      { companyId, code: "SK", name: "Store Keeper" },
      { companyId, code: "ACCT", name: "Accountant" },
      { companyId, code: "HRE", name: "HR Executive" },
      { companyId, code: "OP", name: "Sewing Operator" },
      { companyId, code: "HELP", name: "Helper" },
    ],
    skipDuplicates: true,
  });

  await prisma.employeeCategory.createMany({
    data: [
      { companyId, code: "STAFF", name: "Staff" },
      { companyId, code: "WORKER", name: "Worker" },
      { companyId, code: "SUPV", name: "Supervisor" },
      { companyId, code: "MGMT", name: "Management" },
      { companyId, code: "CONTR", name: "Contract Worker" },
    ],
    skipDuplicates: true,
  });

  await prisma.shiftMaster.createMany({
    data: [
      { companyId, code: "GEN", name: "General Shift", startTime: "09:00", endTime: "18:00" },
      { companyId, code: "MOR", name: "Morning Shift", startTime: "06:00", endTime: "14:00" },
      { companyId, code: "EVE", name: "Evening Shift", startTime: "14:00", endTime: "22:00" },
      { companyId, code: "NGT", name: "Night Shift", startTime: "22:00", endTime: "06:00" },
    ],
    skipDuplicates: true,
  });

  await prisma.holidayMaster.createMany({
    data: [
      { companyId, name: "Republic Day", date: new Date("2026-01-26") },
      { companyId, name: "Holi", date: new Date("2026-03-04") },
      { companyId, name: "Good Friday", date: new Date("2026-04-03") },
      { companyId, name: "Independence Day", date: new Date("2026-08-15") },
      { companyId, name: "Gandhi Jayanti", date: new Date("2026-10-02") },
      { companyId, name: "Dussehra", date: new Date("2026-10-20") },
      { companyId, name: "Diwali", date: new Date("2026-11-08") },
      { companyId, name: "Christmas", date: new Date("2026-12-25") },
    ],
    skipDuplicates: true,
  });

  console.log("Seeding Customers + Buyers, Suppliers...");
  await prisma.customer.createMany({
    data: [
      { companyId, code: "CUST001", name: "Zenith Apparel Imports", type: "CUSTOMER", country: "USA", paymentTermsDays: 45, creditLimit: 100000 },
      { companyId, code: "CUST002", name: "EuroTrend Fashion GmbH", type: "CUSTOMER", country: "Germany", paymentTermsDays: 60, creditLimit: 80000 },
      { companyId, code: "CUST003", name: "Northline Garments Ltd", type: "CUSTOMER", country: "United Kingdom", paymentTermsDays: 30, creditLimit: 60000 },
      { companyId, code: "CUST004", name: "Pacific Rim Clothing Co.", type: "CUSTOMER", country: "Australia", paymentTermsDays: 30, creditLimit: 50000 },
      { companyId, code: "CUST005", name: "Nordic Wear AB", type: "CUSTOMER", country: "Sweden", paymentTermsDays: 45, creditLimit: 70000 },
      { companyId, code: "CUST006", name: "Marina Textiles LLC", type: "CUSTOMER", country: "UAE", paymentTermsDays: 30, creditLimit: 55000 },
      { companyId, code: "CUST007", name: "Urban Edge Retail", type: "CUSTOMER", country: "Canada", paymentTermsDays: 45, creditLimit: 65000 },
      { companyId, code: "CUST008", name: "Sunrise Fashion House", type: "CUSTOMER", country: "Japan", paymentTermsDays: 60, creditLimit: 90000 },
      { companyId, code: "CUST009", name: "Metro Style Trading", type: "CUSTOMER", country: "Singapore", paymentTermsDays: 30, creditLimit: 45000 },
      { companyId, code: "CUST010", name: "Bluewave Denim Co.", type: "CUSTOMER", country: "USA", paymentTermsDays: 45, creditLimit: 120000 },
    ],
    skipDuplicates: true,
  });

  const customers = await prisma.customer.findMany({ where: { companyId } });
  const customerIdByCode = new Map(customers.map((c) => [c.code, c.id]));

  await prisma.buyer.createMany({
    data: [
      { companyId, customerId: customerIdByCode.get("CUST001")!, code: "BYR-001", name: "John Miller", contactPerson: "John Miller", email: "john.miller@zenithapparel.example" },
      { companyId, customerId: customerIdByCode.get("CUST002")!, code: "BYR-002", name: "Lena Schmidt", contactPerson: "Lena Schmidt", email: "lena.schmidt@eurotrend.example" },
      { companyId, customerId: customerIdByCode.get("CUST003")!, code: "BYR-003", name: "Oliver Hughes", contactPerson: "Oliver Hughes", email: "oliver.hughes@northline.example" },
      { companyId, customerId: customerIdByCode.get("CUST004")!, code: "BYR-004", name: "Sarah Thompson", contactPerson: "Sarah Thompson", email: "sarah.thompson@pacificrim.example" },
      { companyId, customerId: customerIdByCode.get("CUST010")!, code: "BYR-005", name: "Mike Anderson", contactPerson: "Mike Anderson", email: "mike.anderson@bluewave.example" },
    ],
    skipDuplicates: true,
  });

  console.log("Seeding Supplier Categories...");
  await prisma.supplierCategory.createMany({
    data: [
      { companyId, code: "FABRIC", name: "Fabric" },
      { companyId, code: "TRIMS", name: "Trims" },
      { companyId, code: "ZIPS", name: "Zips" },
      { companyId, code: "BUTTONS", name: "Buttons" },
      { companyId, code: "ACCESSORIES", name: "Accessories" },
      { companyId, code: "PACKAGING", name: "Packaging" },
      { companyId, code: "SERVICES", name: "Services" },
      { companyId, code: "MACHINERY", name: "Machinery" },
      { companyId, code: "OTHER", name: "Other" },
    ],
    skipDuplicates: true,
  });
  const supplierCategories = await prisma.supplierCategory.findMany({ where: { companyId } });
  const supplierCategoryIdByCode = new Map(supplierCategories.map((c) => [c.code, c.id]));

  await prisma.supplier.createMany({
    data: [
      { companyId, code: "SUP001", name: "Shree Balaji Textiles", categoryId: supplierCategoryIdByCode.get("FABRIC")!, contactPerson: "Balaji Rao", phone: "9820011122" },
      { companyId, code: "SUP002", name: "Om Fabrics Pvt Ltd", categoryId: supplierCategoryIdByCode.get("FABRIC")!, contactPerson: "Om Prakash", phone: "9820033344" },
      { companyId, code: "SUP003", name: "National Zipper Co.", categoryId: supplierCategoryIdByCode.get("ZIPS")!, contactPerson: "Feroz Khan", phone: "9820055566" },
      { companyId, code: "SUP004", name: "Universal Buttons & Trims", categoryId: supplierCategoryIdByCode.get("BUTTONS")!, contactPerson: "Ramesh Shah", phone: "9820077788" },
      { companyId, code: "SUP005", name: "Classic Labels & Tags", categoryId: supplierCategoryIdByCode.get("ACCESSORIES")!, contactPerson: "Meena Iyer", phone: "9820099900" },
      { companyId, code: "SUP006", name: "Perfect Packaging Solutions", categoryId: supplierCategoryIdByCode.get("PACKAGING")!, contactPerson: "Ashok Jain", phone: "9821011122" },
      { companyId, code: "SUP007", name: "SecureBox Cartons", categoryId: supplierCategoryIdByCode.get("PACKAGING")!, contactPerson: "Vinod Agarwal", phone: "9821033344" },
      { companyId, code: "SUP008", name: "Rapid Logistics Services", categoryId: supplierCategoryIdByCode.get("SERVICES")!, contactPerson: "Sanjay Kulkarni", phone: "9821055566" },
      { companyId, code: "SUP009", name: "Juki Machine Traders", categoryId: supplierCategoryIdByCode.get("MACHINERY")!, contactPerson: "Harish Mehta", phone: "9821077788" },
      { companyId, code: "SUP010", name: "Singer Sewing Equipments", categoryId: supplierCategoryIdByCode.get("MACHINERY")!, contactPerson: "Nitin Kapoor", phone: "9821099900" },
    ],
    skipDuplicates: true,
  });

  const suppliers = await prisma.supplier.findMany({ where: { companyId } });
  const supplierIdByCode = new Map(suppliers.map((s) => [s.code, s.id]));

  console.log("Seeding Warehouses + Locations, Production Stages/Lines, Machines, Sales Agents...");
  await prisma.warehouse.createMany({
    data: [
      { companyId, branchId, code: "WH01", name: "Raw Material Godam", type: ["RAW_MATERIAL"] },
      { companyId, branchId, code: "WH02", name: "Fabric Store", type: ["FABRIC"] },
      { companyId, branchId, code: "WH03", name: "WIP Store", type: ["WIP"] },
      { companyId, branchId, code: "WH04", name: "Finished Goods Godam", type: ["FINISHED_GOODS"] },
      { companyId, branchId, code: "WH05", name: "Trims & Accessories Store", type: ["TRIMS"] },
      { companyId, branchId, code: "WH06", name: "Dispatch Yard", type: ["DISPATCH"] },
    ],
    skipDuplicates: true,
  });

  const warehouses = await prisma.warehouse.findMany({ where: { companyId } });
  await prisma.warehouseLocation.createMany({
    data: warehouses.flatMap((w) => [
      { warehouseId: w.id, code: "A", zone: "A", rack: "A1" },
      { warehouseId: w.id, code: "B", zone: "B", rack: "B1" },
    ]),
    skipDuplicates: true,
  });

  await prisma.productionStage.createMany({
    data: [
      { companyId, code: "CUT", name: "Cutting", sequence: 1, allowsExtraQuantity: true },
      { companyId, code: "SEW", name: "Stitching", sequence: 2 },
      { companyId, code: "CHK", name: "Checking", sequence: 3 },
      { companyId, code: "FIN", name: "Finishing", sequence: 4 },
      { companyId, code: "IRN", name: "Ironing/Pressing", sequence: 5 },
      { companyId, code: "PAK", name: "Packing", sequence: 6 },
    ],
    skipDuplicates: true,
  });

  await prisma.productionLine.createMany({
    data: [
      { companyId, branchId, code: "L2", name: "Line 2", capacityPerDay: 500 },
      { companyId, branchId, code: "L3", name: "Line 3", capacityPerDay: 450 },
      { companyId, branchId, code: "L4", name: "Line 4", capacityPerDay: 500 },
    ],
    skipDuplicates: true,
  });

  const productionLines = await prisma.productionLine.findMany({ where: { companyId } });
  const lineIdByCode = new Map(productionLines.map((l) => [l.code, l.id]));
  const firstLineId = productionLines[0]?.id ?? null;

  await prisma.machine.createMany({
    data: [
      { companyId, productionLineId: firstLineId, code: "M2", name: "Overlock Machine 1", machineType: "Overlock" },
      { companyId, productionLineId: firstLineId, code: "M3", name: "Flatlock Machine 1", machineType: "Flatlock" },
      { companyId, productionLineId: lineIdByCode.get("L2") ?? null, code: "M4", name: "Single Needle Machine 2", machineType: "Single Needle" },
      { companyId, productionLineId: lineIdByCode.get("L2") ?? null, code: "M5", name: "Button Hole Machine", machineType: "Button Hole" },
      { companyId, productionLineId: lineIdByCode.get("L3") ?? null, code: "M6", name: "Bar Tack Machine", machineType: "Bar Tack" },
    ],
    skipDuplicates: true,
  });

  await prisma.salesAgent.createMany({
    data: [
      { companyId, code: "SA01", name: "Anil Mehta", contactPerson: "Anil Mehta", phone: "9811011122", commissionPercent: 2.5 },
      { companyId, code: "SA02", name: "Rakesh Malhotra", contactPerson: "Rakesh Malhotra", phone: "9811033344", commissionPercent: 2 },
      { companyId, code: "SA03", name: "Sunita Kapoor", contactPerson: "Sunita Kapoor", phone: "9811055566", commissionPercent: 3 },
      { companyId, code: "SA04", name: "Vijay Choudhary", contactPerson: "Vijay Choudhary", phone: "9811077788", commissionPercent: 2.5 },
      { companyId, code: "SA05", name: "Deepa Nair", contactPerson: "Deepa Nair", phone: "9811099900", commissionPercent: 2 },
    ],
    skipDuplicates: true,
  });

  console.log("Seeding Employees...");
  const departments = await prisma.department.findMany({ where: { companyId } });
  const deptIdByCode = new Map(departments.map((d) => [d.code, d.id]));
  const designations = await prisma.designation.findMany({ where: { companyId } });
  const designationIdByName = new Map(designations.map((d) => [d.name, d.id]));

  await prisma.employee.createMany({
    data: [
      { companyId, branchId, departmentId: deptIdByCode.get("SEW"), employeeCode: "EMP001", fullName: "Ramesh Kumar", designationId: designationIdByName.get("Production Manager"), phone: "9700011122", joinDate: new Date("2022-01-10") },
      { companyId, branchId, departmentId: deptIdByCode.get("CUT"), employeeCode: "EMP002", fullName: "Suresh Patil", designationId: designationIdByName.get("Cutting Master"), phone: "9700033344", joinDate: new Date("2021-06-15") },
      { companyId, branchId, departmentId: deptIdByCode.get("QC"), employeeCode: "EMP003", fullName: "Anita Sharma", designationId: designationIdByName.get("Quality Checker"), phone: "9700055566", joinDate: new Date("2023-02-20") },
      { companyId, branchId, departmentId: deptIdByCode.get("MER"), employeeCode: "EMP004", fullName: "Priya Singh", designationId: designationIdByName.get("Merchandiser"), phone: "9700077788", joinDate: new Date("2022-09-01") },
      { companyId, branchId, departmentId: deptIdByCode.get("SEW"), employeeCode: "EMP005", fullName: "Vikram Rao", designationId: designationIdByName.get("Sewing Supervisor"), phone: "9700099900", joinDate: new Date("2020-11-05") },
      { companyId, branchId, departmentId: deptIdByCode.get("STR"), employeeCode: "EMP006", fullName: "Deepak Joshi", designationId: designationIdByName.get("Store Keeper"), phone: "9700111122", joinDate: new Date("2023-05-18") },
      { companyId, branchId, departmentId: deptIdByCode.get("ACC"), employeeCode: "EMP007", fullName: "Kavita Desai", designationId: designationIdByName.get("Accountant"), phone: "9700133344", joinDate: new Date("2021-03-12") },
      { companyId, branchId, departmentId: deptIdByCode.get("HR"), employeeCode: "EMP008", fullName: "Manoj Yadav", designationId: designationIdByName.get("HR Executive"), phone: "9700155566", joinDate: new Date("2022-07-25") },
      { companyId, branchId, departmentId: deptIdByCode.get("SEW"), employeeCode: "EMP009", fullName: "Sunita Gupta", designationId: designationIdByName.get("Sewing Operator"), phone: "9700177788", joinDate: new Date("2023-08-30") },
      { companyId, branchId, departmentId: deptIdByCode.get("FIN"), employeeCode: "EMP010", fullName: "Rajesh Verma", designationId: designationIdByName.get("Helper"), phone: "9700199900", joinDate: new Date("2023-10-02") },
    ],
    skipDuplicates: true,
  });

  console.log("Seeding Garment Attributes, Fabric Config, Cost Master, Finance Config...");
  await prisma.brand.createMany({
    data: [
      { companyId, code: "BR-IND", name: "Indradhar Signature" },
      { companyId, code: "BR-URB", name: "Urban Threads" },
      { companyId, code: "BR-DEN", name: "DenimCraft" },
      { companyId, code: "BR-CLS", name: "Classic Wear" },
      { companyId, code: "BR-SPT", name: "SportFlex" },
    ],
    skipDuplicates: true,
  });

  await prisma.category.createMany({
    data: [
      { companyId, code: "CAT-FRM", name: "Formal Wear" },
      { companyId, code: "CAT-CAS", name: "Casual Wear" },
      { companyId, code: "CAT-TSH", name: "T-Shirts" },
      { companyId, code: "CAT-SHT", name: "Shirts" },
      { companyId, code: "CAT-TRS", name: "Trousers" },
      { companyId, code: "CAT-ETH", name: "Ethnic Wear" },
      { companyId, code: "CAT-SPT", name: "Sportswear" },
      { companyId, code: "CAT-KID", name: "Kidswear" },
    ],
    skipDuplicates: true,
  });

  await prisma.season.createMany({
    data: [
      { companyId, code: "SS26", name: "Spring/Summer 2026" },
      { companyId, code: "AW26", name: "Autumn/Winter 2026" },
      { companyId, code: "SS27", name: "Spring/Summer 2027" },
      { companyId, code: "ALL", name: "All Season" },
    ],
    skipDuplicates: true,
  });

  await prisma.productFitting.createMany({
    data: [
      { companyId, code: "SLIM", name: "Slim Fit" },
      { companyId, code: "REG", name: "Regular Fit" },
      { companyId, code: "RELX", name: "Relaxed Fit" },
      { companyId, code: "SKIN", name: "Skinny Fit" },
      { companyId, code: "LOOSE", name: "Loose Fit" },
    ],
    skipDuplicates: true,
  });

  await prisma.productType.createMany({
    data: [
      { companyId, code: "JEAN", name: "Jeans" },
      { companyId, code: "SHRT", name: "Shirt" },
      { companyId, code: "TSHRT", name: "T-Shirt" },
      { companyId, code: "TRSR", name: "Trouser" },
      { companyId, code: "JCKT", name: "Jacket" },
      { companyId, code: "KURT", name: "Kurta" },
    ],
    skipDuplicates: true,
  });

  await prisma.design.createMany({
    data: [
      { companyId, code: "DSG-A101", name: "Design A101" },
      { companyId, code: "DSG-A102", name: "Design A102" },
      { companyId, code: "DSG-B201", name: "Design B201" },
      { companyId, code: "DSG-B202", name: "Design B202" },
      { companyId, code: "DSG-C301", name: "Design C301" },
      { companyId, code: "DSG-C302", name: "Design C302" },
    ],
    skipDuplicates: true,
  });

  await prisma.designPattern.createMany({
    data: [
      { companyId, code: "SOLID", name: "Solid" },
      { companyId, code: "STRIPE", name: "Striped" },
      { companyId, code: "CHECK", name: "Checked" },
      { companyId, code: "PRINT", name: "Printed" },
      { companyId, code: "FLORAL", name: "Floral" },
    ],
    skipDuplicates: true,
  });

  await prisma.pattern.createMany({
    data: [
      { companyId, code: "5PKT", name: "5-Pocket" },
      { companyId, code: "CARGO", name: "Cargo" },
      { companyId, code: "STRGHT", name: "Straight Cut" },
      { companyId, code: "BOOT", name: "Bootcut" },
      { companyId, code: "SLIMCUT", name: "Slim Cut" },
    ],
    skipDuplicates: true,
  });

  await prisma.fabricGsm.createMany({
    data: [
      { companyId, code: "GSM120", name: "120 GSM" },
      { companyId, code: "GSM150", name: "150 GSM" },
      { companyId, code: "GSM200", name: "200 GSM" },
      { companyId, code: "GSM220", name: "220 GSM" },
      { companyId, code: "GSM280", name: "280 GSM" },
    ],
    skipDuplicates: true,
  });

  await prisma.fabricDye.createMany({
    data: [
      { companyId, code: "IND", name: "Indigo", pantone: "19-4052 TCX" },
      { companyId, code: "BLKDY", name: "Black Dye", pantone: "19-4005 TCX" },
      { companyId, code: "STNW", name: "Stone Wash" },
      { companyId, code: "ACDW", name: "Acid Wash" },
      { companyId, code: "RNSW", name: "Rinse Wash" },
    ],
    skipDuplicates: true,
  });

  await prisma.fabricWeaveType.createMany({
    data: [
      { companyId, code: "TWL", name: "Twill" },
      { companyId, code: "PLN", name: "Plain Weave" },
      { companyId, code: "SATIN", name: "Satin" },
      { companyId, code: "RIB", name: "Rib" },
      { companyId, code: "DNMW", name: "Denim Weave" },
    ],
    skipDuplicates: true,
  });

  const widthUoms = await prisma.unitOfMeasure.findMany({ where: { code: { in: ["IN", "CM"] } } });
  const widthUomIdByCode = new Map(widthUoms.map((u) => [u.code, u.id]));

  await prisma.fabricWidth.createMany({
    data: [
      { companyId, code: "W44", name: "44 Inch", unitId: widthUomIdByCode.get("IN") },
      { companyId, code: "W58", name: "58 Inch", unitId: widthUomIdByCode.get("IN") },
      { companyId, code: "W60", name: "60 Inch", unitId: widthUomIdByCode.get("IN") },
      { companyId, code: "W150", name: "150 cm", unitId: widthUomIdByCode.get("CM") },
    ],
    skipDuplicates: true,
  });

  await prisma.fabricComposition.createMany({
    data: [
      { companyId, code: "C100", name: "100% Cotton" },
      { companyId, code: "CPBLND", name: "Cotton-Polyester Blend" },
      { companyId, code: "CLSTR", name: "Cotton-Lycra Stretch" },
      { companyId, code: "DNMBLD", name: "Denim Cotton Blend" },
      { companyId, code: "POLY", name: "100% Polyester" },
    ],
    skipDuplicates: true,
  });

  await prisma.costMaster.createMany({
    data: [
      { companyId, code: "CUTOH", name: "Cutting Overhead", type: "PER_UNIT", rate: 5 },
      { companyId, code: "SEWLAB", name: "Sewing Labor", type: "HOURLY", rate: 120 },
      { companyId, code: "MCHDEP", name: "Machine Depreciation", type: "MONTHLY", rate: 15000 },
      { companyId, code: "RENT", name: "Factory Rent", type: "MONTHLY", rate: 250000 },
      { companyId, code: "PACKOH", name: "Packing Cost", type: "PER_UNIT", rate: 3 },
    ],
    skipDuplicates: true,
  });

  await prisma.paymentType.createMany({
    data: [
      { companyId, code: "BANK", name: "Bank Transfer", type: "BANK" },
      { companyId, code: "CHQ", name: "Cheque", type: "CHEQUE" },
      { companyId, code: "CARD", name: "Credit/Debit Card", type: "CARD" },
      { companyId, code: "UPI", name: "UPI", type: "UPI" },
    ],
    skipDuplicates: true,
  });

  await prisma.bankAccount.createMany({
    data: [
      {
        companyId,
        code: "HDFC-001",
        name: "Secondary Current A/C",
        bankName: "HDFC Bank",
        accountNumber: "50100234567890",
        ifscCode: "HDFC0001234",
        branch: "Andheri East Branch",
        accountHolderName: "Indradhar Garments Pvt. Ltd.",
      },
    ],
    skipDuplicates: true,
  });

  console.log("Seeding Chart of Accounts + Tax Config (Phase 7A)...");
  await prisma.chartOfAccount.createMany({
    data: [
      { companyId, code: "CASH", name: "Cash", accountType: "ASSET" },
      { companyId, code: "BANK", name: "Bank", accountType: "ASSET" },
      { companyId, code: "AR", name: "Accounts Receivable", accountType: "ASSET", isSystemAccount: true },
      { companyId, code: "GST-ITC", name: "GST Input Tax Credit", accountType: "ASSET", isSystemAccount: true },
      { companyId, code: "AP", name: "Accounts Payable", accountType: "LIABILITY", isSystemAccount: true },
      { companyId, code: "GST-PAY", name: "GST Payable", accountType: "LIABILITY", isSystemAccount: true },
      { companyId, code: "RETAINED-EARN", name: "Retained Earnings", accountType: "EQUITY" },
      { companyId, code: "SALES-REV", name: "Sales Revenue", accountType: "INCOME" },
      { companyId, code: "COGS", name: "Purchases / Cost of Goods Sold", accountType: "EXPENSE" },
      { companyId, code: "EXP-RENT", name: "Factory Rent", accountType: "EXPENSE" },
      { companyId, code: "EXP-SALARY", name: "Salaries & Wages", accountType: "EXPENSE" },
      { companyId, code: "EXP-UTIL", name: "Utilities", accountType: "EXPENSE" },
    ],
    skipDuplicates: true,
  });

  await prisma.taxType.createMany({
    data: [{ companyId, code: "GST", name: "Goods & Services Tax" }],
    skipDuplicates: true,
  });
  const gstTaxType = await prisma.taxType.findFirst({ where: { companyId, code: "GST" } });
  if (gstTaxType) {
    const existingRates = await prisma.taxRate.count({ where: { companyId, taxTypeId: gstTaxType.id } });
    if (existingRates === 0) {
      await prisma.taxRate.createMany({
        data: [
          { companyId, taxTypeId: gstTaxType.id, name: "GST 5%", ratePercentage: 5, effectiveFrom: new Date("2026-01-01") },
          { companyId, taxTypeId: gstTaxType.id, name: "GST 12%", ratePercentage: 12, effectiveFrom: new Date("2026-01-01") },
          { companyId, taxTypeId: gstTaxType.id, name: "GST 18%", ratePercentage: 18, effectiveFrom: new Date("2026-01-01") },
        ],
      });
    }
  }

  console.log("Seeding Raw Materials and Styles...");
  const units = await prisma.unitOfMeasure.findMany();
  const unitIdByCode = new Map(units.map((u) => [u.code, u.id]));

  await prisma.product.createMany({
    data: [
      { companyId, itemType: "RAW_MATERIAL", materialCategory: "FABRIC", styleCode: "MAT-DNM12", styleName: "Denim Fabric 12oz", baseUomId: unitIdByCode.get("MTR"), defaultSupplierId: supplierIdByCode.get("SUP001"), reorderLevel: 500, unitCost: 220 },
      { companyId, itemType: "RAW_MATERIAL", materialCategory: "FABRIC", styleCode: "MAT-CTN", styleName: "Cotton Fabric", baseUomId: unitIdByCode.get("MTR"), defaultSupplierId: supplierIdByCode.get("SUP002"), reorderLevel: 500, unitCost: 150 },
      { companyId, itemType: "RAW_MATERIAL", materialCategory: "ZIPS", styleCode: "MAT-ZIP", styleName: "Metal Zipper 7 Inch", baseUomId: unitIdByCode.get("PCS"), defaultSupplierId: supplierIdByCode.get("SUP003"), reorderLevel: 2000, unitCost: 8 },
      { companyId, itemType: "RAW_MATERIAL", materialCategory: "BUTTONS", styleCode: "MAT-BTN", styleName: "Plastic Button 4-Hole", baseUomId: unitIdByCode.get("PCS"), defaultSupplierId: supplierIdByCode.get("SUP004"), reorderLevel: 5000, unitCost: 1.5 },
      { companyId, itemType: "RAW_MATERIAL", materialCategory: "ACCESSORIES", styleCode: "MAT-LBL", styleName: "Woven Brand Label", baseUomId: unitIdByCode.get("PCS"), defaultSupplierId: supplierIdByCode.get("SUP005"), reorderLevel: 3000, unitCost: 2 },
      { companyId, itemType: "RAW_MATERIAL", materialCategory: "PACKAGING", styleCode: "MAT-POLY", styleName: "Poly Bag", baseUomId: unitIdByCode.get("PCS"), defaultSupplierId: supplierIdByCode.get("SUP006"), reorderLevel: 5000, unitCost: 1 },
      { companyId, itemType: "RAW_MATERIAL", materialCategory: "PACKAGING", styleCode: "MAT-CTNBOX", styleName: "Export Carton Box", baseUomId: unitIdByCode.get("PCS"), defaultSupplierId: supplierIdByCode.get("SUP007"), reorderLevel: 500, unitCost: 45 },
      { companyId, itemType: "RAW_MATERIAL", materialCategory: "TRIMS", styleCode: "MAT-THRD", styleName: "Polyester Thread", baseUomId: unitIdByCode.get("ROL"), defaultSupplierId: supplierIdByCode.get("SUP002"), reorderLevel: 200, unitCost: 35 },
    ],
    skipDuplicates: true,
  });

  const categories = await prisma.category.findMany({ where: { companyId } });
  const categoryIdByCode = new Map(categories.map((c) => [c.code, c.id]));
  const denimCategoryId = categoryIdByCode.get("DENIM") ?? categories.find((c) => c.name === "Denim")?.id ?? null;
  const seasons = await prisma.season.findMany({ where: { companyId } });
  const seasonIdByCode = new Map(seasons.map((s) => [s.code, s.id]));

  await prisma.product.createMany({
    data: [
      { companyId, itemType: "STYLE", styleCode: "ST-DN-101", styleName: "Slim Fit Straight Jeans", categoryId: denimCategoryId, seasonId: seasonIdByCode.get("SS26"), gender: "Men", customerId: customerIdByCode.get("CUST001") },
      { companyId, itemType: "STYLE", styleCode: "ST-DN-102", styleName: "Regular Fit Bootcut Jeans", categoryId: denimCategoryId, seasonId: seasonIdByCode.get("AW26"), gender: "Men", customerId: customerIdByCode.get("CUST010") },
      { companyId, itemType: "STYLE", styleCode: "ST-DN-103", styleName: "Skinny Fit Ripped Jeans", categoryId: denimCategoryId, seasonId: seasonIdByCode.get("SS26"), gender: "Women", customerId: customerIdByCode.get("CUST002") },
      { companyId, itemType: "STYLE", styleCode: "ST-DN-104", styleName: "Relaxed Fit Cargo Jeans", categoryId: denimCategoryId, seasonId: seasonIdByCode.get("AW26"), gender: "Men", customerId: customerIdByCode.get("CUST003") },
      { companyId, itemType: "STYLE", styleCode: "ST-FR-201", styleName: "Formal Cotton Shirt", categoryId: categoryIdByCode.get("CAT-FRM"), seasonId: seasonIdByCode.get("ALL"), gender: "Men", customerId: customerIdByCode.get("CUST004") },
      { companyId, itemType: "STYLE", styleCode: "ST-FR-202", styleName: "Slim Fit Formal Trouser", categoryId: categoryIdByCode.get("CAT-FRM"), seasonId: seasonIdByCode.get("ALL"), gender: "Men", customerId: customerIdByCode.get("CUST005") },
      { companyId, itemType: "STYLE", styleCode: "ST-FR-203", styleName: "Classic Blazer", categoryId: categoryIdByCode.get("CAT-FRM"), seasonId: seasonIdByCode.get("AW26"), gender: "Men", customerId: customerIdByCode.get("CUST006") },
      { companyId, itemType: "STYLE", styleCode: "ST-CS-301", styleName: "Casual Check Shirt", categoryId: categoryIdByCode.get("CAT-CAS"), seasonId: seasonIdByCode.get("SS26"), gender: "Men", customerId: customerIdByCode.get("CUST007") },
      { companyId, itemType: "STYLE", styleCode: "ST-CS-302", styleName: "Cargo Shorts", categoryId: categoryIdByCode.get("CAT-CAS"), seasonId: seasonIdByCode.get("SS26"), gender: "Men", customerId: customerIdByCode.get("CUST008") },
      { companyId, itemType: "STYLE", styleCode: "ST-CS-303", styleName: "Denim Jacket", categoryId: categoryIdByCode.get("CAT-CAS"), seasonId: seasonIdByCode.get("AW26"), gender: "Unisex", customerId: customerIdByCode.get("CUST009") },
      { companyId, itemType: "STYLE", styleCode: "ST-TS-401", styleName: "Round Neck T-Shirt", categoryId: categoryIdByCode.get("CAT-TSH"), seasonId: seasonIdByCode.get("ALL"), gender: "Unisex", customerId: customerIdByCode.get("CUST001") },
      { companyId, itemType: "STYLE", styleCode: "ST-TS-402", styleName: "Polo T-Shirt", categoryId: categoryIdByCode.get("CAT-TSH"), seasonId: seasonIdByCode.get("SS26"), gender: "Men", customerId: customerIdByCode.get("CUST010") },
      { companyId, itemType: "STYLE", styleCode: "ST-TS-403", styleName: "V-Neck T-Shirt", categoryId: categoryIdByCode.get("CAT-TSH"), seasonId: seasonIdByCode.get("SS26"), gender: "Women", customerId: customerIdByCode.get("CUST002") },
      { companyId, itemType: "STYLE", styleCode: "ST-SH-501", styleName: "Printed Casual Shirt", categoryId: categoryIdByCode.get("CAT-SHT"), seasonId: seasonIdByCode.get("SS26"), gender: "Men", customerId: customerIdByCode.get("CUST003") },
      { companyId, itemType: "STYLE", styleCode: "ST-SH-502", styleName: "Striped Formal Shirt", categoryId: categoryIdByCode.get("CAT-SHT"), seasonId: seasonIdByCode.get("ALL"), gender: "Men", customerId: customerIdByCode.get("CUST004") },
      { companyId, itemType: "STYLE", styleCode: "ST-TR-601", styleName: "Chino Trouser", categoryId: categoryIdByCode.get("CAT-TRS"), seasonId: seasonIdByCode.get("ALL"), gender: "Men", customerId: customerIdByCode.get("CUST005") },
      { companyId, itemType: "STYLE", styleCode: "ST-TR-602", styleName: "Jogger Pants", categoryId: categoryIdByCode.get("CAT-TRS"), seasonId: seasonIdByCode.get("SS26"), gender: "Unisex", customerId: customerIdByCode.get("CUST006") },
      { companyId, itemType: "STYLE", styleCode: "ST-ET-701", styleName: "Men's Kurta", categoryId: categoryIdByCode.get("CAT-ETH"), seasonId: seasonIdByCode.get("ALL"), gender: "Men", customerId: customerIdByCode.get("CUST007") },
      { companyId, itemType: "STYLE", styleCode: "ST-SP-801", styleName: "Track Pants", categoryId: categoryIdByCode.get("CAT-SPT"), seasonId: seasonIdByCode.get("ALL"), gender: "Unisex", customerId: customerIdByCode.get("CUST008") },
      { companyId, itemType: "STYLE", styleCode: "ST-KD-901", styleName: "Kids T-Shirt", categoryId: categoryIdByCode.get("CAT-KID"), seasonId: seasonIdByCode.get("SS26"), gender: "Kids", customerId: customerIdByCode.get("CUST009") },
    ],
    skipDuplicates: true,
  });

  console.log("Seeding a sample of Product Variants...");
  const colors = await prisma.color.findMany({ where: { companyId } });
  const sizes = await prisma.size.findMany({ where: { companyId } });
  const styleProducts = await prisma.product.findMany({
    where: { companyId, itemType: "STYLE", styleCode: { in: ["ST-DN-101", "ST-TS-401", "ST-SH-501"] } },
  });
  const variantColors = colors.filter((c) => ["BLK", "NVY", "WHT"].includes(c.code));
  const variantSizes = sizes.filter((s) => ["S", "M", "L", "XL"].includes(s.code));

  await prisma.productVariant.createMany({
    data: styleProducts.flatMap((p) =>
      variantColors.flatMap((c) =>
        variantSizes.map((s) => ({
          productId: p.id,
          colorId: c.id,
          sizeId: s.id,
          skuCode: `${p.styleCode}-${c.code}-${s.code}`,
        }))
      )
    ),
    skipDuplicates: true,
  });

  console.log("\nSeed complete.");
  console.log(`  Company:  ${company.name} (${company.id})`);
  console.log(`  Branch:   ${branch.name} (${branch.code})`);
  console.log(`  Login:    ${superAdminEmail} / ${superAdminPassword}`);
  console.log("  ⚠ Change this password immediately in a non-dev environment.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
