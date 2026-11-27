// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestsView } from "../src/app/requests/requests-view.js";
import { CatalogueApiError } from "../src/lib/catalogue-http.js";
import type {
  NoticeVersion,
  RequestDetail,
  RequestSummary,
  RequestsApi,
} from "../src/lib/requests-api.js";

// Tasks T067 and T069: the request inbox and the notice versions.
afterEach(cleanup);

const summary = (over: Partial<RequestSummary> = {}): RequestSummary => ({
  id: "q1",
  kind: "download",
  offerId: "offer-5",
  state: "received",
  email: "dana@newco-hie.example",
  displayName: "Dana",
  orgName: "Newco HIE",
  accountId: "a1",
  contactId: "c1",
  flags: [],
  submittedAt: "2026-11-23T10:00:00.000Z",
  ...over,
});
const detail = (over: Partial<RequestDetail> = {}): RequestDetail => ({
  ...summary(),
  roleTitle: "Integration Lead",
  orgType: "health_information_exchange",
  consent: {
    noticeVersionId: "notice-version-1",
    consentGiven: true,
    recordedAt: "2026-11-23T10:00:00.000Z",
  },
  download: { delivered: true, deliveryFailure: null, linkExpiresAt: "2026-11-24T10:00:00.000Z" },
  decisions: null,
  intake: null,
  recommendationId: "r1",
  ...over,
});
const notice = (over: Partial<NoticeVersion> = {}): NoticeVersion => ({
  id: "n1",
  version: 1,
  noticeText: "A privacy notice.",
  consentText: "I agree to be contacted.",
  createdBy: "author-1",
  createdAt: "2026-11-23T09:00:00.000Z",
  approvedBy: null,
  approvedAt: null,
  ...over,
});
const apiWith = (
  items: RequestSummary[],
  d: RequestDetail,
  notices: NoticeVersion[] = [],
): RequestsApi => ({
  list: vi.fn().mockResolvedValue({ items }),
  get: vi.fn().mockResolvedValue(d),
  review: vi.fn().mockResolvedValue({ ...d, state: "reviewed" }),
  notices: {
    list: vi.fn().mockResolvedValue({ items: notices }),
    create: vi.fn().mockResolvedValue(notice()),
    approve: vi.fn().mockResolvedValue(notice({ approvedBy: "approver-1" })),
  },
});
const READ = ["requests.read"];
const REVIEW = ["requests.read", "requests.review"];

