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
import hashlib
import threading
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
import argparse
from typing import Dict, Iterable, List, Optional, Set, Tuple
from urllib.parse import parse_qs, urlparse, unquote
from datetime import datetime
from pathlib import Path

from font_enumerator import FontEnumerator
from font_inspector import get_all_name_variants, get_localized_family_names
from font_name_resolver import parse_style_flags
from gdi_renderer import GDIRenderer, FW_NORMAL


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


def get_cache_dir() -> Path:
    """Return a user-writable directory for font cache."""
    root = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
    if not root:
        root = str(Path.home())
    base = Path(root) / "AEFontPreview" / "cache"
    try:
        base.mkdir(parents=True, exist_ok=True)
    except Exception:
        # As a last resort, use current working directory
        base = Path("cache")
        base.mkdir(exist_ok=True)
    return base


def get_font_list_hash() -> str:
    """Generate a hash of system fonts to detect changes."""
    try:
        enumerator = FontEnumerator()
        families = enumerator.enumerate_all_fonts()
        # Sort to ensure consistent hash
        sorted_families = sorted(families)
        hash_input = "\n".join(sorted_families).encode('utf-8')
        return hashlib.sha256(hash_input).hexdigest()[:16]
    except Exception:
        return ""


_reconfigure_stdio()

LOG = logging.getLogger("font_server")
logging.basicConfig(
    level=logging.INFO,
    format="[font_server] %(message)s",
    stream=sys.stdout,
)

DEFAULT_PORT = int(os.environ.get("AE_FONT_SERVER_PORT", "8765"))
RBIZ_STYLES = {
    "",
    "regular",
    "bold",
    "italic",
    "bold italic",
    "italic bold",
    "bolditalic",
}


def normalize(value: Optional[str]) -> str:
    if not value and value != 0:
        return ""
    lowered = str(value).lower().strip()
    lowered = lowered.replace("\u3000", " ")  # ideographic space
    lowered = lowered.lstrip("@")  # vertical font flag
    return "".join(ch for ch in lowered if ch.isalnum())


