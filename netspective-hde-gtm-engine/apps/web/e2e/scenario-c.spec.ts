import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Scenario C in a browser (feature 006, task T071): a visitor downloads the CCDA-to-FHIR Mapping Decision
// Register from the hosted page, and the follow-up recommendation is then waiting for a person. Nothing is
// sent. The operator step reads the API with the operator's token, the same calls the inbox screen makes
// (signing in through an identity provider is outside this test).
const API = "http://127.0.0.1:3999/api/v1";
const SLUG = "ccda-to-fhir-mapping-decision-register";
/** Open the hosted page and wait until the page is interactive, so what is typed is not wiped by hydration. */
async function openForm(page: Page) {
  await page.goto(`/public/offers/${SLUG}`);
  await page.waitForLoadState("networkidle");
}
const operatorToken = () =>
  readFileSync(join(import.meta.dirname, ".runtime", "operator-token.txt"), "utf8").trim();

test("a visitor downloads the register and a follow-up waits for a person", async ({
  page,
  request,
}) => {
  await page.goto(`/public/offers/${SLUG}`);
  await expect(
    page.getByRole("heading", { name: "CCDA-to-FHIR Mapping Decision Register" }),
  ).toBeVisible();
  await expect(page.getByText("We use your details to send the register")).toBeVisible();
  const consent = page.getByRole("checkbox");
  await expect(consent).not.toBeChecked();

  // The form refuses an answer that comes too fast (a bot); a person takes longer than the minimum time.
  await page.getByLabel("Work email").fill("alex.interop@northvale-hie.example");
  await page.getByLabel("Your role").fill("Director of Interoperability");
  await page
    .getByLabel("Organisation", { exact: true })
    .fill("Northvale Health Information Exchange");
  await page.getByLabel("Organisation type").selectOption("health_information_exchange");
  await consent.check();
  await page.waitForTimeout(3500);
  await page.getByRole("button", { name: "Download the register" }).click();

  await expect(page.getByRole("status")).toContainText("received your request");
  const link = page.getByRole("link", { name: "Download the register" });
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/api\/public\/downloads\//);
  const file = await request.get(href as string);
  expect(file.status()).toBe(200);
  expect(await file.text()).toBe("synthetic register");

  // The operator's view: the request is in the inbox and an Offer 1 follow-up is waiting for review.
  const headers = { authorization: `Bearer ${operatorToken()}` };
  const requests = await (
    await request.get(`${API}/offer-requests?kind=download`, { headers })
  ).json();
  expect(requests.items).toHaveLength(1);
  expect(requests.items[0]).toMatchObject({
    state: "received",
    orgName: "Northvale Health Information Exchange",
  });
  const queue = await (
    await request.get(`${API}/offer-recommendations?state=pending`, { headers })
  ).json();
  expect(queue.items).toHaveLength(1);
  expect(queue.items[0]).toMatchObject({
    trigger: "offer5_download",
    outcome: "offer",
    outreach: "allowed",
    offerKey: "sender-onboarding-friction-map",
    reviewState: "pending",
  });
});

test("a form sent straight away is refused with a plain message and creates nothing", async ({
  page,
  request,
}) => {
  await openForm(page);
  await page.getByLabel("Work email").fill("bot@spam.example");
  await page.getByLabel("Your role").fill("Bot");
  await page.getByLabel("Organisation", { exact: true }).fill("Spam Co");
  await page.getByLabel("Organisation type").selectOption("health_system");
  await page.getByRole("button", { name: "Download the register" }).click();
  await expect(page.locator("main p[role=alert]")).toContainText("could not be accepted");
  const headers = { authorization: `Bearer ${operatorToken()}` };
  const requests = await (await request.get(`${API}/offer-requests`, { headers })).json();
  expect(requests.items.filter((r: { orgName: string }) => r.orgName === "Spam Co")).toHaveLength(
    0,
  );
});
