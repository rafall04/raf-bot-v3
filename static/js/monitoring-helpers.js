(function (globalScope) {
    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatLastUpdated(value) {
        if (!value) {
            return '';
        }

        const dateValue = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(dateValue.getTime())) {
            return '';
        }

        return dateValue.toLocaleString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            day: '2-digit',
            month: 'short'
        });
    }

    function resolveMonitoringState({ explicitDisconnected = false, hasData = false, failureCount = 0, threshold = 3 } = {}) {
        if (explicitDisconnected) {
            return 'disconnected';
        }

        if (hasData) {
            return 'healthy';
        }

        if (failureCount >= threshold) {
            return 'disconnected';
        }

        return 'stale';
    }

    const api = {
        escapeHtml,
        formatLastUpdated,
        resolveMonitoringState
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (typeof globalScope !== 'undefined') {
        globalScope.MonitoringHelpers = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
