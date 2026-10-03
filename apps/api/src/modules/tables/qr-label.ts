import QRCode from 'qrcode';
import { ON_BRAND_DARK } from '@resget/shared';

/**
 * Printable table label: the restaurant's name, the QR that opens /m/<token>,
 * the table's name and a caption in the restaurant's language. SVG scales to
 * any sticker size; the PNG variant is the bare QR for places that only take
 * raster images. A4 sheets come from the panel's print page.
 */
export interface QrLabelInput {
  url: string;
  title: string;
  tableLine: string;
  caption: string;
  /** The restaurant's primary color; only the top band uses it so the QR stays high-contrast. */
  accent: string;
}

const WIDTH = 600;
const HEIGHT = 840;
const QR_SIZE = 480;
const MUTED = '#6b7280';
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => {
    switch (char) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case "'":
        return '&apos;';
      default:
        return '&quot;';
    }
  });
}

/** A fitted text line: long names shrink instead of overflowing the sticker. */
function textLine(text: string, y: number, size: number, weight: number, fill: string, maxChars: number): string {
  const fitted = text.length > maxChars ? Math.max(14, Math.floor((size * maxChars) / text.length)) : size;
  return `<text x="${WIDTH / 2}" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="${fitted}" font-weight="${weight}" fill="${fill}">${escapeXml(text)}</text>`;
}

export async function renderQrLabelSvg(input: QrLabelInput): Promise<string> {
  const qr = await QRCode.toString(input.url, { type: 'svg', errorCorrectionLevel: 'M', margin: 0 });
  const qrData = Buffer.from(qr, 'utf8').toString('base64');
  const x = (WIDTH - QR_SIZE) / 2;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`,
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>`,
    `<rect width="${WIDTH}" height="18" fill="${escapeXml(input.accent)}"/>`,
    textLine(input.title, 92, 36, 700, ON_BRAND_DARK, 24),
    `<image x="${x}" y="130" width="${QR_SIZE}" height="${QR_SIZE}" href="data:image/svg+xml;base64,${qrData}"/>`,
    textLine(input.tableLine, 690, 46, 700, ON_BRAND_DARK, 20),
    textLine(input.caption, 748, 26, 400, MUTED, 40),
    textLine(input.url, 800, 16, 400, MUTED, 64),
    '</svg>',
  ].join('');
}

export function renderQrPng(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, { type: 'png', errorCorrectionLevel: 'M', width: 1024, margin: 2 });
}

/** ASCII-only file name part; tenant names may carry any script. */
export function fileSafe(value: string): string {
  const ascii = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return ascii || 'table';
}
