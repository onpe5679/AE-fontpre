(function(window) {
    'use strict';

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

    const listeners = new Set();
    let currentLanguage = 'ko';

    function translate(key, fallback) {
        const pack = translations[currentLanguage] || translations.ko;
        if (!pack) {
            return fallback !== undefined ? fallback : key;
        }
        if (Object.prototype.hasOwnProperty.call(pack, key)) {
            return pack[key];
        }
        if (fallback !== undefined) {
            return fallback;
        }
        return key;
    }

    function format(key, params) {
        const template = translate(key, key);
        if (!params || typeof params !== 'object') {
            return template;
        }
        return Object.keys(params).reduce((acc, paramKey) => {
            const pattern = new RegExp(`\\{${paramKey}\\}`, 'g');
            return acc.replace(pattern, params[paramKey]);
        }, template);
    }

    function syncSelectValue(lang) {
        const select = document.getElementById('language-select');
        if (select && select.value !== lang) {
            select.value = lang;
        }
    }

    function applyToDom(lang) {
        const texts = translations[lang];
        if (!texts) {
            return;
        }
        syncSelectValue(lang);
        Object.keys(texts).forEach(key => {
            const element = document.getElementById(key);
            if (!element) {
                return;
            }
            if (key === 'placeholder-text') {
                const input = document.getElementById('preview-text');
                if (input) {
                    input.placeholder = texts[key];
                }
                return;
            }
            if (key === 'placeholder-search') {
                const search = document.getElementById('search-font');
                if (search) {
                    search.placeholder = texts[key];
                }
                return;
            }
            element.textContent = texts[key];
        });
    }

    function notify() {
        listeners.forEach(listener => {
            try {
                listener(currentLanguage);
            } catch (error) {
                console.warn('[AEFontI18n] Listener threw error:', error);
            }
        });
    }

    window.AEFontI18n = {
        getLanguage() {
            return currentLanguage;
        },
        setLanguage(lang, options = {}) {
            if (!lang || lang === currentLanguage || !translations[lang]) {
                return;
            }
            currentLanguage = lang;
            const shouldApply = options.applyToDom !== false;
            if (shouldApply) {
                applyToDom(lang);
            }
            notify();
        },
        translate,
        format,
        applyToDom,
        onChange(callback) {
            if (typeof callback === 'function') {
                listeners.add(callback);
            }
        },
        offChange(callback) {
            listeners.delete(callback);
        },
        get availableLanguages() {
            return Object.keys(translations);
        },
        get translations() {
            return translations;
        }
    };
})(window);
