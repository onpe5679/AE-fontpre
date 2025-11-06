// AE Font Preview - Main JavaScript
(function() {
    'use strict';

    // Global variables
    let csInterface;
    let currentLanguage = 'ko';
    let availableFonts = [];
    let fontFamilies = [];
    let selectedFont = null;
    let selectedFontId = null;
    let isInitialized = false;
    let initRetryCount = 0;
    const MAX_INIT_RETRIES = 5;
    let toastContainer;
    let pythonProcess = null;
    let pythonClient = null;
    let pythonReady = false;
    let pythonCatalogAll = new Map();
    const pythonAliasIndex = new Map();
    const pythonPreviewCache = new Map();
    let pythonUpdateTimer = null;
    let pythonPreviewBusy = false;
    const fontByUid = new Map();
    const fontsByPythonKey = new Map();
    let fontListElement;
    let previewTextInput;
    let fontSizeInput;
    let applyButton;

    // Multi-language support
    const translations = {
        ko: {
            'app-title': '폰트 프리뷰',
            'text-label': '미리보기 텍스트:',
            'size-label': '폰트 크기:',
            'search-label': '폰트 검색:',
            'refresh-text': '폰트 새로고침',
            'apply-text': '선택된 폰트 적용',
            'font-list-title': '폰트 목록',
            'loading-text': '폰트 목록을 불러오는 중...',
            'status-ready': '준비 완료',
            'status-loading': '폰트 목록 로딩 중...',
            'status-applying': '폰트 적용 중...',
            'status-error': '오류 발생',
            'no-fonts': '사용 가능한 폰트가 없습니다',
            'font-count': '{count}개 폰트',
            'placeholder-text': '미리보기할 텍스트를 입력하세요...',
            'placeholder-search': '폰트 이름으로 검색...',
            'load-text': '텍스트 불러오기',
            'status-fetching-text': '텍스트 불러오는 중...',
            'toast-apply-success': '{count}개의 레이어에 적용했습니다.',
            'toast-apply-success-single': '{count}개의 레이어에 적용했습니다.',
            'toast-load-success': '텍스트를 불러왔습니다.',
            'toast-load-fail': '텍스트를 불러올 수 없습니다.',
            'toast-apply-fail': '폰트 적용 실패',
            'toast-parse-fail': '응답을 파싱할 수 없습니다.'
        },
        en: {
            'app-title': 'Font Preview',
            'text-label': 'Preview Text:',
            'size-label': 'Font Size:',
            'search-label': 'Search Font:',
            'refresh-text': 'Refresh Fonts',
            'apply-text': 'Apply Selected Font',
            'font-list-title': 'Font List',
            'loading-text': 'Loading font list...',
            'status-ready': 'Ready',
            'status-loading': 'Loading fonts...',
            'status-applying': 'Applying font...',
            'status-error': 'Error occurred',
            'no-fonts': 'No fonts available',
            'font-count': '{count} fonts',
            'placeholder-text': 'Enter preview text...',
            'placeholder-search': 'Search by font name...',
            'load-text': 'Fetch Text',
            'status-fetching-text': 'Fetching text...',
            'toast-apply-success': 'Applied to {count} layers.',
            'toast-apply-success-single': 'Applied to {count} layer.',
            'toast-load-success': 'Loaded layer text.',
            'toast-load-fail': 'Could not load text.',
            'toast-apply-fail': 'Failed to apply font',
            'toast-parse-fail': 'Could not parse response.'
        },
        ja: {
            'app-title': 'フォントプレビュー',
            'text-label': 'プレビューテキスト:',
            'size-label': 'フォントサイズ:',
            'search-label': 'フォント検索:',
            'refresh-text': 'フォント更新',
            'apply-text': '選択フォント適用',
            'font-list-title': 'フォント一覧',
            'loading-text': 'フォント一覧を読み込み中...',
            'status-ready': '準備完了',
            'status-loading': 'フォント読み込み中...',
            'status-applying': 'フォント適用中...',
            'status-error': 'エラー発生',
            'no-fonts': '利用可能なフォントがありません',
            'font-count': '{count}個のフォント',
            'placeholder-text': 'プレビューテキストを入力...',
            'placeholder-search': 'フォント名で検索...',
            'load-text': 'テキスト取得',
            'status-fetching-text': 'テキスト取得中...',
            'toast-apply-success': '{count}個のレイヤーに適用しました。',
            'toast-apply-success-single': '{count}個のレイヤーに適用しました。',
            'toast-load-success': 'テキストを読み込みました。',
            'toast-load-fail': 'テキストを取得できません。',
            'toast-apply-fail': 'フォントの適用に失敗しました',
            'toast-parse-fail': 'レスポンスを解析できません。'
        }
    };

    function translate(key, fallback) {
        const pack = translations[currentLanguage] || translations.ko;
        if (pack && Object.prototype.hasOwnProperty.call(pack, key)) {
            return pack[key];
        }
        if (fallback !== undefined) {
            return fallback;
        }
        return key;
    }

    function formatTranslation(key, params = {}) {
        let template = translate(key, key);
        Object.keys(params).forEach(paramKey => {
            const pattern = new RegExp(`\\{${paramKey}\\}`, 'g');
            template = template.replace(pattern, params[paramKey]);
        });
        return template;
    }

    function normalizeFontKey(name) {
        if (!name && name !== 0) {
            return '';
        }
        return String(name)
            .toLowerCase()
            .replace(/\s+/g, '')
            .replace(/[_-]/g, '');
    }

    function addAlias(font, alias) {
        if (!alias && alias !== 0) {
            return;
        }
        const value = String(alias).trim();
        if (!value) {
            return;
        }
        if (!font.aliases) {
            font.aliases = new Set();
        }
        if (!font.normalizedAliases) {
            font.normalizedAliases = new Set();
        }
        font.aliases.add(value);
        const normalized = normalizeFontKey(value);
        if (normalized) {
            font.normalizedAliases.add(normalized);
        }
    }

    function rebuildPythonAliasIndex() {
        pythonAliasIndex.clear();
        if (!pythonCatalogAll || typeof pythonCatalogAll.forEach !== 'function') {
            return;
        }
        pythonCatalogAll.forEach(meta => {
            if (!meta) {
                return;
            }
            const key = meta.key || normalizeFontKey(meta.name);
            if (key && !pythonAliasIndex.has(key)) {
                pythonAliasIndex.set(key, meta);
            }
            const list = Array.isArray(meta.normalizedAliases) ? meta.normalizedAliases : [];
            list.forEach(alias => {
                if (!alias) {
                    return;
                }
                if (!pythonAliasIndex.has(alias)) {
                    pythonAliasIndex.set(alias, meta);
                }
            });
        });
    }

    // Simple HTML escape helpers to guard against unsafe font names
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

    async function initializePythonSupport() {
        if (typeof PythonProcessManager === 'undefined' || typeof PythonPreviewClient === 'undefined') {
            return false;
        }

        let extensionPath;
        try {
            if (typeof window.CSInterface === 'function') {
                const tempInterface = new window.CSInterface();
                extensionPath = tempInterface.getSystemPath('extension');
            }
        } catch (error) {
            console.warn('[initializePythonSupport] Unable to resolve extension path:', error);
        }

        pythonProcess = new PythonProcessManager();
        const started = pythonProcess.start(extensionPath);
        if (!started) {
            return false;
        }

        pythonClient = new PythonPreviewClient();
        const ready = await pythonClient.waitUntilReady();
        if (!ready) {
            pythonProcess.stop();
            return false;
        }

        pythonCatalogAll = await pythonClient.fetchFontCatalog();
        rebuildPythonAliasIndex();
        pythonReady = true;
        return true;
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
            if (imageNode && font.pythonImage) {
                imageNode.src = font.pythonImage;
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
            if (previewTextInput) {
                textNode.textContent = previewTextInput.value;
            }
        }
        if (imageNode) {
            imageNode.removeAttribute('src');
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
        console.log('Initializing AE Font Preview...');
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
            if (pythonProcess) {
                pythonProcess.stop();
            }
        });

        await initializePythonSupport();

        if (!initCSInterface()) {
            console.error('Failed to initialize CSInterface');
            setTimeout(init, 1000);
            return;
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
            refreshBtn.addEventListener('click', () => loadFonts());
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
        currentLanguage = lang;
        const texts = translations[lang];
        
        if (!texts) return;

        const languageSelect = document.getElementById('language-select');
        if (languageSelect && languageSelect.value !== lang) {
            languageSelect.value = lang;
        }

        // Update all translatable elements
        Object.keys(texts).forEach(key => {
            const element = document.getElementById(key);
            if (element) {
                if (key === 'placeholder-text') {
                    document.getElementById('preview-text').placeholder = texts[key];
                } else if (key === 'placeholder-search') {
                    document.getElementById('search-font').placeholder = texts[key];
                } else {
                    element.textContent = texts[key];
                }
            }
        });

        // Update font count
        updateFontCount();
    }

    // Update status text
    function updateStatus(statusKey, params = {}) {
        const statusText = translations[currentLanguage][statusKey] || statusKey;
        let finalText = statusText;
        
        // Replace parameters
        Object.keys(params).forEach(key => {
            finalText = finalText.replace(`{${key}}`, params[key]);
        });
        
        document.getElementById('status-text').textContent = finalText;
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
        updateStatus('status-loading');
        showLoading(true);

        try {
            const aeFonts = await fetchAEFonts();
            availableFonts = aeFonts;
            pythonPreviewCache.clear();

            if (pythonReady) {
                mergePythonFonts();
            } else {
                availableFonts.forEach(font => {
                    font.pythonLookup = font.displayName;
                    font.pythonKey = normalizeFontKey(font.displayName);
                    font.canApply = font.canApply !== false;
                });
            }

            if (window.AEFontFamilies) {
                const familyData = AEFontFamilies.buildFamilies(availableFonts);
                fontFamilies = familyData.families;
                window.fontFamilies = fontFamilies;
            }

            availableFonts.sort((a, b) => a.displayName.localeCompare(b.displayName, currentLanguage));

            fontByUid.clear();
            fontsByPythonKey.clear();
            availableFonts.forEach(font => {
                fontByUid.set(font.uid, font);
                const keys = [];
                if (font.normalizedAliases && font.normalizedAliases.size) {
                    keys.push(...font.normalizedAliases);
                }
                const primaryKey = font.pythonKey || normalizeFontKey(font.displayName);
                if (primaryKey) {
                    keys.push(primaryKey);
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
            pythonKey: normalizeFontKey(displayName),
            // Native (localized) names - 네이티브 이름
            nativeFamily: font.nativeFamily || '',
            nativeStyle: font.nativeStyle || '',
            nativeFull: font.nativeFull || ''
        };

        addAlias(fontObj, displayName);
        addAlias(fontObj, familyName);
        addAlias(fontObj, postScriptName);
        if (styleName) {
            addAlias(fontObj, `${familyName} ${styleName}`);
            addAlias(fontObj, `${displayName} ${styleName}`);
            addAlias(fontObj, `${familyName}-${styleName}`);
            addAlias(fontObj, `${displayName}-${styleName}`);
        }
        cssFamilies.forEach(candidate => addAlias(fontObj, candidate));

        return fontObj;
    }

    function mergePythonFonts() {
        if (!pythonReady || !(pythonCatalogAll instanceof Map) || pythonCatalogAll.size === 0) {
            return;
        }

        rebuildPythonAliasIndex();
        availableFonts.forEach(font => {
            const meta = findPythonMetaForFont(font);
            if (meta) {
                font.pythonInfo = meta;
                font.pythonLookup = meta.name;
                font.pythonKey = meta.key;
                font.paths = meta.paths || [];
                if (Array.isArray(meta.aliases)) {
                    meta.aliases.forEach(alias => addAlias(font, alias));
                }
                if (Array.isArray(meta.normalizedAliases)) {
                    meta.normalizedAliases.forEach(alias => {
                        if (alias) {
                            font.normalizedAliases.add(alias);
                        }
                    });
                }
                font.externalOnly = false;
                font.canApply = true;
                if (meta.forceBitmap) {
                    font.requiresPython = true;
                }
            }
        });
    }

    function findPythonMetaForFont(font) {
        if (!pythonCatalogAll || pythonCatalogAll.size === 0) {
            return null;
        }
        const candidateKeys = new Set();
        const addCandidate = value => {
            const key = normalizeFontKey(value);
            if (key) {
                candidateKeys.add(key);
            }
        };

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
                    candidateKeys.add(key);
                }
            });
        }

        for (const key of candidateKeys) {
            if (pythonCatalogAll.has(key)) {
                return pythonCatalogAll.get(key);
            }
            if (pythonAliasIndex.has(key)) {
                return pythonAliasIndex.get(key);
            }
        }
        return null;
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
            listElement.innerHTML = `<div class="no-fonts">${translate('no-fonts', 'No fonts available')}</div>`;
            return;
        }

        const html = fonts.map(font => {
            const encodedUid = escapeAttr(font.uid);
            const nameText = escapeHtml(font.displayName);
            const styleText = escapeHtml(font.style || '');
            const pythonKeyAttr = font.pythonKey ? ` data-python-key="${escapeAttr(font.pythonKey)}"` : '';
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
                nativeNameHtml = ` <span class="font-native-name" style="color:#999;font-size:0.9em;">(${escapeHtml(nativeName)})</span>`;
            }

            return `
                <div class="${classes.join(' ')}" data-font-uid="${encodedUid}"${pythonKeyAttr}>
                    <div class="font-name">${nameText}<span class="font-style"> ${styleText}</span>${nativeNameHtml}</div>
                <div class="font-preview">
                    <div class="font-preview-text" style="font-size:${fontSize}px;">${escapeHtml(previewText)}</div>
                    <img class="font-preview-image" alt="${nameText} preview">
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
        if (!pythonReady) {
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
        pythonUpdateTimer = setTimeout(updatePythonPreviews, 300);
    }
    function buildPythonCacheKey(fontKey, text, size, width) {
        const normalizedWidth = Number.isFinite(width) ? Math.round(width) : 0;
        return `${fontKey}__${size}__${normalizedWidth}__${text}`;
    }

    async function updatePythonPreviews() {
        if (!pythonReady || !pythonClient || pythonPreviewBusy) {
            return;
        }
        if (!fontListElement) {
            return;
        }

        const text = previewTextInput ? previewTextInput.value : '';
        const size = fontSizeInput ? parseInt(fontSizeInput.value, 10) || 24 : 24;
        const listRect = fontListElement.getBoundingClientRect();

        const requestPayload = [];
        const requestBindings = new Map();

        document.querySelectorAll('.font-item.python-render').forEach(item => {
            const rect = item.getBoundingClientRect();
            if (rect.bottom < listRect.top - 80 || rect.top > listRect.bottom + 80) {
                return;
            }
            const font = fontByUid.get(item.dataset.fontUid);
            if (!font) {
                return;
            }
            const key = font.pythonKey || normalizeFontKey(font.displayName);
            if (!key) {
                return;
            }
             const previewHost = item.querySelector('.font-preview');
            const viewportWidth = previewHost ? Math.max(0, Math.floor(previewHost.clientWidth || previewHost.getBoundingClientRect().width || 0)) : 0;
            font._pythonViewportWidth = viewportWidth;
            const cacheKey = buildPythonCacheKey(key, text, size, viewportWidth);
            font.currentPythonCacheKey = cacheKey;
            const cached = pythonPreviewCache.get(cacheKey);
            if (cached) {
                updatePythonPreviewDom(font, cached);
           return;
            }
            const requestId = cacheKey;
            if (!requestBindings.has(requestId)) {
                requestBindings.set(requestId, []);
                // Debug: Check what we're sending
                console.log('[DEBUG] Sending to Python:', {
                    name: font.displayName,
                    postScriptName: font.postScriptName,
                    style: font.style,
                    hasPS: !!font.postScriptName
                });
                requestPayload.push({
                    name: font.pythonLookup || font.displayName,
                    postScriptName: font.postScriptName || null,
                    style: font.style || null,
                    width: viewportWidth,
                    requestId
                });
            }
            requestBindings.get(requestId).push(font);
        });

        if (requestPayload.length === 0) {
            return;
        }

        pythonPreviewBusy = true;
        try {
            const previews = await pythonClient.fetchBatchPreviews(requestPayload, text, size);
            (previews || []).forEach(preview => {
                if (!preview || !preview.image) {
                    return;
                }
               const requestId = preview.requestId;
                let boundFonts = requestId ? requestBindings.get(requestId) : null;
                if ((!boundFonts || !boundFonts.length) && preview.fontName) {
                    const norm = normalizeFontKey(preview.fontName);
                    boundFonts = fontsByPythonKey.get(norm) || [];
                }
                if (!boundFonts || !boundFonts.length) {
                    return;
                }
              boundFonts.forEach(font => {
                    const width = font._pythonViewportWidth || 0;
                    const cacheKey = buildPythonCacheKey(font.pythonKey || normalizeFontKey(font.displayName), text, size, width);
                    pythonPreviewCache.set(cacheKey, preview.image);
                    updatePythonPreviewDom(font, preview.image);
                });
            });
        } catch (error) {
            console.error('Python preview fetch failed:', error);
        } finally {
            pythonPreviewBusy = false;
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
                    showToast(translate('toast-load-fail'), 'warning');
                    return;
                }

                if (typeof result === 'string' && result.indexOf('EvalScript error') !== -1) {
                    console.warn('EvalScript error during load text:', result);
                    showToast(translate('toast-load-fail'), 'warning');
                    return;
                }

                const response = JSON.parse(result);
                if (response.success) {
                    const preview = document.getElementById('preview-text');
                    preview.value = response.text || '';
                    updateFontPreviews();
                    showToast(translate('toast-load-success'), 'success');
                } else {
                    console.warn('Load text failed:', response.error);
                    showToast(`${translate('toast-load-fail')} (${response.error || 'N/A'})`, 'warning');
                }
            } catch (error) {
                console.error('Failed to parse load text response:', error, result);
                showToast(translate('toast-load-fail'), 'error');
            }
        });
    }

    // Update font count
    function updateFontCount(count = availableFonts.length) {
        const countText = translations[currentLanguage]['font-count'].replace('{count}', count);
        document.getElementById('font-count').textContent = countText;
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
                loading.innerHTML = `<span>${translations[currentLanguage]['loading-text'] || 'Loading...'}</span>`;
                fontList.innerHTML = '';
                fontList.appendChild(loading);
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
                    const message = formatTranslation(key, { count: appliedCount });
                    showToast(message, 'success');
                } else {
                    updateStatus('status-error');
                    showToast(`${translate('toast-apply-fail')}: ${response.error}`, 'error');
                }
            } catch (parseError) {
                console.error('Parse error:', parseError);
                updateStatus('status-error');
                showToast(translate('toast-parse-fail'), 'error');
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
