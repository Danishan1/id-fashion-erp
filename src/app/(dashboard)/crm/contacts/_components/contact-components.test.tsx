// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const { ContactabilityBadge } = await import("./ContactsListClient");
const { ContactUpcomingSections } = await import("./ContactRelatedPanels");

afterEach(cleanup);

describe("contact UI pieces", () => {
  it("shows contact-wide DND before channel restrictions", () => {
    render(<ContactabilityBadge restricted={["EMAIL", "ALL"]} />);
    expect(screen.getByText("Do not contact")).toBeTruthy();
    cleanup();
    render(<ContactabilityBadge restricted={["WHATSAPP"]} />);
    expect(screen.getByText("DND: WhatsApp")).toBeTruthy();
    cleanup();
    render(<ContactabilityBadge restricted={[]} />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("lists later-phase sections as placeholders without data", () => {
    render(<ContactUpcomingSections />);
    expect(screen.getByText("Activities")).toBeTruthy();
    expect(screen.getByText("Conversations")).toBeTruthy();
    expect(screen.getAllByText(/Arrives with Phase/).length).toBe(5);
  });
});
