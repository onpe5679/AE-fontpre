(function(window) {
    'use strict';

    const state = {
        initialized: false,
        container: null
    };

    function ensureContainer() {
        if (state.initialized) {
            return state.container;
        }
        state.initialized = true;

        var banner = document.createElement('div');
        banner.id = 'aefp-error-banner';
        banner.style.position = 'fixed';
        banner.style.bottom = '0';
        banner.style.left = '0';
        banner.style.right = '0';
        banner.style.zIndex = '9999';
        banner.style.background = 'rgba(180, 32, 32, 0.95)';
        banner.style.color = '#fff';
        banner.style.padding = '8px 12px';
        banner.style.fontSize = '12px';
        banner.style.fontFamily = 'Consolas, monospace';
        banner.style.display = 'none';
        banner.style.whiteSpace = 'pre-wrap';
        document.body.appendChild(banner);
        state.container = banner;
        return banner;
    }

    function formatError(error) {
        if (!error) {
            return 'Unknown error';
        }
        if (error.stack) {
            return error.stack;
        }
        if (error.message) {
            return error.message;
        }
        return String(error);
    }

    function showErrorBanner(message, error) {
        var banner = ensureContainer();
        banner.textContent = message + '\n' + formatError(error);
        banner.style.display = 'block';
    }

    function notify(origin, error) {
        var label = origin ? `[${origin}] ` : '';
        console.error(label + (error && error.message ? error.message : error), error);
        showErrorBanner(label + 'Runtime error', error);
        var status = document.getElementById('status-text');
        if (status) {
            status.textContent = origin + ' 오류 발생';
        }
    }

    window.AEFontErrorBoundary = {
        notify: notify
    };

    window.addEventListener('error', function(event) {
        try {
            notify('window.onerror', event.error || event.message || event);
        } catch (loggingError) {
            console.error('AEFontErrorBoundary failed:', loggingError);
        }
    });

    window.addEventListener('unhandledrejection', function(event) {
        try {
            var reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
            notify('unhandledrejection', reason);
        } catch (loggingError) {
            console.error('AEFontErrorBoundary failed:', loggingError);
        }
    });
})(window);
