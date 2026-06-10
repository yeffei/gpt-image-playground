"""
Generate lightweight `.thumb.webp` assets for prompt-library card previews.

List cards should use thumbnails for faster opening/scrolling.
Lightbox preview keeps using the original image.
"""

from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(r"D:\gpt_image_playground-main")
SOURCE_DIR = ROOT / "public" / "prompt-library-source"
MAX_EDGE = 640
QUALITY = 72


def iter_source_images():
    for path in SOURCE_DIR.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
            continue
        if path.name.endswith(".thumb.webp"):
            continue
        yield path


def build_thumbnail(source_path: Path):
    thumb_path = source_path.with_name(f"{source_path.stem}.thumb.webp")

    with Image.open(source_path) as image:
        image = ImageOps.exif_transpose(image)
        if image.mode not in ("RGB", "RGBA"):
            image = image.convert("RGBA" if "A" in image.getbands() else "RGB")

        image.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)

        save_kwargs = {"format": "WEBP", "quality": QUALITY, "method": 6}
        if image.mode == "RGBA":
          save_kwargs["lossless"] = False
        else:
          image = image.convert("RGB")

        image.save(thumb_path, **save_kwargs)

    return thumb_path


def main():
    created = 0
    skipped = 0

    for source_path in iter_source_images():
        thumb_path = source_path.with_name(f"{source_path.stem}.thumb.webp")
        if thumb_path.exists():
            skipped += 1
            continue
        build_thumbnail(source_path)
        created += 1

    print(f"created={created}")
    print(f"skipped={skipped}")


if __name__ == "__main__":
    main()
