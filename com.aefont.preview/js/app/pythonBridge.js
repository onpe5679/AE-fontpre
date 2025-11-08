(function(window) {
    'use strict';

    const utils = window.AEFontUtils;
    const ProcessManager = window.PythonProcessManager;
    const PreviewClient = window.PythonPreviewClient;

    if (!utils || !ProcessManager || !PreviewClient) {
        window.AEFontPythonBridge = null;
        return;
    }

    let processManager = null;
    let client = null;
    let ready = false;
    let catalog = new Map();
    const previewCache = new Map();

    function normalize(value) {
        return utils.normalizeFontKey(value);
    }

    function rebuildCatalogAliases() {
        if (!(catalog instanceof Map)) {
            catalog = new Map();
            return;
        }
        const aliasPairs = [];
        catalog.forEach(meta => {
            if (!meta) {
                return;
            }
            const aliasList = Array.isArray(meta.normalizedAliases) ? meta.normalizedAliases : [];
            aliasList.forEach(alias => {
                if (!alias) {
                    return;
                }
                if (!catalog.has(alias)) {
                    aliasPairs.push([alias, meta]);
                }
            });
            const primaryKey = meta.key || normalize(meta.name);
            if (primaryKey && !catalog.has(primaryKey)) {
                aliasPairs.push([primaryKey, meta]);
            }
        });
        aliasPairs.forEach(([key, meta]) => {
            catalog.set(key, meta);
        });
    }

    function findMetaForFont(font) {
        if (!ready || !(catalog instanceof Map) || catalog.size === 0 || !font) {
            return null;
        }
        const candidates = new Set();

        function addCandidate(value) {
            const key = normalize(value);
            if (key) {
                candidates.add(key);
            }
        }

        addCandidate(font.pythonKey);
        addCandidate(font.displayName);
        addCandidate(font.family);
        addCandidate(font.postScriptName);

        if (font.aliases && typeof font.aliases.forEach === 'function') {
            font.aliases.forEach(alias => addCandidate(alias));
        }
        if (font.normalizedAliases && typeof font.normalizedAliases.forEach === 'function') {
            font.normalizedAliases.forEach(key => {
                if (key) {
                    candidates.add(key);
                }
            });
        }

        for (const key of candidates) {
            if (catalog.has(key)) {
                return catalog.get(key);
            }
        }
        return null;
    }

    function buildCacheKey(fontKey, text, size, width, styleKey) {
        const base = fontKey || '';
        const style = styleKey || '';
        const normalizedText = (text || '').slice(0, 200);
        return `${base}::${style}::${normalizedText}::${size}::${width}`;
    }

    async function ensureClientReady(extensionPathOverride) {
        if (ready && client) {
            return true;
        }

        if (!processManager) {
            processManager = new ProcessManager();
        }

        let extensionPath = extensionPathOverride || null;
        if (!extensionPath) {
            try {
                if (typeof window.CSInterface === 'function') {
                    const temp = new window.CSInterface();
                    extensionPath = temp.getSystemPath('extension');
                } else if (window.csInterface && typeof window.csInterface.getSystemPath === 'function') {
                    extensionPath = window.csInterface.getSystemPath('extension');
                }
            } catch (error) {
                console.warn('[AEFontPythonBridge] Could not determine extension path:', error);
            }
        }

        const started = processManager.start(extensionPath);
        if (!started) {
            return false;
        }

        client = new PreviewClient();
        const alive = await client.waitUntilReady();
        if (!alive) {
            processManager.stop();
            processManager = null;
            client = null;
            return false;
        }

        catalog = await client.fetchFontCatalog();
        rebuildCatalogAliases();
        ready = true;
        return true;
    }

    function mergeFonts(fonts) {
        if (!ready || !Array.isArray(fonts)) {
            return fonts;
        }
        fonts.forEach(font => {
            if (!font) {
                return;
            }
            const meta = findMetaForFont(font);
            if (!meta) {
                font.pythonLookup = font.displayName;
                font.pythonKey = normalize(font.displayName);
                font.canApply = font.canApply !== false;
                return;
            }
            font.pythonInfo = meta;
            font.pythonLookup = meta.name;
            font.pythonKey = meta.key || normalize(meta.name);
            font.paths = meta.paths || [];
            font.externalOnly = false;
            font.canApply = meta.apply !== false;
            if (Array.isArray(meta.aliases)) {
                meta.aliases.forEach(alias => utils.addAlias(font, alias));
            }
            if (Array.isArray(meta.normalizedAliases) && font.normalizedAliases) {
                meta.normalizedAliases.forEach(alias => {
                    if (alias) {
                        font.normalizedAliases.add(alias);
                    }
                });
            }
            if (meta.forceBitmap) {
                font.requiresPython = true;
            }
        });
        return fonts;
    }

    async function fetchBatchPreviews(fontRequests, text, size) {
        if (!ready || !client) {
            return [];
        }
        if (!Array.isArray(fontRequests) || fontRequests.length === 0) {
            return [];
        }

        const cached = [];
        const pending = [];
        const payload = [];

            fontRequests.forEach(request => {
                if (!request) {
                    return;
                }
                const baseKey = request.pythonKey || normalize(request.name || request.postScriptName || request.family);
                const widthValue = Number.isFinite(request.width) ? Math.max(0, Math.round(request.width)) : 0;
                const styleMarker = request.style || request.postScriptName || request.name;
                const cacheKey = buildCacheKey(baseKey, text, size, widthValue, styleMarker);
            if (previewCache.has(cacheKey)) {
                const cachedResult = Object.assign({}, previewCache.get(cacheKey), {
                    requestId: request.requestId || `${baseKey}__${widthValue}`,
                });
                cached.push(cachedResult);
                return;
            }
            const aliasList = Array.isArray(request.aliases)
                ? request.aliases.filter(value => typeof value === 'string' && value.trim().length)
                : [];
            const payloadEntry = {
                name: request.name,
                aliases: aliasList,
                postScriptName: request.postScriptName || request.postscript || null,
                style: request.style || null,
                width: widthValue,
                requestId: request.requestId || `${request.name || baseKey}__${widthValue}`,
                pythonKey: baseKey,
            };
            payload.push(payloadEntry);
            pending.push({ cacheKey, requestId: payloadEntry.requestId });
        });

        if (payload.length === 0) {
            return cached;
        }

        let fetched = [];
        try {
            fetched = await client.fetchBatchPreviews(payload, text, size);
        } catch (error) {
            console.warn('[AEFontPythonBridge] Batch preview request failed:', error);
            return cached;
        }

        if (!Array.isArray(fetched)) {
            return cached;
        }

        fetched.forEach(result => {
            if (!result || !result.image) {
                return;
            }
            const matching = pending.find(entry => entry.requestId === result.requestId);
            if (!matching) {
                return;
            }
            previewCache.set(matching.cacheKey, result);
        });

        return cached.concat(fetched);
    }

    function clearPreviewCache() {
        previewCache.clear();
    }

    function stop() {
        if (processManager) {
            try {
                processManager.stop();
            } catch (error) {
                console.warn('[AEFontPythonBridge] Failed to stop helper:', error);
            }
        }
        processManager = null;
        client = null;
        ready = false;
        catalog = new Map();
        previewCache.clear();
    }

    window.AEFontPythonBridge = {
        async init(extensionPath) {
            return ensureClientReady(extensionPath);
        },
        isReady() {
            return ready;
        },
        stop,
        mergeFonts,
        findMetaForFont,
        clearPreviewCache,
        buildCacheKey,
        fetchBatchPreviews,
        getCatalog() {
            return catalog;
        }
    };
})(window);
