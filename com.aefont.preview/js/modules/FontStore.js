(function(window) {
    'use strict';

    class FontStore {
        constructor() {
            this.fonts = [];
            this.filteredFonts = [];
            this.fontByUid = new Map();
            this.fontsByPythonKey = new Map();
            this.selectedFont = null;
            this.selectedFontId = null;
            this.searchQuery = '';
            this.listeners = new Set();
        }

        setFonts(fonts) {
            this.fonts = fonts;
            this.fontByUid.clear();
            this.fontsByPythonKey.clear();

            fonts.forEach(font => {
                if (font.uid) {
                    this.fontByUid.set(font.uid, font);
                }
                if (font.pythonKey) {
                    if (!this.fontsByPythonKey.has(font.pythonKey)) {
                        this.fontsByPythonKey.set(font.pythonKey, []);
                    }
                    this.fontsByPythonKey.get(font.pythonKey).push(font);
                }
            });

            this.applyFilter();
            this.notifyListeners('fonts-updated');
        }

        applyFilter() {
            const query = this.searchQuery.toLowerCase().trim();

            if (!query) {
                this.filteredFonts = this.fonts;
            } else {
                this.filteredFonts = this.fonts.filter(font => {
                    const targets = [
                        font.displayName,
                        font.family,
                        font.nativeFamily,
                        font.postScriptName,
                        font.style
                    ];

                    return targets.some(target =>
                        target && String(target).toLowerCase().includes(query)
                    );
                });
            }

            this.notifyListeners('filter-updated');
        }

        setSearchQuery(query) {
            this.searchQuery = query;
            this.applyFilter();
        }

        selectFont(fontUid) {
            const font = this.fontByUid.get(fontUid);
            if (!font) {
                return;
            }

            this.selectedFont = font;
            this.selectedFontId = fontUid;
            this.notifyListeners('font-selected', font);
        }

        getFont(fontUid) {
            return this.fontByUid.get(fontUid);
        }

        getFontsByPythonKey(pythonKey) {
            return this.fontsByPythonKey.get(pythonKey) || [];
        }

        getFilteredFonts() {
            return this.filteredFonts;
        }

        getAllFonts() {
            return this.fonts;
        }

        getSelectedFont() {
            return this.selectedFont;
        }

        onChange(listener) {
            this.listeners.add(listener);
            return () => this.listeners.delete(listener);
        }

        notifyListeners(event, data) {
            this.listeners.forEach(listener => {
                try {
                    listener(event, data);
                } catch (error) {
                    console.error('[FontStore] Listener error:', error);
                }
            });
        }

        clear() {
            this.fonts = [];
            this.filteredFonts = [];
            this.fontByUid.clear();
            this.fontsByPythonKey.clear();
            this.selectedFont = null;
            this.selectedFontId = null;
            this.notifyListeners('cleared');
        }
    }

    window.FontStore = FontStore;
})(window);
