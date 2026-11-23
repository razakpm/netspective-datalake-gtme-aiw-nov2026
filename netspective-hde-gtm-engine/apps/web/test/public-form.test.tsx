// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicForm } from "../src/app/public/offers/[slug]/public-form.js";
import {
  PublicApiError,
  describePublicError,
  publicDownloadHref,
  type FormDefinition,
  type PublicApi,
  type Receipt,
} from "../src/lib/public-api.js";

// Task T068: the hosted public form for each offer.
afterEach(cleanup);

const base = {
  orgTypes: [
    { key: "health_information_exchange", label: "Health information exchange" },
    { key: "health_system", label: "Health system" },
  ],
  notice: {
    versionId: "nv-1",
    noticeText: "We use your details to send the register.",
    consentText: "I agree to be contacted about this topic.",
  },
  formToken: "token-abc",
  issuedAt: "2026-11-23T10:00:00.000Z",
};
const ccda: FormDefinition = {
  ...base,
  slug: "ccda-to-fhir-mapping-decision-register",
  title: "CCDA-to-FHIR Mapping Decision Register",
  kinds: ["download", "working_session"],
  fields: {
    working_session: [
      {
        key: "decisions",
        label: "Open decisions you would like to bring (up to five)",
        type: "list",
        required: true,
        minItems: 1,
        maxItems: 5,
        maxLength: 300,
      },
    ],
  },
};
const offer6: FormDefinition = {
  ...base,
  slug: "pilot-input-trace-workshop",
  title: "Pilot Input Trace Workshop: before the session",
  kinds: ["intake"],
  fields: {
    intake: [
      { key: "useCase", label: "The named use case", type: "text", required: true, maxLength: 200 },
      { key: "sourceSystems", label: "Source system names", type: "list", required: true },
      {
        key: "fieldNames",
        label: "Ten field names (names only, never values)",
        type: "names",
        required: true,
        help: "For example DOB or patient_id.",
      },
    ],
  },
};
const offer1: FormDefinition = {
  ...base,
  slug: "sender-onboarding-friction-map",
  title: "Sender Onboarding Friction Map: before the session",
  kinds: ["intake"],
  fields: {
    intake: [
      {
        key: "recentOnboarding.senderLabel",
        label: "One recent sender onboarding",
        type: "text",
        required: true,
      },
      {
        key: "specsAvailable",
        label: "Are non-PHI specifications available?",
        type: "select",
        required: true,
        options: [
          { key: "yes", label: "Yes" },
          { key: "no", label: "No" },
        ],
      },
    ],
  },
};
const receipt = (over: Partial<Receipt> = {}): Receipt => ({
  requestId: "q1",
  status: "received",
  flags: [],
  ...over,
});
const apiWith = (r: Receipt | Error): PublicApi => ({
  submit: vi.fn(async () => {
    if (r instanceof Error) throw r;
    return r;
  }),
});

function fillContact(email = "dana@newco-hie.example") {
  fireEvent.change(screen.getByLabelText("Work email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Your role"), { target: { value: "Integration Lead" } });
  fireEvent.change(screen.getByLabelText("Organisation"), { target: { value: "Newco HIE" } });
  fireEvent.change(screen.getByLabelText("Organisation type"), {
    target: { value: "health_information_exchange" },
  });
}

