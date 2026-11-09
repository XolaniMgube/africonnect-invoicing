/**
 * End-to-end checks against a real Supabase backend. Skipped unless
 * E2E_SUPABASE=1. Point it at a local stack (`npm run db:start`) or a test
 * project, never production: it creates records, and records cannot be
 * deleted. See README → "Testing against Supabase".
 */
import { test, expect, type Browser, type Page } from "@playwright/test";
import fs from "node:fs/promises";

test.skip(
  process.env.E2E_SUPABASE !== "1",
  "Set E2E_SUPABASE=1 to run against a Supabase-backed build.",
);

const employee = {
  email: process.env.E2E_EMAIL || "user@africonnectsolutions.co.za",
  password: process.env.E2E_PASSWORD || "User@2026",
};
const outsider = {
  email: process.env.E2E_OUTSIDER_EMAIL,
  password: process.env.E2E_OUTSIDER_PASSWORD,
};

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function login(page: Page) {
  await signIn(page, employee.email, employee.password);
  await expect(
    page.getByRole("heading", { name: "Workspace overview" }),
  ).toBeVisible();
}

async function secondEmployee(browser: Browser) {
  const page = await (await browser.newContext()).newPage();
  await login(page);
  return page;
}

/** A business with one customer and one catalogue item; returns its id. */
async function createBusiness(page: Page, name: string) {
  await page.getByRole("button", { name: "Add business", exact: true }).click();
  await page.getByLabel("Trading / company name").fill(name);
  await page.getByLabel("Contact email").fill("hello@e2e.example");
  await page
    .getByLabel("Business address", { exact: true })
    .fill("1 Example Street");
  await page
    .getByLabel("Upload business logo")
    .setInputFiles("public/demo-gz.png");
  await expect(
    page.getByRole("dialog").locator(".business-mark img"),
  ).toHaveAttribute("src", /\/storage\/v1\/object\/public\/business-logos\//);
  await page
    .getByRole("button", { name: "Save business", exact: true })
    .click();
  await expect(page).toHaveURL(/\/businesses\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").pop()!;
  await page.goto(`/businesses/${id}/customers`);
  await page
    .getByRole("button", { name: "Add customer", exact: true })
    .first()
    .click();
  await page.getByLabel("Person / company name").fill("E2E Customer");
  await page.getByRole("button", { name: "Save customer" }).click();
  await expect(page.locator("tbody:visible")).toContainText("E2E Customer");
  await page.goto(`/businesses/${id}/items`);
  await page
    .getByRole("button", { name: "Add item", exact: true })
    .first()
    .click();
  await page.getByLabel("Item / service name").fill("E2E Service");
  await page.getByLabel("Default unit price (R)").fill("1000");
  await page.getByRole("button", { name: "Save item" }).click();
  await expect(page.locator("tbody:visible")).toContainText("E2E Service");
  return id;
}

async function draft(page: Page, businessId: string, kind: string) {
  await page.goto(`/businesses/${businessId}/documents/new?kind=${kind}`);
  const customer = page.getByRole("combobox", {
    name: "Customer",
    exact: true,
  });
  await customer.click();
  await page.getByRole("option", { name: /E2E Customer/ }).click();
  await expect(customer).toHaveValue("E2E Customer");
  await page.getByRole("button", { name: "From catalogue" }).click();
  await page.getByRole("button", { name: /E2E Service/ }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
  return page.url();
}

test("sign-in refuses wrong passwords and non-employees; employees sign in and out", async ({
  page,
}) => {
  await page.goto("/overview");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText("Try the demo")).toHaveCount(0);
  await signIn(page, employee.email, "not-the-password");
  await expect(page.locator(".form-error")).toContainText("incorrect");
  if (outsider.email && outsider.password) {
    await signIn(page, outsider.email, outsider.password);
    await expect(page.locator(".form-error")).toContainText(
      "isn’t set up for Africonnect Invoicing",
    );
    await page.goto("/overview");
    await expect(page).toHaveURL(/\/login/);
  }
  await login(page);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Workspace overview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/businesses");
  await expect(page).toHaveURL(/\/login/);
});

test("shared records: logo upload, numbering by the database, issue, editing an issued invoice, PDF", async ({
  page,
  browser,
}) => {
  await login(page);
  const name = `E2E Supabase ${Date.now()}`;
  const businessId = await createBusiness(page, name);
  const url = await draft(page, businessId, "invoice");
  await expect(
    page.getByRole("heading", { name: "INV-0001", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Issue invoice", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm & issue" }).click();
  await expect(
    page.getByText("Issued and preserved", { exact: true }),
  ).toBeVisible();

  // Another employee, in another browser, sees the same issued invoice.
  const other = await secondEmployee(browser);
  await other.goto(url);
  await expect(
    other.getByText("Issued and preserved", { exact: true }),
  ).toBeVisible();
  await expect(other.locator(".document-paper:visible")).toContainText(name);

  // The issued invoice can be edited; it keeps its number and stays issued.
  const quantity = (p: Page) =>
    p.getByLabel("Quantity", { exact: true }).filter({ visible: true });
  await page.getByRole("button", { name: "Edit invoice" }).click();
  await quantity(page).fill("3");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("INV-0001 updated")).toBeVisible();
  await expect(
    page.getByText("Issued and preserved", { exact: true }),
  ).toBeVisible();
  // An employee still looking at the old version cannot overwrite the edit.
  await other.getByRole("button", { name: "Edit invoice" }).click();
  await quantity(other).fill("4");
  await other.getByRole("button", { name: "Save changes" }).click();
  await expect(other.locator(".toast.error")).toContainText(
    "Another employee changed this document",
  );
  await other.reload();
  await other.getByRole("button", { name: "Edit invoice" }).click();
  await expect(quantity(other)).toHaveValue("3");

  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  const data = await fs.readFile((await (await event).path())!);
  expect(data.subarray(0, 4).toString()).toBe("%PDF");
  // The uploaded logo is embedded as an image.
  expect(data.toString("latin1")).toMatch(/\/Subtype \/Image/);

  // The next invoice gets the next number.
  await draft(page, businessId, "invoice");
  await expect(
    page.getByRole("heading", { name: "INV-0002", exact: true }),
  ).toBeVisible();

  // A typed number is kept, and the database continues from it.
  await page.goto(`/businesses/${businessId}/documents/new?kind=invoice`);
  const number = page
    .getByLabel("Invoice number", { exact: true })
    .filter({ visible: true });
  await expect(number).toHaveValue("INV-0003");
  await number.fill("0500");
  await page.getByRole("combobox", { name: "Customer", exact: true }).click();
  await page.getByRole("option", { name: /E2E Customer/ }).click();
  await page.getByRole("button", { name: "From catalogue" }).click();
  await page.getByRole("button", { name: /E2E Service/ }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "0500", exact: true }),
  ).toBeVisible();
  await draft(page, businessId, "invoice");
  await expect(
    page.getByRole("heading", { name: "INV-0501", exact: true }),
  ).toBeVisible();
});

