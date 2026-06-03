(function () {
const monitoringTransportExports = {
    connectSocket() {
        const socketUrl = window.location.protocol + '//' + window.location.hostname + 
                         (window.location.port ? ':' + window.location.port : '');

        this.socket = io(socketUrl, {
            auth: {
                token: localStorage.getItem('token')
            },
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            reconnectionAttempts: 5
        });

        this.socket.on('connect', () => {
            console.log('Connected to monitoring server via Socket.IO');
            this.isConnected = true;
            this.updateConnectionStatus('connected');
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from monitoring server');
            this.isConnected = false;
            this.mikrotikConnected = false;
            this.updateConnectionStatus('disconnected');
        });

        this.socket.on('connect_error', () => {
            if (!this.socketErrorLogged) {
                console.warn('Socket.IO connection failed. Falling back to polling mode.');
                this.socketErrorLogged = true;
            }
        });

        this.socket.on('monitoring:update', (data) => {
            this.handleMonitoringUpdate(data);
        });

        this.socket.on('mikrotik:traffic', (data) => {
            this.updateTrafficChart(data);
        });

        this.socket.on('mikrotik:users', (data) => {
            this.updateUserTables(data);
        });

        this.socket.on('alert:new', (alert) => {
            this.handleNewAlert(alert);
        });
    },

    bindEvents() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = monitoringTransportExports;
}

if (typeof window !== 'undefined') {
    window.MonitoringTransportMethods = monitoringTransportExports;
}
})();
