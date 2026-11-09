import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
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
  // Charging VAT requires the business's VAT registration number.
  await page.goto(`/businesses/${businessId}/settings`);
  await page.getByLabel("Default VAT rate (%)").fill("15");
  await page
    .getByRole("button", { name: "Save business", exact: true })
    .click();
  await expect(page.locator(".form-error:visible")).toContainText(
    "VAT registration number",
  );
  expect(
    (await storage(page)).businesses.find(
      (b: { id: string }) => b.id === businessId,
    ).taxRate,
  ).toBe(0);
  await page.getByLabel("VAT registration number").fill("DEMO-VAT-9999");
  await page
    .getByRole("button", { name: "Save business", exact: true })
    .click();
  await expect(page.getByText("Business profile saved.")).toBeVisible();
  expect(
    (await storage(page)).businesses.find(
      (b: { id: string }) => b.id === businessId,
    ).taxRate,
  ).toBe(15);
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
  await expect(
    page.getByText("Issued and preserved", { exact: true }),
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
    page.getByRole("heading", { name: "ME-QUO-0001" }),
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
  await expect(page.locator("tbody:visible")).toContainText("ME-QUO-0001");
  await page.getByRole("button", { name: "Create document" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Document type")
    .selectOption("quotation");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "New quotation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Customer", exact: true }),
  ).toHaveValue("");
  await page.goto("/businesses/glen/documents/new?kind=invoice");
  await page.getByRole("combobox", { name: "Customer", exact: true }).click();
  await expect(page.getByRole("option")).toHaveCount(2);
  await expect(page.getByRole("option", { name: /Lindiwe/ })).toHaveCount(0);
});
test("issued invoices and quotations can be edited and saved under the same number", async ({
  page,
}) => {
  await login(page);
  await page.goto("/documents/green-doc-0");
  await expect(
    page.getByRole("heading", { name: "GG-INV-0001", exact: true }),
  ).toBeVisible();
  const quantity = page
    .getByLabel("Quantity", { exact: true })
    .filter({ visible: true })
    .first();
  await expect(quantity).toHaveCount(0);
  await page.getByRole("button", { name: "Edit invoice" }).click();
  await quantity.fill("10");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText("Issued and preserved", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "GG-INV-0001", exact: true }),
  ).toBeVisible();
  const saved = (await storage(page)).documents.filter(
    (d: { businessId: string; number: string }) =>
      d.businessId === "green" && d.number === "GG-INV-0001",
  );
  expect(saved).toHaveLength(1);
  expect(saved[0].status).toBe("issued");
  expect(saved[0].lines[0].quantity).toBe(10);
  // Cancelling an edit discards it.
  await page.getByRole("button", { name: "Edit invoice" }).click();
  await quantity.fill("99");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit invoice" }),
  ).toBeVisible();
  const after = (await storage(page)).documents.find(
    (d: { id: string }) => d.id === "green-doc-0",
  );
  expect(after.lines[0].quantity).toBe(10);
  // Issued quotations can be edited the same way, beside "Convert to invoice".
  await page.goto("/documents/green-doc-3");
  await expect(
    page.getByRole("button", { name: "Convert to invoice" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit quotation" }).click();
  await quantity.fill("7");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/Quotation GG-QUO-0001 updated/)).toBeVisible();
  const quote = (await storage(page)).documents.find(
    (d: { id: string }) => d.id === "green-doc-3",
  );
  expect(quote.status).toBe("issued");
  expect(quote.number).toBe("GG-QUO-0001");
  expect(quote.lines[0].quantity).toBe(7);
});
test("businesses without prefixes, and invoices that continue from a chosen number", async ({
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
  await page.goto("/businesses/glen/documents/new?kind=invoice");
  const number = page
    .getByLabel("Invoice number", { exact: true })
    .filter({ visible: true });
  // Glen Zamba's invoices end at 0003; without a prefix the next is 0004.
  await expect(number).toHaveValue("0004");
  await number.fill("0123");
  await pickCustomer(page, "Mahlangu Property Group");
  await page.getByRole("button", { name: "Add custom line" }).click();
  await page.getByLabel("Line 1 name").fill("Existing work");
  await page.getByLabel("Unit price (R)").fill("100");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "0123", exact: true }),
  ).toBeVisible();
  // Another document cannot reuse the number; the next one follows on.
  await page.goto("/businesses/glen/documents/new?kind=invoice");
  await expect(number).toHaveValue("0124");
  await number.fill("0123");
  await pickCustomer(page, "Mahlangu Property Group");
  await page.getByRole("button", { name: "Add custom line" }).click();
  await page.getByLabel("Line 1 name").fill("Duplicate");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.locator(".form-error:visible")).toContainText(
    "Invoice number 0123 is already used",
  );
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
