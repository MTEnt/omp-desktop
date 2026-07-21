import { useEffect } from "react";
import { createPortal } from "react-dom";

type ImageLightboxProps = {
  src: string;
  alt?: string;
  onClose: () => void;
};

export const ImageLightbox = ({ src, alt, onClose }: ImageLightboxProps) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={alt?.trim() || "Image preview"}
      onClick={onClose}
    >
      <button
        type="button"
        className="image-lightbox__close"
        aria-label="Close preview"
        onClick={onClose}
      >
        ×
      </button>
      <img
        className="image-lightbox__image"
        src={src}
        alt={alt ?? ""}
        onClick={(event) => event.stopPropagation()}
      />
    </div>,
    document.body,
  );
};
