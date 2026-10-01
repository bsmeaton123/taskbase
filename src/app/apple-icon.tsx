import { ImageResponse } from "next/og";
import { brandIconSvg } from "@/lib/brand-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon for iOS. */
export default function AppleIcon() {
  const src = `data:image/svg+xml;utf8,${encodeURIComponent(brandIconSvg(180, 40))}`;
  return new ImageResponse(
    (
      // eslint-disable-next-line jsx-a11y/alt-text
      <img src={src} width={180} height={180} />
    ),
    size,
  );
}
