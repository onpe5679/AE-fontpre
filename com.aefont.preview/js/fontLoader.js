// AE Font Preview - Web Font Loader
(function(window, document) {
    'use strict';

    if (window.AEFontLoader) {
        return;
    }

    function FontLoader() {
        this._configs = [];
        this._loaded = new Set();
        this._loading = new Map();
    }

    FontLoader.prototype.register = function(configs) {
        if (!Array.isArray(configs)) {
            return;
        }
        for (var i = 0; i < configs.length; i++) {
            var cfg = configs[i];
            if (!cfg || !cfg.id) {
                continue;
            }
            if (this._configs.some(function(existing) { return existing.id === cfg.id; })) {
                continue;
            }
            cfg.matches = Array.isArray(cfg.matches) ? cfg.matches : [];
            if (cfg.family && cfg.matches.indexOf(cfg.family) === -1) {
                cfg.matches.push(cfg.family);
            }
            this._configs.push(cfg);
        }
    };

    FontLoader.prototype._isFontAvailable = function(names) {
        if (!window.document.fonts || !window.document.fonts.check) {
            return true;
        }
        if (!names || names.length === 0) {
            return false;
        }
        for (var i = 0; i < names.length; i++) {
            var name = names[i];
            if (!name) {
                continue;
            }
            var checkName = name.replace(/"/g, '');
            try {
                if (window.document.fonts.check('12px "' + checkName + '"')) {
                    return true;
                }
            } catch (e) {
                // continue
            }
        }
        return false;
    };

    FontLoader.prototype._findConfigForFont = function(font) {
        if (!font) {
            return null;
        }

        var candidates = [];
        function addCandidate(value) {
            if (!value && value !== 0) {
                return;
            }
            var candidate = String(value).trim();
            if (!candidate) {
                return;
            }
            if (candidates.indexOf(candidate) === -1) {
                candidates.push(candidate);
            }
        }

        var families = font.cssFamilies || [];
        for (var i = 0; i < families.length; i++) {
            addCandidate(families[i]);
        }
        addCandidate(font.displayName);
        addCandidate(font.family);
        addCandidate(font.postScriptName);
        addCandidate(font.displayName && font.displayName.replace(/_/g, ' '));
        addCandidate(font.family && font.family.replace(/_/g, ' '));
        addCandidate(font.postScriptName && font.postScriptName.replace(/[_-]/g, ' '));

        for (var j = 0; j < this._configs.length; j++) {
            var config = this._configs[j];
            for (var k = 0; k < config.matches.length; k++) {
                if (candidates.indexOf(config.matches[k]) !== -1) {
                    return config;
                }
            }
        }

        return null;
    };

    FontLoader.prototype.ensureFont = function(font) {
        if (!font) {
            return Promise.resolve({ status: 'invalid' });
        }

        var names = [];
        if (Array.isArray(font.cssFamilies)) {
            names = names.concat(font.cssFamilies);
        }
        if (font.displayName) names.push(font.displayName);
        if (font.family) names.push(font.family);
        if (font.postScriptName) names.push(font.postScriptName);

        if (this._isFontAvailable(names)) {
            return Promise.resolve({ status: 'available' });
        }

        var config = this._findConfigForFont(font);
        if (!config) {
            return Promise.resolve({ status: 'missing-config' });
        }

        return this._loadConfig(config).then(function() {
            var additionalNames = [];
            if (config.family) {
                additionalNames.push(config.family);
            }
            if (config.aliases) {
                additionalNames = additionalNames.concat(config.aliases);
            }
            var merged = names.concat(additionalNames);
            var loaded = this._isFontAvailable(merged);
            return {
                status: loaded ? 'loaded' : 'pending',
                config: config,
                addedFamilies: additionalNames
            };
        }.bind(this)).catch(function(error) {
            console.warn('[FontLoader]', 'Failed to load web font', config ? config.id : '', error);
            return { status: 'failed', config: config, error: error };
        });
    };

    FontLoader.prototype._loadConfig = function(config) {
        if (this._loaded.has(config.id)) {
            return Promise.resolve();
        }
        if (this._loading.has(config.id)) {
            return this._loading.get(config.id);
        }

        var loaderPromise;
        if (config.type === 'stylesheet') {
            loaderPromise = this._loadStylesheet(config);
        } else if (config.type === 'fontface') {
            loaderPromise = this._loadFontFaces(config);
        } else {
            loaderPromise = Promise.reject(new Error('Unknown font loader type: ' + config.type));
        }

        var finalPromise = loaderPromise.then(function() {
            this._loaded.add(config.id);
            this._loading.delete(config.id);
        }.bind(this)).catch(function(err) {
            this._loading.delete(config.id);
            throw err;
        }.bind(this));

        this._loading.set(config.id, finalPromise);
        return finalPromise;
    };

    FontLoader.prototype._loadStylesheet = function(config) {
        return new Promise(function(resolve, reject) {
            if (!config.url) {
                reject(new Error('Missing stylesheet url for font ' + config.id));
                return;
            }
            var existing = document.querySelector('link[data-webfont-id="' + config.id + '"]');
            if (existing) {
                resolve();
                return;
            }
            var link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = config.url;
            link.setAttribute('data-webfont-id', config.id);
            link.onload = function() {
                resolve();
            };
            link.onerror = function(event) {
                reject(new Error('Failed to load stylesheet for ' + config.id));
            };
            document.head.appendChild(link);
        });
    };

    FontLoader.prototype._loadFontFaces = function(config) {
        if (!Array.isArray(config.variants) || config.variants.length === 0) {
            return Promise.reject(new Error('No fontface variants provided for ' + config.id));
        }

        var promises = [];
        for (var i = 0; i < config.variants.length; i++) {
            (function(variant) {
                if (!variant || !variant.url) {
                    return;
                }
                var fontFace = new FontFace(
                    variant.family || config.family,
                    'url(' + variant.url + ')',
                    {
                        weight: variant.weight || 'normal',
                        style: variant.style || 'normal',
                        display: variant.display || 'swap'
                    }
                );
                promises.push(fontFace.load().then(function(loaded) {
                    document.fonts.add(loaded);
                }));
            })(config.variants[i]);
        }

        if (promises.length === 0) {
            return Promise.reject(new Error('No valid variants to load for ' + config.id));
        }

        return Promise.all(promises);
    };

    window.AEFontLoader = new FontLoader();

    window.AEFontLoader.register([
        {
            id: 'google-noto-sans-kr',
            type: 'stylesheet',
            url: 'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@100;300;400;500;700;900&display=swap',
            family: 'Noto Sans KR',
            matches: ['NotoSansKR', 'NotoSansKR-Thin', 'NotoSansKR-Light', 'NotoSansKR-Regular', 'Noto Sans KR']
        },
        {
            id: 'noonnu-pretendard',
            type: 'stylesheet',
            url: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css',
            family: 'Pretendard',
            matches: ['Pretendard', 'Pretendard-Regular', 'Pretendard-Light', 'Pretendard ExtraBold']
        },
        {
            id: 'noonnu-gmarketsans',
            type: 'stylesheet',
            url: 'https://cdn.jsdelivr.net/gh/fonts-archive/GmarketSans/GmarketSans.css',
            family: 'GmarketSans',
            matches: ['G마켓 산스', 'Gmarket Sans', 'GmarketSans', 'GmarketSans Medium', 'GmarketSans-Bold']
        },
        {
            id: 'google-nanum-gothic',
            type: 'stylesheet',
            url: 'https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@400;700;800&display=swap',
            family: 'Nanum Gothic',
            matches: ['Nanum Gothic', 'NanumGothic', 'NanumGothic-Bold']
        },
        {
            id: 'google-nanum-myeongjo',
            type: 'stylesheet',
            url: 'https://fonts.googleapis.com/css2?family=Nanum+Myeongjo:wght@400;700;800&display=swap',
            family: 'Nanum Myeongjo',
            matches: ['NanumMyeongjo', 'Nanum Myeongjo', 'NanumMyeongjo-Bold']
        },
        {
            id: 'google-black-han-sans',
            type: 'stylesheet',
            url: 'https://fonts.googleapis.com/css2?family=Black+Han+Sans&display=swap',
            family: 'Black Han Sans',
            matches: ['BlackHanSans', 'Black Han Sans']
        },
        {
            id: 'google-jua',
            type: 'stylesheet',
            url: 'https://fonts.googleapis.com/css2?family=Jua&display=swap',
            family: 'Jua',
            matches: ['Jua']
        },
        {
            id: 'google-do-hyeon',
            type: 'stylesheet',
            url: 'https://fonts.googleapis.com/css2?family=Do+Hyeon&display=swap',
            family: 'Do Hyeon',
            matches: ['DoHyeon', 'Do Hyeon']
        }
    ]);

})(window, document);
