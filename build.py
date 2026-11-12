#!/usr/bin/env python3
"""Build a reproducible Firefox extension archive using the standard library."""

from pathlib import Path
import zipfile


ROOT = Path(__file__).resolve().parent
FILES = (
    "manifest.json",
    "background.js",
    "content.js",
    "content.css",
    "icons/icon.svg",
    "options.html",
    "options.js",
    "options.css",
    "THIRD_PARTY_NOTICES.txt",
    "_locales/en/messages.json",
    "_locales/ru/messages.json",
)
OUTPUT = ROOT / "build" / "yc-power-firefox.xpi"


def main():
    missing = [name for name in FILES if not (ROOT / name).is_file()]
    if missing:
        raise SystemExit("Missing extension files: " + ", ".join(missing))

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUTPUT, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(FILES):
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, (ROOT / name).read_bytes())
    print(OUTPUT)


if __name__ == "__main__":
    main()
