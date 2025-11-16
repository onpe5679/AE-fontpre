(function(window) {
    'use strict';

    class FontListView {
        constructor(container, options = {}) {
            this.container = container;
            this.previewText = options.previewText || '';
            this.fontSize = options.fontSize || 24;
            this.onFontSelect = options.onFontSelect;
            this.applyFontPlan = options.applyFontPlan;
            this.selectedFontId = null;
            this.observer = null;
            this.visibleItems = new Set();
            this.onVisibilityChange = options.onVisibilityChange;

            this.setupIntersectionObserver();
        }

        setupIntersectionObserver() {
            if (!('IntersectionObserver' in window)) {
                return;
            }

            this.observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        this.visibleItems.add(entry.target);
                    } else {
                        this.visibleItems.delete(entry.target);
                    }
                });

                if (this.onVisibilityChange) {
                    this.onVisibilityChange(Array.from(this.visibleItems));
                }
            }, {
                root: this.container,
                rootMargin: '200px 0px'
            });
        }

        render(fonts) {
            if (!this.container) {
                return;
            }

            // Disconnect existing observers
            if (this.observer) {
                this.observer.disconnect();
                this.visibleItems.clear();
            }

            if (!fonts || fonts.length === 0) {
                this.renderEmpty();
                return;
            }

            const fragment = document.createDocumentFragment();

            fonts.forEach(font => {
                const item = this.createFontItem(font);
                fragment.appendChild(item);
            });

            this.container.innerHTML = '';
            this.container.appendChild(fragment);

            // Re-observe all python-render items
            if (this.observer) {
                this.container.querySelectorAll('.font-item.python-render').forEach(item => {
                    this.observer.observe(item);
                });
            }

            // Trigger initial visibility check
            if (this.onVisibilityChange) {
                requestAnimationFrame(() => {
                    this.onVisibilityChange(Array.from(this.visibleItems));
                });
            }
        }

        createFontItem(font) {
            const item = document.createElement('div');
            item.className = 'font-item';
            item.dataset.fontUid = this.escapeAttr(font.uid);

            if (font.pythonKey) {
                item.dataset.pythonKey = this.escapeAttr(font.pythonKey);
            }

            if (font.requiresPython) {
                item.classList.add('python-render');
            } else {
                item.classList.add('css-render');
            }

            if (font.uid === this.selectedFontId) {
                item.classList.add('selected');
            }

            // Font name and style
            const nameDiv = document.createElement('div');
            nameDiv.className = 'font-name';

            const nameText = document.createTextNode(font.displayName);
            nameDiv.appendChild(nameText);

            if (font.style) {
                const styleSpan = document.createElement('span');
                styleSpan.className = 'font-style';
                styleSpan.textContent = ' ' + font.style;
                nameDiv.appendChild(styleSpan);
            }

            // Native name if different
            if (font.nativeFamily && font.nativeFamily !== font.family) {
                const nativeName = font.nativeFull || (font.nativeFamily + (font.nativeStyle ? ' ' + font.nativeStyle : ''));
                const nativeSpan = document.createElement('span');
                nativeSpan.className = 'font-native-name';
                nativeSpan.style.cssText = 'color:#999;font-size:0.9em;';
                nativeSpan.textContent = ' (' + nativeName + ')';
                nameDiv.appendChild(nativeSpan);
            }

            // Preview container
            const previewDiv = document.createElement('div');
            previewDiv.className = 'font-preview';

            const previewTextDiv = document.createElement('div');
            previewTextDiv.className = 'font-preview-text';
            previewTextDiv.style.fontSize = this.fontSize + 'px';
            previewTextDiv.textContent = this.previewText;

            const previewImg = document.createElement('img');
            previewImg.className = 'font-preview-image';
            previewImg.alt = font.displayName + ' preview';

            previewDiv.appendChild(previewTextDiv);
            previewDiv.appendChild(previewImg);

            item.appendChild(nameDiv);
            item.appendChild(previewDiv);

            // Event listener
            item.addEventListener('click', () => {
                if (this.onFontSelect) {
                    this.onFontSelect(font.uid);
                }
            });

            // Apply font rendering plan
            if (this.applyFontPlan) {
                this.applyFontPlan(font, item);
            }

            return item;
        }

        renderEmpty() {
            const div = document.createElement('div');
            div.className = 'no-fonts';
            div.textContent = window.i18n ? i18n.translate('no-fonts', 'No fonts available') : 'No fonts available';
            this.container.innerHTML = '';
            this.container.appendChild(div);
        }

        updatePreviewText(text) {
            this.previewText = text;
            this.container.querySelectorAll('.font-preview-text').forEach(node => {
                node.textContent = text;
            });
        }

        updateFontSize(size) {
            this.fontSize = size;
            this.container.querySelectorAll('.font-preview-text').forEach(node => {
                node.style.fontSize = size + 'px';
            });
        }

        setSelectedFont(fontUid) {
            this.selectedFontId = fontUid;

            // Remove previous selection
            this.container.querySelectorAll('.font-item.selected').forEach(item => {
                item.classList.remove('selected');
            });

            // Add new selection
            if (fontUid) {
                const item = this.container.querySelector(`.font-item[data-font-uid="${this.escapeAttr(fontUid)}"]`);
                if (item) {
                    item.classList.add('selected');
                }
            }
        }

        getVisibleItems() {
            return Array.from(this.visibleItems);
        }

        destroy() {
            if (this.observer) {
                this.observer.disconnect();
            }
            this.visibleItems.clear();
            this.container.innerHTML = '';
        }

        escapeAttr(str) {
            if (!str && str !== 0) {
                return '';
            }
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        }
    }

    window.FontListView = FontListView;
})(window);
