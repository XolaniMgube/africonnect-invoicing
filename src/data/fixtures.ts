import type {
  Business,
  BusinessDocument,
  Customer,
  Database,
  ReferenceItem,
} from "../domain/types";
import { calculate } from "../domain/documents";
const logo = (letters: string) => `/demo-${letters.toLowerCase()}.png`;
export function createFixtures(): Database {
  const businesses: Business[] = [
    [
      "glen",
      "Glen Zamba Construction",
      "Construction",
      "#b77932",
      "GZ",
      "GZ-INV",
      "GZ-QUO",
      "15",
    ],
    [
      "green",
      "Greenleaf Garden Care",
      "Property maintenance",
      "#397d63",
      "GG",
      "GG-INV",
      "GG-QUO",
      "0",
    ],
    [
      "nala",
      "Nala Creative Studio",
      "Design & creative",
      "#7861a9",
      "NC",
      "NC-INV",
      "NC-QUO",
      "15",
    ],
    [
      "moya",
      "Moya Event Styling",
      "Events & hospitality",
      "#bb6c70",
      "ME",
      "ME-INV",
      "ME-QUO",
      "0",
    ],
  ].map(
    (
      [
        id,
        name,
        industry,
        accent,
        initials,
        invoicePrefix,
        quotationPrefix,
        tax,
      ],
      i,
    ) => ({
      id,
      name,
      industry,
      accent,
      logo: logo(initials),
      invoicePrefix,
      quotationPrefix,
      taxRate: +tax,
      email: `hello@${id}.example`,
      phone: `+27 00 000 010${i}`,
      address: `${12 + i * 8} Example Avenue\nDemo Park, Gauteng, 0000`,
      registration: `DEMO-2026/000${i}/07`,
      vat: +tax ? `DEMO-VAT-000${i}` : "",
      bank: "Fictional Demo Bank",
      accountName: name,
      accountNumber: `DEMO-00000${i}`,
      branch: "DEMO-000",
      archived: false,
      paymentDays: 30,
      validityDays: 14,
      notes:
        "Thank you for choosing us. All details in this example are fictional.",
    }),
  );
  const names = [
    ["Mahlangu Property Group", "Eastwood Community Centre"],
    ["Willow Ridge Estate", "Thandi Mokoena"],
    ["Ubuntu Market Co.", "Kopano Coffee House"],
  ];
  const customers: Customer[] = businesses.slice(0, 3).flatMap((b, i) =>
    names[i].map((name, j) => ({
      id: `${b.id}-customer-${j}`,
      businessId: b.id,
      name,
      contact: j ? "Lerato Example" : "Sipho Example",
      email: `accounts${j}@${b.id}-customer.example`,
      phone: "+27 00 000 0200",
      address: `${42 + j} Sample Road\nJohannesburg, 0000`,
      registration: "",
      vat: "",
    })),
  );
  const specs = [
    [
      [
        "Site preparation",
        "Ground clearing and preparation",
        "Site works",
        "Day",
        2800,
      ],
      [
        "Brickwork",
        "Supply and installation of standard brickwork",
        "Building",
        "Square metre",
        480,
      ],
      [
        "Project supervision",
        "On-site coordination and quality checks",
        "Management",
        "Day",
        1500,
      ],
    ],
    [
      [
        "Garden maintenance",
        "Lawn care, pruning and seasonal maintenance",
        "Maintenance",
        "Visit",
        850,
      ],
      [
        "Landscape design",
        "Planting plan and garden concept",
        "Design",
        "Project",
        4200,
      ],
      [
        "Hedge trimming",
        "Trim and remove garden cuttings",
        "Maintenance",
        "Hour",
        250,
      ],
    ],
    [
      [
        "Brand identity",
        "Visual identity concept and brand guidelines",
        "Branding",
        "Project",
        7500,
      ],
      [
        "Website design",
        "Responsive five-page business website",
        "Digital",
        "Project",
        12500,
      ],
      [
        "Design consultation",
        "Creative direction and design advice",
        "Consulting",
        "Hour",
        650,
      ],
    ],
  ];
  const items: ReferenceItem[] = businesses.slice(0, 3).flatMap((b, i) =>
    specs[i].map(([name, description, category, unit, price], j) => ({
      id: `${b.id}-item-${j}`,
      businessId: b.id,
      name: String(name),
      description: String(description),
      category: String(category),
      unit: String(unit),
      price: Number(price),
      archived: false,
    })),
  );
  const documents: BusinessDocument[] = businesses.slice(0, 3).flatMap((b, i) =>
    Array.from({ length: 5 }, (_, j) => {
      const kind = j > 2 ? "quotation" : "invoice";
      const customer = customers.find(
        (c) => c.id === `${b.id}-customer-${j % 2}`,
      )!;
      const lines = (
        i === 0 && j === 2
          ? Array.from({ length: 28 }, (_, n) => items[i * 3 + (n % 3)])
          : [items[i * 3 + (j % 3)], items[i * 3 + ((j + 1) % 3)]]
      ).map((item, n) => ({
        id: `line-${n}`,
        referenceId: item.id,
        name: item.name,
        description:
          item.description +
          (j === 2 && i === 0
            ? ` — Work package ${n + 1}: preparation, delivery and finishing to the agreed specification.`
            : ""),
        unit: item.unit,
        quantity: item.unit === "Square metre" ? 25 : 1 + (n % 3),
        price: item.price,
      }));
      return {
        id: `${b.id}-doc-${j}`,
        businessId: b.id,
        customerId: customer.id,
        kind,
        number: `${kind === "invoice" ? b.invoicePrefix : b.quotationPrefix}-${String(kind === "invoice" ? j + 1 : j - 2).padStart(4, "0")}`,
        status: j === 1 || j === 4 ? "draft" : "issued",
        date: `2026-11-0${4 - (j % 4)}`,
        endDate: kind === "invoice" ? "2026-12-04" : "2026-11-18",
        terms:
          kind === "invoice"
            ? "Payment within 30 days."
            : "Quotation valid for 14 days.",
        notes: b.notes,
        taxRate: b.taxRate,
        lines,
        snapshot: {
          issuer: structuredClone(b),
          customer: structuredClone(customer),
        },
        totals: calculate(lines, b.taxRate),
        updatedAt: `2026-11-0${4 - (j % 4)}T10:00:00Z`,
      };
    }),
  );
  return { version: 1, businesses, customers, items, documents };
}
