/* eslint-disable jsx-a11y/alt-text -- React PDF Image is a PDF primitive, not a DOM image. */
import {
  Document,
  Font,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";
import type { BusinessDocument } from "@/domain/types";
import { calculate, money, dateLabel } from "@/domain/documents";
import { splitDescription } from "./layout";

// Keep ordinary words whole (no syllable hyphenation), but allow very long
// unbroken strings such as references or URLs to wrap instead of overflowing.
Font.registerHyphenationCallback((word) =>
  word.length > 24 ? (word.match(/.{1,16}/g) ?? [word]) : [word],
);

const MUTED = "#6b756e";
const RULE = "#e5e9e2";

const s = StyleSheet.create({
  page: {
    paddingTop: 46,
    paddingBottom: 60,
    paddingHorizontal: 40,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#24332c",
    lineHeight: 1.45,
  },
  // Dynamic (render-prop) chrome is top-anchored with a fixed width: in this
  // react-pdf version, bottom-anchored or shrink-to-fit dynamic text can be
  // dropped when it is re-laid out with the final page count.
  runningHead: {
    position: "absolute",
    top: 22,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    lineHeight: 1.3,
    fontSize: 7.5,
    color: MUTED,
  },
  footer: {
    position: "absolute",
    top: 790,
    left: 40,
    right: 40,
    paddingTop: 7,
    lineHeight: 1.3,
    borderTop: `1 solid ${RULE}`,
    fontSize: 7.5,
    color: MUTED,
  },
  pageNumber: {
    position: "absolute",
    top: 798,
    left: 40,
    right: 40,
    lineHeight: 1.3,
    textAlign: "right",
    fontSize: 7.5,
    color: MUTED,
  },
  watermark: {
    position: "absolute",
    top: 360,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 110,
    fontFamily: "Helvetica-Bold",
    color: "#d9a441",
    opacity: 0.12,
    transform: "rotate(-30deg)",
  },
  heading: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 22,
  },
  // Natural proportions, up to 120 pt each way; tall logos sit left.
  logo: {
    maxWidth: 120,
    maxHeight: 120,
    objectFit: "contain",
    objectPositionX: 0,
    marginBottom: 10,
  },
  initials: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    marginBottom: 8,
  },
  name: {
    lineHeight: 1.25,
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    marginBottom: 5,
  },
  title: {
    lineHeight: 1.2,
    marginBottom: 6,
    fontSize: 24,
    fontFamily: "Helvetica-Bold",
    textAlign: "right",
  },
  right: { textAlign: "right" },
  muted: { color: MUTED },
  columns: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 22,
  },
  column: { width: "46%" },
  label: { fontSize: 7.5, letterSpacing: 1, color: MUTED, marginBottom: 5 },
  bold: { fontFamily: "Helvetica-Bold" },
  detailRow: { flexDirection: "row" },
  detailLabel: { width: 82, color: MUTED },
  table: { marginBottom: 4 },
  tableHead: {
    flexDirection: "row",
    paddingVertical: 7,
    paddingHorizontal: 8,
    backgroundColor: "#f1f4ef",
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: "#45524a",
  },
  row: {
    flexDirection: "row",
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderBottom: `1 solid ${RULE}`,
  },
  desc: { width: "46%", paddingRight: 10 },
  qty: { width: "16%", textAlign: "right", paddingRight: 6 },
  price: { width: "19%", textAlign: "right" },
  total: { width: "19%", textAlign: "right" },
  totals: {
    width: "46%",
    alignSelf: "flex-end",
    marginTop: 14,
    marginBottom: 20,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  grand: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 9,
    paddingHorizontal: 10,
    marginTop: 5,
    color: "#fff",
    fontSize: 11.5,
    fontFamily: "Helvetica-Bold",
  },
  section: {
    marginTop: 4,
    paddingTop: 12,
    paddingBottom: 6,
    borderTop: `1 solid ${RULE}`,
  },
  draft: {
    fontSize: 9,
    color: "#9b691d",
    fontFamily: "Helvetica-Bold",
    marginTop: 6,
    textAlign: "right",
  },
});

