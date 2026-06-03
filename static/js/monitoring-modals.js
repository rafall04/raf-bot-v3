(function () {
const monitoringModalHelpers = typeof window !== 'undefined' && window.MonitoringHelpers
    ? window.MonitoringHelpers
    : require('./monitoring-helpers');

const {
    escapeHtml,
    formatLastUpdated
} = monitoringModalHelpers;

const monitoringModalExports = {
    initClickableStatCards() {
        const pppoeCard = document.getElementById('pppoe-stat-card');
        if (pppoeCard) {
            pppoeCard.addEventListener('click', () => {
                this.showPPPoEUsers();
            });
        }

        const hotspotCard = document.getElementById('hotspot-stat-card');
        if (hotspotCard) {
            hotspotCard.addEventListener('click', () => {
                this.showHotspotUsers();
            });
        }
    },

    buildActiveUsersMeta(result) {
        if (!result || (!result.fromCache && !result.stale)) {
            return '';
        }

        const badgeClass = result.stale ? 'alert-warning' : 'alert-secondary';
        const baseMessage = result.stale
            ? 'Menampilkan cache terbaru karena router lambat/tidak merespons.'
            : 'Menampilkan cache cepat untuk klik berulang.';
        const updatedAt = result.last_updated_at ? formatLastUpdated(result.last_updated_at) : '';
        const suffix = updatedAt ? ` Update terakhir: ${updatedAt}.` : '';

        return `<div class="alert ${badgeClass} mx-3 mt-3 mb-0 py-2 small">${escapeHtml(baseMessage + suffix)}</div>`;
    },

    formatTrafficMetric(bytes) {
        if (bytes === null || bytes === undefined || bytes === '') {
            return '-';
        }

        return this.formatBytes(Number(bytes) || 0);
    },

    async showHotspotUsers() {
        const modal = $('#userListModal');
        $('#userListTitle').text('Hotspot Active Users');
        const loadingContent = `
            <div class="text-center py-5">
                <div class="spinner-border text-info" role="status" style="width: 3rem; height: 3rem;">
                    <span class="sr-only">Loading...</span>
                </div>
                <p class="mt-3 text-muted">Memuat data Hotspot users...</p>
            </div>
        `;
        $('#userListContent').html(loadingContent);
        modal.modal('show');

        try {
            const response = await fetch('/api/monitoring/hotspot-active-users', {
                credentials: 'same-origin'
            });
            const result = await response.json();

            if (result.ok && Array.isArray(result.data?.sessions)) {
                const sessions = result.data.sessions || [];
                let content = this.buildActiveUsersMeta(result);
                content += '<div class="user-list-container">';

                if (sessions.length > 0) {
                    content += '<div class="d-none d-md-block">';
                    content += '<table class="table table-sm table-striped"><thead><tr>';
                    content += '<th>User</th><th>IP</th><th>Hostname</th><th>MAC</th><th>Uptime</th><th>Download</th><th>Upload</th>';
                    content += '</tr></thead><tbody>';

                    sessions.forEach(session => {
                        const hostname = session.hostname || '-';
                        const hostnameDisplay = hostname !== '-'
                            ? `<span class="badge badge-secondary" title="Hostname dari DHCP Server">${escapeHtml(hostname)}</span>`
                            : '<span class="text-muted">-</span>';

                        content += `<tr>
                            <td><strong>${escapeHtml(session.user || '-')}</strong></td>
                            <td>${escapeHtml(session.address || '-')}</td>
                            <td>${hostnameDisplay}</td>
                            <td class="text-muted small font-monospace">${escapeHtml(session.mac || '-')}</td>
                            <td>${escapeHtml(session.uptime || '0s')}</td>
                            <td class="text-success">${this.formatTrafficMetric(session.rx_bytes)}</td>
                            <td class="text-info">${this.formatTrafficMetric(session.tx_bytes)}</td>
                        </tr>`;
                    });
                    content += '</tbody></table></div>';
                    content += '<div class="d-md-none">';
                    sessions.forEach(session => {
                        const hostname = session.hostname || '-';
                        const hostnameDisplay = hostname !== '-'
                            ? `<div class="mt-1"><span class="badge badge-secondary badge-sm">${escapeHtml(hostname)}</span></div>`
                            : '';

                        content += `<div class="user-card mb-2">
                            <div class="d-flex justify-content-between align-items-center">
                                <strong>${escapeHtml(session.user || '-')}</strong>
                                <span class="badge badge-info">${escapeHtml(session.uptime || '0s')}</span>
                            </div>
                            <small class="text-muted d-block">IP: ${escapeHtml(session.address || '-')}</small>
                            ${hostnameDisplay}
                            <small class="text-muted d-block font-monospace" style="font-size: 0.75rem;">MAC: ${escapeHtml(session.mac || '-')}</small>
                            <div class="d-flex justify-content-between mt-1">
                                <span class="text-success small">Down ${this.formatTrafficMetric(session.rx_bytes)}</span>
                                <span class="text-info small">Up ${this.formatTrafficMetric(session.tx_bytes)}</span>
                            </div>
                        </div>`;
                    });
                    content += '</div>';
                } else {
                    content += '<div class="alert alert-info text-center">No active hotspot users</div>';
                }

                content += '</div>';
                $('#userListContent').html(content);
            } else {
                $('#userListContent').html(`<div class="alert alert-warning m-3">${escapeHtml(result.message || 'Data hotspot users tidak tersedia')}</div>`);
            }
        } catch (error) {
            console.error('Error loading hotspot users:', error);
            $('#userListContent').html('<div class="alert alert-danger m-3">Gagal memuat data hotspot users</div>');
        }
    },

    async showPPPoEUsers() {
        const modal = $('#userListModal');
        $('#userListTitle').text('PPPoE Active Users');
        const loadingContent = `
            <div class="text-center py-5">
                <div class="spinner-border text-success" role="status" style="width: 3rem; height: 3rem;">
                    <span class="sr-only">Loading...</span>
                </div>
                <p class="mt-3 text-muted">Memuat data PPPoE users...</p>
            </div>
        `;
        $('#userListContent').html(loadingContent);
        modal.modal('show');

        try {
            const response = await fetch('/api/monitoring/pppoe-active-users', {
                credentials: 'same-origin'
            });
            const result = await response.json();

            if (result.ok && Array.isArray(result.data?.sessions)) {
                const sessions = result.data.sessions || [];
                let content = this.buildActiveUsersMeta(result);
                content += '<div class="user-list-container">';

                if (sessions.length > 0) {
                    content += '<div class="d-none d-md-block">';
                    content += '<table class="table table-sm table-striped"><thead><tr>';
                    content += '<th>Name</th><th>IP</th><th>Service</th><th>Uptime</th><th>Download</th><th>Upload</th>';
                    content += '</tr></thead><tbody>';

                    sessions.forEach(session => {
                        content += `<tr>
                            <td><strong>${escapeHtml(session.name || '-')}</strong></td>
                            <td>${escapeHtml(session.address || '-')}</td>
                            <td><span class="badge badge-primary">${escapeHtml(session.service || 'pppoe')}</span></td>
                            <td>${escapeHtml(session.uptime || '-')}</td>
                            <td class="text-success">${this.formatTrafficMetric(session.rx_bytes)}</td>
                            <td class="text-info">${this.formatTrafficMetric(session.tx_bytes)}</td>
                        </tr>`;
                    });
                    content += '</tbody></table></div>';
                    content += '<div class="d-md-none">';
                    sessions.forEach(session => {
                        content += `<div class="user-card mb-2">
                            <div class="d-flex justify-content-between align-items-center">
                                <strong>${escapeHtml(session.name || '-')}</strong>
                                <span class="badge badge-success">${escapeHtml(session.uptime || '-')}</span>
                            </div>
                            <small class="text-muted d-block">${escapeHtml(session.address || '-')}</small>
                            <div class="d-flex justify-content-between mt-1">
                                <span class="text-success small">Down ${this.formatTrafficMetric(session.rx_bytes)}</span>
                                <span class="text-info small">Up ${this.formatTrafficMetric(session.tx_bytes)}</span>
                            </div>
                        </div>`;
                    });
                    content += '</div>';
                } else {
                    content += '<div class="alert alert-info text-center">No active PPPoE users</div>';
                }

                content += '</div>';
                $('#userListContent').html(content);
            } else {
                $('#userListContent').html(`<div class="alert alert-warning m-3">${escapeHtml(result.message || 'Data PPPoE users tidak tersedia')}</div>`);
            }
        } catch (error) {
            console.error('Error loading PPPoE users:', error);
            $('#userListContent').html('<div class="alert alert-danger m-3">Gagal memuat data PPPoE users</div>');
        }
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = monitoringModalExports;
}

if (typeof window !== 'undefined') {
    window.MonitoringModalMethods = monitoringModalExports;
}
})();