describe("the register form", () => {
  it("shows the approved notice, an unticked optional consent box and a hidden honeypot", () => {
    render(<PublicForm form={ccda} api={apiWith(receipt())} />);
    expect(screen.getByText("We use your details to send the register.")).toBeTruthy();
    const box = screen.getByRole("checkbox") as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(screen.getByText(/You receive the register either way/)).toBeTruthy();
    const honeypot = document.querySelector('input[name="website"]') as HTMLInputElement;
    expect(honeypot.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(honeypot.tabIndex).toBe(-1);
    expect(honeypot.value).toBe("");
  });

  it("submits a download with the form token, notice version and consent choice, and shows the link and its expiry", async () => {
    const api = apiWith(
      receipt({
        download: {
          url: "/api/v1/public/downloads/abc.def",
          expiresAt: "2026-11-24T10:00:00.000Z",
          delivered: true,
        },
      }),
    );
    render(<PublicForm form={ccda} api={api} />);
    fillContact();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Download the register" }));
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
    expect(api.submit).toHaveBeenCalledWith("ccda-to-fhir-mapping-decision-register", {
      kind: "download",
      formToken: "token-abc",
      noticeVersionId: "nv-1",
      consentToContact: true,
      website: "",
      contact: {
        email: "dana@newco-hie.example",
        role: "Integration Lead",
        orgName: "Newco HIE",
        orgType: "health_information_exchange",
      },
    });
    const link = await screen.findByRole("link", { name: "Download the register" });
    expect(link.getAttribute("href")).toBe("/api/public/downloads/abc.def");
    expect(screen.getByText(/this link works until/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/received your request/);
  });

  it("sends consent as false when the box stays unticked", async () => {
    const api = apiWith(
      receipt({
        download: {
          url: "/api/v1/public/downloads/a.b",
          expiresAt: "2026-11-24T10:00:00.000Z",
          delivered: true,
        },
      }),
    );
    render(<PublicForm form={ccda} api={api} />);
    fillContact();
    fireEvent.click(screen.getByRole("button", { name: "Download the register" }));
    await waitFor(() => expect(api.submit).toHaveBeenCalled());
    expect((api.submit as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toMatchObject({
      consentToContact: false,
    });
  });

  it("tells a visitor in plain words when the register could not be prepared", async () => {
    render(
      <PublicForm
        form={ccda}
        api={apiWith(receipt({ download: { url: null, expiresAt: null, delivered: false } }))}
      />,
    );
    fillContact();
    fireEvent.click(screen.getByRole("button", { name: "Download the register" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /could not prepare the register just now/,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("explains that a personal email will be looked at by a person", async () => {
    render(
      <PublicForm
        form={ccda}
        api={apiWith(
          receipt({
            flags: ["personal_email"],
            download: { url: "/api/v1/public/downloads/a.b", expiresAt: null, delivered: true },
          }),
        )}
      />,
    );
    fillContact("pat@gmail.com");
    fireEvent.click(screen.getByRole("button", { name: "Download the register" }));
    expect(await screen.findByText(/personal email address/)).toBeTruthy();
  });

  it("switches to the working session form and sends up to five decisions, one per line", async () => {
    const api = apiWith(receipt());
    render(<PublicForm form={ccda} api={api} />);
    fireEvent.click(screen.getByLabelText(/Request a 30-minute working session/));
    fillContact();
    fireEvent.change(screen.getByLabelText(/Open decisions/), {
      target: {
        value: "Which OBX segment carries results?\n\nHow do we map the encounter class?\n",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request a 30-minute working session" }));
    await waitFor(() => expect(api.submit).toHaveBeenCalled());
    expect((api.submit as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toMatchObject({
      kind: "working_session",
      decisions: ["Which OBX segment carries results?", "How do we map the encounter class?"],
    });
    expect(await screen.findByText(/Nothing has been sent to you/)).toBeTruthy();
  });
});

describe("the intake forms", () => {
  it("sends ten field names as a list, and asks about no price, budget, credential or production data", async () => {
    const api = apiWith(receipt());
    render(<PublicForm form={offer6} api={api} />);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(document.body.textContent).not.toMatch(
      /budget|price|password|credential|production data/i,
    );
    expect(screen.getByText(/For example DOB or patient_id/)).toBeTruthy();
    fillContact("casey@riverbend-health.example");
    fireEvent.change(screen.getByLabelText("The named use case"), {
      target: { value: "Readmission model" },
    });
    fireEvent.change(screen.getByLabelText(/Source system names/), {
      target: { value: "Epic Clarity\nLabLink" },
    });
    fireEvent.change(screen.getByLabelText(/Ten field names/), {
      target: { value: "patient_id\nDOB\nencounter_date" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send the intake" }));
    await waitFor(() => expect(api.submit).toHaveBeenCalled());
    expect((api.submit as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toMatchObject({
      kind: "intake",
      intake: {
        useCase: "Readmission model",
        sourceSystems: ["Epic Clarity", "LabLink"],
        fieldNames: ["patient_id", "DOB", "encounter_date"],
      },
    });
  });

  it("builds nested answers from dotted keys and sends choices as their keys", async () => {
    const api = apiWith(receipt());
    render(<PublicForm form={offer1} api={api} />);
    fillContact();
    fireEvent.change(screen.getByLabelText(/One recent sender onboarding/), {
      target: { value: "A regional hospital sender" },
    });
    fireEvent.change(screen.getByLabelText(/non-PHI specifications/), { target: { value: "yes" } });
    fireEvent.click(screen.getByRole("button", { name: "Send the intake" }));
    await waitFor(() => expect(api.submit).toHaveBeenCalled());
    expect((api.submit as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toMatchObject({
      intake: {
        recentOnboarding: { senderLabel: "A regional hospital sender" },
        specsAvailable: "yes",
      },
    });
  });

  it("warns, without blocking, when typed text looks like patient information", () => {
    render(<PublicForm form={offer6} api={apiWith(receipt())} />);
    fireEvent.change(screen.getByLabelText("The named use case"), {
      target: { value: "SSN: 123-45-6789" },
    });
    expect(screen.getByRole("note").textContent).toMatch(/Do not enter PHI/);
  });
});

describe("refusals", () => {
  it.each([
    [new PublicApiError(400, ["form_rejected"], null), /reload the page and try again/],
    [new PublicApiError(409, ["notice_changed"], null), /notice was updated/],
    [new PublicApiError(429, ["rate_limited"], null), /wait a minute/],
    [new PublicApiError(503, ["no_notice"], null), /not available yet/],
    [
      new PublicApiError(422, ["intake_invalid"], "Give exactly ten field names (you gave 9)."),
      /exactly ten field names/,
    ],
    [
      new PublicApiError(
        422,
        [],
        "The request contains content that may be protected health information.",
      ),
      /patient or personal health information/,
    ],
    [new Error("network"), /Something went wrong/],
  ])("shows a plain message for %#", async (error, pattern) => {
    render(<PublicForm form={ccda} api={apiWith(error as Error)} />);
    fillContact();
    fireEvent.click(screen.getByRole("button", { name: "Download the register" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(pattern);
  });

  it("never shows the server's own text for an unknown refusal", () => {
    expect(describePublicError(new PublicApiError(400, [], "stack trace and internals"))).toBe(
      "Please check the details and try again.",
    );
    expect(describePublicError(new PublicApiError(500, [], "boom"))).toBe(
      "Something went wrong. Please try again.",
    );
  });

  it("maps the API download path onto the public proxy", () => {
    expect(publicDownloadHref("/api/v1/public/downloads/a.b")).toBe("/api/public/downloads/a.b");
  });
});
