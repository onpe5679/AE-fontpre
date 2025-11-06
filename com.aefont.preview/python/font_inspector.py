#!/usr/bin/env python3
"""
Utilities for extracting localized font names from Windows GDI.

This module reads the `name` table from a font selected into a device
context via GetFontData so that we can discover aliases (e.g. English
and Korean names) for FR_PRIVATE fonts that never hit the filesystem.
"""

from __future__ import annotations

import ctypes
import struct
from ctypes import wintypes
from typing import Dict, Iterable, Optional, Set

# Constants
LF_FACESIZE = 32
FW_NORMAL = 400
DEFAULT_CHARSET = 1
GDI_ERROR = 0xFFFFFFFF
NAME_TABLE_TAG = 0x656D616E  # 'name'

# Lazy DLL handles
gdi32 = ctypes.windll.gdi32  # type: ignore[attr-defined]
user32 = ctypes.windll.user32  # type: ignore[attr-defined]


class LOGFONTW(ctypes.Structure):
    _fields_ = [
        ("lfHeight", wintypes.LONG),
        ("lfWidth", wintypes.LONG),
        ("lfEscapement", wintypes.LONG),
        ("lfOrientation", wintypes.LONG),
        ("lfWeight", wintypes.LONG),
        ("lfItalic", wintypes.BYTE),
        ("lfUnderline", wintypes.BYTE),
        ("lfStrikeOut", wintypes.BYTE),
        ("lfCharSet", wintypes.BYTE),
        ("lfOutPrecision", wintypes.BYTE),
        ("lfClipPrecision", wintypes.BYTE),
        ("lfQuality", wintypes.BYTE),
        ("lfPitchAndFamily", wintypes.BYTE),
        ("lfFaceName", wintypes.WCHAR * LF_FACESIZE),
    ]


LANG_MAP = {
    0x0409: "en",
    0x0412: "ko",
    0x0411: "ja",
    0x0804: "zh-Hans",
    0x0c0a: "es",
    0x0404: "zh-Hant",
}


def _create_gdi_font(face_name: str) -> wintypes.HFONT:
    logfont = LOGFONTW()
    logfont.lfHeight = -16
    logfont.lfWeight = FW_NORMAL
    logfont.lfCharSet = DEFAULT_CHARSET
    logfont.lfFaceName = face_name[: LF_FACESIZE - 1]
    # ctypes.byref() does not satisfy the LP_LOGFONTW prototype on Python 3.13,
    # so create a real pointer object.
    hfont = gdi32.CreateFontIndirectW(ctypes.pointer(logfont))
    if not hfont:
        raise OSError(f"CreateFontIndirectW failed for '{face_name}'")
    return hfont


def _read_name_table(face_name: str) -> Optional[bytes]:
    hfont = None
    hdc = None
    old_font = None
    try:
        hfont = _create_gdi_font(face_name)
        hdc = user32.GetDC(None)
        if not hdc:
            raise OSError("GetDC returned NULL")
        old_font = gdi32.SelectObject(hdc, hfont)

        size = gdi32.GetFontData(hdc, NAME_TABLE_TAG, 0, None, 0)
        if size in (GDI_ERROR, 0) or size > 1_048_576:
            return None

        buffer = ctypes.create_string_buffer(size)
        result = gdi32.GetFontData(hdc, NAME_TABLE_TAG, 0, buffer, size)
        if result == GDI_ERROR:
            return None
        return buffer.raw
    finally:
        if old_font:
            gdi32.SelectObject(hdc, old_font)
        if hdc:
            user32.ReleaseDC(None, hdc)
        if hfont:
            gdi32.DeleteObject(hfont)


def _decode_windows_name(data: bytes) -> Optional[str]:
    try:
        return data.decode("utf-16-be")
    except Exception:
        return None


def _decode_mac_name(data: bytes) -> Optional[str]:
    for encoding in ("mac_roman", "latin-1", "utf-8"):
        try:
            return data.decode(encoding)
        except Exception:
            continue
    return None


def _iter_name_records(name_table: bytes) -> Iterable[Dict]:
    if len(name_table) < 6:
        return
    count = struct.unpack(">H", name_table[2:4])[0]
    string_offset = struct.unpack(">H", name_table[4:6])[0]

    offset = 6
    for _ in range(count):
        if offset + 12 > len(name_table):
            break
        platform_id = struct.unpack(">H", name_table[offset : offset + 2])[0]
        encoding_id = struct.unpack(">H", name_table[offset + 2 : offset + 4])[0]
        language_id = struct.unpack(">H", name_table[offset + 4 : offset + 6])[0]
        name_id = struct.unpack(">H", name_table[offset + 6 : offset + 8])[0]
        length = struct.unpack(">H", name_table[offset + 8 : offset + 10])[0]
        str_offset = struct.unpack(">H", name_table[offset + 10 : offset + 12])[0]
        offset += 12

        start = string_offset + str_offset
        end = start + length
        if start < 0 or end > len(name_table):
            continue
        payload = name_table[start:end]
        yield {
            "platform": platform_id,
            "encoding": encoding_id,
            "language": language_id,
            "name_id": name_id,
            "data": payload,
        }


def get_localized_family_names(face_name: str) -> Dict[str, str]:
    """Return mapping of language code to localized family name."""
    name_table = _read_name_table(face_name)
    if not name_table:
        return {}

    names: Dict[str, str] = {}
    for record in _iter_name_records(name_table):
        if record["name_id"] != 1:
            continue  # only family names
        text: Optional[str] = None
        if record["platform"] == 3:  # Windows
            text = _decode_windows_name(record["data"])
            lang = LANG_MAP.get(record["language"], f"win-{record['language']:04x}")
        elif record["platform"] == 1:  # Macintosh
            text = _decode_mac_name(record["data"])
            lang = f"mac-{record['language']:04x}"
        else:
            lang = f"p{record['platform']}-{record['language']:04x}"

        if text:
            names[lang] = text
    return names


def get_all_name_variants(face_name: str) -> Set[str]:
    """Return a set of unique family names for the given face."""
    variants: Set[str] = {face_name}
    localized = get_localized_family_names(face_name)
    for value in localized.values():
        variants.add(value)
    return {name.strip() for name in variants if name and name.strip()}