describe("request inbox", () => {
  it("lists requests with their kind, organisation, state and flags", async () => {
    const api = apiWith(
      [
        summary(),
        summary({
          id: "q2",
          kind: "working_session",
          flags: ["personal_email", "no_consent"],
          accountId: null,
          orgName: "Pat's Clinic",
        }),
      ],
      detail(),
    );
    render(<RequestsView permissions={READ} userId="u1" api={api} />);
    expect(await screen.findByText(/Register download · Newco HIE/)).toBeTruthy();
    expect(screen.getByText(/Working session request · Pat's Clinic/)).toBeTruthy();
    expect(screen.getByText(/\[Personal email\]/)).toBeTruthy();
    expect(screen.getByText(/\[No consent to be contacted\]/)).toBeTruthy();
  });

  it("filters by state and kind", async () => {
    const api = apiWith([summary()], detail());
    render(<RequestsView permissions={READ} userId="u1" api={api} />);
    await screen.findByText(/Register download/);
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "closed" } });
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith({ state: "closed", kind: "" }));
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "intake" } });
    await waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith({ state: "closed", kind: "intake" }),
    );
  });

  it("shows a download as first-party engagement with its consent and follow-up", async () => {
    render(<RequestsView permissions={READ} userId="u1" api={apiWith([summary()], detail())} />);
    fireEvent.click(await screen.findByRole("button", { name: /Register download/ }));
    const d = await screen.findByRole("article", { name: "Request detail" });
    expect(within(d).getByText(/Consent to be contacted: given/)).toBeTruthy();
    expect(within(d).getByText(/Register delivered by link/)).toBeTruthy();
    expect(within(d).getByText(/first-party engagement, not buying intent/)).toBeTruthy();
    expect(within(d).getByText(/follow-up recommendation is waiting for review/)).toBeTruthy();
  });

  it("shows session decisions and an Offer 6 intake as field names, never as values", async () => {
    const intake = {
      useCase: "Readmission model",
      fieldNames: ["patient_id", "DOB"],
      attendees: ["Data lead"],
    };
    const api = apiWith(
      [summary({ kind: "intake" })],
      detail({
        kind: "intake",
        download: null,
        recommendationId: null,
        intake,
        decisions: ["Which OBX segment carries results?"],
      }),
    );
    render(<RequestsView permissions={READ} userId="u1" api={api} />);
    fireEvent.click(await screen.findByRole("button", { name: /Intake/ }));
    expect(await screen.findByText("patient_id, DOB")).toBeTruthy();
    expect(screen.getByText("Which OBX segment carries results?")).toBeTruthy();
    expect(screen.getByLabelText("Intake answers")).toBeTruthy();
  });

  it("offers review controls only with requests.review, and closing needs a reason", async () => {
    const api = apiWith([summary()], detail());
    const { unmount } = render(<RequestsView permissions={READ} userId="u1" api={api} />);
    fireEvent.click(await screen.findByRole("button", { name: /Register download/ }));
    await screen.findByRole("article", { name: "Request detail" });
    expect(screen.queryByRole("button", { name: "Mark reviewed" })).toBeNull();
    unmount();

    render(<RequestsView permissions={REVIEW} userId="u1" api={api} />);
    fireEvent.click(await screen.findByRole("button", { name: /Register download/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Mark reviewed" }));
    await waitFor(() =>
      expect(api.review).toHaveBeenCalledWith(
        "q1",
        { action: "mark_reviewed" },
        expect.any(String),
      ),
    );
    const close = await screen.findByRole("button", { name: "Close" });
    expect((close as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason for closing"), {
      target: { value: "Duplicate request" },
    });
    fireEvent.click(close);
    await waitFor(() =>
      expect(api.review).toHaveBeenCalledWith(
        "q1",
        { action: "close", reason: "Duplicate request" },
        expect.any(String),
      ),
    );
  });

  it("asks for a business email to link a personal-email request, and sends it", async () => {
    const personal = detail({
      flags: ["personal_email"],
      accountId: null,
      contactId: null,
      recommendationId: null,
    });
    const api = apiWith([summary({ flags: ["personal_email"] })], personal);
    render(<RequestsView permissions={REVIEW} userId="u1" api={api} />);
    fireEvent.click(await screen.findByRole("button", { name: /Register download/ }));
    fireEvent.change(await screen.findByLabelText("Account to link to"), {
      target: { value: "a1" },
    });
    fireEvent.change(screen.getByLabelText("Business email"), {
      target: { value: "pat@newco-hie.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    await waitFor(() =>
      expect(api.review).toHaveBeenCalledWith(
        "q1",
        { action: "link", accountId: "a1", businessEmail: "pat@newco-hie.example" },
        expect.any(String),
      ),
    );
  });

  it("hides the controls once a request is linked or closed, and shows plain refusals", async () => {
    const api = apiWith([summary({ state: "closed" })], detail({ state: "closed" }));
    render(<RequestsView permissions={REVIEW} userId="u1" api={api} />);
    fireEvent.click(await screen.findByRole("button", { name: /Register download/ }));
    await screen.findByRole("article", { name: "Request detail" });
    expect(screen.queryByRole("form", { name: "Review this request" })).toBeNull();

    const failing = apiWith([summary()], detail());
    failing.review = vi.fn().mockRejectedValue(new CatalogueApiError(409, ["request_closed"]));
    cleanup();
    render(<RequestsView permissions={REVIEW} userId="u1" api={failing} />);
    fireEvent.click(await screen.findByRole("button", { name: /Register download/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Mark reviewed" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "That request has already been linked or closed.",
    );
  });

  it("does not load the inbox without requests.read", async () => {
    const api = apiWith([summary()], detail());
    render(<RequestsView permissions={["notices.manage"]} userId="u1" api={api} />);
    await screen.findByText("Privacy notice and consent wording");
    expect(api.list).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Request inbox" })).toBeNull();
  });
});

describe("notice versions", () => {
  it("lists versions, drafts a new one and shows approval state", async () => {
    const api = apiWith([], detail(), [
      notice(),
      notice({ id: "n2", version: 2, approvedBy: "approver-1" }),
    ]);
    render(<RequestsView permissions={["notices.manage"]} userId="author-1" api={api} />);
    expect(await screen.findByText(/Version 1: not approved/)).toBeTruthy();
    expect(screen.getByText(/Version 2: approved/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Privacy notice text"), {
      target: { value: "We use your details to send the register." },
    });
    fireEvent.change(screen.getByLabelText("Consent wording"), {
      target: { value: "I agree to be contacted." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(api.notices.create).toHaveBeenCalledWith(
        {
          noticeText: "We use your details to send the register.",
          consentText: "I agree to be contacted.",
        },
        expect.any(String),
      ),
    );
  });

  it("shows the approve control only to an approver who is not the author", async () => {
    const api = apiWith([], detail(), [notice()]);
    const { unmount } = render(
      <RequestsView permissions={["notices.approve"]} userId="author-1" api={api} />,
    );
    await screen.findByText(/Version 1: not approved/);
    expect(screen.queryByRole("button", { name: /Approve version 1/ })).toBeNull();
    unmount();
    render(<RequestsView permissions={["notices.approve"]} userId="approver-1" api={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve version 1" }));
    await waitFor(() => expect(api.notices.approve).toHaveBeenCalledWith("n1", expect.any(String)));
    expect(screen.queryByRole("form", { name: "Draft a notice version" })).toBeNull();
  });
});

describe("converting a request to a workshop (feature 007)", () => {
  const intake = detail({ kind: "intake", state: "linked", download: null, intake: {} });
  const openIt = async (permissions: string[], d = intake) => {
    const api = apiWith([summary({ kind: "intake", state: "linked" })], d);
    const workshops = { convert: vi.fn().mockResolvedValue({ id: "w1" }) };
    render(<RequestsView permissions={permissions} userId="u1" api={api} workshops={workshops} />);
    fireEvent.click(await screen.findByRole("button", { name: /Newco HIE/ }));
    await screen.findByRole("article", { name: "Request detail" });
    return workshops;
  };
  const convert = () => screen.queryByRole("button", { name: "Convert to workshop" });

  it("makes the workshop from a linked intake and links to it", async () => {
    const workshops = await openIt(["requests.read", "workshops.edit"]);
    fireEvent.click(convert()!);
    expect(
      (await screen.findByRole("link", { name: "Open the workshop" })).getAttribute("href"),
    ).toBe("/workshops/w1");
    expect(workshops.convert).toHaveBeenCalledWith("q1");
  });
  it("offers nothing without the permission or for an unlinked request", async () => {
    await openIt(["requests.read"]);
    expect(convert()).toBeNull();
    cleanup();
    await openIt(["requests.read", "workshops.edit"], { ...intake, state: "reviewed" });
    expect(convert()).toBeNull();
  });
  it("shows a plain message when it is refused", async () => {
    const api = apiWith([summary({ kind: "intake", state: "linked" })], intake);
    const workshops = {
      convert: vi.fn().mockRejectedValue(new CatalogueApiError(409, ["workshop_open"])),
    };
    render(
      <RequestsView
        permissions={["requests.read", "workshops.edit"]}
        userId="u1"
        api={api}
        workshops={workshops}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Newco HIE/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Convert to workshop" }));
    expect((await screen.findByRole("alert")).textContent).toContain("already has an open");
  });
});
