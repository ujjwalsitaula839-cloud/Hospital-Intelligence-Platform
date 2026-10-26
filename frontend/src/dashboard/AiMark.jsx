import { useId } from "react";

// HIP AI: a heartbeat line (the live hospital) ending in a spark (the assistant).
// While it thinks, the line traces itself like a monitor sweep.
export default function AiMark({ size = 32, thinking = false, className = "" }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      className={`ai-mark${thinking ? " is-thinking" : ""}${className ? ` ${className}` : ""}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${id}-bg`} x1="3" y1="2" x2="29" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4a7dff" />
          <stop offset="0.55" stopColor="#1c9bd1" />
          <stop offset="1" stopColor="#19c28c" />
        </linearGradient>
        <radialGradient id={`${id}-shine`} cx="9" cy="6" r="16" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0.5" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="10" fill={`url(#${id}-bg)`} />
      <rect x="1" y="1" width="30" height="30" rx="10" fill={`url(#${id}-shine)`} />
      <rect x="1.5" y="1.5" width="29" height="29" rx="9.5" fill="none" stroke="#fff" strokeOpacity="0.28" />
      <path
        className="ai-mark-pulse"
        d="M5.5 18h4.6l2.1-5.2 3.7 10.2 2.7-7 1.5 2h6.4"
        fill="none"
        stroke="#fff"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path className="ai-mark-spark" d="m24.2 4.6 1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1 1-2.5Z" fill="#fff" />
    </svg>
  );
}
