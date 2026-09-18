type SorrelMarkProps = {
  size?: number;
  className?: string;
};

const PETAL =
  "M 50 50 C 44 36, 24 32, 24 18 C 24 8, 36 2, 44 8 C 47 10, 48.5 12, 50 16 C 51.5 12, 53 10, 56 8 C 64 2, 76 8, 76 18 C 76 32, 56 36, 50 50 Z";

export function SorrelMark({ size = 24, className }: SorrelMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      fill="currentColor"
      role="img"
      aria-label="Sorrel"
      className={className}
    >
      <path d={PETAL} />
      <path transform="rotate(120 50 50)" d={PETAL} />
      <path transform="rotate(240 50 50)" d={PETAL} />
    </svg>
  );
}
