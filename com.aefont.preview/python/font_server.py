#!/usr/bin/env python3
"""Local font helper for AE Font Preview.

This lightweight HTTP service exposes:
  GET  /ping             → {"status": "ok"}
  GET  /fonts            → catalog of system fonts with alias metadata
  GET  /preview/<name>   → single preview image (legacy)
  POST /batch-preview    → render multiple previews in one request

The service relies on Windows GDI to enumerate fonts (including FR_PRIVATE
fonts that live only in memory) and render glyphs as PNG data returned via
base64. It purposefully avoids Tkinter dependencies to keep the runtime
surface minimal and friendly to PyInstaller.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import io
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer
import argparse
from typing import Dict, Iterable, List, Optional, Set, Tuple
from urllib.parse import parse_qs, urlparse, unquote
from datetime import datetime
from pathlib import Path

from font_enumerator import FontEnumerator
from font_inspector import get_all_name_variants, get_localized_family_names
from font_name_resolver import parse_style_flags
from gdi_renderer import GDIRenderer


def _reconfigure_stdio() -> None:
    """Ensure stdout/stderr can emit UTF-8 safely on Windows consoles.

    Falls back to replacing unencodable characters if necessary.
    """
    try:
        if hasattr(sys.stdout, "reconfigure"):
            try:
                sys.stdout.reconfigure(encoding="utf-8", errors="replace")
                sys.stderr.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass
        else:
            # For older Python builds
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
            sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
    except Exception:
        # Best-effort only
        pass


def get_debug_dir() -> Path:
    """Return a user-writable directory for debug artifacts."""
    root = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
    if not root:
        root = str(Path.home())
    base = Path(root) / "AEFontPreview" / "font_debug"
    try:
        base.mkdir(parents=True, exist_ok=True)
    except Exception:
        # As a last resort, use current working directory
        base = Path("font_debug")
        base.mkdir(exist_ok=True)
    return base


_reconfigure_stdio()

LOG = logging.getLogger("font_server")
logging.basicConfig(
    level=logging.INFO,
    format="[font_server] %(message)s",
    stream=sys.stdout,
)

DEFAULT_PORT = int(os.environ.get("AE_FONT_SERVER_PORT", "8765"))


def normalize(value: Optional[str]) -> str:
    if not value and value != 0:
        return ""
    lowered = str(value).lower().strip()
    lowered = lowered.replace("\u3000", " ")  # ideographic space
    lowered = lowered.lstrip("@")  # vertical font flag
    return "".join(ch for ch in lowered if ch.isalnum())


@dataclass
class FontMeta:
    primary_name: str
    gdi_name: str
    aliases: Set[str] = field(default_factory=set)
    language_names: Dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.aliases:
            self.aliases = {self.primary_name}
        self.aliases.add(self.primary_name)
        self.aliases.add(self.gdi_name)

    @property
    def key(self) -> str:
        return normalize(self.gdi_name)

    @property
    def normalized_aliases(self) -> Set[str]:
        return {normalize(alias) for alias in self.aliases if normalize(alias)}

    def to_payload(self) -> Dict[str, object]:
        aliases_sorted = sorted(alias for alias in self.aliases if alias)
        norm_aliases_sorted = sorted(self.normalized_aliases)
        return {
            "name": self.primary_name,
            "family": self.primary_name,
            "style": "Regular",
            "postScriptName": self.gdi_name,
            "gdiName": self.gdi_name,
            "aliases": aliases_sorted,
            "normalizedAliases": norm_aliases_sorted,
            "languageNames": self.language_names,
            "forceBitmap": False,
            "paths": [],
            "key": self.key,
        }


class FontRegistry:
    def __init__(self) -> None:
        self._records: List[FontMeta] = []
        self._by_key: Dict[str, FontMeta] = {}
        self._load()
        self._write_debug_files()

    @property
    def fonts(self) -> List[FontMeta]:
        return list(self._records)

    def _load(self) -> None:
        LOG.info("Enumerating fonts via EnumFontFamiliesExW ...")
        enumerator = FontEnumerator()
        families = enumerator.enumerate_all_fonts()
        LOG.info("Found %d font families", len(families))

        for face_name in families:
            names = get_all_name_variants(face_name)
            localized = get_localized_family_names(face_name)

            english = localized.get("en")
            if not english:
                # Try any language that starts with en (e.g., en-us)
                english = next(
                    (value for key, value in localized.items() if key.startswith("en")),
                    None,
                )
            primary_name = english or face_name
            gdi_name = face_name

            aliases = set(names)
            aliases.discard("")
            aliases.add(face_name)
            if english:
                aliases.add(english)

            meta = FontMeta(
                primary_name=primary_name,
                gdi_name=gdi_name,
                aliases=aliases,
                language_names=localized,
            )

            inserted = self._register(meta)
            if not inserted:
                LOG.debug("Duplicate font skipped: %s", face_name)

        self._records.sort(key=lambda meta: meta.primary_name.lower())
        LOG.info("Catalog ready with %d entries", len(self._records))

    def _register(self, meta: FontMeta) -> bool:
        # Avoid overriding existing entries for the same normalized key
        keys = {meta.key} | meta.normalized_aliases
        existing = None
        for key in keys:
            if key in self._by_key:
                existing = self._by_key[key]
                break
        if existing:
            return False
        self._records.append(meta)
        for key in keys:
            if key:
                self._by_key[key] = meta
        return True

    def find(self, name: Optional[str]) -> Optional[FontMeta]:
        if not name and name != 0:
            return None
        key = normalize(name)
        return self._by_key.get(key)

    def catalog(self) -> List[Dict[str, object]]:
        return [meta.to_payload() for meta in self._records]

    def _write_debug_files(self) -> None:
        try:
            debug_dir = get_debug_dir()
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

            gdi_file = debug_dir / f'gdi_families_{timestamp}.txt'
            with gdi_file.open('w', encoding='utf-8') as handle:
                handle.write("EnumFontFamiliesExW Results\n")
                handle.write(f"Count: {len(self._records)}\n")
                handle.write("=" * 80 + "\n")
                for idx, meta in enumerate(sorted(self._records, key=lambda m: m.primary_name.lower()), 1):
                    handle.write(f"{idx:04d}. {meta.primary_name}\n")
                    handle.write(f"      GDI Name: {meta.gdi_name}\n")
                    if meta.aliases:
                        sample = ', '.join(sorted(meta.aliases))[:500]
                        handle.write(f"      Aliases: {sample}\n")
                    if meta.language_names:
                        sample_langs = ', '.join(f"{lang}:{name}" for lang, name in list(meta.language_names.items())[:4])
                        handle.write(f"      Languages: {sample_langs}\n")
                    handle.write("\n")

            catalog_file = debug_dir / f'font_catalog_{timestamp}.json'
            with catalog_file.open('w', encoding='utf-8') as handle:
                json.dump(self.catalog(), handle, ensure_ascii=False, indent=2)
        except Exception as exc:
            LOG.warning("Failed to write font registry debug files: %s", exc)


class PreviewService:
    def __init__(self, registry: FontRegistry) -> None:
        self.registry = registry
        self.renderer = GDIRenderer(LOG.info)
        self._gdi_log = get_debug_dir()

    def render_entry(
        self,
        entry: Dict[str, object],
        text: str,
        size: int,
    ) -> Optional[Dict[str, object]]:
        width = 0
        raw_width = entry.get("width")
        if isinstance(raw_width, (int, float)):
            width = int(max(0, raw_width))
        elif isinstance(raw_width, str) and raw_width.isdigit():
            width = int(raw_width)

        weight, italic = parse_style_flags(
            font_name=str(entry.get("name") or ""),
            style_hint=str(entry.get("style") or ""),
            ps_name=str(entry.get("postScriptName") or ""),
        )

        base_alias_pool: Set[str] = set()

        def add_alias_source(value: Optional[str]) -> None:
            if not value and value != 0:
                return
            text_value = str(value).strip()
            if text_value:
                base_alias_pool.add(text_value)

        add_alias_source(entry.get("name"))
        raw_aliases = entry.get("aliases")
        if isinstance(raw_aliases, list):
            for alias in raw_aliases:
                add_alias_source(alias)
        add_alias_source(entry.get("postScriptName"))
        add_alias_source(entry.get("family"))

        candidate_strings: List[str] = []
        seen_candidates: Set[str] = set()

        def add_candidate(value: Optional[str]) -> None:
            if not value and value != 0:
                return
            candidate = str(value).strip()
            if not candidate:
                return
            key = normalize(candidate)
            if key in seen_candidates:
                return
            seen_candidates.add(key)
            candidate_strings.append(candidate)

        add_candidate(entry.get("name"))
        if isinstance(raw_aliases, list):
            for alias in raw_aliases:
                add_candidate(alias)
        add_candidate(entry.get("postScriptName"))
        add_candidate(entry.get("family"))

        attempt_queue: List[Tuple[str, Set[str], Optional[FontMeta], str]] = []
        attempted_faces: Set[str] = set()

        def enqueue(face_name: str, record: Optional[FontMeta], source: str) -> None:
            normalized = normalize(face_name)
            if not normalized or normalized in attempted_faces:
                return
            attempted_faces.add(normalized)
            alias_names = set(base_alias_pool)
            alias_names.add(face_name)
            if record:
                alias_names.update(record.aliases)
            attempt_queue.append((face_name, alias_names, record, source))

        for candidate in candidate_strings:
            record = self.registry.find(candidate)
            enqueue(candidate, record, "request")
            if record and record.gdi_name:
                enqueue(record.gdi_name, record, "registry")

        if not attempt_queue:
            return None

        for face_name, alias_names, record, source in attempt_queue:
            image, substituted = self.renderer.render(
                face_name,
                text,
                size,
                weight=weight,
                italic=int(bool(italic)),
                target_width=width,
                alias_names=alias_names,
            )
            actual_face = getattr(self.renderer, "last_actual_face", "")
            self._log_gdi_attempt(
                entry,
                face_name=face_name,
                actual_face=actual_face,
                status="substituted" if substituted else ("success" if image else "failed"),
                source=source,
            )
            if substituted:
                continue
            if not image:
                continue

            request_id = entry.get("requestId")
            if not request_id:
                key_hint = record.key if record else normalize(face_name)
                request_id = f"{key_hint}:{width}"

            normalized_key = record.key if record else normalize(face_name)
            python_key = entry.get("pythonKey") or normalized_key
            return {
                "requestId": request_id,
                "fontName": entry.get("name") or (record.primary_name if record else face_name),
                "faceName": face_name,
                "resolvedName": actual_face or face_name,
                "image": image,
                "substituted": False,
                "normalizedKey": normalized_key,
                "pythonKey": python_key,
            }

        return None

    def render_batch(
        self,
        fonts: Iterable[Dict[str, object]],
        text: str,
        size: int,
    ) -> List[Dict[str, object]]:
        results: List[Dict[str, object]] = []
        for entry in fonts:
            rendered = self.render_entry(entry, text, size)
            if rendered:
                results.append(rendered)
        return results

    def render_single(self, name: str, text: str, size: int) -> Optional[Dict[str, object]]:
        return self.render_entry({"name": name}, text, size)

    def _log_gdi_attempt(
        self,
        entry: Dict[str, object],
        face_name: str,
        actual_face: str,
        status: str,
        source: str,
    ) -> None:
        try:
            self._gdi_log.mkdir(exist_ok=True)
            logfile = self._gdi_log / 'gdi_attempts.log'
            payload = {
                "timestamp": datetime.now().isoformat(timespec='seconds'),
                "requestName": entry.get("name"),
                "faceTried": face_name,
                "actualFace": actual_face,
                "status": status,
                "source": source,
                "width": entry.get("width"),
                "style": entry.get("style"),
                "pythonKey": entry.get("pythonKey"),
            }
            with logfile.open('a', encoding='utf-8') as handle:
                handle.write(json.dumps(payload, ensure_ascii=False) + '\n')
        except Exception as exc:
            LOG.debug("Failed to log GDI attempt: %s", exc)


REGISTRY = FontRegistry()
PREVIEW = PreviewService(REGISTRY)


class FontServerHandler(BaseHTTPRequestHandler):
    server_version = "FontServer/1.0"

    def log_message(self, fmt: str, *args) -> None:  # noqa: D401, A003
        # Suppress default logging; we already log via logging module.
        LOG.debug("%s - %s", self.address_string(), fmt % args)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _set_cors_headers(handler: "FontServerHandler") -> None:
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        handler.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, payload: Dict[str, object], status: HTTPStatus = HTTPStatus.OK) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self._set_cors_headers(self)
        self.end_headers()
        self.wfile.write(data)

    def _parse_json_body(self) -> Optional[Dict[str, object]]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return None
        body = self.rfile.read(length)
        try:
            return json.loads(body.decode("utf-8"))
        except json.JSONDecodeError:
            return None

    # ------------------------------------------------------------------
    # HTTP methods
    # ------------------------------------------------------------------
    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self._set_cors_headers(self)
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/ping":
            self._send_json({"status": "ok"})
            return

        if parsed.path == "/fonts":
            self._send_json({"fonts": REGISTRY.catalog(), "count": len(REGISTRY.fonts)})
            return

        if parsed.path.startswith("/preview/"):
            font_name = unquote(parsed.path.split("/preview/", 1)[1])
            params = parse_qs(parsed.query or "")
            text = params.get("text", ["Sample"])[0]
            try:
                size = int(float(params.get("size", ["24"])[0]))
            except (ValueError, TypeError):
                size = 24

            rendered = PREVIEW.render_single(font_name, text, size)
            if not rendered:
                self._send_json({"error": "Font not found or render failed"}, HTTPStatus.NOT_FOUND)
                return
            self._send_json({"preview": rendered})
            return

        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/batch-preview":
            self._handle_batch_preview()
            return
        if parsed.path == "/debug/cep-fonts":
            self._handle_cep_font_debug()
            return

        self.send_error(HTTPStatus.NOT_FOUND)

    def _handle_batch_preview(self):
        payload = self._parse_json_body()
        if not payload:
            self._send_json({"error": "Invalid JSON"}, HTTPStatus.BAD_REQUEST)
            return

        fonts = payload.get("fonts")
        text = payload.get("text", "Sample")
        size = payload.get("size", 24)
        if not isinstance(fonts, list) or not fonts:
            self._send_json({"previews": []})
            return
        try:
            size = int(float(size))
        except (ValueError, TypeError):
            size = 24

        previews = PREVIEW.render_batch(fonts, text, size)
        self._send_json({"previews": previews, "count": len(previews)})

    def _handle_cep_font_debug(self):
        payload = self._parse_json_body()
        if not payload:
            self._send_json({"error": "Invalid JSON"}, HTTPStatus.BAD_REQUEST)
            return

        fonts = payload.get("fonts")
        label = payload.get("label") or "cep"
        if not isinstance(fonts, list):
            self._send_json({"error": "fonts must be a list"}, HTTPStatus.BAD_REQUEST)
            return

        try:
            debug_dir = get_debug_dir()
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            target = debug_dir / f'cep_fonts_{timestamp}.json'
            with target.open('w', encoding='utf-8') as handle:
                json.dump({"label": label, "count": len(fonts), "fonts": fonts}, handle, ensure_ascii=False, indent=2)
            self._send_json({"status": "ok", "saved": str(target)})
        except Exception as exc:
            LOG.warning("Failed to write CEP font debug file: %s", exc)
            self._send_json({"error": "write-failed"}, HTTPStatus.INTERNAL_SERVER_ERROR)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="AE Font Preview helper server")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Port to listen on")
    return parser.parse_args()


def run_server(port: int = DEFAULT_PORT) -> None:
    server = HTTPServer(("127.0.0.1", port), FontServerHandler)
    print(f"PORT:{port}", flush=True)
    LOG.info("Font server listening on http://127.0.0.1:%d", port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        LOG.info("Shutting down font server")
    finally:
        server.server_close()


if __name__ == "__main__":
    args = parse_args()
    run_server(args.port)
