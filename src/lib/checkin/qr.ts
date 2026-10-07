import QRCode from "qrcode";

/**
 * Builds the relative check-in path `/checkin/[eventId]?token=[signed token]`.
 */
export function buildCheckinPath(eventId: string, token: string): string {
  return `/checkin/${encodeURIComponent(eventId)}?token=${encodeURIComponent(token)}`;
}

/**
 * Builds the full URL encoded inside the event's QR code.
 * Falls back to the relative path `/checkin/[eventId]?token=[token]` if no
 * origin is provided.
 */
export function buildCheckinUrl(
  eventId: string,
  token: string,
  origin?: string | null,
): string {
  const path = buildCheckinPath(eventId, token);
  const trimmedOrigin = (origin ?? "").trim().replace(/\/$/, "");
  if (!trimmedOrigin) return path;
  return `${trimmedOrigin}${path}`;
}

/**
 * Generates a cryptographically random secret token for an event's QR code.
 */
export function generateCheckinToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Constant-time-style comparison of the scanned token with the event's
 * stored secret token.
 */
export function isValidCheckinToken(
  providedToken: string | null | undefined,
  storedToken: string | null | undefined,
): boolean {
  if (!providedToken || !storedToken) return false;
  const a = providedToken.trim();
  const b = storedToken.trim();
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Generates a PNG data URL for the check-in URL using the `qrcode` npm package.
 */
export async function generateQrCodeDataUrl(
  checkinUrl: string,
  width = 480,
): Promise<string> {
  return QRCode.toDataURL(checkinUrl, {
    width,
    margin: 2,
    errorCorrectionLevel: "M",
    color: {
      dark: "#1B2A49",
      light: "#FFFFFF",
    },
  });
}

/**
 * Generates an inline SVG string for the check-in URL using the `qrcode` npm package.
 */
export async function generateQrCodeSvg(checkinUrl: string): Promise<string> {
  return QRCode.toString(checkinUrl, {
    type: "svg",
    margin: 2,
    errorCorrectionLevel: "M",
    color: {
      dark: "#1B2A49",
      light: "#FFFFFF",
    },
  });
}
