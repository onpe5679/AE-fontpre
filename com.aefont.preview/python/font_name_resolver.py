#!/usr/bin/env python3
"""
Font Name Resolver - Translates display names to GDI-compatible font names.

This module handles the conversion of user-facing font names to actual font face names
that Windows GDI can recognize, and extracts style flags (bold, italic) from font metadata.
"""


def normalize_name(name: str) -> str:
    """Normalize a font name for comparison."""
    if not name:
        return ''
    return ''.join(ch for ch in name.lower() if ch.isalnum())


def strip_style_suffix(name: str) -> str:
    """
    Remove style suffixes from a font name to get the family name.
    
    Example: "210 Santorini Bold" → "210 Santorini"
    """
    if not name:
        return ''
    
    # Common style keywords to remove
    style_keywords = [
        'thin', 'hairline', 'extralight', 'extra light', 'ultralight', 'ultra light',
        'light', 'semilight', 'semi light', 'demilight', 'demi light',
        'book', 'regular', 'normal', 'medium', 'roman',
        'semibold', 'semi bold', 'demibold', 'demi bold',
        'bold', 'heavy', 'black', 'extrabold', 'extra bold', 'ultrabold', 'ultra bold',
        'italic', 'oblique', 'slanted', 'inclined',
        'condensed', 'compressed', 'narrow', 'extended', 'expanded', 'wide'
    ]
    
    # Remove trailing style keywords (case insensitive)
    result = name.strip()
    changed = True
    while changed:
        changed = False
        for keyword in style_keywords:
            # Try with space, hyphen, and underscore separators
            for sep in [' ', '-', '_']:
                pattern = f'{sep}{keyword}'
                if result.lower().endswith(pattern):
                    result = result[:-len(pattern)].strip()
                    changed = True
                    break
            if changed:
                break
    
    return result.strip() or name


def parse_style_flags(font_name: str = None, style_hint: str = None, ps_name: str = None):
    """
    Parse style flags (weight, italic) from font name and style hint.
    
    Args:
        font_name: Display name like "Arial Bold Italic"
        style_hint: Explicit style like "Bold Italic"
        ps_name: PostScript name like "Arial-BoldItalic"
    
    Returns:
        tuple: (weight: int, italic: int)
            weight: 100-900 (400=normal, 700=bold)
            italic: 0 or 1
    """
    # Combine all available name sources
    text_parts = []
    if font_name:
        text_parts.append(font_name)
    if style_hint:
        text_parts.append(style_hint)
    if ps_name:
        text_parts.append(ps_name)
    
    combined = ' '.join(text_parts).lower()
    
    # Detect weight
    weight = 400  # Normal
    if any(kw in combined for kw in ['black', 'heavy', 'ultrablack', 'ultra-black']):
        weight = 900
    elif any(kw in combined for kw in ['extrabold', 'extra-bold', 'ultrabold', 'ultra-bold']):
        weight = 800
    elif any(kw in combined for kw in ['bold']):
        weight = 700
    elif any(kw in combined for kw in ['semibold', 'semi-bold', 'demibold', 'demi-bold']):
        weight = 600
    elif any(kw in combined for kw in ['medium']):
        weight = 500
    elif any(kw in combined for kw in ['light']) and 'bold' not in combined:
        weight = 300
    elif any(kw in combined for kw in ['thin', 'hairline', 'ultralight', 'ultra-light']):
        weight = 200
    
    # Detect italic
    italic = 0
    if any(kw in combined for kw in ['italic', 'oblique', 'slant', 'kursiv', 'cursive']):
        italic = 1
    
    return weight, italic


class FontNameResolver:
    """
    Resolves display font names to GDI-compatible face names.
    
    Priority order:
    1. PostScript name (most reliable)
    2. Display name (as fallback)
    3. Family name (last resort)
    """
    
    def __init__(self, registry=None):
        """
        Initialize the resolver.
        
        Args:
            registry: Optional FontRegistry instance for path lookups
        """
        self.registry = registry
    
    def resolve(self, display_name: str, postscript_name: str = None, 
                family_name: str = None, style: str = None):
        """
        Resolve font names to GDI-compatible format.
        
        Args:
            display_name: User-facing name like "210 Santorini Bold"
            postscript_name: PostScript name like "TTSantoriniB"
            family_name: Font family like "210 Santorini"
            style: Style hint like "Bold" or "Italic"
        
        Returns:
            dict: {
                'faceName': str,     # Name to pass to GDI
                'weight': int,       # 100-900
                'italic': int,       # 0 or 1
                'source': str        # 'postscript', 'display', or 'family'
            }
        """
        # Priority 1: Use PostScript name if available and valid
        # But use Family Name (display name without style) as the face name for GDI
        if postscript_name and postscript_name.strip():
            # Extract family name from display name by removing style suffixes
            if display_name:
                face_name = strip_style_suffix(display_name)
            elif family_name:
                face_name = family_name.strip()
            else:
                # Fallback to PostScript name (may not work well with GDI)
                face_name = postscript_name.strip()
            
            # Parse style flags from PostScript name and style hint
            weight, italic = parse_style_flags(
                font_name=display_name,
                style_hint=style,
                ps_name=postscript_name
            )
            return {
                'faceName': face_name,
                'weight': weight,
                'italic': italic,
                'source': 'postscript'
            }
        
        # Priority 2: Use display name
        if display_name and display_name.strip():
            face_name = display_name.strip()
            weight, italic = parse_style_flags(
                font_name=display_name,
                style_hint=style
            )
            return {
                'faceName': face_name,
                'weight': weight,
                'italic': italic,
                'source': 'display'
            }
        
        # Priority 3: Use family name as last resort
        if family_name and family_name.strip():
            face_name = family_name.strip()
            weight, italic = parse_style_flags(
                font_name=family_name,
                style_hint=style
            )
            return {
                'faceName': face_name,
                'weight': weight,
                'italic': italic,
                'source': 'family'
            }
        
        # Fallback: return Arial
        return {
            'faceName': 'Arial',
            'weight': 400,
            'italic': 0,
            'source': 'fallback'
        }
    
    def resolve_for_gdi(self, display_name: str, postscript_name: str = None,
                        family_name: str = None, style: str = None):
        """
        Convenience method that returns just the face name for GDI.
        
        Returns:
            str: Face name to use with CreateFontIndirectW
        """
        result = self.resolve(display_name, postscript_name, family_name, style)
        return result['faceName']
    
    def resolve_for_pillow(self, display_name: str, postscript_name: str = None,
                           family_name: str = None, style: str = None):
        """
        Resolve font name for Pillow/PIL rendering.
        
        For Pillow, we need to use the actual file path if available.
        Falls back to face name if path lookup fails.
        
        Returns:
            str: Font path or face name
        """
        # Try to get path from registry if available
        if self.registry:
            candidates = [postscript_name, display_name, family_name]
            for candidate in candidates:
                if not candidate:
                    continue
                path = self.registry.resolve_path(candidate)
                if path:
                    return path
        
        # Fallback to face name
        result = self.resolve(display_name, postscript_name, family_name, style)
        return result['faceName']


# Convenience functions for direct use
def resolve_gdi_name(display_name: str, postscript_name: str = None,
                     family_name: str = None, style: str = None) -> str:
    """Quick function to get GDI face name."""
    resolver = FontNameResolver()
    return resolver.resolve_for_gdi(display_name, postscript_name, family_name, style)


def get_style_flags(display_name: str = None, style: str = None, 
                    postscript_name: str = None) -> tuple:
    """Quick function to get (weight, italic) tuple."""
    return parse_style_flags(display_name, style, postscript_name)
