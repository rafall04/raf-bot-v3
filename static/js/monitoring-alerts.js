(function () {
const monitoringAlertHelpers = typeof window !== 'undefined' && window.MonitoringHelpers
    ? window.MonitoringHelpers
    : require('./monitoring-helpers');

const { escapeHtml } = monitoringAlertHelpers;

const monitoringAlertExports = {
    handleNewAlert(alert) {
        this.alerts.unshift(alert);

        if (this.alerts.length > 50) {
            this.alerts = this.alerts.slice(0, 50);
        }

        const activeAlerts = document.getElementById('active-alerts');
        if (activeAlerts) {
            activeAlerts.textContent = this.alerts.length;
        }

        const lastAlert = document.getElementById('last-alert');
        if (lastAlert) {
            lastAlert.textContent = alert.message || 'New alert';
        }

        if (alert.level === 'critical' || alert.level === 'error') {
            this.showNotification(alert);
        }
    },

    showNotification(alert) {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('System Alert', {
                body: alert.message,
                icon: '/static/img/alert-icon.png'
            });
        }

        if (typeof toastr !== 'undefined') {
            toastr[alert.level || 'info'](alert.message, 'System Alert');
        }
    },

    showAlerts() {
        $('#alertModal').modal('show');
        this.renderAlerts();
    },

    renderAlerts() {
        const alertsList = document.getElementById('alerts-list');
        if (!alertsList) return;

        if (this.alerts.length === 0) {
            alertsList.innerHTML = '<p class="text-center">No alerts to display</p>';
            return;
        }

        let html = '<div class="list-group">';
        this.alerts.forEach(alert => {
            const levelClass = {
                critical: 'danger',
                error: 'danger',
                warning: 'warning',
                info: 'info'
            }[alert.level] || 'secondary';

            html += `
                <div class="list-group-item">
                    <div class="d-flex w-100 justify-content-between">
                        <h6 class="mb-1">
                            <span class="badge badge-${levelClass}">${escapeHtml(alert.level)}</span>
                            ${escapeHtml(alert.type || 'Alert')}
                        </h6>
                        <small>${escapeHtml(new Date(alert.timestamp).toLocaleString())}</small>
                    </div>
                    <p class="mb-1">${escapeHtml(alert.message)}</p>
                    ${alert.details ? `<small class="text-muted">${escapeHtml(JSON.stringify(alert.details))}</small>` : ''}
                </div>
            `;
        });
        html += '</div>';

        alertsList.innerHTML = html;
    },

    async clearAlerts() {
        this.alerts = [];

        const activeAlerts = document.getElementById('active-alerts');
        if (activeAlerts) {
            activeAlerts.textContent = '0';
        }

        const lastAlert = document.getElementById('last-alert');
        if (lastAlert) {
            lastAlert.textContent = 'No recent alerts';
        }

        this.renderAlerts();

        try {
            await fetch('/api/monitoring-wrapper.php?action=trigger', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'same-origin',
                body: JSON.stringify({
                    action: 'clear_alerts',
                    params: {}
                })
            });
        } catch (error) {
            console.error('Error clearing alerts:', error);
        }
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = monitoringAlertExports;
}

if (typeof window !== 'undefined') {
    window.MonitoringAlertMethods = monitoringAlertExports;
}
})();