const titleOf = (doc: BusinessDocument) =>
  doc.kind === "quotation" ? "QUOTATION" : "INVOICE";

function TableHeadings() {
  return (
    <>
      <Text style={s.desc}>DESCRIPTION</Text>
      <Text style={s.qty}>QTY / UNIT</Text>
      <Text style={s.price}>UNIT PRICE</Text>
      <Text style={s.total}>AMOUNT</Text>
    </>
  );
}

/**
 * Repeated page chrome (`fixed` elements render on every page): draft mark,
 * running head on continuation pages, footer and page numbers. Space for the
 * head and footer is reserved by the page padding.
 */
function PageChrome({ doc }: { doc: BusinessDocument }) {
  const draft = doc.status === "draft";
  const number = doc.number || "Unnumbered draft";
  return (
    <>
      {draft && (
        <Text fixed style={s.watermark}>
          DRAFT
        </Text>
      )}
      <View
        fixed
        style={s.runningHead}
        render={({ pageNumber }) =>
          pageNumber > 1 ? (
            <>
              <Text>{doc.snapshot.issuer.name}</Text>
              <Text>
                {titleOf(doc)} {number}
                {draft ? " · DRAFT" : ""} (continued)
              </Text>
            </>
          ) : null
        }
      />
      <View fixed style={s.footer}>
        <Text>
          {number} ·{" "}
          {draft
            ? "Draft — not issued"
            : `Issued by ${doc.snapshot.issuer.name}`}{" "}
          · Amounts in ZAR
        </Text>
      </View>
      <Text
        fixed
        style={s.pageNumber}
        render={({ pageNumber, totalPages }) =>
          `Page ${pageNumber} of ${totalPages}`
        }
      />
    </>
  );
}

