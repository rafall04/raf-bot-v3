(function () {
const monitoringStateHelpers = typeof window !== 'undefined' && window.MonitoringHelpers
    ? window.MonitoringHelpers
    : require('./monitoring-helpers');

const {
    formatLastUpdated,
    resolveMonitoringState
} = monitoringStateHelpers;

const monitoringStateExports = {
    setMonitoringState(state, options = {}) {
        this.monitoringState = state;

        if (Object.prototype.hasOwnProperty.call(options, 'lastLiveUpdateAt')) {
            this.lastLiveUpdateAt = options.lastLiveUpdateAt;
        }

        if (options.userStatsSourceText) {
            this.userStatsSourceText = options.userStatsSourceText;
        }

        const badge = document.getElementById('monitoring-state-badge');
        const lastUpdated = document.getElementById('monitoring-last-updated');
        const userStatsSource = document.getElementById('monitoring-user-stats-source');
        const labels = {
            healthy: 'Live monitoring sehat',
            stale: 'Data monitoring stale',
            disconnected: 'MikroTik disconnected'
        };

        if (badge) {
            badge.className = `monitoring-state-badge state-${state}`;
            badge.textContent = labels[state] || labels.stale;
            badge.title = options.message || badge.textContent;
        }

        if (lastUpdated) {
            const formatted = formatLastUpdated(this.lastLiveUpdateAt);
            lastUpdated.textContent = formatted
                ? `Last live update: ${formatted}`
                : 'Last live update: belum ada data';
        }

        if (userStatsSource) {
            userStatsSource.textContent = this.userStatsSourceText;
        }
    },

    setUserStatsSource(text) {
        this.userStatsSourceText = text;
        this.setMonitoringState(this.monitoringState);
    },

    setTrafficPanelTitle(text) {
        const title = document.getElementById('traffic-panel-title');
        if (title) {
            title.textContent = text;
        }
    },

    setChartStatusTitle(text, color) {
        if (!this.trafficChart) {
            return;
        }

        if (!this.trafficChart.options.plugins.title) {
            this.trafficChart.options.plugins.title = {};
        }

        this.trafficChart.options.plugins.title.display = true;
        this.trafficChart.options.plugins.title.text = text;
        this.trafficChart.options.plugins.title.color = color;
        this.trafficChart.options.plugins.title.font = {
            size: 14,
            weight: '500'
        };
        this.trafficChart.options.plugins.title.position = 'top';
        this.trafficChart.options.plugins.title.align = 'center';
    },

    clearChartStatusTitle() {
        if (!this.trafficChart?.options?.plugins?.title) {
            return;
        }

        this.trafficChart.options.plugins.title.display = false;
        this.trafficChart.update('none');
    },

    setMikrotikMetricsUnknown() {
        const mikrotikCpu = document.getElementById('mikrotik-cpu');
        const mikrotikTemp = document.getElementById('mikrotik-temp');

        if (mikrotikCpu) {
            mikrotikCpu.textContent = 'N/A';
        }

        if (mikrotikTemp) {
            mikrotikTemp.textContent = 'N/A';
        }

        this.updateProgressBar('cpu', null);
        this.updateProgressBar('memory', null);
        this.updateProgressBar('disk', null);
    },

    updateConnectionStatus(status) {
        console.log('WebSocket connection status:', status);

        if (status === 'disconnected') {
            this.markMikrotikDisconnected('Koneksi monitoring terputus.');
        }
    },

    markMikrotikHealthy() {
        this.mikrotikFailureCount = 0;
        this.mikrotikConnected = true;
        this.setMonitoringState(resolveMonitoringState({ hasData: true }), {
            lastLiveUpdateAt: new Date(),
            message: 'Monitoring live tersambung'
        });
        this.clearChartStatusTitle();
    },

    registerMikrotikFailure(message) {
        this.mikrotikFailureCount += 1;
        console.warn(`[Monitoring] MikroTik failure ${this.mikrotikFailureCount}/${this.mikrotikFailureThreshold}: ${message}`);
        const nextState = resolveMonitoringState({
            failureCount: this.mikrotikFailureCount,
            threshold: this.mikrotikFailureThreshold
        });

        if (nextState === 'stale') {
            this.setMonitoringState('stale', {
                message
            });
            return;
        }

        this.mikrotikConnected = false;
        this.handleDisconnection('MikroTik disconnected');
    },

    markMikrotikDisconnected(message) {
        this.mikrotikFailureCount = this.mikrotikFailureThreshold;
        this.mikrotikConnected = false;
        console.warn(`[Monitoring] MikroTik explicitly disconnected: ${message}`);
        this.handleDisconnection(message);
    },

    handleDisconnection(message = 'MikroTik disconnected') {
        const dlCurrent = document.getElementById('current-download');
        const ulCurrent = document.getElementById('current-upload');
        const dlTotal = document.getElementById('total-download');
        const ulTotal = document.getElementById('total-upload');

        if (dlCurrent) dlCurrent.textContent = 'N/A';
        if (ulCurrent) ulCurrent.textContent = 'N/A';
        if (dlTotal) dlTotal.textContent = 'Total: N/A';
        if (ulTotal) ulTotal.textContent = 'Total: N/A';

        this.setMikrotikMetricsUnknown();
        this.setMonitoringState(resolveMonitoringState({ explicitDisconnected: true }), {
            message
        });
        this.fetchUserStatsFromStats('Stat user: fallback /api/stats saat disconnected');
        this.setTrafficPanelTitle('Network Traffic Monitor');

        if (this.trafficChart) {
            this.trafficChart.data.labels = [];
            this.trafficChart.data.datasets[0].data = [];
            this.trafficChart.data.datasets[1].data = [];
            this.setChartStatusTitle('Network Traffic Monitor (MikroTik disconnected)', '#dc2626');
            this.trafficChart.update('default');
        }
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = monitoringStateExports;
}

if (typeof window !== 'undefined') {
    window.MonitoringStateMethods = monitoringStateExports;
}
})();
