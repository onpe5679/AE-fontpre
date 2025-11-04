// AE Font Preview - Font Rendering Utilities
(function(window, document) {
    'use strict';

    function escapeCssString(text) {
        if (text === null || text === undefined) {
            return '';
        }
        return String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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

    function normalizeFontName(name) {
        if (!name && name !== 0) {
            return '';
        }
        return String(name).toLowerCase().replace(/[\s_\-]/g, '');
    }

    function mapStyleToWeight(styleName) {
        if (!styleName) {
            return null;
        }
        const name = styleName.toLowerCase();
        if (/\bthin\b/.test(name) || name.includes('100')) return 100;
        if (/\bextra\s*light\b/.test(name) || name.includes('200')) return 200;
        if (/\blight\b/.test(name) || name.includes('300')) return 300;
        if (/\bregular\b/.test(name) || /\bnormal\b/.test(name) || name.includes('400')) return 400;
        if (/\bmedium\b/.test(name) || name.includes('500')) return 500;
        if (/\bsemi\s*bold\b/.test(name) || /\bdemi\b/.test(name) || name.includes('600')) return 600;
        if (/\bbold\b/.test(name) || name.includes('700')) return 700;
        if (/\bextra\s*bold\b/.test(name) || name.includes('800')) return 800;
        if (/\bblack\b/.test(name) || /\bheavy\b/.test(name) || name.includes('900')) return 900;
        return null;
    }

    function getLoadedCandidates(font) {
        if (font.loadedCandidates) {
            return font.loadedCandidates;
        }
        const loaded = [];
        if (!document.fonts || !document.fonts.check || !font || !Array.isArray(font.cssFamilies)) {
            if (font && Array.isArray(font.cssFamilies) && font.cssFamilies.length > 0) {
                loaded.push(font.cssFamilies[0]);
            }
            font.loadedCandidates = loaded;
            return loaded;
        }
        const seen = new Set();
        font.cssFamilies.forEach(candidate => {
            if (!candidate) return;
            const normalized = normalizeFontName(candidate);
            if (seen.has(normalized)) {
                return;
            }
            const safeName = candidate.replace(/"/g, '');
            try {
                if (document.fonts.check(`12px "${safeName}"`)) {
                    loaded.push(candidate);
                    seen.add(normalized);
                }
            } catch (error) {
                // ignore
            }
        });
        font.loadedCandidates = loaded;
        return loaded;
    }

    function chooseFamilyCandidate(font) {
        const candidates = Array.isArray(font.cssFamilies) ? font.cssFamilies.filter(Boolean) : [];
        if (candidates.length === 0) {
            return { family: font.displayName || font.family || 'sans-serif', matchType: 'fallback' };
        }

        const targets = new Set();
        const displayNorm = normalizeFontName(font.displayName);
        const familyNorm = normalizeFontName(font.family);
        const styleNorm = normalizeFontName(font.style);
        const postScriptNorm = normalizeFontName(font.postScriptName);

        [displayNorm, postScriptNorm,
            normalizeFontName(`${font.family} ${font.style}`),
            normalizeFontName(`${font.displayName} ${font.style}`)
        ].forEach(val => {
            if (val) targets.add(val);
        });

        let best = candidates[0];
        let bestScore = 1e9;
        let matchType = 'fallback';

        candidates.forEach(candidate => {
            const norm = normalizeFontName(candidate);
            let score = 100;

            if (targets.has(norm)) {
                score = 0;
            } else if (norm === familyNorm && familyNorm) {
                score = 1;
            } else if (styleNorm && norm.includes(styleNorm)) {
                score = 2;
            } else if (norm.includes(familyNorm)) {
                score = 3;
            }

            if (score < bestScore) {
                best = candidate;
                bestScore = score;
            }
        });

        if (bestScore === 0) matchType = 'exact';
        else if (bestScore === 1) matchType = 'family';
        else if (bestScore === 2) matchType = 'style-fragment';
        else matchType = 'fuzzy';

        return { family: best, matchType };
    }

    function resolveRenderSource(font, loadedMatch) {
        if (!font) return 'unknown';
        if (font.webFontStatus === 'render-failed') return 'render-failed';
        if (font.webFontStatus === 'failed' || font.webFontStatus === 'missing-config') return 'error';
        if (font.webFontStatus === 'web' || font.webFontStatus === 'loaded') return 'web';
        if (loadedMatch) return 'local';
        if (font.webFontStatus === 'loading') return 'web-loading';
        if (font.webFontStatus === 'local' || font.webFontStatus === 'available') return 'local';
        return 'pending';
    }

    function buildCssString(family) {
        if (!family) {
            return 'sans-serif';
        }
        return `"${escapeCssString(family)}", sans-serif`;
    }

    function computeRenderPlan(font) {
        if (!font) {
            return {
                cssString: 'sans-serif',
                matchType: 'fallback',
                needsWeightOverride: false,
                renderSource: 'unknown',
                loadedCandidates: []
            };
        }
        if (font.renderPlan) {
            return font.renderPlan;
        }

        const candidateInfo = chooseFamilyCandidate(font);
        const loadedCandidates = getLoadedCandidates(font);
        const candidateNorm = normalizeFontName(candidateInfo.family);
        const loadedMatch = loadedCandidates.find(name => normalizeFontName(name) === candidateNorm) || loadedCandidates[0] || null;
        const effectiveFamily = loadedMatch || candidateInfo.family;
        const cssString = buildCssString(effectiveFamily);
        const fontWeight = mapStyleToWeight(font.style);
        const effectiveNorm = normalizeFontName(effectiveFamily);
        const familyNorm = normalizeFontName(font.family);
        const fallbackToFamily = effectiveNorm === familyNorm && candidateNorm !== effectiveNorm;
        const needsWeightOverride = fontWeight !== null && (!loadedMatch || fallbackToFamily);
        const renderSource = resolveRenderSource(font, loadedMatch);

        const warningReasons = [];
        if (font.familyMeta && font.familyMeta.hasVariants) {
            if (!loadedMatch) {
                warningReasons.push('no-loaded-variant');
            }
            if (fallbackToFamily) {
                warningReasons.push('using-base-family');
            }
            if (candidateInfo.matchType !== 'exact') {
                warningReasons.push('fuzzy-match');
            }
            if (needsWeightOverride) {
                warningReasons.push('weight-override');
            }
        }

        const plan = {
            cssString,
            preferredFamily: effectiveFamily,
            matchType: candidateInfo.matchType,
            needsWeightOverride,
            fontWeight,
            renderSource,
            loadedCandidate: loadedMatch,
            loadedCandidates,
            candidateFamily: candidateInfo.family,
            warning: warningReasons.length > 0,
            warningReasons,
            fallbackToFamily,
            familyHasVariants: !!(font.familyMeta && font.familyMeta.hasVariants)
        };

        font.renderPlan = plan;
        return plan;
    }

    function isRenderable(font) {
        const loaded = getLoadedCandidates(font);
        return loaded.length > 0;
    }

    function invalidate(font) {
        if (!font) return;
        delete font.renderPlan;
        delete font.loadedCandidates;
    }

    window.AEFontRender = {
        addCandidate,
        computePlan: computeRenderPlan,
        isRenderable,
        invalidate,
        mapStyleToWeight
    };

})(window, document);
