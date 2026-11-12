/* eslint-disable jsx-a11y/alt-text -- React PDF Image is a PDF primitive, not a DOM image. */
import {
  Font,
  Page,
  Polygon,
  StyleSheet,
  Svg,
  Text,
  View,
  Image,
} from "@react-pdf/renderer";
import type { BusinessDocument } from "@/domain/types";
import { calculate, dateLabel, money } from "@/domain/documents";
import { splitDescription } from "./layout";

/** The same bundled files the on-screen preview uses (public/fonts). */
let fontsRegistered = false;
function registerFonts() {
  if (fontsRegistered) return;
  const base = typeof window === "undefined" ? "" : window.location.origin;
  Font.register({
    family: "Poppins",
    fonts: [
      { src: `${base}/fonts/Poppins-Regular.ttf`, fontWeight: 400 },
      { src: `${base}/fonts/Poppins-Medium.ttf`, fontWeight: 500 },
      { src: `${base}/fonts/Poppins-SemiBold.ttf`, fontWeight: 600 },
      { src: `${base}/fonts/Poppins-Bold.ttf`, fontWeight: 700 },
    ],
  });
  Font.register({ family: "Kristi", src: `${base}/fonts/Kristi-Regular.ttf` });
  fontsRegistered = true;
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 44;
const BAND = 30;
const INK = "#1f2a3c";
const MUTED = "#5f6878";

const s = StyleSheet.create({
  page: {
    paddingTop: 44,
    // Reserves the contact, signature and band area on every page.
    paddingBottom: 150,
    paddingHorizontal: MARGIN,
    backgroundColor: "#fafafa",
    fontFamily: "Poppins",
    fontSize: 9.5,
    color: INK,
    lineHeight: 1.45,
  },
  runningHead: {
    position: "absolute",
    top: 18,
    left: MARGIN,
    right: MARGIN,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    color: MUTED,
  },
  watermark: {
    position: "absolute",
    top: 340,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 110,
    fontWeight: 700,
    color: "#d9a441",
    opacity: 0.12,
    transform: "rotate(-30deg)",
  },
  head: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  logo: {
    maxWidth: 140,
    maxHeight: 66,
    objectFit: "contain",
    objectPositionX: 0,
  },
  brand: { fontSize: 15, fontWeight: 600 },
  title: {
    fontSize: 26,
    fontWeight: 600,
    lineHeight: 1.15,
    textAlign: "right",
  },
  right: { textAlign: "right" },
  draft: {
    marginTop: 4,
    textAlign: "right",
    fontSize: 8.5,
    fontWeight: 700,
    color: "#9b691d",
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 14,
    marginBottom: 22,
  },
  parties: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 22,
  },
  billLabel: { fontSize: 10.5, marginBottom: 3 },
  customer: { fontSize: 13, fontWeight: 600, marginBottom: 3 },
  muted: { color: MUTED },
  detailLabel: { fontSize: 9.5, textAlign: "right" },
  detailValue: {
    fontSize: 10,
    fontWeight: 600,
    textAlign: "right",
    marginBottom: 9,
  },
  tableHead: {
    flexDirection: "row",
    paddingVertical: 8,
    borderRadius: 16,
    color: "#fff",
    fontSize: 10.5,
    fontWeight: 600,
  },
  row: {
    flexDirection: "row",
    paddingVertical: 11,
    borderBottomWidth: 1.3,
    borderBottomStyle: "dashed",
  },
  desc: { width: "47%", paddingLeft: 22, paddingRight: 8 },
  qty: { width: "15%", textAlign: "center" },
  price: { width: "19%", textAlign: "center" },
  total: { width: "19%", textAlign: "center" },
  summary: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 16,
  },
  totals: { width: "40%" },
  breakdown: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 1.5,
    fontSize: 9,
  },
  pill: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 5,
    paddingVertical: 6,
    paddingHorizontal: 18,
    borderRadius: 14,
    color: "#fff",
    fontSize: 12.5,
    fontWeight: 600,
  },
  payment: {
    width: "50%",
    marginTop: 16,
    padding: 18,
    borderRadius: 10,
    color: "#fff",
    fontSize: 10,
    lineHeight: 1.6,
  },
  paymentTitle: { fontSize: 10.5, fontWeight: 600, marginBottom: 3 },
  strong: { fontWeight: 600 },
  notes: { marginTop: 12, fontSize: 8, color: MUTED },
  // Contact lines: one Text each, like the signature (see `contactLines`).
  contactLine: {
    position: "absolute",
    left: MARGIN,
    width: 330,
    fontSize: 8.5,
    lineHeight: 1.2,
    maxLines: 1,
    textOverflow: "ellipsis",
  },
  // Dynamic (render-prop) chrome is top-anchored with a fixed width, as in
  // the Classic template: react-pdf can drop bottom-anchored dynamic content.
  // Only Text receives the page count, so each signature part is a Text.
  signPart: {
    position: "absolute",
    left: PAGE_WIDTH - MARGIN - 150,
    width: 150,
    textAlign: "center",
    fontSize: 7,
    fontWeight: 600,
    lineHeight: 1.2,
    textTransform: "uppercase",
  },
  sign: {
    top: 698,
    fontFamily: "Kristi",
    fontSize: 26,
    fontWeight: 400,
    textTransform: "none",
  },
  pageNumber: {
    position: "absolute",
    top: 794,
    left: MARGIN,
    right: MARGIN,
    textAlign: "right",
    fontSize: 7,
    color: MUTED,
  },
  band: { position: "absolute", top: PAGE_HEIGHT - BAND, left: 0 },
});

