// AE Font Preview - Main JavaScript
(function() {
    'use strict';

    if (!window.AEFontI18n || !window.AEFontUtils) {
        console.error('[AE Font Preview] Missing shared modules.');
        return;
    }

    const i18n = window.AEFontI18n;
    const utils = window.AEFontUtils;
    const errorBoundary = window.AEFontErrorBoundary;
    const disablePythonSupport = (() => {
        try {
            return window.localStorage && window.localStorage.getItem('AEFP_DISABLE_PYTHON') === '1';
        } catch (error) {
            return false;
        }
    })();

    function reportError(origin, error) {
        if (errorBoundary && typeof errorBoundary.notify === 'function') {
            errorBoundary.notify(origin, error);
        } else if (error) {
            console.error(`[${origin}]`, error);
        } else {
            console.error(`[${origin}] Unknown error`);
        }
    }

    function decodeNativeValue(value) {
        if (value === undefined || value === null) {
            return '';
        }
        try {
            return decodeURIComponent(value);
        } catch (error) {
            reportError('decodeNativeValue', error);
            return String(value);
        }
    }

    function sendCepFontSnapshot(label, fonts) {
        if (!window.AEFontPythonBridge || typeof fetch !== 'function') {
            return;
        }
        if (!AEFontPythonBridge.isReady() || !Array.isArray(fonts) || fonts.length === 0) {
            return;
        }
        try {
            const payload = {
                label,
                fonts: fonts.map(font => ({
                    displayName: font.displayName,
                    family: font.family,
                    style: font.style,
                    postScriptName: font.postScriptName,
                    nativeFamily: font.nativeFamily,
                    nativeStyle: font.nativeStyle,
                    nativeFull: font.nativeFull
                }))
            };
            fetch('http://127.0.0.1:8765/debug/cep-fonts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).catch(error => {
                console.warn('[AE Font Preview] Failed to send CEP font snapshot:', error);
            });
        } catch (error) {
            reportError('sendCepFontSnapshot', error);
        }
    }

    // Global variables
    let csInterface;
    let currentLanguage = i18n.getLanguage ? i18n.getLanguage() : 'ko';
    let availableFonts = [];
    let fontFamilies = [];
    let selectedFont = null;
    let selectedFontId = null;
    let isInitialized = false;
    let initRetryCount = 0;
    const MAX_INIT_RETRIES = 5;
    let toastContainer;
    let pythonUpdateTimer = null;
    let pythonPreviewBusy = false;
    const fontByUid = new Map();
    const fontsByPythonKey = new Map();
    let fontListElement;
    let previewTextInput;
    let fontSizeInput;
    let applyButton;
    let cepFontSnapshotSent = false;

    if (typeof i18n.onChange === 'function') {
        i18n.onChange(lang => {
            currentLanguage = lang;
            try {
                updateFontCount();
            } catch (error) {
                console.warn('[AE Font Preview] Failed to update font count on language change:', error);
            }
        });
    }
    function showLoadingBar() {
        const loader = document.getElementById('floating-loader');
        if (loader) {
            loader.style.display = 'block';
        }
    }

    function hideLoadingBar() {
        const loader = document.getElementById('floating-loader');
        if (loader) {
            loader.style.display = 'none';
        }
    }

    function updateLoadingBar(status) {
        const loaderText = document.getElementById('loader-text');
        const loaderFill = document.getElementById('loader-progress-fill');
        const loaderPercentage = document.getElementById('loader-percentage');

        if (loaderText && status.message) {
            loaderText.textContent = status.message;
        }

        const progress = Math.min(100, Math.max(0, (status.progress || 0) * 100));
        if (loaderFill) {
            loaderFill.style.width = progress + '%';
        }
        if (loaderPercentage) {
            loaderPercentage.textContent = Math.round(progress) + '%';
        }
    }

    async function initializePythonSupport() {
        console.log('[initializePythonSupport] Starting...');
        if (disablePythonSupport) {
            console.info('[AE Font Preview] Python helper disabled via AEFP_DISABLE_PYTHON flag.');
            return false;
        }
        if (!window.AEFontPythonBridge) {
            console.log('[initializePythonSupport] AEFontPythonBridge not available, skipping.');
            return false;
        }
        try {
            console.log('[initializePythonSupport] Calling AEFontPythonBridge.init()...');

            // Show loading bar
            showLoadingBar();

            const result = await AEFontPythonBridge.init(null, (status) => {
                // Update loading bar with progress
                updateLoadingBar(status);
            });

            console.log('[initializePythonSupport] Result:', result);

            // Setup callback for when fonts are ready
            AEFontPythonBridge.onFontsReady((ready, status) => {
                console.log('[initializePythonSupport] Fonts ready!', status);
                hideLoadingBar();
                // Reload fonts to include Python catalog
                if (availableFonts.length > 0) {
                    loadFonts();
                }
            });

            // If already ready, hide loader
            if (AEFontPythonBridge.isReady()) {
                hideLoadingBar();
            }

            return result;
        } catch (error) {
            console.warn('[initializePythonSupport] Failed to initialize Python helper:', error);
            hideLoadingBar();
            return false;
        }
    }

    function applyPlanToFontItem(font, fontItem) {
        if (!fontItem) {
            return;
        }

        const textNode = fontItem.querySelector('.font-preview-text');
        const imageNode = fontItem.querySelector('.font-preview-image');

        if (font.familyMeta) {
            fontItem.dataset.familyId = font.familyMeta.id || '';
            fontItem.dataset.familyName = font.familyMeta.displayName || '';
        }

        if (font.requiresPython) {
            fontItem.classList.add('python-render');
            fontItem.classList.remove('css-render');
            if (textNode && previewTextInput) {
                textNode.textContent = previewTextInput.value;
                if (fontSizeInput) {
                    textNode.style.fontSize = `${fontSizeInput.value}px`;
                }
            }
            if (imageNode) {
                if (font.pythonImage) {
                    imageNode.src = font.pythonImage;
                    imageNode.classList.add('is-visible');
                    // If we already have a cached python image, mark as loaded so CSS shows it
                    fontItem.classList.add('python-loaded');
                } else {
                    imageNode.removeAttribute('src');
                    imageNode.classList.remove('is-visible');
                }
            }
            return;
        }

        fontItem.classList.add('css-render');
        fontItem.classList.remove('python-render');

        if (!window.AEFontRender) {
            if (textNode) {
                textNode.style.fontFamily = `'${font.displayName}', sans-serif`;
                if (previewTextInput) {
                    textNode.textContent = previewTextInput.value;
                }
            }
            return;
        }

        const plan = AEFontRender.computePlan(font);

        if (textNode) {
            textNode.style.fontFamily = plan.cssString;
            if (plan.needsWeightOverride && plan.fontWeight) {
                textNode.style.fontWeight = plan.fontWeight;
            } else {
                textNode.style.removeProperty('font-weight');
            }
            const styleName = font.style || '';
            const isItalic = /\bitalic\b|\boblique\b/i.test(styleName);
            if (isItalic) {
                textNode.style.fontStyle = 'italic';
            } else {
                textNode.style.removeProperty('font-style');
            }
            if (previewTextInput) {
                textNode.textContent = previewTextInput.value;
            }
        }
        if (imageNode) {
            imageNode.removeAttribute('src');
            imageNode.classList.remove('is-visible');
        }

        fontItem.dataset.renderSource = plan.renderSource;
        fontItem.dataset.matchType = plan.matchType;
        fontItem.dataset.loadedCount = plan.loadedCandidates.length;
        fontItem.dataset.warningReasons = plan.warningReasons ? plan.warningReasons.join(',') : '';
        if (plan.fontWeight) {
            fontItem.dataset.fontWeight = String(plan.fontWeight);
        } else {
            delete fontItem.dataset.fontWeight;
        }
        if (plan.preferredFamily) {
            fontItem.dataset.preferredFamily = plan.preferredFamily;
        } else {
            delete fontItem.dataset.preferredFamily;
        }

        const classes = [
            'font-origin-web',
            'font-origin-local',
            'font-warning',
            'font-render-failed',
            'font-origin-web-loading',
            'font-loading'
        ];
        fontItem.classList.remove(...classes);

        switch (plan.renderSource) {
            case 'web':
                fontItem.classList.add('font-origin-web');
                break;
            case 'web-loading':
                fontItem.classList.add('font-origin-web', 'font-origin-web-loading');
                break;
            case 'local':
            case 'available':
                fontItem.classList.add('font-origin-local');
                break;
            case 'error':
            case 'render-failed':
                fontItem.classList.add('font-render-failed');
                break;
            default:
                fontItem.classList.add('font-loading');
                break;
        }

        if (plan.warning) {
            fontItem.classList.add('font-warning');
        } else {
            fontItem.classList.remove('font-warning');
        }
        if (plan.renderSource === 'render-failed') {
            fontItem.classList.add('font-render-failed');
        }
    }

    function refreshFontItem(font) {
        const item = document.querySelector(`.font-item[data-font-uid="${font.uid}"]`);
        if (item) {
            AEFontRender.invalidate(font);
            applyPlanToFontItem(font, item);
        }
    }

    function invalidateFontPlan(font) {
        if (window.AEFontRender && font) {
            AEFontRender.invalidate(font);
        }
    }

    function ensureFontForPreview(font) {
        if (!window.AEFontLoader || !window.AEFontRender || !font) {
            return;
        }

        if (font.requiresPython) {
            schedulePythonPreviewUpdate();
            return;
        }

        if (['loading', 'web', 'web-loading', 'render-failed', 'local', 'available'].includes(font.webFontStatus)) {
            return;
        }

        if (AEFontRender.isRenderable(font)) {
            font.webFontStatus = 'local';
            refreshFontItem(font);
            return;
        }

        font.requiresPython = true;
        refreshFontItem(font);
        schedulePythonPreviewUpdate(true);
    }

    function checkFinalRenderStatus(font) {
        if (!font || !window.AEFontRender) return;
        if (font.requiresPython) {
            return;
        }

        const canRender = AEFontRender.isRenderable(font);
        if (canRender) {
            if (font.webFontStatus === 'loaded' || font.webFontStatus === 'web') {
                font.webFontStatus = 'web';
            } else {
                font.webFontStatus = 'local';
            }
        } else {
            font.webFontStatus = 'render-failed';
        }
        AEFontRender.invalidate(font);
        refreshFontItem(font);
    }

    // Initialize CSInterface
    function initCSInterface() {
        try {
            csInterface = new CSInterface();
            
            // Set theme
            updateTheme();
            
            // Listen for theme changes
            csInterface.addEventListener(CSInterface.THEME_COLOR_CHANGED_EVENT, updateTheme);
            
            console.log('CSInterface initialized successfully');
            return true;
        } catch (error) {
            console.error('Failed to initialize CSInterface:', error);
            updateStatus('status-error');
            return false;
        }
    }

    // Update theme based on AE theme
    function updateTheme() {
        try {
            const hostEnv = csInterface.hostEnvironment;
            const baseFontFamily = hostEnv.baseFontFamily;
            const baseFontSize = hostEnv.baseFontSize;
            
            // Apply theme colors
            const themeColor = hostEnv.appSkinInfo.appBarBackgroundColor.color;
            const isDarkTheme = (themeColor.red + themeColor.green + themeColor.blue) < 384;
            
            document.body.classList.toggle('dark-theme', isDarkTheme);
            document.body.style.fontFamily = baseFontFamily;
            document.body.style.fontSize = baseFontSize + 'px';
            
        } catch (error) {
            console.warn('Could not update theme:', error);
        }
    }

    // Initialize the application
    async function init() {
        console.log(`[init] Starting initialization (attempt ${initRetryCount + 1})...`);
        toastContainer = document.getElementById('toast-container');
        fontListElement = document.getElementById('font-list');
        previewTextInput = document.getElementById('preview-text');
        fontSizeInput = document.getElementById('font-size');
        applyButton = document.getElementById('apply-font');
        if (applyButton) {
            applyButton.disabled = true;
        }
        const sizeValue = document.getElementById('size-value');
        if (fontSizeInput && sizeValue) {
            sizeValue.textContent = fontSizeInput.value + 'px';
        }

        window.addEventListener('beforeunload', () => {
            if (window.AEFontPythonBridge && typeof AEFontPythonBridge.stop === 'function') {
                try {
                    AEFontPythonBridge.stop();
                } catch (error) {
                    console.warn('[init] Error stopping Python bridge:', error);
                }
            }
        });

        console.log('[init] Initializing Python support...');
        try {
            await initializePythonSupport();
            console.log('[init] Python support initialization completed');
        } catch (error) {
            console.error('[init] Python support initialization failed:', error);
        }

        console.log('[init] Initializing CSInterface...');
        if (!initCSInterface()) {
            initRetryCount++;
            console.error(`Failed to initialize CSInterface (attempt ${initRetryCount}/${MAX_INIT_RETRIES})`);
            
            if (initRetryCount < MAX_INIT_RETRIES) {
                setTimeout(init, 1000);
                return;
            } else {
                console.error('Maximum initialization retries reached. Stopping.');
                updateStatus('status-error');
                if (fontListElement) {
                    fontListElement.innerHTML = '<div class="no-fonts" style="color:red;">CSInterface 초기화 실패. After Effects를 재시작해주세요.</div>';
                }
                return;
            }
        }

        loadJSXScript();
        setupEventListeners();
        if (fontListElement) {
            fontListElement.addEventListener('scroll', () => schedulePythonPreviewUpdate());
        }

        loadLanguage('ko');

        setTimeout(function() {
            loadFonts();
        }, 500);

        isInitialized = true;
        updateStatus('status-ready');
    }

    // Load JSX script manually
    function loadJSXScript() {
        try {
            // Get the extension path - CSInterface.SystemPath is the correct constant
            const extensionPath = csInterface.getSystemPath('extension');
            const jsxPath = extensionPath + '/jsx/hostscript.jsx';
            
            console.log('Loading JSX from:', jsxPath);
            
            // Load the JSX file
            csInterface.evalScript('$.evalFile("' + jsxPath.replace(/\\/g, '/') + '")', function(result) {
                if (result === 'EvalScript error.') {
                    console.error('Failed to load JSX script');
                    // Try alternate loading method
                    loadJSXAlternate();
                } else {
                    console.log('JSX script loaded successfully:', result);
                }
            });
        } catch (error) {
            console.error('Error loading JSX script:', error);
            loadJSXAlternate();
        }
    }

    // Alternate JSX loading method
    function loadJSXAlternate() {
        console.log('Trying alternate JSX loading method...');
        // Simply check if the global functions exist
        csInterface.evalScript('typeof AEFontPreview_getFonts', function(result) {
            if (result === 'function') {
                console.log('JSX functions already loaded');
            } else {
                console.error('JSX functions not available. Extension may need reinstall.');
                showErrorMessage('ExtendScript 로딩 실패. 확장 프로그램을 재설치해주세요.');
            }
        });
    }

    // Set up event listeners
    function setupEventListeners() {
        // Language selector
        document.getElementById('language-select').addEventListener('change', function(e) {
            loadLanguage(e.target.value);
        });

        // Font size slider
        document.getElementById('font-size').addEventListener('input', function(e) {
            document.getElementById('size-value').textContent = e.target.value + 'px';
            updateFontPreviews();
        });

        // Preview text
        document.getElementById('preview-text').addEventListener('input', updateFontPreviews);

        // Search
        document.getElementById('search-font').addEventListener('input', filterFonts);

        // Buttons
        const refreshBtn = document.getElementById('refresh-fonts');
        const applyBtn = document.getElementById('apply-font');
        const loadTextBtn = document.getElementById('load-text-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                // Clear Python cache and reload fonts
                if (window.AEFontPythonBridge && typeof AEFontPythonBridge.clearCache === 'function') {
                    showLoadingBar();
                    updateLoadingBar({ message: 'Clearing cache...', progress: 0 });

                    await AEFontPythonBridge.clearCache();

                    // Re-initialize Python support with loading bar
                    await initializePythonSupport();
                }

                // Reload fonts
                loadFonts();
            });
        }
        if (applyBtn) {
            applyBtn.addEventListener('click', () => applySelectedFont());
        }
        if (loadTextBtn) {
            loadTextBtn.addEventListener('click', () => loadTextFromSelectedLayer());
        }
    }
    
    window.addEventListener('resize', () => schedulePythonPreviewUpdate(true));

    // Load language
    function loadLanguage(lang) {
        const target = lang || currentLanguage || 'ko';
        if (typeof i18n.setLanguage === 'function' && target !== currentLanguage) {
            i18n.setLanguage(target, { applyToDom: false });
        }
        currentLanguage = typeof i18n.getLanguage === 'function' ? i18n.getLanguage() : target;
        if (typeof i18n.applyToDom === 'function') {
            i18n.applyToDom(currentLanguage);
        }
        updateFontCount();
    }

    // Update status text
    function updateStatus(statusKey, params = {}) {
        const element = document.getElementById('status-text');
        if (!element) {
            return;
        }
        const text = typeof i18n.format === 'function'
            ? i18n.format(statusKey, params)
            : statusKey;
        element.textContent = text;
    }

    function showToast(message, type = 'info') {
        if (!toastContainer) {
            toastContainer = document.getElementById('toast-container');
        }
        if (!toastContainer) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        toastContainer.appendChild(toast);

        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 220);
        }, 2600);
    }

        // Load fonts from After Effects
    async function loadFonts() {
        console.log('[loadFonts] Starting font load...');
        updateStatus('status-loading');
        showLoading(true);

        try {
            console.log('[loadFonts] Fetching AE fonts...');
            const aeFonts = await fetchAEFonts();
            console.log(`[loadFonts] Fetched ${aeFonts.length} fonts`);
            availableFonts = aeFonts;

            if (window.AEFontPythonBridge && typeof AEFontPythonBridge.clearPreviewCache === 'function') {
                AEFontPythonBridge.clearPreviewCache();
            }

            if (window.AEFontPythonBridge && AEFontPythonBridge.isReady()) {
                AEFontPythonBridge.mergeFonts(availableFonts);
            } else {
                availableFonts.forEach(font => {
                    font.pythonLookup = font.displayName;
                    font.pythonKey = utils.normalizeFontKey(font.displayName);
                    font.canApply = font.canApply !== false;
                });
            }

            if (window.AEFontFamilies) {
                const familyData = AEFontFamilies.buildFamilies(availableFonts);
                fontFamilies = familyData.families;
                window.fontFamilies = fontFamilies;
            }

            availableFonts.sort((a, b) => a.displayName.localeCompare(b.displayName, currentLanguage));

            if (!cepFontSnapshotSent && window.AEFontPythonBridge && AEFontPythonBridge.isReady()) {
                sendCepFontSnapshot('ae-fonts', availableFonts);
                cepFontSnapshotSent = true;
            }

            fontByUid.clear();
            fontsByPythonKey.clear();
            availableFonts.forEach(font => {
                fontByUid.set(font.uid, font);
                const keys = [];
                if (font.normalizedAliases && font.normalizedAliases.size) {
                    keys.push(...font.normalizedAliases);
                }
                const primaryKey = font.pythonKey || utils.normalizeFontKey(font.displayName);
                if (primaryKey) {
                    keys.push(primaryKey);
                }
                // Add native (localized) names as candidate keys for Python mapping
                if (font.nativeFamily) {
                    const k = utils.normalizeFontKey(font.nativeFamily);
                    if (k) keys.push(k);
                }
                if (font.nativeFull) {
                    const k = utils.normalizeFontKey(font.nativeFull);
                    if (k) keys.push(k);
                }
                if (font.nativeFamily && font.nativeStyle) {
                    const k1 = utils.normalizeFontKey(font.nativeFamily + ' ' + font.nativeStyle);
                    const k2 = utils.normalizeFontKey(font.nativeFamily + '-' + font.nativeStyle);
                    if (k1) keys.push(k1);
                    if (k2) keys.push(k2);
                }
                const uniqueKeys = new Set(keys.filter(Boolean));
                uniqueKeys.forEach(key => {
                    if (!fontsByPythonKey.has(key)) {
                        fontsByPythonKey.set(key, []);
                    }
                    const list = fontsByPythonKey.get(key);
                    if (!list.includes(font)) {
                        list.push(font);
                    }
                });
            });

            window.availableFonts = availableFonts;

            showLoading(false);
            displayFonts(availableFonts);
            updateFontCount();
            schedulePythonPreviewUpdate(true);
            updateStatus('status-ready');
        } catch (error) {
            console.error('Failed to load fonts:', error);
            showLoading(false);
            showErrorMessage('폰트 목록을 불러올 수 없습니다: ' + (error.message || error));
            updateStatus('status-error');
        }
    }

    function fetchAEFonts() {
        return new Promise((resolve, reject) => {
            if (!csInterface) {
                resolve([]);
                return;
            }

            csInterface.evalScript('AEFontPreview_getFonts()', function(result) {
                if (!result || result === 'undefined' || result === 'null') {
                    reject(new Error('Empty response from host script.'));
                    return;
                }

                if (typeof result === 'string' && result.indexOf('EvalScript error') !== -1) {
                    reject(new Error(result));
                    return;
                }

                try {
                    const response = JSON.parse(result);
                    if (!response.success) {
                        reject(new Error(response.error || 'Unknown ExtendScript error.'));
                        return;
                    }

                    const fonts = (response.fonts || []).map((font, index) => createFontObject(font, index));
                    resolve(fonts);
                } catch (parseError) {
                    reject(parseError);
                }
            });
        });
    }

    function createFontObject(font, index) {
        const displayName = font.name || font.family || font.postScriptName || 'Unknown Font';
        const familyName = font.family || displayName;
        const styleName = font.style || 'Regular';
        const postScriptName = font.postScriptName || displayName;
        const uid = `font-${index}`;

        const cssFamilies = [];
        if (window.AEFontRender) {
            AEFontRender.addCandidate(cssFamilies, postScriptName);
            AEFontRender.addCandidate(cssFamilies, familyName);
            AEFontRender.addCandidate(cssFamilies, displayName);
            AEFontRender.addCandidate(cssFamilies, displayName.replace(/_/g, ' '));
            AEFontRender.addCandidate(cssFamilies, familyName.replace(/_/g, ' '));
            if (postScriptName) {
                AEFontRender.addCandidate(cssFamilies, postScriptName.replace(/[_-]/g, ' '));
            }
            if (styleName) {
                AEFontRender.addCandidate(cssFamilies, `${familyName} ${styleName}`);
                AEFontRender.addCandidate(cssFamilies, `${familyName}-${styleName}`);
                AEFontRender.addCandidate(cssFamilies, `${displayName} ${styleName}`);
                AEFontRender.addCandidate(cssFamilies, `${displayName}-${styleName}`);
            }
        } else {
            cssFamilies.push(displayName);
        }

        if (cssFamilies.length === 0) {
            cssFamilies.push(displayName);
        }

        const fontObj = {
            uid,
            id: postScriptName || `${displayName}|${styleName}`,
            displayName,
            family: familyName,
            style: styleName,
            postScriptName,
            cssFamilies,
            source: font.source || 'System',
            canApply: true,
            requiresPython: false,
            externalOnly: false,
            pythonLookup: displayName,
            pythonKey: utils.normalizeFontKey(displayName),
            // Native (localized) names - decode from hostscript transport encoding
            nativeFamily: decodeNativeValue(font.nativeFamily),
            nativeStyle: decodeNativeValue(font.nativeStyle),
            nativeFull: decodeNativeValue(font.nativeFull)
        };

        utils.addAlias(fontObj, displayName);
        utils.addAlias(fontObj, familyName);
        utils.addAlias(fontObj, postScriptName);
        if (styleName) {
            utils.addAlias(fontObj, `${familyName} ${styleName}`);
            utils.addAlias(fontObj, `${displayName} ${styleName}`);
            utils.addAlias(fontObj, `${familyName}-${styleName}`);
            utils.addAlias(fontObj, `${displayName}-${styleName}`);
        }
        cssFamilies.forEach(candidate => utils.addAlias(fontObj, candidate));

        return fontObj;
    }

    // Display fonts in the list
    function displayFonts(fonts) {
        const listElement = fontListElement || document.getElementById('font-list');
        if (!listElement) {
            return;
        }

        const previewText = previewTextInput ? previewTextInput.value : '';
        const fontSize = fontSizeInput ? fontSizeInput.value : '24';

        if (!fonts.length) {
            listElement.innerHTML = `<div class="no-fonts">${i18n.translate('no-fonts', 'No fonts available')}</div>`;
            return;
        }

        const html = fonts.map(font => {
            const encodedUid = utils.escapeAttr(font.uid);
            const nameText = utils.escapeHtml(font.displayName);
            const styleText = utils.escapeHtml(font.style || '');
            const pythonKeyAttr = font.pythonKey ? ` data-python-key="${utils.escapeAttr(font.pythonKey)}"` : '';
            const classes = ['font-item'];
            if (font.requiresPython) {
                classes.push('python-render');
            } else {
                classes.push('css-render');
            }
            
            // Show native name if it's different from English name
            let nativeNameHtml = '';
            if (font.nativeFamily && font.nativeFamily !== font.family) {
                const nativeName = font.nativeFull || (font.nativeFamily + (font.nativeStyle ? ' ' + font.nativeStyle : ''));
                nativeNameHtml = ` <span class="font-native-name" style="color:#999;font-size:0.9em;">(${utils.escapeHtml(nativeName)})</span>`;
            }

            return `
                <div class="${classes.join(' ')}" data-font-uid="${encodedUid}"${pythonKeyAttr}>
                    <div class="font-name">${nameText}<span class="font-style"> ${styleText}</span>${nativeNameHtml}</div>
                    <div class="font-preview">
                        <div class="font-preview-text" style="font-size:${fontSize}px;">${utils.escapeHtml(previewText)}</div>
                        <img class="font-preview-image" alt="${nameText} preview">
                    </div>
                </div>
            `;
        }).join('');

        listElement.innerHTML = html;

        const items = Array.from(listElement.children);
        items.forEach((item, index) => {
            const font = fonts[index];
            if (!font) {
                return;
            }
            item.addEventListener('click', () => selectFont(font.uid));
            if (font.pythonLookup) {
                item.dataset.pythonLookup = font.pythonLookup;
            }
            applyPlanToFontItem(font, item);
        });

        if (selectedFontId) {
            const selectedElement = listElement.querySelector(`.font-item[data-font-uid="${selectedFontId}"]`);
            if (selectedElement) {
                selectedElement.classList.add('selected');
            }
        }

        if (window.AEFontLoader) {
            fonts.forEach(font => ensureFontForPreview(font));
        }

        updateFontPreviews();
        schedulePythonPreviewUpdate(true);
    }


    // Select a font
    function selectFont(fontUid) {
        // Remove previous selection
        document.querySelectorAll('.font-item').forEach(item => {
            item.classList.remove('selected');
        });

        selectedFont = availableFonts.find(font => font.uid === fontUid) || null;
        selectedFontId = selectedFont ? fontUid : null;

        if (selectedFont) {
            const selectedItem = document.querySelector(`.font-item[data-font-uid="${fontUid}"]`);
            if (selectedItem) {
                selectedItem.classList.add('selected');
            }
            updateStatus('status-ready');
            if (applyButton) {
                applyButton.disabled = false;
            }
        } else if (applyButton) {
            applyButton.disabled = true;
        }
    }

    // Filter fonts based on search
    function filterFonts() {
        const searchTerm = document.getElementById('search-font').value.toLowerCase();
        const filteredFonts = availableFonts.filter(font => {
            if (!searchTerm) return true;
            const targets = [
                font.displayName || '',
                font.family || '',
                font.postScriptName || '',
                font.style || ''
            ];
            if (font.familyMeta && font.familyMeta.displayName) {
                targets.push(font.familyMeta.displayName);
            }
            if (Array.isArray(font.cssFamilies)) {
                targets.push(...font.cssFamilies);
            }
            if (font.aliases && typeof font.aliases.forEach === 'function') {
                font.aliases.forEach(alias => targets.push(alias));
            }
            // Add native names to search targets
            if (font.nativeFamily) targets.push(font.nativeFamily);
            if (font.nativeStyle) targets.push(font.nativeStyle);
            if (font.nativeFull) targets.push(font.nativeFull);
            
            for (let i = 0; i < targets.length; i++) {
                const target = targets[i];
                if (target && String(target).toLowerCase().indexOf(searchTerm) !== -1) {
                    return true;
                }
            }
            return false;
        });
        displayFonts(filteredFonts);
        updateFontCount(filteredFonts.length);
    }

    // Update font previews
    function updateFontPreviews() {
        const previewText = previewTextInput ? previewTextInput.value : '';
        const fontSize = fontSizeInput ? fontSizeInput.value : '24';

        document.querySelectorAll('.font-preview-text').forEach(node => {
            node.textContent = previewText;
            node.style.fontSize = fontSize + 'px';
        });

        schedulePythonPreviewUpdate();
    }

    function schedulePythonPreviewUpdate(immediate = false) {
        if (!window.AEFontPythonBridge || !AEFontPythonBridge.isReady()) {
            return;
        }
        if (immediate) {
            if (pythonUpdateTimer) {
                clearTimeout(pythonUpdateTimer);
                pythonUpdateTimer = null;
            }
            updatePythonPreviews();
            return;
        }
        if (pythonUpdateTimer) {
            clearTimeout(pythonUpdateTimer);
        }
        pythonUpdateTimer = setTimeout(updatePythonPreviews, 100);
    }

    async function updatePythonPreviews() {
        if (!window.AEFontPythonBridge || !AEFontPythonBridge.isReady() || pythonPreviewBusy) {
            return;
        }
        if (!fontListElement) {
            return;
        }

        try {
            const text = previewTextInput ? previewTextInput.value : '';
            const size = fontSizeInput ? parseInt(fontSizeInput.value, 10) || 24 : 24;
            const listRect = fontListElement.getBoundingClientRect();

            const requestPayload = [];
            const requestBindings = new Map();

            document.querySelectorAll('.font-item.python-render').forEach(item => {
                const rect = item.getBoundingClientRect();
                if (rect.bottom < listRect.top - 80 || rect.top > listRect.bottom + 2000) {
                    return;
                }
                const font = fontByUid.get(item.dataset.fontUid);
                if (!font) {
                    return;
                }
                const key = font.pythonKey || utils.normalizeFontKey(font.displayName);
                if (!key) {
                    return;
                }
                // Avoid flicker: keep current image visible while requesting a new one
                // Only reset if there's no currently visible image
                const resetImg = item.querySelector('.font-preview-image');
                const hasVisible = item.classList.contains('python-loaded') && resetImg && resetImg.classList.contains('is-visible') && !!resetImg.src;
                if (!hasVisible) {
                    item.classList.remove('python-loaded');
                    if (resetImg) {
                        resetImg.classList.remove('is-visible');
                        resetImg.removeAttribute('src');
                    }
                }
                const previewHost = item.querySelector('.font-preview');
                const viewportWidth = previewHost ? Math.max(0, Math.floor(previewHost.clientWidth || previewHost.getBoundingClientRect().width || 0)) : 0;
                font._pythonViewportWidth = viewportWidth;
                const styleMarker = font.postScriptName || font.id || font.style || '';
                const cacheKey = (window.AEFontPythonBridge && typeof AEFontPythonBridge.buildCacheKey === 'function')
                    ? AEFontPythonBridge.buildCacheKey(key, text, size, viewportWidth, styleMarker)
                    : `${key}::${styleMarker}::${(text || '').slice(0, 200)}::${size}::${viewportWidth}`;
                font.currentPythonCacheKey = cacheKey;
                // Skip re-request if this exact cacheKey previously failed (e.g., due to substitution)
                if (font._pythonFailedCacheKey === cacheKey) {
                    return;
                }
                const requestId = cacheKey;
                if (!requestBindings.has(requestId)) {
                    requestBindings.set(requestId, []);
                    const aliasValues = new Set();
                    const pushAlias = value => {
                        if (!value && value !== 0) {
                            return;
                        }
                        const trimmed = String(value).trim();
                        if (trimmed) {
                            aliasValues.add(trimmed);
                        }
                    };
                    pushAlias(font.displayName);
                    pushAlias(font.pythonLookup);
                    pushAlias(font.postScriptName);
                    pushAlias(font.family);
                    pushAlias(font.nativeFamily);
                    pushAlias(font.nativeFull);
                    if (font.nativeFamily && font.nativeStyle) {
                        pushAlias(`${font.nativeFamily} ${font.nativeStyle}`);
                        pushAlias(`${font.nativeFamily}-${font.nativeStyle}`);
                    }
                    if (font.aliases && typeof font.aliases.forEach === 'function') {
                        font.aliases.forEach(pushAlias);
                    }
                    const aliasList = Array.from(aliasValues);
                    const requestName = font.displayName
                        || font.nativeFull
                        || font.pythonLookup
                        || font.postScriptName
                        || font.family;
                    requestPayload.push({
                        name: requestName,
                        aliases: aliasList,
                        postScriptName: font.postScriptName || null,
                        style: font.style || null,
                        width: viewportWidth,
                        requestId,
                        pythonKey: key
                    });
                }
                requestBindings.get(requestId).push(font);
            });

            if (requestPayload.length === 0) {
                return;
            }

            pythonPreviewBusy = true;
            try {
                const previews = await AEFontPythonBridge.fetchBatchPreviews(requestPayload, text, size);
                const successIds = new Set();
                (previews || []).forEach(preview => {
                    if (!preview || !preview.image) {
                        return;
                    }
                    const requestId = preview.requestId;
                    if (requestId) successIds.add(requestId);
                    let boundFonts = requestId ? requestBindings.get(requestId) : null;
                    if ((!boundFonts || !boundFonts.length) && preview.fontName) {
                        const norm = utils.normalizeFontKey(preview.fontName);
                        boundFonts = fontsByPythonKey.get(norm) || [];
                    }
                    if ((!boundFonts || !boundFonts.length) && preview.pythonKey) {
                        const normKey = utils.normalizeFontKey(preview.pythonKey);
                        boundFonts = fontsByPythonKey.get(normKey) || boundFonts;
                    }
                    if ((!boundFonts || !boundFonts.length) && preview.resolvedName) {
                        const normResolved = utils.normalizeFontKey(preview.resolvedName);
                        boundFonts = fontsByPythonKey.get(normResolved) || boundFonts;
                    }
                    if (!boundFonts || !boundFonts.length) {
                        return;
                    }
                    boundFonts.forEach(font => {
                        updatePythonPreviewDom(font, preview.image);
                        // Track success key so future logic can know the last good render params
                        font._pythonSuccessCacheKey = font.currentPythonCacheKey;
                    });
                });
                // Mark non-returned requestIds as failed for the current cache key to avoid re-requests
                requestBindings.forEach((fonts, requestId) => {
                    if (!successIds.has(requestId)) {
                        fonts.forEach(f => {
                            f._pythonFailedCacheKey = requestId;
                        });
                    }
                });
            } catch (error) {
                reportError('updatePythonPreviews/fetch', error);
            } finally {
                pythonPreviewBusy = false;
            }
        } catch (error) {
            reportError('updatePythonPreviews', error);
        }
    }

    function updatePythonPreviewDom(font, image) {
        if (!font) {
            return;
        }
        const item = document.querySelector(`.font-item[data-font-uid="${font.uid}"]`);
        if (!item) {
            return;
        }
        const img = item.querySelector('.font-preview-image');
        if (img && image) {
            img.src = image;
            font.pythonImage = image;
            item.classList.add('python-loaded');
            img.classList.add('is-visible');
        }
    }

    function loadTextFromSelectedLayer() {
        if (!csInterface) {
            return;
        }

        updateStatus('status-fetching-text');
        csInterface.evalScript('AEFontPreview_getSelectedText()', function(result) {
            updateStatus('status-ready');
            try {
                if (!result || result === 'undefined') {
                    showToast(i18n.translate('toast-load-fail'), 'warning');
                    return;
                }

                if (typeof result === 'string' && result.indexOf('EvalScript error') !== -1) {
                    console.warn('EvalScript error during load text:', result);
                    showToast(i18n.translate('toast-load-fail'), 'warning');
                    return;
                }

                const response = JSON.parse(result);
                if (response.success) {
                    const preview = document.getElementById('preview-text');
                    preview.value = response.text || '';
                    updateFontPreviews();
                    showToast(i18n.translate('toast-load-success'), 'success');
                } else {
                    console.warn('Load text failed:', response.error);
                    showToast(`${i18n.translate('toast-load-fail')} (${response.error || 'N/A'})`, 'warning');
                }
            } catch (error) {
                console.error('Failed to parse load text response:', error, result);
                showToast(i18n.translate('toast-load-fail'), 'error');
            }
        });
    }

    // Update font count
    function updateFontCount(count = availableFonts.length) {
        const element = document.getElementById('font-count');
        if (!element) {
            return;
        }
        const text = typeof i18n.format === 'function'
            ? i18n.format('font-count', { count })
            : `${count}`;
        element.textContent = text;
    }

    // Show/hide loading indicator
    function showLoading(show) {
        const fontList = document.getElementById('font-list');
        if (!fontList) return;

        let loading = document.getElementById('loading');
        if (show) {
            if (!loading) {
                loading = document.createElement('div');
                loading.id = 'loading';
                loading.className = 'loading';
                loading.innerHTML = `<span>${i18n.translate('loading-text', 'Loading...')}</span>`;
                fontList.innerHTML = '';
                fontList.appendChild(loading);
            } else {
                const label = loading.querySelector('span');
                if (label) {
                    label.textContent = i18n.translate('loading-text', 'Loading...');
                }
            }
            loading.style.display = 'flex';
        } else if (loading) {
            loading.style.display = 'none';
        }
    }

    // Show error message
    function showErrorMessage(message) {
        const fontList = document.getElementById('font-list');
        fontList.innerHTML = `<div class="error-message">${message}</div>`;
    }

    // Apply selected font to active text layer
    function applySelectedFont() {
        if (!selectedFont) {
            updateStatus('status-error');
            showErrorMessage('폰트를 먼저 선택해주세요.');
            return;
        }

        updateStatus('status-applying');

        const fontNameForApply = selectedFont.postScriptName || selectedFont.displayName;
        const script = 'AEFontPreview_applyFont(' + JSON.stringify(fontNameForApply) + ')';

        csInterface.evalScript(script, function(result) {
            try {
                const response = JSON.parse(result);
                if (response.success) {
                    updateStatus('status-ready');
                    const appliedCount = response.appliedCount || 0;
                    const key = appliedCount === 1 ? 'toast-apply-success-single' : 'toast-apply-success';
                    const message = i18n.format(key, { count: appliedCount });
                    showToast(message, 'success');
                } else {
                    updateStatus('status-error');
                    showToast(`${i18n.translate('toast-apply-fail')}: ${response.error}`, 'error');
                }
            } catch (parseError) {
                console.error('Parse error:', parseError);
                updateStatus('status-error');
                showToast(i18n.translate('toast-parse-fail'), 'error');
            }
        });
    }

    // Debug function to test JSX connection
    window.testJSXConnection = function() {
        console.log('Testing JSX connection...');
        if (!csInterface) {
            console.error('CSInterface not initialized');
            return;
        }
        
        // Test basic evalScript
        csInterface.evalScript('$.global.AEFontPreview', function(result) {
            console.log('AEFontPreview object check:', result);
        });
        
        // Test if global function exists
        csInterface.evalScript('typeof AEFontPreview_getFonts', function(result) {
            console.log('AEFontPreview_getFonts type:', result);
        });
        
        // Try to get fonts
        csInterface.evalScript('AEFontPreview_getFonts()', function(result) {
            console.log('Font fetch result:', result);
        });
    };

    window.checkFontRendering = function(fontName) {
        if (!fontName) {
            console.warn('Font name is required.');
            return;
        }

        console.log(`Checking font: "${fontName}"`);

        const lowerName = fontName.toLowerCase();
        const font = availableFonts.find(f =>
            (f.displayName && f.displayName.toLowerCase().includes(lowerName)) ||
            (f.family && f.family.toLowerCase().includes(lowerName)) ||
            (f.postScriptName && f.postScriptName.toLowerCase().includes(lowerName))
        );

        if (!font) {
            console.log('Font not found in available fonts list');
            return;
        }

        if (document.fonts && document.fonts.check) {
            const candidates = (font.cssFamilies || []).map(name => ({
                name,
                loaded: document.fonts.check(`12px "${name}"`)
            }));
            console.table(candidates);
        } else {
            console.log('document.fonts API is not available in this runtime.');
        }

        console.log('Font data:', {
            displayName: font.displayName,
            family: font.family,
            postScriptName: font.postScriptName,
            style: font.style,
            cssFamilies: font.cssFamilies,
            webFontStatus: font.webFontStatus || '(none)',
            familyMeta: font.familyMeta
        });

        if (window.AEFontRender) {
            console.log('Render plan:', AEFontRender.computePlan(font));
        }

        if (window.AEFontLoader) {
            ensureFontForPreview(font);
        }
    };

    // Initialize when DOM is ready
    document.addEventListener('DOMContentLoaded', init);

})();
