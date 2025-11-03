// AE Font Preview - Main JavaScript
(function() {
    'use strict';

    // Global variables
    let csInterface;
    let currentLanguage = 'ko';
    let availableFonts = [];
    let selectedFont = null;
    let selectedFontId = null;
    let isInitialized = false;

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
            'placeholder-search': '폰트 이름으로 검색...'
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
            'placeholder-search': 'Search by font name...'
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
            'placeholder-search': 'フォント名で検索...'
        }
    };

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

    function escapeCssString(text) {
        if (text === null || text === undefined) {
            return '';
        }
        return escapeHtml(text);
    }

    function addCandidate(target, value) {
        if (!target || !Array.isArray(target)) {
            return;
        }
        if (!value && value !== 0) {
            return;
        }
        const candidate = String(value).trim();
        if (!candidate) {
            return;
        }
        if (!target.includes(candidate)) {
            target.push(candidate);
        }
    }

    function getFontFamilyValue(font) {
        const families = [];
        if (font && Array.isArray(font.cssFamilies)) {
            font.cssFamilies.forEach(name => addCandidate(families, name));
        }
        const cssList = families
            .filter(Boolean)
            .map(name => `"${escapeCssString(name)}"`)
            .join(', ');
        return cssList ? `${cssList}, sans-serif` : 'sans-serif';
    }

    function isFontRenderable(font) {
        if (!font) {
            return false;
        }
        if (!document.fonts || !document.fonts.check) {
            return true;
        }
        const families = Array.isArray(font.cssFamilies) ? font.cssFamilies : [];
        for (let i = 0; i < families.length; i++) {
            const candidate = families[i];
            if (!candidate) {
                continue;
            }
            const safeName = candidate.replace(/"/g, '');
            try {
                if (document.fonts.check(`12px "${safeName}"`)) {
                    return true;
                }
            } catch (error) {
                // ignore
            }
        }
        return false;
    }

    function updateFontPreviewFamily(font) {
        if (!font) {
            return;
        }
        const selector = `.font-item[data-font-uid="${font.uid}"] .font-preview`;
        const familyValue = getFontFamilyValue(font);
        document.querySelectorAll(selector).forEach(element => {
            element.style.fontFamily = familyValue;
        });
    }

    function ensureFontForPreview(font) {
        if (!window.AEFontLoader || !font) {
            return;
        }

        if (font.webFontStatus === 'loading' || font.webFontStatus === 'loaded' || font.webFontStatus === 'missing-config' || font.webFontStatus === 'failed') {
            return;
        }

        if (isFontRenderable(font)) {
            font.webFontStatus = 'available';
            return;
        }

        font.webFontStatus = 'loading';
        AEFontLoader.ensureFont(font).then(result => {
            if (result && Array.isArray(result.addedFamilies)) {
                result.addedFamilies.forEach(name => addCandidate(font.cssFamilies, name));
            }

            if (result && (result.status === 'loaded' || result.status === 'available')) {
                font.webFontStatus = 'loaded';
                requestAnimationFrame(() => updateFontPreviewFamily(font));
            } else if (result && result.status === 'missing-config') {
                font.webFontStatus = 'missing-config';
            } else if (result && result.status === 'failed') {
                font.webFontStatus = 'failed';
            } else {
                font.webFontStatus = result ? result.status : 'unknown';
            }
        }).catch(error => {
            font.webFontStatus = 'failed';
            console.warn('Web font loading failed:', font.displayName, error);
        });
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
    function init() {
        console.log('Initializing AE Font Preview...');
        
        if (!initCSInterface()) {
            console.error('Failed to initialize CSInterface');
            // Try to reinitialize after a delay
            setTimeout(init, 1000);
            return;
        }

        // Load JSX script manually if not loaded
        loadJSXScript();

        // Set up event listeners
        setupEventListeners();
        
        // Load initial language
        loadLanguage('ko');
        
        // Wait a bit for JSX to load, then load fonts
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
        document.getElementById('refresh-fonts').addEventListener('click', loadFonts);
        document.getElementById('apply-font').addEventListener('click', applySelectedFont);
    }

    // Load language
    function loadLanguage(lang) {
        currentLanguage = lang;
        const texts = translations[lang];
        
        if (!texts) return;

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

        // Load fonts from After Effects
    function loadFonts() {
        updateStatus('status-loading');
        showLoading(true);
        console.log('Loading fonts from After Effects...');

        csInterface.evalScript('AEFontPreview_getFonts()', function(result) {
            console.log('evalScript result:', result);
            
            try {
                // Check if result is undefined or null
                if (!result || result === 'undefined' || result === 'null') {
                    console.error('evalScript returned empty or undefined result');
                    updateStatus('status-error');
                    showErrorMessage('JSX 스크립트가 로드되지 않았습니다. After Effects를 다시 시작해주세요.');
                    showLoading(false);
                    return;
                }
                
                // Check for EvalScript error
                if (typeof result === 'string' && result.indexOf('EvalScript error') !== -1) {
                    console.error('EvalScript error:', result);
                    updateStatus('status-error');
                    showErrorMessage('JSX 스크립트 실행 오류: ' + result);
                    showLoading(false);
                    return;
                }
                
                const response = JSON.parse(result);
                console.log('Parsed response:', response);
                
                if (response.success) {
                    const fonts = Array.isArray(response.fonts) ? response.fonts : [];
                    console.log('Font count:', fonts.length, 'Source:', response.source);
                    
                    availableFonts = fonts.map((font, index) => {
                        const displayName = font.name || font.family || font.postScriptName || 'Unknown Font';
                        const familyName = font.family || displayName;
                        const postScriptName = font.postScriptName || font.name || displayName;
                        const styleName = font.style || 'Regular';
                        const id = postScriptName || (displayName + '|' + styleName);
                        const uid = 'font-' + index;

                        const cssFamilies = [];
                        addCandidate(cssFamilies, postScriptName);
                        addCandidate(cssFamilies, familyName);
                        addCandidate(cssFamilies, displayName);
                        addCandidate(cssFamilies, displayName.replace(/_/g, ' '));
                        addCandidate(cssFamilies, familyName.replace(/_/g, ' '));
                        if (postScriptName) {
                            addCandidate(cssFamilies, postScriptName.replace(/[_-]/g, ' '));
                        }
                        if (styleName) {
                            addCandidate(cssFamilies, `${familyName} ${styleName}`);
                            addCandidate(cssFamilies, `${familyName}-${styleName}`);
                            addCandidate(cssFamilies, `${displayName} ${styleName}`);
                            addCandidate(cssFamilies, `${displayName}-${styleName}`);
                        }
                        if (cssFamilies.length === 0) {
                            cssFamilies.push(displayName);
                        }

                        return {
                            uid,
                            id,
                            displayName,
                            family: familyName,
                            style: styleName,
                            postScriptName,
                            cssFamilies,
                            source: font.source || 'System'
                        };
                    });

                    window.availableFonts = availableFonts;

                    showLoading(false);  // displayFonts 호출 전에 loading 숨김
                    displayFonts(availableFonts);
                    updateFontCount();
                    updateStatus('status-ready');
                } else {
                    console.error('Script error:', response.error);
                    updateStatus('status-error');
                    showLoading(false);
                    showErrorMessage('폰트 목록을 불러올 수 없습니다: ' + response.error);
                }
            } catch (parseError) {
                console.error('Parse error:', parseError, 'Result was:', result);
                updateStatus('status-error');
                showLoading(false);
                showErrorMessage('응답을 파싱할 수 없습니다: ' + parseError.message);
            }
        });
    }

    // Display fonts in the list
    function displayFonts(fonts) {
        const fontList = document.getElementById('font-list');
        const previewText = document.getElementById('preview-text').value;
        const fontSize = document.getElementById('font-size').value;
        
        if (fonts.length === 0) {
            fontList.innerHTML = `<div class="no-fonts">${translations[currentLanguage]['no-fonts']}</div>`;
            return;
        }

        const html = fonts.map(font => {
            const encodedUid = escapeAttr(font.uid);
            const nameText = escapeHtml(font.displayName);
            const styleText = escapeHtml(font.style);
            const familyValue = getFontFamilyValue(font);
            const familyAttr = escapeAttr(familyValue);
            const statusAttr = font.webFontStatus ? ` data-font-status="${escapeAttr(font.webFontStatus)}"` : '';

            return `
                <div class="font-item" data-font-uid="${encodedUid}"${statusAttr}>
                    <div class="font-name">${nameText}<span class="font-style"> ${styleText}</span></div>
                    <div class="font-preview" style="font-family: ${familyAttr}; font-size: ${fontSize}px;">
                        ${escapeHtml(previewText)}
                    </div>
                </div>
            `;
        }).join('');

        fontList.innerHTML = html;

        document.querySelectorAll('.font-item').forEach(item => {
            item.addEventListener('click', function() {
                selectFont(this.dataset.fontUid);
            });
        });

        if (selectedFontId) {
            const selectedElement = document.querySelector(`.font-item[data-font-uid="${selectedFontId}"]`);
            if (selectedElement) {
                selectedElement.classList.add('selected');
            }
        }

        if (window.AEFontLoader) {
            fonts.forEach(font => ensureFontForPreview(font));
        }
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
            if (Array.isArray(font.cssFamilies)) {
                targets.push(...font.cssFamilies);
            }
            for (let i = 0; i < targets.length; i++) {
                if (targets[i].toLowerCase().indexOf(searchTerm) !== -1) {
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
        const previewText = document.getElementById('preview-text').value;
        const fontSize = document.getElementById('font-size').value;
        
        document.querySelectorAll('.font-preview').forEach(preview => {
            preview.textContent = previewText;
            preview.style.fontSize = fontSize + 'px';
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
                    const displayName = selectedFont.displayName || fontNameForApply;
                    showSuccessMessage(`${displayName} 폰트를 ${appliedCount}개의 텍스트 레이어에 적용했습니다.`);
                } else {
                    updateStatus('status-error');
                    showErrorMessage('폰트 적용 실패: ' + response.error);
                }
            } catch (parseError) {
                console.error('Parse error:', parseError);
                updateStatus('status-error');
                showErrorMessage('응답을 파싱할 수 없습니다.');
            }
        });
    }

    // Show success message
    function showSuccessMessage(message) {
        const fontList = document.getElementById('font-list');
        const successDiv = document.createElement('div');
        successDiv.className = 'success-message';
        successDiv.textContent = message;
        successDiv.style.cssText = 'background: #4CAF50; color: white; padding: 12px; margin: 8px; border-radius: 3px;';
        
        fontList.insertBefore(successDiv, fontList.firstChild);
        
        setTimeout(() => {
            if (successDiv.parentNode) {
                successDiv.parentNode.removeChild(successDiv);
            }
        }, 3000);
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
            webFontStatus: font.webFontStatus || '(none)'
        });

        if (window.AEFontLoader) {
            ensureFontForPreview(font);
        }
    };

    // Initialize when DOM is ready
    document.addEventListener('DOMContentLoaded', init);

})();
