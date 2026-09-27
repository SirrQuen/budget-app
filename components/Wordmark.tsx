import type { CSSProperties } from "react";

type WordmarkProps = {
  // The ™ is for first or most prominent public use -- the auth splash and
  // the OG image -- not every appearance. Behind login it's noise; never in
  // a <title>. The mark is pending, not registered: never ®.
  tm?: boolean;
  className?: string;
  style?: CSSProperties;
};

// The ™ is styled inline, not with Tailwind, so the OG image (ImageResponse,
// which can't read classes) renders the same component. line-height: 0 keeps
// the raised ™ from pushing the line box taller. Geist draws ™ high already,
// so a small 0.25em lift (not `super`) puts its top on the cap line.
//
// ImageResponse ignores vertical-align; there the caller's display: flex
// centres the zero-height ™ on the row's top edge, and marginTop brings it
// down to the cap line. Vertical margins do nothing on an inline element, so
// browsers ignore it.
const TM_STYLE: CSSProperties = {
  fontSize: "0.6em",
  fontWeight: 500,
  lineHeight: 0,
  verticalAlign: "0.25em",
  marginTop: "1em",
};

export function Wordmark({ tm = false, className, style }: WordmarkProps) {
  return (
    <span className={className} style={style}>
      Sorrel
      {tm ? <sup style={TM_STYLE}>™</sup> : null}
    </span>
  );
}
