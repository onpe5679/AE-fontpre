(function(window) {
    'use strict';

    function normalizeFontKey(name) {
        if (!name && name !== 0) {
            return '';
        }
        return String(name)
            .toLowerCase()
            .replace(/\s+/g, '')
            .replace(/[_-]/g, '');
    }

    function ensureAliasContainers(font) {
        if (!font.aliases) {
            font.aliases = new Set();
        }
        if (!font.normalizedAliases) {
            font.normalizedAliases = new Set();
        }
    }

    function addAlias(font, alias) {
        if (!font || (!alias && alias !== 0)) {
            return;
        }
        const value = String(alias).trim();
        if (!value) {
            return;
        }
        ensureAliasContainers(font);
        font.aliases.add(value);
        const normalized = normalizeFontKey(value);
        if (normalized) {
            font.normalizedAliases.add(normalized);
        }
    }

    function escapeHtml(text) {
        if (text === null || text === undefined) {
            return '';
        }
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function escapeAttr(text) {
        if (text === null || text === undefined) {
            return '';
        }
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    window.AEFontUtils = {
        normalizeFontKey,
        addAlias,
        escapeHtml,
        escapeAttr
    };
})(window);