export function DocumentPDF({ doc }: { doc: BusinessDocument }) {
  const { issuer, customer } = doc.snapshot;
  const totals = calculate(doc.lines, doc.taxRate);
  const invoice = doc.kind === "invoice";
  const accent = issuer.accent;
  const hasBank =
    invoice && [issuer.bank, issuer.accountNumber].some((v) => v.trim());
  const initials = issuer.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <Document
      title={`${titleOf(doc)} ${doc.number || "Draft"} — ${issuer.name}`}
      author={issuer.name}
      subject={`${invoice ? "Invoice" : "Quotation"} for ${customer.name}`}
      creator="Africonnect Invoicing"
      producer="Africonnect Invoicing"
    >
      <Page size="A4" style={s.page} wrap>
        <PageChrome doc={doc} />
        <View style={s.heading}>
          <View style={{ width: "58%" }}>
            {issuer.logo ? (
              <Image src={issuer.logo} style={s.logo} />
            ) : (
              <Text style={{ ...s.initials, color: accent }}>{initials}</Text>
            )}
            <Text style={{ ...s.name, color: accent }}>{issuer.name}</Text>
            <Text>{issuer.address}</Text>
            <Text>
              {[issuer.email, issuer.phone].filter(Boolean).join("  |  ")}
            </Text>
            {issuer.registration && (
              <Text style={s.muted}>Registration: {issuer.registration}</Text>
            )}
            {issuer.vat && (
              <Text style={s.muted}>VAT number: {issuer.vat}</Text>
            )}
          </View>
          <View style={{ width: "38%" }}>
            <Text style={{ ...s.title, color: accent }}>{titleOf(doc)}</Text>
            <Text style={{ ...s.right, ...s.bold }}>
              {doc.number || "Number assigned on save"}
            </Text>
            {doc.status === "draft" && (
              <Text style={s.draft}>DRAFT · NOT ISSUED</Text>
            )}
          </View>
        </View>
        <View style={s.columns}>
          <View style={s.column}>
            <Text style={s.label}>{invoice ? "BILL TO" : "PREPARED FOR"}</Text>
            <Text style={s.bold}>{customer.name}</Text>
            {customer.contact && <Text>Attn: {customer.contact}</Text>}
            {customer.address && <Text>{customer.address}</Text>}
            {customer.email && <Text>{customer.email}</Text>}
            {customer.phone && <Text>{customer.phone}</Text>}
            {customer.registration && (
              <Text style={s.muted}>Registration: {customer.registration}</Text>
            )}
            {customer.vat && (
              <Text style={s.muted}>Tax number: {customer.vat}</Text>
            )}
          </View>
          <View style={s.column}>
            <Text style={s.label}>
              {invoice ? "INVOICE DETAILS" : "QUOTATION DETAILS"}
            </Text>
            <View style={s.detailRow}>
              <Text style={s.detailLabel}>
                {invoice ? "Invoice date" : "Quotation date"}
              </Text>
              <Text>{dateLabel(doc.date)}</Text>
            </View>
            {doc.sourceQuotationNumber && (
              <View style={s.detailRow}>
                <Text style={s.detailLabel}>Quotation ref.</Text>
                <Text>{doc.sourceQuotationNumber}</Text>
              </View>
            )}
            {doc.terms && <Text style={{ marginTop: 5 }}>{doc.terms}</Text>}
          </View>
        </View>
        <View style={s.table}>
          {/* `fixed` inside the table repeats the heading on each page the table continues onto. */}
          <View style={s.tableHead} fixed>
            <TableHeadings />
          </View>
          {doc.lines.flatMap((line) =>
            splitDescription(line.description).map((description, index) => (
              <View style={s.row} key={`${line.id}-${index}`} wrap={false}>
                <View style={s.desc}>
                  <Text style={s.bold}>
                    {index ? `${line.name} (continued)` : line.name}
                  </Text>
                  {description && <Text style={s.muted}>{description}</Text>}
                </View>
                <Text style={s.qty}>
                  {index ? "" : `${line.quantity} ${line.unit}`}
                </Text>
                <Text style={s.price}>{index ? "" : money(line.price)}</Text>
                <Text style={s.total}>
                  {index ? "" : money(calculate([line], 0).total)}
                </Text>
              </View>
            )),
          )}
        </View>
        <View style={s.totals} wrap={false}>
          <View style={s.totalRow}>
            <Text>Subtotal</Text>
            <Text>{money(totals.subtotal)}</Text>
          </View>
          {doc.taxRate > 0 && (
            <View style={s.totalRow}>
              <Text>VAT ({doc.taxRate}%)</Text>
              <Text>{money(totals.tax)}</Text>
            </View>
          )}
          <View style={{ ...s.grand, backgroundColor: accent }}>
            <Text>{invoice ? "Total due" : "Quoted total"}</Text>
            <Text>{money(totals.total)}</Text>
          </View>
          {doc.taxRate === 0 && (
            <Text style={{ ...s.muted, marginTop: 5, textAlign: "right" }}>
              No VAT charged.
            </Text>
          )}
        </View>
        {hasBank && (
          <View style={s.section} wrap={false}>
            <Text style={s.label}>PAYMENT DETAILS</Text>
            {issuer.bank && <Text>Bank: {issuer.bank}</Text>}
            {issuer.accountName && (
              <Text>Account holder: {issuer.accountName}</Text>
            )}
            {issuer.accountNumber && (
              <Text>
                Account number: {issuer.accountNumber}
                {issuer.branch ? `  ·  Branch code: ${issuer.branch}` : ""}
              </Text>
            )}
            <Text>Payment reference: {doc.number || "Draft"}</Text>
          </View>
        )}
        {doc.notes && (
          <View style={s.section}>
            <Text style={s.label}>
              {invoice ? "NOTES & INSTRUCTIONS" : "TERMS & NOTES"}
            </Text>
            <Text>{doc.notes}</Text>
          </View>
        )}
      </Page>
    </Document>
  );
}

export async function downloadPDF(doc: BusinessDocument) {
  const { pdf } = await import("@react-pdf/renderer");
  const blob = await pdf(<DocumentPDF doc={doc} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const name = `${doc.number || doc.kind}${doc.status === "draft" ? "-DRAFT" : ""}`;
  a.download = `${name.replace(/[^\w.-]+/g, "-")}.pdf`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
