import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import { createFixtures } from "../src/data/fixtures";
// These tests use the fictional fixtures of the browser-only demo backend.
test.skip(
  process.env.E2E_SUPABASE === "1",
  "Runs against the browser-only demo (NEXT_PUBLIC_DATA_BACKEND=local).",
);
async function login(page: Page) {
  await page.goto("/login");
  await page
    .getByLabel("Email address")
    .fill("user@africonnectsolutions.co.za");
  await page.getByLabel("Password", { exact: true }).fill("User@2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Workspace overview" }),
  ).toBeVisible();
}
async function storage(page: Page) {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem("africonnect-invoicing:v1") || "{}"),
  );
}
/** Opens the customer dropdown, searches it and picks the customer. */
async function pickCustomer(page: Page, name: string) {
  const customer = page.getByRole("combobox", {
    name: "Customer",
    exact: true,
  });
  await customer.click();
  await customer.fill(name);
  await page.getByRole("option", { name: new RegExp(name) }).click();
  await expect(customer).toHaveValue(name);
}
test("login validation, protected direct routes, filters, session refresh and logout", async ({
  page,
}) => {
  await page.goto("/businesses/glen/customers");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email address").fill("wrong@example.com");
  await page.getByLabel("Password", { exact: true }).fill("wrong");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page
      .locator("[role=alert]:visible")
      .filter({ hasText: /incorrect|not saved|not been changed/ }),
  ).toContainText("incorrect");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await page
    .getByLabel("Email address")
    .fill("user@africonnectsolutions.co.za");
  await page.getByLabel("Password", { exact: true }).fill("User@2026");
  await page.getByLabel("Password", { exact: true }).press("Enter");
  await expect(
    page.getByRole("heading", { name: "Workspace overview" }),
  ).toBeVisible();
  // The overview has no document table; each business lists its own.
  await expect(
    page.getByRole("heading", { name: "All documents" }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Workspace overview" }),
  ).toBeVisible();
  await page.goto("/businesses/green");
  await page.getByLabel("Filter by status").selectOption("issued");
  await expect(page.locator("tbody:visible tr")).toHaveCount(2);
  await expect(page.locator("tbody:visible")).not.toContainText("Glen Zamba");
  await page.getByRole("tab", { name: /Quotations/ }).click();
  await expect(page.locator("tbody:visible tr")).toHaveCount(1);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/documents/glen-doc-0");
  await expect(page).toHaveURL(/\/login/);
});
test("business creation, editing, customers, catalogue, context switch and archive restoration", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "Add business", exact: true }).click();
  await page.getByLabel("Trading / company name").fill("Test Plumbing Co");
  await page.getByLabel("Contact email").fill("hello@plumbing.example");
  await page
    .getByLabel("Business address", { exact: true })
    .fill("1 Example Street");
  await page
    .getByRole("button", { name: "Save business", exact: true })
    .click();
  // Saving a new business opens its workspace so customers can be added next.
  await expect(page).toHaveURL(/\/businesses\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { name: "Test Plumbing Co" }),
  ).toBeVisible();
  await expect(page.locator(".context-bar")).toContainText(
    "Working on: Test Plumbing Co",
  );
  const businessId = page.url().split("/").pop()!;
  await page
    .getByRole("link", { name: "Business settings", exact: true })
    .last()
    .click();
  await page.getByLabel("Phone", { exact: true }).fill("+27 00 000 0300");
  await page
    .getByRole("button", { name: "Save business", exact: true })
    .click();
  await page.getByRole("link", { name: "Customers", exact: true }).click();
  await page
    .getByRole("button", { name: "Add customer", exact: true })
    .first()
    .click();
  await page.getByLabel("Person / company name").fill("Test Recipient");
  await page.getByLabel("Email", { exact: true }).fill("recipient@example.com");
  await page.getByLabel("Billing address").fill("42 Sample Street");
  await page.getByRole("button", { name: "Save customer" }).click();
  await expect(page.locator("tbody:visible")).toContainText("Test Recipient");
  await page
    .getByRole("link", { name: "Items & services", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add item", exact: true })
    .first()
    .click();
  await page.getByLabel("Item / service name").fill("Leak repair");
  await page.getByLabel("Category", { exact: true }).fill("Repairs");
  await page.getByLabel("Default unit price (R)").fill("950");
  await page.getByRole("button", { name: "Save item" }).click();
  await expect(page.locator("tbody:visible")).toContainText("Leak repair");
  await page.getByRole("button", { name: "Switch business" }).click();
  await page.getByPlaceholder("Find a client business…").fill("Greenleaf");
  await page.getByRole("dialog").getByRole("link").click();
  await expect(page).toHaveURL(/businesses\/green$/);
  await page.getByRole("link", { name: "Customers", exact: true }).click();
  await expect(page.locator("tbody:visible")).not.toContainText(
    "Test Recipient",
  );
  await page.goto("/businesses");
  await page.getByRole("button", { name: "Archive Test Plumbing Co" }).click();
  await page
    .getByRole("button", { name: "Archive business", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Test Plumbing Co" }),
  ).toHaveCount(0);
  await page.getByLabel("Business status").selectOption("archived");
  await page.getByRole("button", { name: "Restore Test Plumbing Co" }).click();
  await page
    .getByRole("button", { name: "Restore business", exact: true })
    .click();
  await page.goto(`/businesses/${businessId}/customers`);
  await expect(page.locator("tbody:visible")).toContainText("Test Recipient");
  await page.reload();
  await expect(page.locator("tbody:visible")).toContainText("Test Recipient");
  // A positive VAT rate is allowed without a registration number.
  await page.goto(`/businesses/${businessId}/settings`);
  await page.getByLabel("Default VAT rate (%)").fill("15");
  await page
    .getByRole("button", { name: "Save business", exact: true })
    .click();
  await expect(page.getByText("Business profile saved.")).toBeVisible();
  expect(
    (await storage(page)).businesses.find(
      (b: { id: string }) => b.id === businessId,
    ).taxRate,
  ).toBe(15);
  await page.reload();
  await expect(page.getByLabel("VAT registration number")).toHaveValue("");
  await expect(page.getByLabel("Default VAT rate (%)")).toHaveValue("15");
});
test("invoice draft, scoped selectors, calculations, persistence, unsaved warning, issue and immutable snapshot", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "Create document" }).click();
  await page.getByLabel("Issuing client business").selectOption("glen");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  // The customer dropdown lists this business's customers and searches them.
  const customer = page.getByRole("combobox", {
    name: "Customer",
    exact: true,
  });
  await customer.click();
  await expect(page.getByRole("option")).toHaveCount(2);
  await customer.fill("eastwood");
  await expect(page.getByRole("option")).toHaveCount(1);
  await customer.fill("no such customer");
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(page.getByRole("listbox")).toContainText("No customers match");
  await customer.fill("mahlangu");
  await customer.press("Enter");
  await expect(customer).toHaveValue("Mahlangu Property Group");
  await expect(page.locator(".customer-summary:visible")).toContainText(
    "Mahlangu Property Group",
  );
  await page.getByRole("button", { name: "From catalogue" }).click();
  await expect(page.getByRole("dialog")).not.toContainText(
    "Garden maintenance",
  );
  await page.getByRole("button", { name: /Site preparation/ }).click();
  await page.getByLabel("Quantity", { exact: true }).fill("2");
  await page.getByLabel("Unit price (R)").fill("100.25");
  await expect(page.locator(".summary-total:visible")).toContainText("230,58");
  // Lines have no description box; the item total and unit price fill each other.
  await expect(page.getByLabel("Description", { exact: true })).toHaveCount(0);
  const unitPrice = page.getByLabel("Unit price (R)");
  const itemTotal = page.getByLabel("Item total (R)");
  await expect(itemTotal).toHaveValue("200.5");
  await itemTotal.fill("301");
  await expect(unitPrice).toHaveValue("150.5");
  // The typed total stays fixed when the quantity changes, even when it
  // does not divide into whole cents.
  await page.getByLabel("Quantity", { exact: true }).fill("3");
  await expect(unitPrice).toHaveValue("100.33");
  await expect(itemTotal).toHaveValue("301");
  await expect(page.locator(".summary-total:visible")).toContainText("346,15");
  // Typing a unit price makes it the fixed one again.
  await unitPrice.fill("100.25");
  await page.getByLabel("Quantity", { exact: true }).fill("2");
  await expect(itemTotal).toHaveValue("200.5");
  await expect(page.locator(".summary-total:visible")).toContainText("230,58");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page).toHaveURL(/documents\/new/);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
  const url = page.url();
  await page.reload();
  await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("2");
  await page.getByLabel("Quantity", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page
    .getByRole("button", { name: "Issue invoice", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm & issue" }).click();
  await expect(
    page.getByText("Issued and preserved", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toHaveCount(0);
  const before = await storage(page);
  const saved = before.documents.find((d: { id: string }) =>
    url.endsWith(d.id),
  );
  await page.goto("/businesses/glen/settings");
  await page
    .getByLabel("Trading / company name")
    .fill("Updated Construction Identity");
  await page.getByLabel("Bank name", { exact: true }).fill("Changed Demo Bank");
  await page
    .getByRole("button", { name: "Save business", exact: true })
    .click();
  await page.goto(url);
  await expect(page.locator(".document-paper:visible")).toContainText(
    "Glen Zamba Construction",
  );
  await expect(page.locator(".document-paper:visible")).not.toContainText(
    "Changed Demo Bank",
  );
  const after = await storage(page);
  expect(
    after.documents.find((d: { id: string }) => url.endsWith(d.id)),
  ).toEqual(saved);
  await page.getByRole("button", { name: "Log out" }).click();
  await login(page);
  await page.goto(url);
  await expect(
    page.getByText("Issued and preserved", { exact: true }),
  ).toBeVisible();
});
test("quotation creation, preview, issue, linked conversion and duplicate prevention", async ({
  page,
}) => {
  await login(page);
  await page.goto("/businesses/green/documents/new?kind=quotation");
  await pickCustomer(page, "Willow Ridge Estate");
  await page.getByRole("button", { name: "Add custom line" }).click();
  await page.getByLabel("Line 1 name").fill("Seasonal planting");
  await page.getByLabel("Unit price (R)").fill("500");
  await page.getByLabel("Quantity", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByRole("dialog").locator(".paper-title")).toContainText(
    "QUOTATION",
  );
  await expect(page.getByRole("dialog")).toContainText("No VAT charged.");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", { name: "Issue quotation", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm & issue" }).click();
  // The previous route stays mounted (hidden), so match the visible copy.
  await expect(
    page
      .getByText("Issued and preserved", { exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
  const quoteUrl = page.url();
  await page.getByRole("button", { name: "Convert to invoice" }).click();
  await expect(
    page.getByLabel("Invoice date", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Created from quotation", { exact: false }).first(),
  ).toBeVisible();
  await expect(page).not.toHaveURL(quoteUrl);
  const invoiceUrl = page.url();
  const count = (await storage(page)).documents.length;
  await page.goto(quoteUrl);
  await page.getByRole("link", { name: "Open linked invoice" }).click();
  await expect(page).toHaveURL(invoiceUrl);
  expect((await storage(page)).documents.length).toBe(count);
});
test("empty business: inline customer, business-switch warning and a fresh editor after saving", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("link", { name: /Moya Event Styling/ })
    .first()
    .click();
  await expect(page.locator(".context-bar")).toContainText(
    "Working on: Moya Event Styling",
  );
  await expect(page.getByText("No invoices found")).toBeVisible();
  await page.getByRole("button", { name: "Create document" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Document type")
    .selectOption("quotation");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/moya\/documents\/new\?kind=quotation/);
  await expect(page.getByText("has no customers yet")).toBeVisible();
  await page.getByRole("button", { name: "Add a new customer" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Person / company name").fill("Lindiwe Events Trust");
  await dialog
    .getByLabel("Email", { exact: true })
    .fill("events@lindiwe.example");
  await dialog
    .getByLabel("Billing address")
    .fill("7 Sample Lane\nDurban, 0000");
  await dialog.getByRole("button", { name: "Save customer" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".customer-summary:visible")).toContainText(
    "Lindiwe Events Trust",
  );
  await page.getByRole("button", { name: "Add custom line" }).click();
  await page.getByLabel("Line 1 name").fill("Table styling");
  await page.getByLabel("Quantity", { exact: true }).fill("12");
  await page.getByLabel("Unit price (R)").fill("185.5");
  await expect(page.locator(".summary-total:visible")).toContainText("226,00");
  // Switching business with unsaved work asks first; dismissing keeps the draft.
  await page.getByRole("button", { name: "Switch business" }).click();
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("dialog")
    .getByRole("link", { name: /Glen Zamba/ })
    .click();
  await expect(page).toHaveURL(/moya\/documents\/new/);
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Line 1 name")).toHaveValue("Table styling");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { name: "Draft quotation" }),
  ).toBeVisible();
  // The new customer belongs to Moya only.
  const data = await storage(page);
  const created = data.customers.find(
    (c: { name: string }) => c.name === "Lindiwe Events Trust",
  );
  expect(created.businessId).toBe("moya");
  // Starting another quotation opens a blank editor, not the saved one.
  await page.getByRole("link", { name: "Business documents" }).click();
  await page.getByRole("tab", { name: /Quotations/ }).click();
  await expect(page.locator("tbody:visible")).toContainText("Unnumbered draft");
  await page.getByRole("button", { name: "Create document" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Document type")
    .selectOption("quotation");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Draft quotation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Customer", exact: true }),
  ).toHaveValue("");
  await page.goto("/businesses/glen/documents/new?kind=invoice");
  await page.getByRole("combobox", { name: "Customer", exact: true }).click();
  await expect(page.getByRole("option")).toHaveCount(2);
  await expect(page.getByRole("option", { name: /Lindiwe/ })).toHaveCount(0);
});
test("issued invoices and quotations create linked, unnumbered draft revisions", async ({
  page,
}) => {
  await login(page);
  for (const [kind, id, next] of [
    ["invoice", "green-doc-0", "GG-INV-0004"],
    ["quotation", "green-doc-3", "GG-QUO-0002"],
  ]) {
    const original = (
      (await storage(page)).documents || createFixtures().documents
    ).find((d: { id: string }) => d.id === id);
    await page.goto(`/documents/${id}`);
    await page
      .getByRole("button", { name: `Edit ${kind}`, exact: true })
      .click();
    await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
    const revisionUrl = page.url();
    await expect(
      page.getByRole("heading", { name: `Draft ${kind}`, exact: true }),
    ).toBeVisible();
    await page.getByLabel("Quantity", { exact: true }).first().fill("10");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(
      page.getByLabel("Quantity", { exact: true }).first(),
    ).toHaveValue("10");
    const draft = (await storage(page)).documents.find((d: { id: string }) =>
      revisionUrl.endsWith(d.id),
    );
    expect(draft.number).toBe("");
    expect(draft.revisionOfId).toBe(id);
    expect(
      (await storage(page)).documents.find((d: { id: string }) => d.id === id),
    ).toEqual(original);
    // Reopening Edit resumes the existing draft instead of creating another.
    await page.goto(`/documents/${id}`);
    await page
      .getByRole("button", { name: `Edit ${kind}`, exact: true })
      .click();
    await expect(page).toHaveURL(revisionUrl);
    await page
      .getByRole("button", { name: `Issue ${kind}`, exact: true })
      .click();
    await page.getByRole("button", { name: "Confirm & issue" }).click();
    await expect(
      page.getByRole("heading", { name: next, exact: true }),
    ).toBeVisible();
    await page.reload();
    expect(
      (await storage(page)).documents.find((d: { id: string }) => d.id === id),
    ).toEqual(original);
    await page
      .getByRole("link", { name: original.number, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: original.number, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: next, exact: true }),
    ).toBeVisible();
  }
});
test("drafts without prefixes receive numbers only when issued", async ({
  page,
}) => {
  await login(page);
  await page.goto("/businesses/glen/settings");
  await page.getByLabel("Invoice prefix").fill("");
  await page.getByLabel("Quotation prefix").fill("");
  await page
    .getByRole("button", { name: "Save business", exact: true })
    .click();
  await expect(page.getByText("Business profile saved.")).toBeVisible();
  for (let i = 0; i < 2; i++) {
    await page.goto("/businesses/glen/documents/new?kind=invoice");
    await expect(
      page.getByLabel("Invoice number", { exact: true }),
    ).toHaveValue("0004");
    await pickCustomer(page, "Mahlangu Property Group");
    await page.getByRole("button", { name: "Add custom line" }).click();
    await page.getByLabel("Line 1 name").fill("Work");
    await page.getByLabel("Unit price (R)").fill("100");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
    await expect(
      page.getByRole("heading", { name: "Draft invoice", exact: true }),
    ).toBeVisible();
  }
  await page
    .getByRole("button", { name: "Issue invoice", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm & issue" }).click();
  await expect(
    page.getByRole("heading", { name: "0004", exact: true }),
  ).toBeVisible();
});
test("short and multipage PDF downloads contain real PDF data", async ({
  page,
}) => {
  await login(page);
  for (const id of ["green-doc-0", "glen-doc-2"]) {
    await page.goto(`/documents/${id}`);
    const event = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download PDF", exact: true })
      .click();
    const download = await event;
    const path = await download.path();
    const data = await fs.readFile(path!);
    expect(data.subarray(0, 4).toString()).toBe("%PDF");
    expect(data.length).toBeGreaterThan(2000);
    const pages = [...data.toString("latin1").matchAll(/\/Type \/Page\b/g)]
      .length;
    if (id === "glen-doc-2") expect(pages).toBeGreaterThan(1);
    else expect(pages).toBe(1);
    await download.saveAs(`test-results/${id}.pdf`);
  }
});
test("failed saves and malformed records preserve data; responsive layouts have no page overflow", async ({
  page,
}) => {
  await login(page);
  await page.goto("/businesses/glen/settings");
  await page.getByLabel("Trading / company name").fill("Cannot save this");
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
  });
  await page
    .getByRole("button", { name: "Save business", exact: true })
    .click();
  await expect(
    page
      .locator("[role=alert]:visible")
      .filter({ hasText: /incorrect|not saved|not been changed/ }),
  ).toContainText("not saved");
  await expect(
    page.getByText("You have unsaved changes", { exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByLabel("Trading / company name")).toHaveValue(
    "Glen Zamba Construction",
  );
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 950 });
    await page.goto("/overview");
    await expect(
      page.getByRole("heading", { name: "Workspace overview" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/overview-${width}.png`,
      fullPage: true,
    });
  }
  // Phone layouts: lists become cards and documents stack without page overflow.
  for (const path of [
    "/businesses/glen",
    "/businesses/glen/customers",
    "/businesses/glen/items",
    "/businesses/glen/documents/new?kind=invoice",
    "/documents/glen-doc-2",
  ]) {
    await page.goto(path);
    await expect(page.locator(".context-bar")).toContainText("Working on:");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/mobile-${path.replace(/[^a-z0-9]+/gi, "-")}.png`,
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.evaluate(() =>
    localStorage.setItem("africonnect-invoicing:v1", "{malformed"),
  );
  await page.reload();
  await expect(
    page
      .locator("[role=alert]:visible")
      .filter({ hasText: /incorrect|not saved|not been changed/ }),
  ).toContainText("not been changed");
  expect(
    await page.evaluate(() => localStorage.getItem("africonnect-invoicing:v1")),
  ).toBe("{malformed");
});

test("discounts balance on new and edited invoices/quotations, previews, PDFs and conversion", async ({
  page,
}) => {
  // Previous routes stay mounted (hidden), so match only the visible field.
  const discount = () =>
    page.getByRole("spinbutton", { name: "Discount amount (R)" });
  await login(page);
  for (const kind of ["invoice", "quotation"]) {
    await page.goto(`/businesses/glen/documents/new?kind=${kind}`);
    await pickCustomer(page, "Mahlangu Property Group");
    await page.getByRole("button", { name: "Add custom line" }).click();
    await page.getByLabel("Line 1 name").fill("Discounted project");
    await page.getByLabel("Unit price (R)").fill("1000");
    await discount().fill("100");
    await expect(page.locator(".summary-total:visible")).toContainText(
      "1 035,00",
    );
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
    const url = page.url();
    await page.reload();
    await expect(discount()).toHaveValue("100");
    await discount().fill("1001");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.locator(".form-error:visible")).toContainText(
      "cannot exceed the subtotal",
    );
    await discount().fill("200");
    await page
      .getByRole("button", { name: `Issue ${kind}`, exact: true })
      .click();
    await page.getByRole("button", { name: "Confirm & issue" }).click();
    await expect(
      page.locator(".document-paper:visible .paper-totals"),
    ).toContainText("920,00");
    const issuedUrl = page.url();
    await page
      .getByRole("button", { name: `Edit ${kind}`, exact: true })
      .click();
    // Editing an issued document opens a separate draft revision.
    await expect(page).not.toHaveURL(issuedUrl);
    await expect(
      page.getByRole("heading", { name: `Draft ${kind}`, exact: true }),
    ).toBeVisible();
    await discount().fill("250");
    await page
      .getByRole("button", { name: `Issue ${kind}`, exact: true })
      .click();
    await page.getByRole("button", { name: "Confirm & issue" }).click();
    const totals = page.locator(".document-paper:visible .paper-totals");
    await expect(totals).toContainText("Discount");
    await expect(totals).toContainText("250,00");
    await expect(totals).toContainText("112,50");
    await expect(totals).toContainText("862,50");
    const downloadEvent = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download PDF", exact: true })
      .click();
    await (await downloadEvent).saveAs(`test-results/discount-${kind}.pdf`);
    await page.reload();
    await expect(totals).toContainText("862,50");
    // The issued original keeps its own discount and total.
    await page.goto(issuedUrl);
    await expect(
      page.locator(".document-paper:visible .paper-totals"),
    ).toContainText("920,00");
    await page.goBack();
    await expect(totals).toContainText("862,50");
    if (kind === "quotation") {
      await page
        .getByRole("button", { name: "Convert to invoice", exact: true })
        .click();
      await expect(page).not.toHaveURL(url);
      await expect(discount()).toHaveValue("250");
      await expect(page.locator(".summary-total:visible")).toContainText(
        "862,50",
      );
    }
  }
});
test("customers and items can be deleted; customers used by documents are kept", async ({
  page,
}) => {
  await login(page);
  await page.goto("/businesses/glen/items");
  await expect(page.getByText("Include archived")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Archive / })).toHaveCount(0);
  await page.getByRole("button", { name: "Delete Site preparation" }).click();
  await expect(
    page.getByRole("dialog").getByText(/keep their lines unchanged/),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page.getByText("Item deleted.")).toBeVisible();
  await page.reload();
  await expect(page.locator("tbody:visible")).toContainText("Brickwork");
  await expect(page.locator("tbody:visible")).not.toContainText(
    "Site preparation",
  );
  // An issued invoice that used the item keeps its line.
  await page.goto("/documents/glen-doc-0");
  await expect(page.locator(".document-paper:visible")).toContainText(
    "Site preparation",
  );

  await page.goto("/businesses/glen/customers");
  await page
    .getByRole("button", { name: "Delete Mahlangu Property Group" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("can’t be deleted");
  await expect(
    dialog.getByRole("button", { name: "Delete", exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Add customer", exact: true })
    .first()
    .click();
  await page.getByLabel("Person / company name").fill("Short-lived Customer");
  await page.getByRole("button", { name: "Save customer" }).click();
  await expect(page.locator("tbody:visible")).toContainText(
    "Short-lived Customer",
  );
  await page
    .getByRole("button", { name: "Delete Short-lived Customer" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page.getByText("Customer deleted.")).toBeVisible();
  await page.reload();
  await expect(page.locator("tbody:visible")).toContainText(
    "Mahlangu Property Group",
  );
  await expect(page.locator("tbody:visible")).not.toContainText(
    "Short-lived Customer",
  );
  const saved = await storage(page);
  expect(
    saved.customers.some(
      (c: { name: string }) => c.name === "Short-lived Customer",
    ),
  ).toBe(false);
});
test("businesses choose a document template; issued documents keep theirs", async ({
  page,
}) => {
  await login(page);
  await page.goto("/businesses/glen/settings");
  await page.locator(".template-option", { hasText: "Executive" }).click();
  await expect(page.getByRole("radio", { name: /Executive/ })).toBeChecked();
  await page.getByLabel("Main colour").fill("#0f2340");
  await page.getByLabel("Signatory name").fill("T. Example");
  await page.getByLabel("Signatory title").fill("Director");
  await page.getByRole("button", { name: "Preview design" }).click();
  const sample = page.getByRole("dialog", { name: "Sample invoice" });
  await expect(sample.locator(".exec-paper")).toContainText("Invoice to :");
  await expect(sample.locator(".exec-paper")).toContainText(
    "Thank you for your service!",
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Save business", exact: true })
    .click();
  await expect(page.getByText("Business profile saved.")).toBeVisible();

  // A draft shows the business's current template.
  await page.goto("/documents/glen-doc-1");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const paper = page.getByRole("dialog").locator(".exec-paper");
  await expect(paper).toContainText("Invoice to :");
  await expect(paper).toContainText("CONTACT US");
  await expect(paper).toContainText("PAYMENT DETAILS");
  await expect(paper.locator(".exec-signature")).toContainText("Director");
  await paper.screenshot({ path: "test-results/executive-preview.png" });
  const download = page.waitForEvent("download");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Download PDF", exact: true })
    .click();
  const file = "test-results/executive-invoice.pdf";
  await (await download).saveAs(file);
  const pdf = await fs.readFile(file);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.includes("Poppins")).toBe(true);

  // An already-issued invoice keeps the Classic look it was issued with.
  await page.goto("/documents/glen-doc-0");
  await expect(page.locator(".document-paper:visible")).toBeVisible();
  await expect(page.locator(".exec-paper:visible")).toHaveCount(0);

  // Issuing the draft preserves Executive, even after switching back.
  await page.goto("/documents/glen-doc-1");
  await page
    .getByRole("button", { name: "Issue invoice", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm & issue" }).click();
  await expect(
    page.getByRole("button", { name: "Edit invoice" }),
  ).toBeVisible();
  const issuedUrl = page.url();
  await page.goto("/businesses/glen/settings");
  await page.locator(".template-option", { hasText: "Classic" }).click();
  await expect(page.getByRole("radio", { name: /Classic/ })).toBeChecked();
  await page
    .getByRole("button", { name: "Save business", exact: true })
    .click();
  await expect(page.getByText("Business profile saved.")).toBeVisible();
  await page.goto(issuedUrl);
  await expect(page.locator(".exec-paper:visible")).toContainText("Director");
  await page
    .locator(".exec-paper:visible")
    .screenshot({ path: "test-results/executive-issued.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".exec-paper:visible")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .locator(".exec-paper:visible")
    .screenshot({ path: "test-results/executive-phone.png" });
});
test("the Templates page previews each template with sample details", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("link", { name: "Templates", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/templates$/);
  await expect(page.getByRole("heading", { name: "Templates" })).toBeVisible();
  // Only the sample preview: no business list or business selector.
  await expect(page.getByLabel("Preview with")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Businesses" })).toHaveCount(
    0,
  );
  const preview = page.locator(".templates-preview .document-paper");
  await expect(preview).toContainText("Invoice to :");
  await expect(preview).toContainText("Sample Trading Co");
  await page.getByLabel("Document").selectOption("quotation");
  await expect(preview).toContainText("Quotation to :");
  await expect(preview).not.toContainText("PAYMENT DETAILS");
  await page
    .locator(".templates-preview")
    .screenshot({ path: "test-results/templates-page.png" });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download sample PDF" }).click();
  const file = "test-results/template-sample.pdf";
  await (await download).saveAs(file);
  expect((await fs.readFile(file)).subarray(0, 5).toString()).toBe("%PDF-");

  const classic = page.locator(".template-option", { hasText: "Classic" });
  await classic.click();
  await expect(preview).toContainText("PREPARED FOR");
  await expect(preview).toContainText("Sample Trading Co");
  await expect(classic).toContainText(/Used by [1-9]\d* businesses/);
  await expect(
    page.locator(".template-option", { hasText: "Executive" }),
  ).toContainText("Used by 0 businesses");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(preview).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/templates-phone.png",
    fullPage: true,
  });
});