def is_rbiz_style(style: Optional[str]) -> bool:
    if not style and style != 0:
        return True
    normalized = " ".join(str(style).lower().split())
    return normalized in RBIZ_STYLES


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
    def __init__(self, background: bool = False) -> None:
        self._records: List[FontMeta] = []
        self._by_key: Dict[str, FontMeta] = {}
        self._is_loading = False
        self._is_ready = False
        self._load_progress = 0.0
        self._load_message = "Initializing..."
        self._lock = threading.RLock()

        if background:
            # Start loading in background thread
            self._is_loading = True
            thread = threading.Thread(target=self._load_async, daemon=True)
            thread.start()
        else:
            # Load synchronously (old behavior)
            self._load()
            self._write_debug_files()

    @property
    def fonts(self) -> List[FontMeta]:
        with self._lock:
            return list(self._records)

    @property
    def is_ready(self) -> bool:
        return self._is_ready

    @property
    def is_loading(self) -> bool:
        return self._is_loading

    @property
    def load_progress(self) -> float:
        return self._load_progress

    @property
    def load_message(self) -> str:
        return self._load_message

    def _load_async(self) -> None:
        """Load fonts asynchronously in background thread."""
        try:
            loaded_from_cache = self._load()
            # Only write debug files if we did a full font enumeration (not from cache)
            if not loaded_from_cache:
                # Write debug files in a separate background thread to avoid blocking
                threading.Thread(target=self._write_debug_files, daemon=True).start()
        finally:
            self._is_loading = False
            self._is_ready = True
            self._load_progress = 1.0
            self._load_message = "Ready"

    def _load(self) -> None:
        """Load fonts from cache or enumerate from system."""
        self._load_message = "Checking cache..."
        self._load_progress = 0.1

        loaded_from_cache = False

        # Try to load from cache first
        if self._load_from_cache():
            LOG.info("Loaded fonts from cache")
            self._is_ready = True
            self._load_progress = 1.0
            loaded_from_cache = True
            # Don't return yet - we still want to write debug files
        else:
            # Cache miss or invalid - enumerate fonts
            self._load_message = "Enumerating fonts..."
            self._load_progress = 0.2
            LOG.info("Enumerating fonts via EnumFontFamiliesExW ...")
            enumerator = FontEnumerator()
            families = enumerator.enumerate_all_fonts()
            LOG.info("Found %d font families", len(families))

            self._load_message = f"Processing {len(families)} fonts..."
            self._load_progress = 0.3

            for idx, face_name in enumerate(families):
                # Update progress
                progress = 0.3 + (0.6 * (idx / max(len(families), 1)))
                self._load_progress = progress

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

            self._load_message = "Finalizing..."
            self._load_progress = 0.9
            with self._lock:
                self._records.sort(key=lambda meta: meta.primary_name.lower())
            LOG.info("Catalog ready with %d entries", len(self._records))

            # Save to cache (only if we didn't load from cache)
            self._save_to_cache()
            self._is_ready = True
            self._load_progress = 1.0

        # Return whether we loaded from cache (so caller knows whether to write debug files)
        return loaded_from_cache

    def _get_cache_path(self) -> Path:
        """Get the cache file path."""
        cache_dir = get_cache_dir()
        font_hash = get_font_list_hash()
        return cache_dir / f"font_cache_{font_hash}.json"

    def _load_from_cache(self) -> bool:
        """Load font registry from cache. Returns True if successful."""
        try:
            cache_path = self._get_cache_path()
            if not cache_path.exists():
                LOG.info("No cache file found")
                return False

            LOG.info("Loading fonts from cache: %s", cache_path)
            with cache_path.open('r', encoding='utf-8') as f:
                data = json.load(f)

            # Validate cache format
            if not isinstance(data, dict) or 'fonts' not in data:
                LOG.warning("Invalid cache format")
                return False

            # Reconstruct FontMeta objects
            for font_data in data['fonts']:
                meta = FontMeta(
                    primary_name=font_data['primary_name'],
                    gdi_name=font_data['gdi_name'],
                    aliases=set(font_data.get('aliases', [])),
                    language_names=font_data.get('language_names', {}),
                )
                self._register(meta)

            with self._lock:
                self._records.sort(key=lambda meta: meta.primary_name.lower())
            LOG.info("Loaded %d fonts from cache", len(self._records))
            return True
        except Exception as e:
            LOG.warning("Failed to load cache: %s", e)
            return False

    def _save_to_cache(self) -> None:
        """Save font registry to cache."""
        try:
            cache_dir = get_cache_dir()

            # Clear old cache files
            for old_cache in cache_dir.glob("font_cache_*.json"):
                try:
                    old_cache.unlink()
                except Exception:
                    pass

            # Save new cache
            cache_path = self._get_cache_path()
            data = {
                'version': 1,
                'timestamp': datetime.now().isoformat(),
                'count': len(self._records),
                'fonts': [
                    {
                        'primary_name': meta.primary_name,
                        'gdi_name': meta.gdi_name,
                        'aliases': list(meta.aliases),
                        'language_names': meta.language_names,
                    }
                    for meta in self._records
                ]
            }

            LOG.info("Saving fonts to cache: %s", cache_path)
            with cache_path.open('w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False)
            LOG.info("Cache saved successfully")
        except Exception as e:
            LOG.warning("Failed to save cache: %s", e)

    def clear_cache(self) -> None:
        """Clear all font cache files."""
        try:
            cache_dir = get_cache_dir()
            for cache_file in cache_dir.glob("font_cache_*.json"):
                try:
                    cache_file.unlink()
                    LOG.info("Deleted cache file: %s", cache_file)
                except Exception as e:
                    LOG.warning("Failed to delete cache file %s: %s", cache_file, e)
        except Exception as e:
            LOG.warning("Failed to clear cache: %s", e)

    def _register(self, meta: FontMeta) -> bool:
        # Avoid overriding existing entries for the same normalized key
        with self._lock:
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
        with self._lock:
            return self._by_key.get(key)

    def catalog(self) -> List[Dict[str, object]]:
        with self._lock:
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

    def close(self) -> None:
        """Clean up GDI resources."""
        if hasattr(self.renderer, 'close'):
            self.renderer.close()

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

        style_hint = str(entry.get("style") or "")
        weight, italic = parse_style_flags(
            font_name=str(entry.get("name") or ""),
            style_hint=style_hint,
            ps_name=str(entry.get("postScriptName") or ""),
        )

        if not is_rbiz_style(style_hint):
            weight = FW_NORMAL
            italic = 0

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


REGISTRY = FontRegistry(background=True)
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

        if parsed.path == "/status":
            self._send_json({
                "isReady": REGISTRY.is_ready,
                "isLoading": REGISTRY.is_loading,
                "progress": REGISTRY.load_progress,
                "message": REGISTRY.load_message,
                "count": len(REGISTRY.fonts)
            })
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
        if parsed.path == "/clear-cache":
            self._handle_clear_cache()
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

    def _handle_clear_cache(self):
        """Handle cache clearing and reload request."""
        global REGISTRY, PREVIEW
        try:
            LOG.info("Clearing font cache and reloading...")

            # Clean up old resources
            global PREVIEW, REGISTRY
            if PREVIEW:
                PREVIEW.close()

            REGISTRY.clear_cache()

            # Reload fonts in background
            REGISTRY = FontRegistry(background=True)
            PREVIEW = PreviewService(REGISTRY)

            self._send_json({"status": "ok", "message": "Cache cleared and reloading"})
        except Exception as exc:
            LOG.warning("Failed to clear cache: %s", exc)
            self._send_json({"error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="AE Font Preview helper server")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Port to listen on")
    return parser.parse_args()


def run_server(port: int = DEFAULT_PORT) -> None:
    server = ThreadingHTTPServer(("127.0.0.1", port), FontServerHandler)
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
