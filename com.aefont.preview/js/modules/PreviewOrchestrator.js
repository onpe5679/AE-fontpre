(function(window) {
    'use strict';

    class PreviewOrchestrator {
        constructor(fontStore, options = {}) {
            this.fontStore = fontStore;
            this.pythonBridge = options.pythonBridge || window.AEFontPythonBridge;
            this.utils = options.utils || window.utils;
            this.updateTimer = null;
            this.busy = false;
            this.visibleItems = [];
            this.previewText = '';
            this.fontSize = 24;
        }

        setVisibleItems(items) {
            this.visibleItems = items;
            this.scheduleUpdate();
        }

        setPreviewText(text) {
            this.previewText = text;
            this.scheduleUpdate();
        }

        setFontSize(size) {
            this.fontSize = size;
            this.scheduleUpdate();
        }

        scheduleUpdate(immediate = false) {
            if (this.updateTimer) {
                clearTimeout(this.updateTimer);
            }
            this.updateTimer = setTimeout(() => this.update(), immediate ? 0 : 100);
        }

        async update() {
            if (!this.pythonBridge || !this.pythonBridge.isReady() || this.busy) {
                return;
            }

            if (this.visibleItems.length === 0) {
                return;
            }

            this.busy = true;

            try {
                const requestPayload = [];
                const requestBindings = new Map();

                this.visibleItems.forEach(item => {
                    if (!item.classList.contains('python-render')) {
                        return;
                    }

                    const fontUid = item.dataset.fontUid;
                    const font = this.fontStore.getFont(fontUid);

                    if (!font) {
                        return;
                    }

                    const key = font.pythonKey || (this.utils ? this.utils.normalizeFontKey(font.displayName) : font.displayName);
                    if (!key) {
                        return;
                    }

                    // Get viewport width for proper rendering
                    const previewHost = item.querySelector('.font-preview');
                    const viewportWidth = previewHost ? Math.max(0, Math.floor(previewHost.clientWidth || 0)) : 0;

                    const styleMarker = font.postScriptName || font.id || font.style || '';
                    const cacheKey = this.buildCacheKey(key, this.previewText, this.fontSize, viewportWidth, styleMarker);

                    font.currentPythonCacheKey = cacheKey;

                    // Skip if previously failed
                    if (font._pythonFailedCacheKey === cacheKey) {
                        return;
                    }

                    const requestId = cacheKey;

                    if (!requestBindings.has(requestId)) {
                        requestBindings.set(requestId, []);

                        const aliases = this.collectAliases(font);

                        const requestName = font.displayName
                            || font.nativeFull
                            || font.pythonLookup
                            || font.postScriptName
                            || font.family;

                        requestPayload.push({
                            name: requestName,
                            aliases: aliases,
                            postScriptName: font.postScriptName || null,
                            style: font.style || null,
                            width: viewportWidth,
                            requestId: requestId,
                            pythonKey: key
                        });
                    }

                    requestBindings.get(requestId).push({ font, item });
                });

                if (requestPayload.length === 0) {
                    return;
                }

                // Fetch batch previews
                const previews = await this.pythonBridge.fetchBatchPreviews(
                    requestPayload,
                    this.previewText,
                    this.fontSize
                );

                // Apply previews to DOM
                this.applyPreviews(previews, requestBindings);

            } catch (error) {
                console.error('[PreviewOrchestrator] Update error:', error);
            } finally {
                this.busy = false;
            }
        }

        collectAliases(font) {
            const aliasSet = new Set();

            const add = (value) => {
                if (value && String(value).trim()) {
                    aliasSet.add(String(value).trim());
                }
            };

            add(font.displayName);
            add(font.pythonLookup);
            add(font.postScriptName);
            add(font.family);
            add(font.nativeFamily);
            add(font.nativeFull);

            if (font.nativeFamily && font.nativeStyle) {
                add(`${font.nativeFamily} ${font.nativeStyle}`);
                add(`${font.nativeFamily}-${font.nativeStyle}`);
            }

            if (font.aliases && Array.isArray(font.aliases)) {
                font.aliases.forEach(add);
            }

            return Array.from(aliasSet);
        }

        applyPreviews(previews, requestBindings) {
            if (!Array.isArray(previews)) {
                return;
            }

            previews.forEach(preview => {
                if (!preview || !preview.image) {
                    return;
                }

                const requestId = preview.requestId || preview.pythonKey;
                const bindings = requestBindings.get(requestId);

                if (!bindings) {
                    return;
                }

                bindings.forEach(({ font, item }) => {
                    const img = item.querySelector('.font-preview-image');
                    if (!img) {
                        return;
                    }

                    if (preview.substituted) {
                        font._pythonFailedCacheKey = font.currentPythonCacheKey;
                    }

                    img.src = preview.image;
                    img.classList.add('is-visible');
                    item.classList.add('python-loaded');
                });
            });
        }

        buildCacheKey(key, text, size, width, styleMarker) {
            const textSnippet = (text || '').slice(0, 200);
            return `${key}::${styleMarker}::${textSnippet}::${size}::${width}`;
        }

        destroy() {
            if (this.updateTimer) {
                clearTimeout(this.updateTimer);
            }
            this.busy = false;
            this.visibleItems = [];
        }
    }

    window.PreviewOrchestrator = PreviewOrchestrator;
})(window);