/**
 * Contact Us lines with their positions. They show on the last page only,
 * which needs a render prop; in this react-pdf version only Text render props
 * lay out reliably (a View's late children are dropped), so each line is its
 * own top-anchored, single-line Text.
 */
function contactLines(issuer: BusinessDocument["snapshot"]["issuer"]) {
  const lines: { text: string; style: Record<string, unknown> }[] = [
    { text: "CONTACT US", style: { fontSize: 10.5, fontWeight: 600 } },
  ];
  for (const text of [
    issuer.phone,
    issuer.address.split(/\n+/).join(", "),
    issuer.email,
  ])
    if (text.trim()) lines.push({ text, style: { fontWeight: 600 } });
  if (issuer.registration)
    lines.push({ text: `Reg. ${issuer.registration}`, style: s.muted });
  if (issuer.vat) lines.push({ text: `VAT ${issuer.vat}`, style: s.muted });
  return lines.map((line, i) => ({
    ...line,
    // The heading is taller; each detail line takes 12 pt.
    top: 712 + (i ? 16 + (i - 1) * 12 : 0),
  }));
}

function Chrome({ doc, word }: { doc: BusinessDocument; word: string }) {
  const { issuer } = doc.snapshot;
  const main = issuer.accent;
  const second = issuer.secondaryAccent;
  const number = doc.number || "Unnumbered draft";
  const draft = doc.status === "draft";
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
              <Text>{issuer.name}</Text>
              <Text>
                {word.toUpperCase()} {number}
                {draft ? " · DRAFT" : ""} (continued)
              </Text>
            </>
          ) : null
        }
      />
      {/* Contact details appear once, on the last page. */}
      {contactLines(issuer).map(({ text, style, top }) => (
        <Text
          key={top}
          fixed
          style={{ ...s.contactLine, color: INK, ...style, top }}
          render={({ pageNumber, totalPages }) =>
            pageNumber === totalPages ? text : ""
          }
        />
      ))}
      {issuer.signatoryName.trim() &&
        (
          [
            [s.sign, issuer.signatoryName, main],
            [{ top: 728, fontWeight: 400 }, "-".repeat(30), INK],
            [{ top: 742 }, issuer.signatoryName, INK],
            [{ top: 751 }, issuer.signatoryTitle, INK],
          ] as const
        ).map(([style, text, color], i) => (
          <Text
            key={i}
            fixed
            style={{ ...s.signPart, ...style, color }}
            render={({ pageNumber, totalPages }) =>
              pageNumber === totalPages ? text : ""
            }
          />
        ))}
      <Text
        fixed
        style={s.pageNumber}
        render={({ pageNumber, totalPages }) =>
          totalPages > 1 ? `Page ${pageNumber} of ${totalPages}` : ""
        }
      />
      <Svg
        fixed
        style={s.band}
        width={PAGE_WIDTH}
        height={BAND}
        viewBox={`0 0 595 ${BAND}`}
      >
        <Polygon points="0,0 350,0 380,30 0,30" fill={main} />
        <Polygon points="362,0 380,0 410,30 392,30" fill={second} />
        <Polygon points="392,0 595,0 595,30 422,30" fill={second} />
      </Svg>
    </>
  );
}

