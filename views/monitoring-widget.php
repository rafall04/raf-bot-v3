<?php
// views/monitoring-widget.php
// Simple modern dashboard - Traffic focused
?>

<!-- Modern Simple Dashboard -->
<link rel="stylesheet" href="/static/css/monitoring.css">

<div class="monitoring-dashboard">

<!-- Compact Status Cards -->
<div class="row mb-3">
    <!-- System Health -->
    <div class="col-lg-2 col-md-4 col-6 mb-3">
        <div class="modern-card gradient-green" id="health-status-box">
            <div class="card-icon">
                <i class="fas fa-heartbeat"></i>
            </div>
            <div class="card-content">
                <h2 id="health-score">95%</h2>
                <p>System Health</p>
            </div>
        </div>
    </div>
    
    <!-- WhatsApp Bot -->
    <div class="col-lg-2 col-md-4 col-6 mb-3">
        <div class="modern-card gradient-blue">
            <div class="card-icon">
                <i class="fab fa-whatsapp"></i>
            </div>
            <div class="card-content">
                <h2 id="wa-status">Checking...</h2>
                <p>WhatsApp Bot</p>
            </div>
        </div>
    </div>
    
    <!-- CPU Usage -->
    <div class="col-lg-2 col-md-4 col-6 mb-3">
        <div class="modern-card gradient-orange" id="mikrotik-status-box">
            <div class="card-icon">
                <i class="fas fa-microchip"></i>
            </div>
            <div class="card-content">
                <h2 id="mikrotik-cpu">0%</h2>
                <p>CPU Usage</p>
            </div>
        </div>
    </div>
    
    <!-- PPPoE Active Card -->
    <div class="col-lg-3 col-md-6 col-6 mb-3">
        <div class="modern-card gradient-purple clickable-stat-card" id="pppoe-stat-card" data-stat-type="pppoe" style="cursor: pointer;" title="Klik untuk melihat detail PPPoE users">
            <div class="card-icon">
                <i class="fas fa-ethernet"></i>
            </div>
            <div class="card-content">
                <h2 id="total-users">0</h2>
                <p>PPPoE Active</p>
            </div>
        </div>
    </div>
    
    <!-- Hotspot Active Card -->
    <div class="col-lg-3 col-md-6 col-6 mb-3">
        <div class="modern-card gradient-info clickable-stat-card" id="hotspot-stat-card" data-stat-type="hotspot" style="cursor: pointer;" title="Klik untuk melihat detail Hotspot users">
            <div class="card-icon">
                <i class="fas fa-wifi"></i>
            </div>
            <div class="card-content">
                <h2 id="hotspot-users-count">0</h2>
                <p>Hotspot Active</p>
            </div>
        </div>
    </div>
</div>