test("a quotation converts once, even when two employees convert it together", async ({
  page,
  browser,
}) => {
  await login(page);
  const businessId = await createBusiness(page, `E2E Convert ${Date.now()}`);
  const quoteUrl = await draft(page, businessId, "quotation");
  await page
    .getByRole("button", { name: "Issue quotation", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm & issue" }).click();
  await expect(
    page.getByText("Issued and preserved", { exact: true }),
  ).toBeVisible();

  const other = await secondEmployee(browser);
  await other.goto(quoteUrl);
  await expect(
    other.getByRole("button", { name: "Convert to invoice" }),
  ).toBeVisible();
  await Promise.all([
    page.getByRole("button", { name: "Convert to invoice" }).click(),
    other.getByRole("button", { name: "Convert to invoice" }).click(),
  ]);
  await expect(page).not.toHaveURL(quoteUrl);
  await expect(other).not.toHaveURL(quoteUrl);
  expect(other.url()).toBe(page.url());
  await expect(
    page.getByText("Created from quotation", { exact: false }).first(),
  ).toBeVisible();
});

test("a draft changed by another employee is not silently overwritten", async ({
  page,
  browser,
}) => {
  await login(page);
  const businessId = await createBusiness(page, `E2E Conflict ${Date.now()}`);
  const url = await draft(page, businessId, "invoice");
  const other = await secondEmployee(browser);
  await other.goto(url);
  await expect(other.getByLabel("Quantity", { exact: true })).toHaveValue("1");

  await page.getByLabel("Quantity", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();

  await other.getByLabel("Quantity", { exact: true }).fill("5");
  await other.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(other.locator(".toast.error")).toContainText(
    "Another employee saved changes to this draft",
  );
  await other.reload();
  await expect(other.getByLabel("Quantity", { exact: true })).toHaveValue("2");
});
