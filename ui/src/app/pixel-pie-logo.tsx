type PixelPieLogoProps = {
  size?: number;
  title?: string;
  className?: string;
};

/** 12x12 pixel pie mark — Oh My Pi style glyph, CSS-animated. */
const FRAME_A = [
  "....####....",
  "..########..",
  ".##########.",
  ".####..####.",
  "####....####",
  "####....####",
  "####....####",
  "####....####",
  ".####..####.",
  ".##########.",
  "..########..",
  "....####....",
];

const FRAME_B = [
  "....####....",
  "..########..",
  ".####.#####.",
  ".###...####.",
  "###.....####",
  "###.....####",
  "####....####",
  "####....####",
  ".####..####.",
  ".##########.",
  "..########..",
  "....####....",
];

const FRAME_C = [
  "....####....",
  "..########..",
  ".##########.",
  ".####..####.",
  "####....####",
  "###.....####",
  "###.....####",
  "####....####",
  ".####..####.",
  ".#####.####.",
  "..########..",
  "....####....",
];

const FRAMES = [FRAME_A, FRAME_B, FRAME_C, FRAME_B];

export const PixelPieLogo = ({
  size = 28,
  title = "Oh My Pi",
  className,
}: PixelPieLogoProps) => {
  const pixel = Math.max(1, Math.round(size / 12));
  const dim = pixel * 12;

  return (
    <span
      className={`pixel-pie${className ? ` ${className}` : ""}`}
      role="img"
      aria-label={title}
      title={title}
      style={{ width: dim, height: dim }}
    >
      {FRAMES.map((frame, frameIndex) => (
        <span
          className={`pixel-pie__frame pixel-pie__frame--${frameIndex}`}
          key={frameIndex}
          aria-hidden="true"
        >
          {frame.map((row, y) =>
            row.split("").map((cell, x) =>
              cell === "#" ? (
                <span
                  className="pixel-pie__dot"
                  key={`${frameIndex}-${x}-${y}`}
                  style={{
                    width: pixel,
                    height: pixel,
                    left: x * pixel,
                    top: y * pixel,
                  }}
                />
              ) : null,
            ),
          )}
        </span>
      ))}
    </span>
  );
};