<!-- Main Traffic & Resources Row -->
<div class="row">
    <!-- Traffic Monitor -->
    <div class="col-lg-8">
        <div class="modern-panel">
            <div class="panel-header">
                <div class="d-flex justify-content-between align-items-center">
                    <h5><i class="fas fa-chart-line mr-2"></i><span id="traffic-panel-title">Network Traffic Monitor</span></h5>
                    <div class="interface-selector-wrapper">
                        <label class="mr-2 small text-muted mb-0">Interface:</label>
                        <select id="interface-selector" class="form-select form-select-sm">
                            <!-- Dynamic options -->
                        </select>
                    </div>
                </div>
            </div>
            <div class="panel-body">
                <div class="traffic-chart-container">
                    <canvas id="traffic-chart"></canvas>
                </div>
            </div>
            <div class="panel-footer">
                <div class="row text-center">
                    <div class="col-6">
                        <div class="traffic-stat download-stat">
                            <i class="fas fa-download"></i>
                            <span class="stat-value" id="current-download">0 Mbps</span>
                            <span class="stat-label">Download Speed</span>
                            <span class="stat-total" id="total-download">Total: 0 GB</span>
                        </div>
                    </div>
                    <div class="col-6">
                        <div class="traffic-stat upload-stat">
                            <i class="fas fa-upload"></i>
                            <span class="stat-value" id="current-upload">0 Mbps</span>
                            <span class="stat-label">Upload Speed</span>
                            <span class="stat-total" id="total-upload">Total: 0 GB</span>
                        </div>
                    </div>
                </div>
                <div class="monitoring-meta mt-3">
                    <span id="monitoring-state-badge" class="monitoring-state-badge state-stale">Menunggu data monitoring</span>
                    <span id="monitoring-last-updated" class="monitoring-meta-text">Last live update: belum ada data</span>
                    <span id="monitoring-user-stats-source" class="monitoring-meta-text">Stat user: belum tersedia</span>
                </div>
            </div>
        </div>
    </div>
    
    <!-- Resource Monitor -->
    <div class="col-lg-4">
        <div class="modern-panel">
            <div class="panel-header">
                <h5><i class="fas fa-server mr-2"></i>System Resources</h5>
            </div>
            <div class="panel-body">
                <!-- CPU -->
                <div class="resource-card mb-3">
                    <div class="resource-header">
                        <i class="fas fa-microchip"></i>
                        <span>CPU</span>
                        <span class="resource-value" id="cpu-text">0%</span>
                    </div>
                    <div class="modern-progress">
                        <div class="progress-fill cpu-fill" id="cpu-bar" style="width: 0%"></div>
                    </div>
                </div>
                
                <!-- Memory -->
                <div class="resource-card mb-3">
                    <div class="resource-header">
                        <i class="fas fa-memory"></i>
                        <span>Memory</span>
                        <span class="resource-value" id="memory-text">0%</span>
                    </div>
                    <div class="modern-progress">
                        <div class="progress-fill memory-fill" id="memory-bar" style="width: 0%"></div>
                    </div>
                </div>
                
                <!-- Disk -->
                <div class="resource-card mb-3">
                    <div class="resource-header">
                        <i class="fas fa-hdd"></i>
                        <span>Storage</span>
                        <span class="resource-value" id="disk-text">0%</span>
                    </div>
                    <div class="modern-progress">
                        <div class="progress-fill disk-fill" id="disk-bar" style="width: 0%"></div>
                    </div>
                </div>
                
                <!-- Temperature -->
                <div class="resource-card">
                    <div class="resource-header">
                        <i class="fas fa-thermometer-half"></i>
                        <span>Temperature</span>
                        <span class="resource-value" id="mikrotik-temp">0°C</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- Quick Actions Footer -->
<div class="row mt-3">
    <div class="col-12">
        <div class="quick-actions text-center">
            <button class="btn btn-sm btn-outline-info" onclick="window.monitoringController.showHotspotUsers()">
                <i class="fas fa-wifi"></i> Hotspot
            </button>
            <button class="btn btn-sm btn-outline-success" onclick="window.monitoringController.showPPPoEUsers()">
                <i class="fas fa-ethernet"></i> PPPoE
            </button>
            <button class="btn btn-sm btn-outline-warning" onclick="location.reload()">
                <i class="fas fa-sync"></i> Refresh
            </button>
        </div>
    </div>
</div>

<!-- Modal for User Lists -->
<div class="modal fade" id="userListModal" tabindex="-1" role="dialog" aria-labelledby="userListTitle" aria-hidden="true">
    <div class="modal-dialog modal-xl modal-dialog-scrollable" role="document">
        <div class="modal-content">
            <div class="modal-header bg-primary text-white">
                <h5 class="modal-title" id="userListTitle">Users</h5>
                <button type="button" class="close text-white" data-dismiss="modal" aria-label="Close">
                    <span aria-hidden="true">&times;</span>
                </button>
            </div>
            <div class="modal-body p-0">
                <div id="userListContent">
                    <!-- Dynamic content -->
                </div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-dismiss="modal">
                    <i class="fas fa-times"></i> Close
                </button>
            </div>
        </div>
    </div>
</div>

</div><!-- End monitoring-dashboard -->
