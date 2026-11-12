import Link from "next/link";
import { Building2, Users, FileText, Download } from "lucide-react";
import { PageHeading } from "@/components/ui";
import { backend } from "@/data/store";
export default function Page() {
  return (
    <>
      <PageHeading
        eyebrow="A LITTLE GUIDANCE"
        title="Good documents start here"
        description="A simple workflow for the businesses Africonnect supports."
      />
      <div className="help-grid">
        {[
          [
            Building2,
            "01",
            "Choose the issuing business",
            "Open a client business from the overview. Its identity, banking details and document defaults will be used. Choose its document template in its settings; the Templates page previews every design.",
          ],
          [
            Users,
            "02",
            "Add its customers and services",
            "Customers receive documents. Your service catalogue makes the next document quicker to create.",
          ],
          [
            FileText,
            "03",
            "Create, review and issue",
            "Save a draft while you work; it has no official number. Issuing assigns the next number. Editing an issued invoice or quotation creates a linked draft revision, leaving the original unchanged. Issue the revision when ready to assign its new number.",
          ],
          [
            Download,
            "04",
            "Download and share",
            "Export an A4 PDF. An issued quotation can become a linked invoice draft, ready for review.",
          ],
        ].map(([Icon, n, title, description]) => {
          const I = Icon as typeof Building2;
          return (
            <section className="card help-step" key={String(n)}>
              <I size={25} />
              <span className="eyebrow">STEP {String(n)}</span>
              <h2>{String(title)}</h2>
              <p>{String(description)}</p>
            </section>
          );
        })}
      </div>
      <section className="card help-details">
        {backend === "local" ? (
          <>
            <h2>About this demo workspace</h2>
            <p>
              This prototype is for Africonnect employees to evaluate the
              invoicing workflow. All seeded business, customer, contact and
              banking details are fictional.
            </p>
            <h3>Where your work lives</h3>
            <p>
              Saved records and uploaded logos stay in this browser’s local
              storage. Your demo session lasts in this tab; logging out does not
              delete business records. Clearing browser data will remove saved
              work. This version does not sync between devices or support
              simultaneous employee collaboration.
            </p>
            <h3>Demo access</h3>
            <p>
              Email: <strong>user@africonnectsolutions.co.za</strong>
              <br />
              Password: <strong>User@2026</strong>
            </p>
            <p>
              Demo access is not secure production authentication. Use fictional
              information only. No emails are sent, no payments are processed,
              and issued invoice totals do not mean money received.
            </p>
          </>
        ) : (
          <>
            <h2>About this workspace</h2>
            <p>
              Africonnect employees use this workspace to prepare quotations and
              invoices for the client businesses they support.
            </p>
            <h3>Where your work lives</h3>
            <p>
              Records are saved in Africonnect’s shared database, so every
              employee who signs in sees the same businesses, customers and
              documents. Businesses are archived, never deleted. Customers and
              items can be deleted, except customers used on an invoice or
              quotation. Issued invoices and quotations are never changed:
              editing one creates a draft revision that gets a new number when
              issued. Business logos can be opened by anyone who has their link,
              because they are printed on documents.
            </p>
            <p>
              If you leave this tab and come back after a while, it reloads the
              latest records. If another employee changed a draft you are
              editing, you will be asked to refresh before saving.
            </p>
            <h3>Access</h3>
            <p>
              Accounts are set up by an Africonnect administrator, who can also
              reset a forgotten password. No emails are sent, no payments are
              processed, and issued invoice totals do not mean money received.
            </p>
          </>
        )}
        <h3>Made for the Africonnect ecosystem</h3>
        <p>
          <a
            href="https://africonnectsolutions.co.za"
            target="_blank"
            rel="noreferrer"
          >
            Africonnect website ↗
          </a>{" "}
          ·{" "}
          <a
            href="https://pos.africonnectsolutions.co.za"
            target="_blank"
            rel="noreferrer"
          >
            Existing POS ↗
          </a>
        </p>
        <p>These are separate applications with separate sign-ins.</p>
        <Link href="/overview" className="btn primary">
          Return to overview
        </Link>
      </section>
    </>
  );
}
