/** Client-safe integration error messages (redirects carry only a code). */
/**
 * Fixed, user-facing messages per error code. Redirects carry only the code, so a crafted
 * link can never make the app display arbitrary text.
 */
export function integrationErrorMessage(code: string | null | undefined, providerName: string): string {
  switch (code) {
    case "STATE_INVALID":
      return `The ${providerName} authorization expired or did not start from this session. Start the connection again.`;
    case "DECLINED":
      return `The ${providerName} authorization was declined or a required permission was not granted.`;
    case "REAUTH_REQUIRED":
      return `${providerName} rejected the stored authorization. Reconnect ${providerName}.`;
    case "NOT_CONFIGURED":
      return `${providerName} is not configured on this server (see Settings → Integrations for the setup steps).`;
    case "FORBIDDEN":
      return `Your role does not allow connecting ${providerName}.`;
    case "RATE_LIMITED":
      return `${providerName} is rate-limiting requests. Try again in a few minutes.`;
    case "UPSTREAM":
      return `${providerName} returned an error. Try again; if it persists, reconnect.`;
    default:
      return `The ${providerName} connection could not be completed.`;
  }
}

