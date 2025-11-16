(function(window) {
    'use strict';

    class LRUCache {
        constructor(maxSize = 100) {
            this.maxSize = maxSize;
            this.cache = new Map();
        }

        get(key) {
            if (!this.cache.has(key)) {
                return undefined;
            }

            // Move to end (most recently used)
            const value = this.cache.get(key);
            this.cache.delete(key);
            this.cache.set(key, value);
            return value;
        }

        set(key, value) {
            // Delete if exists (to reorder)
            if (this.cache.has(key)) {
                this.cache.delete(key);
            }

            // Add to end
            this.cache.set(key, value);

            // Evict oldest if over limit
            if (this.cache.size > this.maxSize) {
                const firstKey = this.cache.keys().next().value;
                this.cache.delete(firstKey);
            }
        }

        has(key) {
            return this.cache.has(key);
        }

        delete(key) {
            return this.cache.delete(key);
        }

        clear() {
            this.cache.clear();
        }

        get size() {
            return this.cache.size;
        }
    }

    window.LRUCache = LRUCache;
})(window);
