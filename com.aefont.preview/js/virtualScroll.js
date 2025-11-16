(function(window) {
    'use strict';

    class VirtualScroll {
        constructor(container, options) {
            this.container = container;
            this.itemHeight = options.itemHeight || 100;
            this.buffer = options.buffer || 5;
            this.renderItem = options.renderItem;
            this.onSelect = options.onSelect;

            this.items = [];
            this.visibleStart = 0;
            this.visibleEnd = 0;
            this.selectedIndex = -1;

            this.viewport = document.createElement('div');
            this.viewport.className = 'virtual-scroll-viewport';
            this.viewport.style.cssText = 'overflow-y: auto; height: 100%; position: relative;';

            this.content = document.createElement('div');
            this.content.className = 'virtual-scroll-content';
            this.content.style.cssText = 'position: relative;';

            this.viewport.appendChild(this.content);
            this.container.appendChild(this.viewport);

            this.viewport.addEventListener('scroll', () => this.handleScroll());
            window.addEventListener('resize', () => this.handleResize());
        }

        setItems(items) {
            this.items = items;
            this.content.style.height = (items.length * this.itemHeight) + 'px';
            this.render();
        }

        handleScroll() {
            this.render();
        }

        handleResize() {
            this.render();
        }

        render() {
            const scrollTop = this.viewport.scrollTop;
            const viewportHeight = this.viewport.clientHeight;

            const start = Math.floor(scrollTop / this.itemHeight) - this.buffer;
            const end = Math.ceil((scrollTop + viewportHeight) / this.itemHeight) + this.buffer;

            this.visibleStart = Math.max(0, start);
            this.visibleEnd = Math.min(this.items.length, end);

            const fragment = document.createDocumentFragment();
            const existingItems = new Map();

            Array.from(this.content.children).forEach(child => {
                const idx = parseInt(child.dataset.index);
                if (!isNaN(idx)) {
                    existingItems.set(idx, child);
                }
            });

            this.content.innerHTML = '';

            for (let i = this.visibleStart; i < this.visibleEnd; i++) {
                const item = this.items[i];
                let element = existingItems.get(i);

                if (!element) {
                    element = document.createElement('div');
                    element.className = 'virtual-scroll-item';
                    element.dataset.index = i;
                    element.style.cssText = `position: absolute; top: ${i * this.itemHeight}px; left: 0; right: 0; height: ${this.itemHeight}px;`;

                    if (this.renderItem) {
                        const content = this.renderItem(item, i);
                        if (typeof content === 'string') {
                            element.innerHTML = content;
                        } else {
                            element.appendChild(content);
                        }
                    }

                    if (this.onSelect) {
                        element.addEventListener('click', () => this.selectItem(i));
                    }
                } else {
                    element.style.top = (i * this.itemHeight) + 'px';
                }

                if (i === this.selectedIndex) {
                    element.classList.add('selected');
                } else {
                    element.classList.remove('selected');
                }

                fragment.appendChild(element);
            }

            this.content.appendChild(fragment);
        }

        selectItem(index) {
            this.selectedIndex = index;
            if (this.onSelect) {
                this.onSelect(this.items[index], index);
            }
            this.render();
        }

        getVisibleItems() {
            return this.items.slice(this.visibleStart, this.visibleEnd);
        }

        destroy() {
            this.viewport.removeEventListener('scroll', this.handleScroll);
            window.removeEventListener('resize', this.handleResize);
            this.container.removeChild(this.viewport);
        }
    }

    window.VirtualScroll = VirtualScroll;
})(window);
