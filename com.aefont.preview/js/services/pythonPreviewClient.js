(function(window) {
    'use strict';

    class PythonPreviewClient {
        constructor(baseUrl) {
            this.baseUrl = baseUrl || 'http://127.0.0.1:8765';
        }

        async waitUntilReady(timeout = 5000, interval = 300) {
            const start = Date.now();
            while (Date.now() - start < timeout) {
                try {
                    const response = await fetch(`${this.baseUrl}/ping`, { cache: 'no-store' });
                    if (response && response.ok) {
                        return true;
                    }
                } catch (error) {
                    // ignore and retry
                }
                await new Promise(resolve => setTimeout(resolve, interval));
            }
            return false;
        }

        async fetchFontCatalog() {
            try {
                const response = await fetch(`${this.baseUrl}/fonts`, { cache: 'no-store' });
                if (!response.ok) {
                    throw new Error(`Status ${response.status}`);
                }
                const data = await response.json();
                const map = new Map();
                if (data && Array.isArray(data.fonts)) {
                    data.fonts.forEach(font => {
                        const key = this._normalize(font.name);
                        map.set(key, {
                            key,
                            name: font.name,
                            family: font.family || font.name,
                            style: font.style || 'Regular',
                            paths: font.paths || [],
                            forceBitmap: font.forceBitmap || false,
                            apply: font.apply !== undefined ? font.apply : true,
                            postScriptName: font.postScriptName || font.name,
                            weight: font.weight || null
                        });
                    });
                }
                return map;
            } catch (error) {
                console.warn('[PythonPreviewClient] Failed to fetch font catalog:', error);
                return new Map();
            }
        }

        async fetchBatchPreviews(fontNames, text, size) {
            if (!Array.isArray(fontNames) || fontNames.length === 0) {
                return [];
            }
            try {
                const response = await fetch(`${this.baseUrl}/batch-preview`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ fonts: fontNames, text, size })
                });
                if (!response.ok) {
                    throw new Error(`Status ${response.status}`);
                }
                const data = await response.json();
                return Array.isArray(data.previews) ? data.previews : [];
            } catch (error) {
                console.warn('[PythonPreviewClient] Batch preview request failed:', error);
                return [];
            }
        }

        async fetchPreview(fontName, text, size) {
            try {
                const response = await fetch(`${this.baseUrl}/preview/${encodeURIComponent(fontName)}?text=${encodeURIComponent(text)}&size=${size}`);
                if (!response.ok) {
                    throw new Error(`Status ${response.status}`);
                }
                const data = await response.json();
                return data && data.image ? data.image : null;
            } catch (error) {
                console.warn('[PythonPreviewClient] Preview request failed:', error);
                return null;
            }
        }

        _normalize(name) {
            if (!name && name !== 0) {
                return '';
            }
            return String(name).toLowerCase().replace(/\s+/g, '').replace(/[_-]/g, '');
        }
    }

    window.PythonPreviewClient = PythonPreviewClient;
})(window);
