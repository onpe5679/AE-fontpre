// AE Font Preview - Font Family Grouping
(function(window) {
    'use strict';

    if (window.AEFontFamilies) {
        return;
    }

    var STYLE_SUFFIXES = [
        'thin', 'hairline', 'ultrathin', 'extra thin', 'extra-light', 'extralight',
        'light', 'book', 'regular', 'normal', 'medium', 'demi', 'semibold', 'semi bold',
        'bold', 'demi bold', 'extra bold', 'extrabold', 'heavy', 'black', 'ultra', 'ultra bold',
        'italic', 'oblique', 'condensed', 'extended', 'compressed'
    ];

    function styleRegex() {
        return new RegExp('(\\s|-|_)?(' + STYLE_SUFFIXES.join('|') + ')(\\s|-|_|$)', 'i');
    }

    function stripStyleSuffix(name) {
        if (!name && name !== 0) {
            return '';
        }
        var result = String(name).replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (!result) {
            return '';
        }
        var regex = styleRegex();
        var previous;
        do {
            previous = result;
            result = result.replace(new RegExp('(\\s|-|_)?(' + STYLE_SUFFIXES.join('|') + ')(\\s|-|_|$)', 'i'), ' ').trim();
        } while (result && result !== previous && regex.test(previous.slice(-20)));
        return result || String(name).trim();
    }

    function normalizeKey(text) {
        if (!text && text !== 0) {
            return '';
        }
        return stripStyleSuffix(text).toLowerCase().replace(/\s+/g, ' ').trim();
    }

    function mapStyleToWeight(styleName) {
        if (window.AEFontRender && typeof window.AEFontRender.mapStyleToWeight === 'function') {
            return window.AEFontRender.mapStyleToWeight(styleName);
        }
        if (!styleName) {
            return null;
        }
        var name = String(styleName).toLowerCase();
        if (/\bthin\b/.test(name) || name.indexOf('100') !== -1) return 100;
        if (/\bextra\s*light\b/.test(name) || name.indexOf('200') !== -1) return 200;
        if (/\blight\b/.test(name) || name.indexOf('300') !== -1) return 300;
        if (/\bregular\b/.test(name) || /\bnormal\b/.test(name) || name.indexOf('400') !== -1) return 400;
        if (/\bmedium\b/.test(name) || name.indexOf('500') !== -1) return 500;
        if (/\bsemi\s*bold\b/.test(name) || /\bdemi\b/.test(name) || name.indexOf('600') !== -1) return 600;
        if (/\bbold\b/.test(name) || name.indexOf('700') !== -1) return 700;
        if (/\bextra\s*bold\b/.test(name) || name.indexOf('800') !== -1) return 800;
        if (/\bblack\b/.test(name) || /\bheavy\b/.test(name) || name.indexOf('900') !== -1) return 900;
        return null;
    }

    function buildFamilies(fonts) {
        if (!Array.isArray(fonts)) {
            return { fonts: [], families: [] };
        }

        var familyMap = new Map();
        var counter = 0;

        fonts.forEach(function(font) {
            var baseSource = (font.family && font.family.trim()) || font.displayName || font.postScriptName;
            var key = normalizeKey(baseSource);
            if (!key) {
                key = normalizeKey(font.displayName || font.postScriptName);
            }
            if (!key) {
                key = 'family-' + counter++;
            }

            var family = familyMap.get(key);
            if (!family) {
                family = {
                    id: key,
                    key: key,
                    name: stripStyleSuffix(baseSource),
                    fonts: []
                };
                familyMap.set(key, family);
            }

            family.fonts.push(font);
            font.familyId = family.id;
            font.familyKey = key;
        });

        familyMap.forEach(function(family) {
            var weights = new Set();
            var styles = new Set();

            family.fonts.forEach(function(font) {
                var weight = mapStyleToWeight(font.style);
                if (weight !== null) {
                    weights.add(weight);
                }
                if (font.style) {
                    styles.add(font.style);
                }
            });

            family.weights = Array.from(weights).sort();
            family.styles = Array.from(styles);
            family.hasVariants = family.fonts.length > 1;
            family.displayName = family.name || (family.fonts[0] && (family.fonts[0].family || family.fonts[0].displayName)) || family.key;

            family.fonts.forEach(function(font) {
                font.familyMeta = {
                    id: family.id,
                    displayName: family.displayName,
                    memberCount: family.fonts.length,
                    hasVariants: family.hasVariants,
                    weights: family.weights,
                    styles: family.styles
                };
                font.numericWeight = mapStyleToWeight(font.style);
            });
        });

        return {
            fonts: fonts,
            families: Array.from(familyMap.values())
        };
    }

    window.AEFontFamilies = {
        buildFamilies: buildFamilies,
        stripStyleSuffix: stripStyleSuffix,
        normalizeKey: normalizeKey,
        mapStyleToWeight: mapStyleToWeight
    };

})(window);
