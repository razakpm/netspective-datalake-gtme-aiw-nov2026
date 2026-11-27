import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// Feature 007 task T069 (quickstart V32): the visitor sends the Offer 1 intake from the hosted page in a
// browser; the operator and service lead steps (link, convert, book, hold, findings, page, approval,
// sharing) then run through the API with their tokens, because signing in through an identity provider is
// outside this test. The calendar and the PDF renderer are the fakes. Nothing is sent. Synthetic data only.
const API = "http://127.0.0.1:3999/api/v1";
const SLUG = "sender-onboarding-friction-map";
const token = (file: string) =>
  readFileSync(join(import.meta.dirname, ".runtime", file), "utf8").trim();
const findings = () => {
  const corpus = JSON.parse(
    readFileSync(
      join(import.meta.dirname, "../../../tests/fixtures/workshops/findings-cases.json"),
      "utf8",
    ),
  ) as { offer1: { id: string; content: unknown }[] };
  return corpus.offer1.find((c) => c.id === "offer1-complete")!.content;
};

test("an intake becomes a workshop with an approved one-page output", async ({ page, request }) => {
  await page.goto(`/public/offers/${SLUG}`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Work email").fill("sam.integration@northvale-hie.example");
  await page.getByLabel("Your role").fill("Integration Lead");
  await page
    .getByLabel("Organisation", { exact: true })
    .fill("Northvale Health Information Exchange");
  await page
    .getByRole("combobox", { name: /^Organisation type/ })
    .selectOption("health_information_exchange");
  await page
    .getByRole("combobox", { name: /^Organisation or program type/ })
    .selectOption("health_information_exchange");
  await page.getByLabel("Organisation name").fill("Northvale HIE");
  await page.getByLabel(/^One recent sender onboarding/).fill("Synthetic sender A");
  await page.getByLabel(/^Format and implementation guide/).fill("HL7 v2 results with the guide");
  await page.getByLabel(/^Timeline and stages/).fill("Registration, testing, review, production");
  await page.getByLabel(/^Roles who will attend/).fill("Integration lead");
  await page.getByRole("combobox", { name: /non-PHI specifications/ }).selectOption("yes");
  await page.getByRole("combobox", { name: /scrubbed rejection logs/ }).selectOption("unsure");
  await page.getByRole("checkbox").check();
  // The form refuses an answer that comes too fast.
  await page.waitForTimeout(3500);
  await page.getByRole("button", { name: "Send the intake" }).click();
  await expect(page.getByRole("status")).toContainText("received your request");

  const as = (file: string) => {
    const authorization = `Bearer ${token(file)}`;
    return (method: "get" | "post" | "put", path: string, data?: unknown) =>
      request[method](`${API}${path}`, {
        headers: { authorization, "idempotency-key": `e2e-${path}-${method}-${Date.now()}` },
        ...(data === undefined ? {} : { data }),
      });
  };
  const operator = as("operator-token.txt");
  const lead = as("lead-token.txt");
  const ok = async (response: Awaited<ReturnType<typeof operator>>) => {
    expect(response.ok(), `${response.url()} ${await response.text()}`).toBe(true);
    return response.json();
  };

  const inbox = await ok(await operator("get", "/offer-requests?kind=intake"));
  const requestId = inbox.items[0].id as string;
  await ok(await operator("post", `/offer-requests/${requestId}/review`, { action: "link" }));
  const workshop = await ok(await operator("post", "/workshops", { requestId }));
  const id = workshop.id as string;
  const at = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const booked = await ok(
    await operator("post", `/workshops/${id}/transition`, {
      action: "book",
      lockNo: 1,
      scheduledAt: at,
      via: "calendar",
    }),
  );
  expect(booked).toMatchObject({ state: "booked", bookingRoute: "calendar" });
  await ok(await operator("post", `/workshops/${id}/transition`, { action: "hold", lockNo: 2 }));
  await ok(await operator("put", `/workshops/${id}/findings`, { content: findings() }));
  await ok(await operator("post", `/workshops/${id}/findings/finalise`, {}));
  await ok(await operator("post", `/workshops/${id}/output`, {}));
  const refused = await operator("post", `/workshops/${id}/output/approve`, {});
  expect(refused.status()).toBe(403);
  expect(await ok(await lead("post", `/workshops/${id}/output/approve`, {}))).toMatchObject({
    state: "approved",
    pdfPages: 1,
  });
  const pdf = await request.get(`${API}/workshops/${id}/output/pdf`, {
    headers: { authorization: `Bearer ${token("operator-token.txt")}` },
  });
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await ok(await operator("post", `/workshops/${id}/output/share`, { how: "handed_over" }));
});