/** The Executive template as an A4 page set; mirrors `ExecutivePreview`. */
export function ExecutivePage({ doc }: { doc: BusinessDocument }) {
  registerFonts();
  const { issuer, customer } = doc.snapshot;
  const main = issuer.accent;
  const second = issuer.secondaryAccent;
  const totals = calculate(doc.lines, doc.taxRate, doc.discountAmount);
  const invoice = doc.kind === "invoice";
  const word = invoice ? "Invoice" : "Quotation";
  const hasBank =
    invoice && [issuer.bank, issuer.accountNumber].some((v) => v.trim());
  const breakdown = doc.discountAmount > 0 || doc.taxRate > 0;
  return (
    <Page size="A4" style={s.page} wrap>
      <Chrome doc={doc} word={word} />
      <View style={s.head}>
        <View style={{ width: "55%" }}>
          {issuer.logo ? (
            <Image src={issuer.logo} style={s.logo} />
          ) : (
            <Text style={{ ...s.brand, color: main }}>{issuer.name}</Text>
          )}
        </View>
        <View style={{ width: "42%" }}>
          <Text style={{ ...s.title, color: main }}>{word.toUpperCase()}</Text>
          {issuer.email && <Text style={s.right}>{issuer.email}</Text>}
          {doc.status === "draft" && (
            <Text style={s.draft}>DRAFT · NOT ISSUED</Text>
          )}
        </View>
      </View>
      <View style={s.divider}>
        <View
          style={{
            width: "40%",
            height: 4,
            borderRadius: 2,
            backgroundColor: main,
          }}
        />
        <View style={{ flexGrow: 1, height: 2, backgroundColor: second }} />
      </View>
      <View style={{ ...s.parties, color: main }}>
        <View style={{ width: "58%" }}>
          <Text style={s.billLabel}>{word} to :</Text>
          <Text style={s.customer}>{customer.name}</Text>
          <View style={{ color: INK }}>
            {customer.contact && <Text>Attn: {customer.contact}</Text>}
            {customer.address && <Text>{customer.address}</Text>}
            {customer.phone && <Text>{customer.phone}</Text>}
            {customer.email && <Text>{customer.email}</Text>}
            {customer.registration && (
              <Text style={s.muted}>Registration: {customer.registration}</Text>
            )}
            {customer.vat && (
              <Text style={s.muted}>Tax number: {customer.vat}</Text>
            )}
          </View>
        </View>
        <View style={{ width: "38%" }}>
          <Text style={s.detailLabel}>{word} Date</Text>
          <Text style={s.detailValue}>{dateLabel(doc.date)}</Text>
          <Text style={s.detailLabel}>{word} No</Text>
          <Text style={s.detailValue}>{doc.number || "Assigned on issue"}</Text>
          {doc.sourceQuotationNumber && (
            <>
              <Text style={s.detailLabel}>Quotation Ref</Text>
              <Text style={s.detailValue}>{doc.sourceQuotationNumber}</Text>
            </>
          )}
        </View>
      </View>
      <View>
        {/* `fixed` repeats the heading on each page the table continues onto. */}
        <View style={{ ...s.tableHead, backgroundColor: main }} fixed>
          <Text style={s.desc}>Description</Text>
          <Text style={s.qty}>Qty</Text>
          <Text style={s.price}>Price</Text>
          <Text style={s.total}>Total</Text>
        </View>
        {doc.lines.flatMap((line) =>
          splitDescription(line.description).map((description, index) => (
            <View
              key={`${line.id}-${index}`}
              style={{ ...s.row, borderBottomColor: second }}
              wrap={false}
            >
              <View style={s.desc}>
                <Text>{index ? `${line.name} (continued)` : line.name}</Text>
                {description && (
                  <Text style={{ ...s.muted, fontSize: 8 }}>{description}</Text>
                )}
              </View>
              <Text style={s.qty}>
                {index
                  ? ""
                  : `${line.quantity}${line.unit && line.unit !== "Item" ? ` ${line.unit}` : ""}`}
              </Text>
              <Text style={s.price}>{index ? "" : money(line.price)}</Text>
              <Text style={s.total}>
                {index ? "" : money(calculate([line], 0).total)}
              </Text>
            </View>
          )),
        )}
      </View>
      <View style={{ ...s.summary, color: main }} wrap={false}>
        <View style={s.totals}>
          {breakdown && (
            <>
              <View style={s.breakdown}>
                <Text>Subtotal</Text>
                <Text>{money(totals.subtotal)}</Text>
              </View>
              {doc.discountAmount > 0 && (
                <View style={s.breakdown}>
                  <Text>Discount</Text>
                  <Text>-{money(doc.discountAmount)}</Text>
                </View>
              )}
              {doc.taxRate > 0 && (
                <View style={s.breakdown}>
                  <Text>VAT ({doc.taxRate}%)</Text>
                  <Text>{money(totals.tax)}</Text>
                </View>
              )}
            </>
          )}
          <View style={{ ...s.pill, backgroundColor: main }}>
            <Text>Total</Text>
            <Text>{money(totals.total)}</Text>
          </View>
        </View>
      </View>
      {hasBank && (
        <View style={{ ...s.payment, backgroundColor: main }} wrap={false}>
          <Text style={s.paymentTitle}>PAYMENT DETAILS</Text>
          {issuer.bank && (
            <Text>
              Bank Name: <Text style={s.strong}>{issuer.bank}</Text>
            </Text>
          )}
          {issuer.accountNumber && (
            <Text>
              Account No: <Text style={s.strong}>{issuer.accountNumber}</Text>
            </Text>
          )}
          {issuer.accountName && (
            <Text>
              Account Holder: <Text style={s.strong}>{issuer.accountName}</Text>
            </Text>
          )}
          {issuer.branch && (
            <Text>
              Branch Code: <Text style={s.strong}>{issuer.branch}</Text>
            </Text>
          )}
          <Text>
            Reference: <Text style={s.strong}>{doc.number || "Draft"}</Text>
          </Text>
        </View>
      )}
      {/* Executive omits the terms line (e.g. “Payment within 30 days.”). */}
      {doc.notes && (
        <View style={s.notes}>
          <Text>{doc.notes}</Text>
        </View>
      )}
    </Page>
  );
}
