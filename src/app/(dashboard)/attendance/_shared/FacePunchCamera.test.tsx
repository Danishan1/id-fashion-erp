// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { FacePunchCamera } = await import("./FacePunchCamera");

afterEach(() => cleanup());

const baseProps = {
  type: "IN" as const,
  facePhotoIds: [],
  requireFace: true,
  threshold: 0.45,
  frames: 3,
  gpsAccuracyMeters: 50,
  onCapture: vi.fn(async () => undefined),
  onCancel: vi.fn(),
};

describe("FacePunchCamera — no face photos enrolled", () => {
  it("shows an Enrol button when the viewer may enrol (HR / Admin / Super Admin)", () => {
    render(<FacePunchCamera {...baseProps} enrolHref="/attendance/face-enrolment/emp-1" />);
    const link = screen.getByRole("link", { name: "Enrol face photos" });
    expect(link.getAttribute("href")).toBe("/attendance/face-enrolment/emp-1");
    expect(screen.getByText(/Enrol them now/)).toBeTruthy();
  });

  it("tells other employees to ask HR, Admin or Super Admin, with no Enrol button", () => {
    render(<FacePunchCamera {...baseProps} enrolHref={null} />);
    expect(screen.queryByRole("link", { name: "Enrol face photos" })).toBeNull();
    expect(screen.getByText(/Ask HR, Admin or Super Admin/)).toBeTruthy();
  });
});
