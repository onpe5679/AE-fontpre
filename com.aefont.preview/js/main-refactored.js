// AE Font Preview - Refactored Main
(function() {
    'use strict';

    // Dependencies
    const i18n = window.AEFontI18n;
    const utils = window.AEFontUtils;
    const errorBoundary = window.AEFontErrorBoundary;

    if (!i18n || !utils) {
        console.error('[AE Font Preview] Missing dependencies');
        return;
    }

    // Core instances
    let csInterface;
    let fontStore;
    let fontListView;
    let previewOrchestrator;
    let isInitialized = false;
    let initRetryCount = 0;
    const MAX_INIT_RETRIES = 5;

    // UI Elements
    let elements = {};

    // =====================
    // Initialization
    // =====================

    async function init() {
        console.log(`[init] Starting (attempt ${initRetryCount + 1})...`);

        // Get UI elements
        elements = {
            fontList: document.getElementById('font-list'),
            searchInput: document.getElementById('search-font'),
            previewTextInput: document.getElementById('preview-text'),
            fontSizeInput: document.getElementById('font-size'),
            sizeValue: document.getElementById('size-value'),
            applyButton: document.getElementById('apply-font'),
            refreshButton: document.getElementById('refresh-fonts'),
            loadTextButton: document.getElementById('load-text-btn'),
            languageSelect: document.getElementById('language-select'),
            fontCount: document.getElementById('font-count'),
            toastContainer: document.getElementById('toast-container')
        };

        if (elements.applyButton) {
            elements.applyButton.disabled = true;
        }

        if (elements.fontSizeInput && elements.sizeValue) {
            elements.sizeValue.textContent = elements.fontSizeInput.value + 'px';
        }

        // Initialize modules
        fontStore = new window.FontStore();

        fontListView = new window.FontListView(elements.fontList, {
            previewText: elements.previewTextInput ? elements.previewTextInput.value : '',
            fontSize: elements.fontSizeInput ? parseInt(elements.fontSizeInput.value) : 24,
            onFontSelect: (fontUid) => handleFontSelect(fontUid),
            applyFontPlan: (font, item) => applyFontRenderingPlan(font, item),
            onVisibilityChange: (visibleItems) => {
                if (previewOrchestrator) {
                    previewOrchestrator.setVisibleItems(visibleItems);
                }
            }
        });

        previewOrchestrator = new window.PreviewOrchestrator(fontStore, {
            pythonBridge: window.AEFontPythonBridge,
            utils: utils
        });

        // Setup event listeners
        setupEventListeners();

        // Cleanup on unload
        window.addEventListener('beforeunload', () => {
            if (fontListView) fontListView.destroy();
            if (previewOrchestrator) previewOrchestrator.destroy();
            if (window.AEFontPythonBridge) {
                try {
                    AEFontPythonBridge.stop();
                } catch (error) {
                    console.warn('[init] Error stopping Python:', error);
                }
            }
        });

        // Initialize Python support
        console.log('[init] Initializing Python...');
        try {
            await initializePythonSupport();
            console.log('[init] Python initialized');
        } catch (error) {
            console.error('[init] Python init failed:', error);
        }

        // Initialize CEP
        console.log('[init] Initializing CSInterface...');
        if (!initCSInterface()) {
            initRetryCount++;
            console.error(`CSInterface init failed (${initRetryCount}/${MAX_INIT_RETRIES})`);

            if (initRetryCount < MAX_INIT_RETRIES) {
                setTimeout(init, 1000);
                return;
            } else {
                showError('CSInterface 초기화 실패. After Effects를 재시작해주세요.');
                return;
            }
        }

        // Load JSX
        await loadJSX();

        // Load fonts
        await loadFonts();

        isInitialized = true;
        console.log('[init] Initialization complete');
    }

    // =====================
    // Python Support
    // =====================

    async function initializePythonSupport() {
        if (!window.AEFontPythonBridge) {
            console.warn('[Python] Bridge not available');
            return;
        }

        const result = await window.AEFontPythonBridge.init(
            null, // extensionPath (auto-detect)
            (status) => {
                console.log('[Python] Status:', status);
                updateLoadingBar(status);
            }
        );

        window.AEFontPythonBridge.onFontsReady((ready, status) => {
            console.log('[Python] Fonts ready!', status);
            hideLoadingBar();

            // Refresh UI with merged data
            if (fontStore && fontStore.getAllFonts().length > 0) {
                fontStore.applyFilter();
            }
        });

        if (window.AEFontPythonBridge.isReady()) {
            hideLoadingBar();
        }

        return result;
    }

    // =====================
    // CSInterface
    // =====================

    function initCSInterface() {
        if (typeof CSInterface === 'undefined') {
            console.error('[CSInterface] Not available');
            return false;
        }

        csInterface = new CSInterface();

        if (!csInterface) {
            return false;
        }

        console.log('[CSInterface] Initialized');
        return true;
    }

    async function loadJSX() {
        const extensionPath = csInterface.getSystemPath('extension');
        const jsxPath = extensionPath + '/jsx/hostscript.jsx';

        console.log('[JSX] Loading from:', jsxPath);

        return new Promise((resolve) => {
            csInterface.evalScript(`$.evalFile("${jsxPath}")`, (result) => {
                if (result === 'EvalScript error.') {
                    console.warn('[JSX] EvalScript error, checking if already loaded...');
                    csInterface.evalScript('typeof AEFontPreview_getFonts', (typeResult) => {
                        if (typeResult === 'function') {
                            console.log('[JSX] Already loaded');
                            resolve(true);
                        } else {
                            console.error('[JSX] Failed to load');
                            resolve(false);
                        }
                    });
                } else {
                    console.log('[JSX] Loaded successfully');
                    resolve(true);
                }
            });
        });
    }

    // =====================
    // Font Loading
    // =====================

    async function loadFonts() {
        console.log('[loadFonts] Starting...');

        return new Promise((resolve) => {
            csInterface.evalScript('AEFontPreview_getFonts()', (result) => {
                try {
                    const data = JSON.parse(result);

                    if (!data || !data.success) {
                        throw new Error(data.error || 'Unknown error');
                    }

                    const rawFonts = data.fonts || [];
                    console.log(`[loadFonts] Fetched ${rawFonts.length} fonts`);

                    const fonts = rawFonts.map((font, index) => createFontObject(font, index));

                    fontStore.setFonts(fonts);
                    updateFontCount(fonts.length);

                    // Ensure web fonts are loaded (async)
                    if (window.AEFontLoader) {
                        Promise.all(fonts.map(font => ensureFontForPreview(font)))
                            .then(() => {
                                console.log('[loadFonts] Font loading complete, re-rendering...');
                                // Re-render to update requiresPython flags
                                fontStore.applyFilter();
                            })
                            .catch(error => {
                                console.error('[loadFonts] Font loading error:', error);
                            });
                    }

                    resolve(fonts);
                } catch (error) {
                    console.error('[loadFonts] Error:', error);
                    showError('폰트 로딩 실패: ' + error.message);
                    resolve([]);
                }
            });
        });
    }

    function createFontObject(font, index) {
        const displayName = font.name || font.family || font.postScriptName || `Unknown Font ${index}`;
        const family = font.family || displayName;
        const style = font.style || 'Regular';
        const postScriptName = font.postScriptName || '';

        const nativeFamily = font.nativeFamily ? decodeNativeValue(font.nativeFamily) : family;
        const nativeStyle = font.nativeStyle ? decodeNativeValue(font.nativeStyle) : style;
        const nativeFull = font.nativeName ? decodeNativeValue(font.nativeName) : (nativeFamily + ' ' + nativeStyle);

        const uid = `${utils.normalizeFontKey(displayName)}_${index}`;

        // Determine if Python rendering is required
        const requiresPython = shouldUsePythonRendering(font);

        const pythonKey = utils.normalizeFontKey(nativeFamily);

        return {
            uid,
            displayName,
            family,
            style,
            postScriptName,
            nativeFamily,
            nativeStyle,
            nativeFull,
            requiresPython,
            pythonKey,
            pythonLookup: nativeFamily,
            id: font.id || null
        };
    }

    function shouldUsePythonRendering(font) {
        // Check if font requires Python/GDI rendering
        const nativeFamily = font.nativeFamily || font.family || '';

        // Korean, Japanese, Chinese characters detection
        const hasAsianChars = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(nativeFamily);

        // If has Asian chars, definitely use Python
        if (hasAsianChars) {
            return true;
        }

        // Otherwise, check if CSS rendering will fail
        // This will be re-evaluated after web fonts are loaded
        return false;
    }

    function ensureFontForPreview(font) {
        if (font.requiresPython) {
            return Promise.resolve();
        }

        if (!window.AEFontLoader) {
            // No loader available, fallback to Python
            font.requiresPython = true;
            return Promise.resolve();
        }

        // Build CSS families for font rendering
        font.cssFamilies = font.cssFamilies || [];

        if (font.postScriptName && !font.cssFamilies.includes(font.postScriptName)) {
            font.cssFamilies.push(font.postScriptName);
        }
        if (font.displayName && !font.cssFamilies.includes(font.displayName)) {
            font.cssFamilies.push(font.displayName);
        }
        if (font.family && !font.cssFamilies.includes(font.family)) {
            font.cssFamilies.push(font.family);
        }

        // Try to load web font if available
        const candidates = [font.postScriptName, font.displayName, font.family].filter(Boolean);

        window.AEFontLoader.register([{
            id: font.uid,
            family: font.family,
            matches: candidates
        }]);

        // Attempt to load the font
        return window.AEFontLoader.ensureFont(font).then(() => {
            // After loading attempt, check if renderable
            if (window.AEFontRender && !window.AEFontRender.isRenderable(font)) {
                console.log(`[Font] CSS rendering not available for ${font.displayName}, using Python`);
                font.requiresPython = true;
                font.webFontStatus = 'render-failed';
            }
        }).catch(error => {
            console.warn(`[Font] Web font loading failed for ${font.displayName}, using Python:`, error);
            font.requiresPython = true;
            font.webFontStatus = 'failed';
        });
    }

    function applyFontRenderingPlan(font, element) {
        if (font.requiresPython) {
            // Python rendering - hide text, show image placeholder
            const textElem = element.querySelector('.font-preview-text');
            const imgElem = element.querySelector('.font-preview-image');

            if (textElem) textElem.style.display = 'none';
            if (imgElem) imgElem.style.display = 'block';
        } else {
            // CSS rendering
            const textElem = element.querySelector('.font-preview-text');
            const imgElem = element.querySelector('.font-preview-image');

            if (textElem) {
                textElem.style.display = 'block';

                if (window.AEFontRender) {
                    const plan = window.AEFontRender.computePlan(font);
                    if (plan && plan.cssString) {
                        textElem.style.fontFamily = plan.cssString;
                    }
                }
            }

            if (imgElem) imgElem.style.display = 'none';
        }
    }

    // =====================
    // Event Handlers
    // =====================

    function setupEventListeners() {
        // Store change listener
        fontStore.onChange((event, data) => {
            if (event === 'filter-updated') {
                const filtered = fontStore.getFilteredFonts();
                fontListView.render(filtered);
                updateFontCount(filtered.length);
            } else if (event === 'font-selected') {
                fontListView.setSelectedFont(fontStore.selectedFontId);
                if (elements.applyButton) {
                    elements.applyButton.disabled = !data;
                }
            }
        });

        // Search
        if (elements.searchInput) {
            elements.searchInput.addEventListener('input', (e) => {
                fontStore.setSearchQuery(e.target.value);
            });
        }

        // Preview text
        if (elements.previewTextInput) {
            elements.previewTextInput.addEventListener('input', (e) => {
                const text = e.target.value;
                fontListView.updatePreviewText(text);
                previewOrchestrator.setPreviewText(text);
            });
        }

        // Font size
        if (elements.fontSizeInput) {
            elements.fontSizeInput.addEventListener('input', (e) => {
                const size = parseInt(e.target.value, 10);
                if (elements.sizeValue) {
                    elements.sizeValue.textContent = size + 'px';
                }
                fontListView.updateFontSize(size);
                previewOrchestrator.setFontSize(size);
            });
        }

        // Apply font
        if (elements.applyButton) {
            elements.applyButton.addEventListener('click', () => {
                const font = fontStore.getSelectedFont();
                if (font) {
                    applyFont(font);
                }
            });
        }

        // Refresh
        if (elements.refreshButton) {
            elements.refreshButton.addEventListener('click', () => {
                loadFonts();
            });
        }

        // Load text from composition
        if (elements.loadTextButton) {
            elements.loadTextButton.addEventListener('click', () => {
                loadTextFromComposition();
            });
        }

        // Language select
        if (elements.languageSelect) {
            elements.languageSelect.value = i18n.getLanguage();
            elements.languageSelect.addEventListener('change', (e) => {
                i18n.setLanguage(e.target.value);
            });
        }
    }

    function handleFontSelect(fontUid) {
        fontStore.selectFont(fontUid);
    }

    function applyFont(font) {
        const fontNameForApply = font.postScriptName || font.displayName || font.family;

        if (!fontNameForApply) {
            showToast('적용할 폰트 이름을 찾을 수 없습니다', 'error');
            return;
        }

        console.log('[applyFont] Applying:', fontNameForApply);

        csInterface.evalScript(`AEFontPreview_applyFont("${fontNameForApply}")`, (result) => {
            try {
                const data = JSON.parse(result);
                if (data && data.success) {
                    showToast(`폰트 "${font.displayName}" 적용 완료`, 'success');
                } else {
                    showToast('폰트 적용 실패: ' + (data.error || 'Unknown error'), 'error');
                }
            } catch (error) {
                console.error('[applyFont] Error:', error);
                showToast('폰트 적용 실패', 'error');
            }
        });
    }

    function loadTextFromComposition() {
        csInterface.evalScript('AEFontPreview_getTextFromSelection()', (result) => {
            try {
                const data = JSON.parse(result);
                if (data && data.success && data.text) {
                    if (elements.previewTextInput) {
                        elements.previewTextInput.value = data.text;
                        fontListView.updatePreviewText(data.text);
                        previewOrchestrator.setPreviewText(data.text);
                    }
                    showToast('텍스트 불러오기 완료', 'success');
                } else {
                    showToast('텍스트를 찾을 수 없습니다', 'warning');
                }
            } catch (error) {
                console.error('[loadText] Error:', error);
                showToast('텍스트 불러오기 실패', 'error');
            }
        });
    }

    // =====================
    // UI Helpers
    // =====================

    function updateFontCount(count) {
        if (elements.fontCount) {
            elements.fontCount.textContent = `${count}개 폰트`;
        }
    }

    function showError(message) {
        if (elements.fontList) {
            const div = document.createElement('div');
            div.className = 'error-message';
            div.style.color = 'red';
            div.textContent = message;
            elements.fontList.innerHTML = '';
            elements.fontList.appendChild(div);
        }
    }

    function showToast(message, type = 'info') {
        if (!elements.toastContainer) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;

        elements.toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    function updateLoadingBar(status) {
        const loader = document.getElementById('floating-loader');
        if (!loader) return;

        if (status.isLoading) {
            loader.style.display = 'flex';
            const text = document.getElementById('loader-text');
            const percentage = document.getElementById('loader-percentage');
            const fill = document.getElementById('loader-progress-fill');

            if (text) text.textContent = status.message || 'Loading...';
            if (percentage) percentage.textContent = Math.round(status.progress * 100) + '%';
            if (fill) fill.style.width = (status.progress * 100) + '%';
        } else {
            loader.style.display = 'none';
        }
    }

    function hideLoadingBar() {
        const loader = document.getElementById('floating-loader');
        if (loader) {
            loader.style.display = 'none';
        }
    }

    function decodeNativeValue(value) {
        if (!value) return '';
        try {
            return decodeURIComponent(value);
        } catch (error) {
            return String(value);
        }
    }

    // =====================
    // Start Application
    // =====================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
