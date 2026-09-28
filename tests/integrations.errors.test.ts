import { describe, expect, it } from "vitest";
import { integrationErrorMessage } from "@/lib/integration-errors";
import { IntegrationError, integrationErrorCode } from "@/server/connectors/http";

describe("integration errors in redirects carry codes, never free text", () => {
  it("maps known codes to fixed messages", () => {
    expect(integrationErrorMessage("STATE_INVALID", "Zoom")).toMatch(/expired or did not start from this session/);
    expect(integrationErrorMessage("REAUTH_REQUIRED", "Google Meet")).toMatch(/Reconnect Google Meet/);
  });
  it("a crafted value never reaches the page", () => {
    const crafted = "Your account is suspended — call +1 555 0100";
    expect(integrationErrorMessage(crafted, "Zoom")).toBe("The Zoom connection could not be completed.");
    expect(integrationErrorMessage(crafted, "Zoom")).not.toContain("555");
  });
  it("derives a code from errors", () => {
    expect(integrationErrorCode(new IntegrationError("STATE_INVALID", "state expired"))).toBe("STATE_INVALID");
    expect(integrationErrorCode(new IntegrationError("INVALID", "The Meet permission was not granted"))).toBe("DECLINED");
    expect(integrationErrorCode(new Error("boom"))).toBe("FAILED");
  });
});
