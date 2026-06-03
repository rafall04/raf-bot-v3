<?php
// FORCE NO CACHE - MUST BE FIRST
header("Cache-Control: no-cache, no-store, must-revalidate");
header("Pragma: no-cache");
header("Expires: 0");
header("X-Debug-Version: NO-PLUGIN-2025-11-07");
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <!-- CACHE BUSTER - Force reload on each access -->
    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
    <meta http-equiv="Pragma" content="no-cache">
    <meta http-equiv="Expires" content="0">
    <!-- VERSION: 2025-11-07-FINAL - Copied working code from teknisi version -->
    <title>Peta Jaringan</title>

    <link href="/vendor/fontawesome-free/css/all.min.css?v=<?php echo time(); ?>" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css?v=<?php echo time(); ?>" rel="stylesheet">
  <link href="/css/dashboard-modern.css?v=<?php echo time(); ?>" rel="stylesheet">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin=""/>
    <link href="https://cdn.jsdelivr.net/npm/select2@4.10-rc.0/dist/css/select2.min.css" rel="stylesheet" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/select2-bootstrap-theme/0.1.0-beta.10/select2-bootstrap.min.css" />
    <!-- Re-enable fullscreen CSS to match teknisi version -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet.fullscreen@1.6.0/Control.FullScreen.css" />

    <style>
        /* CRITICAL FIX: Ensure sidebar navbar is ALWAYS visible and clickable */
        #accordionSidebar {
            z-index: 1200 !important;
            position: relative !important;
        }
        
        /* Ensure sidebar collapse menus are above content */
        #accordionSidebar .collapse,
        #accordionSidebar .collapsing,
        #accordionSidebar .collapse.show {
            z-index: 1201 !important;
        }
        
        /* Ensure sidebar dropdown inner content is clickable */
        #accordionSidebar .collapse-inner {
            z-index: 1202 !important;
            position: relative !important;
        }
        
        /* Map-specific styles only - let sb-admin-2.css handle the layout */
        #content { 
            flex-grow: 1; 
            display: flex; 
            flex-direction: column; 
            overflow: hidden; 
        }
        
        #content .container-fluid {
            flex-grow: 1;
            display: flex;
            flex-direction: column;
            padding: 1rem;
            overflow: hidden;
        }
        
        /* Mobile optimizations for container */
        @media (max-width: 768px) {
            #content .container-fluid {
                padding: 0.5rem !important;
                width: 100%;
            }
            
            .navbar.topbar.mb-2 {
                margin-bottom: 0 !important;
            }
            
            /* Fix untuk modal yang terpotong di mobile */
            .modal-dialog {
                margin: 0.5rem;
                max-width: calc(100% - 1rem);
            }
            
            .modal-body {
                max-height: calc(100vh - 150px);
                padding: 0.75rem;
            }
        }
        #mapContainer {
            position: relative;
            width: 100%;
            flex-grow: 1;
            min-height: 400px;
            border-radius: .35rem;
            box-shadow: 0 .15rem 1.75rem 0 rgba(58,59,69,.15)!important;
            overflow: hidden;
            z-index: 1 !important;
        }
        #interactiveMap {
            width: 100%;
            height: 100%;
            border-radius: .35rem;
            background-color: #f0f0f0;
            z-index: 1 !important;
        }

        #mapContainer:-webkit-full-screen { width: 100vw; height: 100vh; padding: 0; margin: 0; background-color: #fff; }
        #mapContainer:-moz-full-screen { width: 100vw; height: 100vh; padding: 0; margin: 0; background-color: #fff; }
        #mapContainer:-ms-fullscreen { width: 100vw; height: 100vh; padding: 0; margin: 0; background-color: #fff; }
        #mapContainer:fullscreen { width: 100vw; height: 100vh; padding: 0; margin: 0; background-color: #fff; }

        #mapContainer:-webkit-full-screen #interactiveMap,
        #mapContainer:-moz-full-screen #interactiveMap,
        #mapContainer:-ms-fullscreen #interactiveMap,
        #mapContainer:fullscreen #interactiveMap {
            height: 100% !important;
            width: 100% !important;
            min-height: 100% !important;
            border-radius: 0;
        }

        body:has(#mapContainer:fullscreen) #accordionSidebar,
        body:has(#mapContainer:fullscreen) .navbar,
        body:has(#mapContainer:fullscreen) .sticky-footer,
        body:has(#mapContainer:fullscreen) .map-instructions-header,
        body:has(#mapContainer:fullscreen) #globalMessageMap,
        body:has(#mapContainer:fullscreen) .scroll-to-top,
        body:has(#mapContainer:fullscreen) .h4.mb-0.text-gray-800.d-none.d-md-inline-block
        {
            display: none !important;
        }
         body:has(#mapContainer:fullscreen) #content-wrapper {
            padding: 0 !important;
            margin: 0 !important;
            height: 100vh;
         }
         body:has(#mapContainer:fullscreen) #content {
            height: 100vh;
         }
         body:has(#mapContainer:fullscreen) .container-fluid {
            padding: 0 !important;
            height: 100%;
         }

        .leaflet-popup-content-wrapper { border-radius: 5px; }
        .leaflet-popup-content { font-size: 0.9rem; line-height: 1.4; max-width: 380px !important; }
        .leaflet-popup-content b { color: #4e73df; display: block; margin-bottom: 3px; }
        .leaflet-popup-content p { margin: 4px 0; font-size: 0.85rem; word-wrap: break-word; }
        .leaflet-popup-content button { margin-top: 8px; margin-right: 5px;}
        
        .legend { padding: 6px 8px; font: 14px/16px Arial, Helvetica, sans-serif; background: white; background: rgba(255,255,255,0.9); box-shadow: 0 0 15px rgba(0,0,0,0.2); border-radius: 5px; line-height: 24px; color: #555; max-width: 250px;}
        .legend i {
            vertical-align: middle;
            margin-right: 8px;
            font-size: 18px;
        }
        .legend span > i {
             text-shadow: 1px 1px 3px rgba(0,0,0,0.2);
        }
         .legend hr {
            margin-top: 8px;
            margin-bottom: 8px;
            border: 0;
            border-top: 1px solid #ccc;
        }

        .select2-container .select2-selection--single { height: calc(1.5em + .75rem + 2px)!important; padding: .375rem .75rem!important; line-height: 1.5; }
        .select2-container--bootstrap .select2-selection--single .select2-selection__rendered { line-height: calc(1.5em + .75rem)!important; padding-left: 0 !important; }
        .select2-container--bootstrap .select2-selection--single .select2-selection__arrow { height: calc(1.5em + .75rem + 2px)!important; }

        .map-instructions-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px;
            background-color: #f8f9fc;
            border: 1px solid #e3e6f0;
            border-radius: .35rem;
            margin-bottom: 15px;
            font-size: 0.9em;
            flex-wrap: wrap;
        }

        .modal-body { max-height: calc(100vh - 210px); overflow-y: auto; }
        .modal-lg { max-width: 800px; }
        .modal-xl { max-width: 1140px; }
        
        /* CRITICAL FIX: Ensure modals and popups are visible in fullscreen mode */
        .modal { z-index: 10000 !important; }
        .modal-backdrop { z-index: 9999 !important; }
        
        /* Ensure leaflet popups are also visible in fullscreen */
        .leaflet-popup { z-index: 9998 !important; }
        .leaflet-popup-pane { z-index: 9998 !important; }
        
        /* Tooltip should also be visible */
        .leaflet-tooltip { z-index: 9997 !important; }
        .leaflet-tooltip-pane { z-index: 9997 !important; }
        
        /* Ensure proper stacking of leaflet layers */
        .leaflet-overlay-pane { z-index: 400 !important; }
        .leaflet-shadow-pane { z-index: 500 !important; }
        .leaflet-marker-pane { z-index: 600 !important; }
        
        /* Additional fullscreen-specific fixes */
        #mapContainer:fullscreen .modal,
        #mapContainer:-webkit-full-screen .modal,
        #mapContainer:-moz-full-screen .modal,
        #mapContainer:-ms-fullscreen .modal {
            z-index: 10000 !important;
        }
        
        #mapContainer:fullscreen .modal-backdrop,
        #mapContainer:-webkit-full-screen .modal-backdrop,
        #mapContainer:-moz-full-screen .modal-backdrop,
        #mapContainer:-ms-fullscreen .modal-backdrop {
            z-index: 9999 !important;
        }

        .form-label { margin-bottom: .3rem; font-size: 0.8rem; font-weight: 500; }
        .form-control-sm { font-size: 0.8rem; padding: .25rem .5rem; height: calc(1.5em + .5rem + 2px); }

        #manualFullscreenBtn {
            position: absolute;
            bottom: 10px;
            left: 10px;
            z-index: 1000;
            padding: 6px 10px;
        }
        #mapContainer:fullscreen #manualFullscreenBtn,
        #mapContainer:-webkit-full-screen #manualFullscreenBtn,
        #mapContainer:-moz-full-screen #manualFullscreenBtn,
        #mapContainer:-ms-fullscreen #manualFullscreenBtn {
            bottom: 15px;
            left: 15px;
        }

        #wifiInfoModalBody .card-header { background-color: #f8f9fc; font-size: 0.9rem; padding: 0.5rem 1rem;}
        #wifiInfoModalBody .card-body { font-size: 0.85rem; padding: 0.75rem;}
        #wifiInfoModalBody .list-group-item { border-left:0; border-right:0; padding-left:0; padding-right:0; font-size: 0.8rem; }
        #wifiInfoModalBody .device-list { padding-left: 1.25rem; }
        #wifiInfoModalBody .small {font-size: 0.8em;}
         #wifi-names-container div { margin-bottom: 2px; }


        /* Simplified .leaflet-div-icon and .custom-div-icon CSS */
        .leaflet-div-icon {
            background: transparent !important;
            border: none !important;
            text-align: center;
        }
        .custom-div-icon {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
        }
        .custom-div-icon i {
            font-size: 24px;
            text-shadow: 1px 1px 3px rgba(0,0,0,0.3);
            display: block;
            line-height: 1;
        }
        /* Label styling, this will now apply to the L.tooltip content */
        .leaflet-tooltip.leaflet-tooltip-bottom.marker-label-tooltip {
            background-color: rgba(255, 255, 255, 0.75);
            color: black;
            font-size: 11px;
            font-weight: bold;
            padding: 1px 4px;
            border-radius: 3px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.2);
            white-space: nowrap;
            /* Remove default Leaflet tooltip arrow */
            border: none;
        }
        .leaflet-tooltip.leaflet-tooltip-bottom.marker-label-tooltip::before {
            border-bottom-color: transparent !important; /* Hide arrow */
        }


        .icon-odc i { color: #8A2BE2; }
        .icon-odp i { color: #FFA500; }
        .icon-customer-online i { color: #28a745 !important; }
        .icon-customer-offline i { color: #dc3545 !important; }
        .icon-customer-unknown i { color: #007bff !important; }
        
        /* Connection Monitoring Dashboard Styles */
        .border-left-success { border-left: 0.25rem solid #28a745 !important; }
        .border-left-danger { border-left: 0.25rem solid #dc3545 !important; }
        .border-left-info { border-left: 0.25rem solid #17a2b8 !important; }
        .border-left-warning { border-left: 0.25rem solid #ffc107 !important; }
        
        /* Monitoring Chart Styles */
        .monitoring-chart {
            width: 100% !important;
            max-height: 40px;
            opacity: 0.8;
        }
        
        @media (max-width: 768px) {
            .monitoring-chart {
                max-height: 30px;
            }
        }
        
        /* Connection Line Styles - Elegant depth effect */
        .connection-line-base,
        .connection-line-glow,
        .connection-line-shadow {
            pointer-events: none;
        }
        
        .connection-line-base {
            filter: blur(2px);
        }
        
        .connection-line-glow {
            filter: blur(3px);
        }
        
        .connection-line-shadow {
            filter: blur(2px);
        }
        
        /* Waypoint Editor Styles */
        .waypoint-marker {
            background: transparent;
            border: none;
        }
        
        .waypoint-marker-inner {
            position: relative;
            width: 30px;
            height: 40px;
            background: #ffc107;
            border: 3px solid #fff;
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            cursor: move;
        }
        
        .waypoint-marker-inner i {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) rotate(45deg);
            color: #fff;
            font-size: 16px;
        }
        
        .waypoint-index {
            position: absolute;
            bottom: -8px;
            left: 50%;
            transform: translateX(-50%) rotate(45deg);
            background: #ffc107;
            color: #000;
            font-weight: bold;
            font-size: 10px;
            padding: 2px 4px;
            border-radius: 3px;
            border: 1px solid #fff;
        }
        
        .waypoint-marker:hover .waypoint-marker-inner {
            background: #ff9800;
            transform: rotate(-45deg) scale(1.2);
        }
        
        /* Map Sidebar Styles */
        .map-sidebar {
            position: fixed;
            top: 0;
            right: -320px;
            width: 320px;
            height: 100vh;
            background: #fff;
            box-shadow: -2px 0 10px rgba(0,0,0,0.1);
            z-index: 1050;
            transition: right 0.3s ease;
            overflow-y: auto;
            overflow-x: hidden;
        }
        
        .map-sidebar.open {
            right: 0;
        }
        
        .map-sidebar-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 1rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            position: sticky;
            top: 0;
            z-index: 10;
        }
        
        .map-sidebar-header h6 {
            margin: 0;
            font-weight: 600;
        }
        
        .map-sidebar-content {
            padding: 1rem;
        }
        
        .sidebar-section {
            margin-bottom: 1.5rem;
            padding-bottom: 1.5rem;
            border-bottom: 1px solid #e3e6f0;
        }
        
        .sidebar-section:last-child {
            border-bottom: none;
            margin-bottom: 0;
            padding-bottom: 0;
        }
        
        .sidebar-section-title {
            font-size: 0.875rem;
            font-weight: 600;
            color: #5a5c69;
            margin-bottom: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .quick-stats {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }
        
        .stat-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0.5rem;
            background: #f8f9fc;
            border-radius: 0.35rem;
        }
        
        .stat-label {
            font-size: 0.875rem;
            color: #5a5c69;
        }
        
        .stat-value {
            font-size: 1.25rem;
            font-weight: 700;
            color: #4e73df;
        }
        
        .search-results {
            max-height: 200px;
            overflow-y: auto;
            border: 1px solid #e3e6f0;
            border-radius: 0.35rem;
            background: #fff;
        }
        
        .search-result-item {
            padding: 0.5rem;
            border-bottom: 1px solid #e3e6f0;
            cursor: pointer;
            transition: background 0.2s;
        }
        
        .search-result-item:hover {
            background: #f8f9fc;
        }
        
        .search-result-item:last-child {
            border-bottom: none;
        }
        
        .quick-filters {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }
        
        .quick-filters .form-check {
            margin-bottom: 0;
        }
        
        .quick-filters .form-check-label {
            font-size: 0.875rem;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .alerts-list {
            max-height: 200px;
            overflow-y: auto;
        }
        
        .alert-item {
            padding: 0.75rem;
            margin-bottom: 0.5rem;
            border-radius: 0.35rem;
            font-size: 0.875rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .alert-item.alert-info {
            background: #d1ecf1;
            color: #0c5460;
            border-left: 3px solid #17a2b8;
        }
        
        .alert-item.alert-warning {
            background: #fff3cd;
            color: #856404;
            border-left: 3px solid #ffc107;
        }
        
        .alert-item.alert-danger {
            background: #f8d7da;
            color: #721c24;
            border-left: 3px solid #dc3545;
        }
        
        .alert-item.alert-success {
            background: #d4edda;
            color: #155724;
            border-left: 3px solid #28a745;
        }
        
        .export-buttons {
            display: flex;
            flex-direction: column;
        }
        
        .map-sidebar-toggle {
            position: fixed;
            bottom: 2rem;
            right: 2rem;
            width: 56px;
            height: 56px;
            border-radius: 50%;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 1040;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.3s ease;
        }
        
        .map-sidebar-toggle:hover {
            transform: scale(1.1);
        }
        
        .map-sidebar.open ~ .map-sidebar-toggle {
            display: none;
        }
        
        /* Responsive: Mobile - Sidebar jadi bottom sheet */
        @media (max-width: 768px) {
            .map-sidebar {
                width: 100%;
                height: 70vh;
                right: 0;
                bottom: -70vh;
                top: auto;
                border-radius: 1rem 1rem 0 0;
                transition: bottom 0.3s ease;
            }
            
            .map-sidebar.open {
                bottom: 0;
            }
            
            .map-sidebar-toggle {
                bottom: 1rem;
                right: 1rem;
                width: 48px;
                height: 48px;
            }
        }
        
        /* Overlay saat sidebar open (mobile) */
        .map-sidebar-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 1049;
            display: none;
        }
        
        .map-sidebar.open ~ .map-sidebar-overlay,
        .map-sidebar-overlay.active {
            display: block;
        }
        
        @media (min-width: 769px) {
            .map-sidebar-overlay {
                display: none !important;
            }
        }
        
        /* Toast Notifications Styles */
        .toast-notifications-container {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 1060;
            display: flex;
            flex-direction: column;
            gap: 10px;
            max-width: 400px;
            pointer-events: none;
        }
        
        .toast-notification {
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            padding: 16px;
            display: flex;
            align-items: flex-start;
            gap: 12px;
            pointer-events: auto;
            animation: slideInRight 0.3s ease;
            border-left: 4px solid;
            min-width: 300px;
        }
        
        .toast-notification.toast-info {
            border-left-color: #17a2b8;
        }
        
        .toast-notification.toast-warning {
            border-left-color: #ffc107;
        }
        
        .toast-notification.toast-danger {
            border-left-color: #dc3545;
        }
        
        .toast-notification.toast-success {
            border-left-color: #28a745;
        }
        
        .toast-icon {
            font-size: 20px;
            flex-shrink: 0;
        }
        
        .toast-icon.toast-info {
            color: #17a2b8;
        }
        
        .toast-icon.toast-warning {
            color: #ffc107;
        }
        
        .toast-icon.toast-danger {
            color: #dc3545;
        }
        
        .toast-icon.toast-success {
            color: #28a745;
        }
        
        .toast-content {
            flex: 1;
        }
        
        .toast-title {
            font-weight: 600;
            font-size: 14px;
            margin-bottom: 4px;
            color: #5a5c69;
        }
        
        .toast-message {
            font-size: 13px;
            color: #858796;
            margin: 0;
        }
        
        .toast-close {
            background: none;
            border: none;
            color: #858796;
            cursor: pointer;
            font-size: 18px;
            padding: 0;
            width: 20px;
            height: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }
        
        .toast-close:hover {
            color: #5a5c69;
        }
        
        @keyframes slideInRight {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        
        @keyframes slideOutRight {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(100%);
                opacity: 0;
            }
        }
        
        .toast-notification.removing {
            animation: slideOutRight 0.3s ease;
        }
        
        /* Alert Panel Styles */
        .alert-panel {
            position: fixed;
            top: 80px;
            right: 20px;
            width: 380px;
            max-height: 500px;
            background: white;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            border-radius: 8px;
            z-index: 1055;
            display: none;
            flex-direction: column;
            overflow: hidden;
        }
        
        .alert-panel.open {
            display: flex;
        }
        
        .alert-panel.minimized {
            max-height: 50px;
        }
        
        .alert-panel-header {
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            color: white;
            padding: 12px 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: move;
        }
        
        .alert-panel-header h6 {
            margin: 0;
            font-weight: 600;
            font-size: 14px;
        }
        
        .alert-panel-actions {
            display: flex;
            gap: 8px;
        }
        
        .alert-panel-actions button {
            padding: 4px 8px;
            font-size: 12px;
        }
        
        .alert-panel-content {
            flex: 1;
            overflow-y: auto;
            padding: 12px;
        }
        
        .alert-panel-empty {
            text-align: center;
            padding: 40px 20px;
            color: #858796;
        }
        
        .alert-panel-empty i {
            font-size: 48px;
            margin-bottom: 12px;
            display: block;
        }
        
        .alert-panel-item {
            padding: 12px;
            margin-bottom: 8px;
            border-radius: 6px;
            border-left: 4px solid;
            background: #f8f9fc;
            position: relative;
        }
        
        .alert-panel-item.alert-critical {
            border-left-color: #dc3545;
            background: #fff5f5;
        }
        
        .alert-panel-item.alert-warning {
            border-left-color: #ffc107;
            background: #fffbf0;
        }
        
        .alert-panel-item.alert-info {
            border-left-color: #17a2b8;
            background: #f0f9fa;
        }
        
        .alert-panel-item-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 8px;
        }
        
        .alert-panel-item-title {
            font-weight: 600;
            font-size: 14px;
            color: #5a5c69;
            flex: 1;
        }
        
        .alert-panel-item-severity {
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            margin-left: 8px;
        }
        
        .alert-panel-item-severity.severity-critical {
            background: #dc3545;
            color: white;
        }
        
        .alert-panel-item-severity.severity-warning {
            background: #ffc107;
            color: #856404;
        }
        
        .alert-panel-item-severity.severity-info {
            background: #17a2b8;
            color: white;
        }
        
        .alert-panel-item-message {
            font-size: 13px;
            color: #858796;
            margin-bottom: 8px;
        }
        
        .alert-panel-item-time {
            font-size: 11px;
            color: #b7b9cc;
            margin-bottom: 8px;
        }
        
        .alert-panel-item-actions {
            display: flex;
            gap: 8px;
            margin-top: 8px;
        }
        
        .alert-panel-item-actions button {
            font-size: 12px;
            padding: 4px 12px;
        }
        
        .alert-panel-toggle {
            position: fixed;
            bottom: 80px;
            right: 2rem;
            width: 56px;
            height: 56px;
            border-radius: 50%;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 1040;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.3s ease;
            position: relative;
        }
        
        .alert-panel-toggle:hover {
            transform: scale(1.1);
        }
        
        .alert-badge {
            position: absolute;
            top: -4px;
            right: -4px;
            background: #dc3545;
            color: white;
            border-radius: 50%;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: 600;
            border: 2px solid white;
        }
        
        @media (max-width: 768px) {
            .toast-notifications-container {
                top: 10px;
                right: 10px;
                left: 10px;
                max-width: none;
            }
            
            .toast-notification {
                min-width: auto;
            }
            
            .alert-panel {
                width: calc(100% - 20px);
                right: 10px;
                left: 10px;
                max-height: 60vh;
            }
            
            .alert-panel-toggle {
                bottom: 70px;
                right: 1rem;
                width: 48px;
                height: 48px;
            }
        }
        
        /* Quick Filter Buttons Styles */
        .quick-filter-buttons {
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 10px;
            padding: 12px;
            background: #f8f9fc;
            border: 1px solid #e3e6f0;
            border-radius: 8px;
        }
        
        .quick-filter-group {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }
        
        .quick-filter-label {
            font-weight: 600;
            color: #5a5c69;
            font-size: 14px;
            margin-right: 4px;
        }
        
        .quick-filter-btn {
            border: 1px solid #d1d3e2;
            background: white;
            color: #5a5c69;
            padding: 6px 12px;
            border-radius: 6px;
            transition: all 0.2s ease;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        
        .quick-filter-btn:hover {
            background: #f8f9fc;
            border-color: #bac8f3;
            color: #4e73df;
            transform: translateY(-1px);
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .quick-filter-btn.active {
            background: #4e73df;
            border-color: #4e73df;
            color: white;
            box-shadow: 0 2px 8px rgba(78, 115, 223, 0.3);
        }
        
        .quick-filter-btn.active:hover {
            background: #375a7f;
            border-color: #375a7f;
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(78, 115, 223, 0.4);
        }
        
        .quick-filter-btn i {
            font-size: 12px;
        }
        
        #resetQuickFilterBtn {
            border: 1px solid #d1d3e2;
            color: #858796;
        }
        
        #resetQuickFilterBtn:hover {
            background: #f8f9fc;
            border-color: #bac8f3;
            color: #4e73df;
        }
        
        @media (max-width: 768px) {
            .quick-filter-buttons {
                padding: 8px;
            }
            
            .quick-filter-group {
                width: 100%;
                margin-bottom: 8px;
            }
            
            .quick-filter-label {
                width: 100%;
                margin-bottom: 4px;
            }
            
            .quick-filter-btn {
                flex: 1;
                min-width: calc(50% - 4px);
                justify-content: center;
            }
            
            #resetQuickFilterBtn {
                width: 100%;
            }
        }
        
        .badge-lg { font-size: 0.9rem; padding: 0.4rem 0.6rem; }
        
        /* Sembunyikan pesan error default Leaflet "map data not yet available" */
        .leaflet-tile-container {
            position: relative;
            font-size: 0 !important; /* Sembunyikan semua text dengan font-size 0 */
            line-height: 0 !important;
            color: transparent !important;
        }
        /* Sembunyikan semua text node dan non-image elements */
        .leaflet-tile-container *:not(img) {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            font-size: 0 !important;
            line-height: 0 !important;
            color: transparent !important;
        }
        /* Pastikan hanya image tile yang terlihat */
        .leaflet-tile-container img {
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
        }
        /* Sembunyikan text node langsung di tile container */
        .leaflet-tile-pane {
            font-size: 0 !important;
            line-height: 0 !important;
            color: transparent !important;
        }
        /* Pastikan tile pane tidak menampilkan text */
        .leaflet-tile-pane * {
            font-size: 0 !important;
            line-height: 0 !important;
            color: transparent !important;
        }
        /* Pastikan image tile tetap terlihat */
        .leaflet-tile-pane img {
            font-size: initial !important;
            line-height: initial !important;
        }

        
        .leaflet-control-custom-gps {
            background-color: white;
            border: 2px solid rgba(0,0,0,0.2);
            border-radius: 4px;
            width: 34px;
            height: 34px;
            line-height: 30px;
            text-align: center;
            cursor: pointer;
        }
        .leaflet-control-custom-gps i {
            font-size: 16px;
            color: #007bff;
        }
        .leaflet-control-custom-gps:hover {
            background-color: #f4f4f4;
        }
        
        /* Fix untuk overlap controls di mobile */
        @media (max-width: 768px) {
            .leaflet-control-custom-gps {
                width: 30px;
                height: 30px;
                line-height: 26px;
            }
            .leaflet-control-custom-gps i {
                font-size: 14px;
            }
            .leaflet-control-zoom {
                margin-top: 10px !important;
            }
            .leaflet-control-layers {
                margin-right: 5px !important;
            }
            #manualFullscreenBtn {
                bottom: 5px;
                left: 5px;
                padding: 4px 8px;
                font-size: 0.85rem;
            }
            
            /* Ensure map uses full available space */
            #interactiveMap {
                height: 100% !important;
            }
        }
        
        /* Styling for custom label toggles inside the layer control */
        .leaflet-control-layers-separator {
            border-top: 1px solid #ddd;
            margin: 5px 0;
        }
        .label-toggle-section {
            padding: 2px 5px;
        }
        .label-toggle-section label {
            display: flex;
            align-items: center;
            font-weight: normal;
            cursor: pointer;
        }
         .label-toggle-section label span {
            padding-left: 4px;
         }
        
        /* Advanced Legend Styling */
        .advanced-legend {
            background: white;
            background: rgba(255,255,255,0.95);
            box-shadow: 0 0 15px rgba(0,0,0,0.2);
            border-radius: 8px;
            padding: 12px;
            font-size: 14px;
            line-height: 1.6;
            max-width: 280px;
            max-height: 80vh;
            overflow-y: auto;
        }
        
        .advanced-legend-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
            padding-bottom: 8px;
            border-bottom: 2px solid #e3e6f0;
        }
        
        .advanced-legend-header h4 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: #5a5c69;
        }
        
        .advanced-legend-toggle-btn {
            background: none;
            border: none;
            color: #5a5c69;
            cursor: pointer;
            padding: 4px 8px;
            font-size: 14px;
        }
        
        .advanced-legend-toggle-btn:hover {
            color: #4e73df;
        }
        
        .legend-category {
            margin-bottom: 12px;
            padding: 8px;
            background: #f8f9fc;
            border-radius: 6px;
            border-left: 3px solid transparent;
        }
        
        .legend-category.legend-category-odc {
            border-left-color: #8A2BE2;
        }
        
        .legend-category.legend-category-odp {
            border-left-color: #FFA500;
        }
        
        .legend-category.legend-category-online {
            border-left-color: #28a745;
        }
        
        .legend-category.legend-category-offline {
            border-left-color: #dc3545;
        }
        
        .legend-category.legend-category-unknown {
            border-left-color: #007bff;
        }
        
        .legend-category-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 6px;
        }
        
        .legend-category-label {
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: 500;
            color: #5a5c69;
        }
        
        .legend-category-icon {
            font-size: 18px;
        }
        
        .legend-category-counter {
            background: #4e73df;
            color: white;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
            min-width: 24px;
            text-align: center;
        }
        
        .legend-category-toggle {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        
        .legend-category-toggle input[type="checkbox"] {
            cursor: pointer;
            width: 18px;
            height: 18px;
        }
        
        .legend-category-toggle label {
            cursor: pointer;
            font-size: 12px;
            color: #858796;
            margin: 0;
        }
        
        .legend-minimap-container {
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px solid #e3e6f0;
        }
        
        .legend-minimap {
            height: 150px;
            width: 100%;
            border: 1px solid #e3e6f0;
            border-radius: 4px;
            background: #f8f9fc;
        }
        
        .legend-tools {
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px solid #e3e6f0;
        }
        
        .legend-tools-btn {
            width: 100%;
            margin-bottom: 6px;
            font-size: 12px;
            padding: 6px 12px;
        }
        
        /* Collapsible Legend Styling (Legacy - keep for compatibility) */
        .legend-control {
            box-shadow: 0 1px 5px rgba(0,0,0,0.4);
            background: #fff;
            border-radius: 5px;
        }
        .legend-control a.legend-toggle {
            display: block;
            width: 36px;
            height: 36px;
            line-height: 36px;
            text-align: center;
            cursor: pointer;
            color: #333;
        }
        .legend-control a.legend-toggle i {
            font-size: 1.2em;
        }
        .legend-control.legend-collapsed .info.legend { display: none; }
        .legend-control:not(.legend-collapsed) a.legend-toggle { display: none; }
        .legend-control .info.legend { cursor: pointer; }


        #refreshAllDataBtn {
            margin-bottom: 0px;
        }
        #openCustomFilterModalBtn {
            margin-left: 10px;
        }
        
        /* Fix untuk auto refresh checkbox */
        .form-check.form-check-inline {
            white-space: nowrap;
        }
        .filter-list-column {
            max-height: 50vh;
            overflow-y: auto;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: .25rem;
        }
        
        @media (max-width: 768px) {
            .filter-list-column {
                max-height: 30vh;
            }
        }
        .filter-list-column .list-group-item {
            padding: .5rem .75rem;
            font-size: 0.85rem;
        }
        .filter-list-column .list-group-item label {
            margin-bottom: 0;
            font-weight: normal;
            width: 100%;
            cursor: pointer;
        }
         .filter-list-column .list-group-item input[type="checkbox"] {
            margin-right: 8px;
        }
        .filter-search-input {
            margin-bottom: 10px;
        }

        /* Asset Modal Map */
        #assetModalMap {
            height: 250px;
            width: 100%;
            margin-bottom: 10px;
            border: 1px solid #ddd;
            border-radius: .35rem;
        }
        /* Style for Leaflet layer control in asset modal */
        #assetModal .leaflet-control-layers {
            font-size: 0.8rem;
        }
        #assetModal .leaflet-control-layers-expanded {
             padding: 6px 10px 6px 6px;
        }


        /* Mobile Responsiveness Improvements */
@media (max-width: 768px) {
    #content .container-fluid {
        padding: 0.5rem !important;
        height: auto;
        overflow-y: auto;
    }
    
    #mapContainer {
        height: calc(100vh - 180px) !important;
        border-radius: 0;
        margin: 0;
        width: 100%;
    }
    
    .map-controls-container {
        bottom: 80px !important;
    }
    
    /* Remove this duplicate rule as it conflicts with responsive layout */
    
    .map-instructions-header {
        display: none !important; /* Hide instruction header on mobile to maximize map space */
    }
    
    /* Floating action buttons for mobile */
    #openCustomFilterModalBtn,
    #refreshAllDataBtn {
        position: fixed !important;
        z-index: 999;
        border-radius: 50% !important;
        width: 45px !important;
        height: 45px !important;
        padding: 0 !important;
        box-shadow: 0 2px 5px rgba(0,0,0,0.3) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
    }
    
    #openCustomFilterModalBtn {
        bottom: 140px !important;
        right: 15px !important;
        margin: 0 !important;
    }
    
    #refreshAllDataBtn {
        bottom: 85px !important;
        right: 15px !important;
        margin: 0 !important;
    }
    
    #openCustomFilterModalBtn span,
    #refreshAllDataBtn span {
        display: none !important;
    }
    
    /* Auto refresh checkbox mobile position */
    .form-check.form-check-inline {
        position: fixed !important;
        bottom: 195px !important;
        right: 15px !important;
        background: white !important;
        padding: 5px 10px !important;
        border-radius: 20px !important;
        box-shadow: 0 2px 5px rgba(0,0,0,0.3) !important;
        margin: 0 !important;
        z-index: 999;
    }
    
    .form-check.form-check-inline label {
        font-size: 0.75rem !important;
        margin-bottom: 0 !important;
    }

    .h4.mb-0.text-gray-800.d-none.d-md-inline-block {
        font-size: 1.1rem;
    }
    
    .legend-control, .legend {
        max-width: 180px;
        font-size: 12px;
        line-height: 20px;
    }
    
    .legend i {
        font-size: 14px;
    }
    
    /* Custom Filter Modal Spacing on Mobile */
    #customFilterModal .col-md-4 {
        margin-bottom: 1.5rem;
    }
    
    #customFilterModal .col-md-4:last-child {
        margin-bottom: 0;
    }
}
        
        /* Responsif untuk tablet */
        @media (min-width: 769px) and (max-width: 1024px) {
            #mapContainer {
                height: calc(100vh - 160px);
            }
            
            .navbar.topbar {
                padding: 0.5rem 1rem !important;
            }
            
            .navbar.topbar .h4 {
                font-size: 1.1rem !important;
            }
        }
        @media (max-width: 575.98px) {
            #content .container-fluid {
                padding: 0.25rem;
            }
            
            #mapContainer {
                height: calc(100vh - 70px) !important;
            }
            
            .map-instructions-header {
                padding: 6px;
                font-size: 0.8rem;
            }
            
            .map-instructions-header > span {
                font-size: 0.8rem;
            }
            
            .map-instructions-header .btn {
                font-size: 0.8rem;
                padding: 0.25rem 0.5rem;
            }
            
            .legend-control {
                display: none;
            }
            
            /* Auto refresh checkbox handled by floating position above */
            
            .form-check-label {
                font-size: 0.85rem;
            }
            
            /* Compact navbar for small screens */
            .navbar.topbar {
                padding: 0.375rem 0.75rem !important;
            }
            
            #username-placeholder {
                display: none !important;
            }
        }

    </style>
    <!-- Mobile sidebar styles handled by sb-admin-2.css -->
</head>

<body id="page-top">
    <div id="wrapper">
        <?php include '_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <nav class="navbar navbar-expand navbar-light bg-white topbar mb-2 static-top shadow">
                    <button type="button" id="sidebarToggleTop" class="btn btn-link d-md-none rounded-circle mr-3"><i class="fa fa-bars"></i></button>
                    <h1 class="h4 mb-0 text-gray-800">Peta Aset Jaringan</h1>
                    <ul class="navbar-nav ml-auto">
                        <li class="nav-item dropdown no-arrow">
                            <a class="nav-link dropdown-toggle" href="#" id="userDropdown" role="button" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                                <span id="username-placeholder" class="mr-2 d-none d-lg-inline text-gray-600 small">User</span>
                                <img class="img-profile rounded-circle" src="/img/undraw_profile.svg">
                            </a>
                            <div class="dropdown-menu dropdown-menu-right shadow animated--grow-in" aria-labelledby="userDropdown">
                                <a class="dropdown-item" href="/logout" data-toggle="modal" data-target="#logoutModal"><i class="fas fa-sign-out-alt fa-sm fa-fw mr-2 text-gray-400"></i>Logout</a>
                            </div>
                        </li>
                    </ul>
                </nav>
                <div class="container-fluid">
                    <div class="map-instructions-header">
                        <span class="flex-grow-1">
                           <i class="fas fa-info-circle"></i> <strong class="d-none d-sm-inline">Petunjuk:</strong> <span class="d-none d-md-inline">Klik marker ODC/ODP/Pelanggan untuk melihat detail atau mengelola. Gunakan tombol <i class="fas fa-crosshairs"></i> untuk ke lokasi GPS Anda.</span><span class="d-inline d-md-none">Klik marker untuk detail.</span>
                        </span>
                        <button id="openCustomFilterModalBtn" class="btn btn-sm btn-info" title="Filter Item Peta Secara Spesifik">
                            <i class="fas fa-filter"></i> <span class="d-none d-sm-inline">Filter Kustom</span><span class="d-inline d-sm-none">Filter</span>
                        </button>
                        <button id="refreshAllDataBtn" class="btn btn-sm btn-primary ml-2" title="Refresh Status Pelanggan & Redaman">
                            <i class="fas fa-sync-alt"></i> <span class="d-none d-sm-inline">Refresh Data</span><span class="d-inline d-sm-none">Refresh</span>
                        </button>
                        <div class="form-check form-check-inline ml-3">
                            <input class="form-check-input" type="checkbox" id="autoRefreshToggle">
                            <label class="form-check-label" for="autoRefreshToggle" title="Aktifkan refresh data otomatis setiap 30 detik">
                                <span class="d-none d-sm-inline">Auto Refresh</span><span class="d-inline d-sm-none">Auto</span>
                            </label>
                        </div>
                    </div>
                    <div id="globalMessageMap" class="mb-2"></div>
                    
                    <!-- Quick Filter Buttons -->
                    <div id="quickFilterButtons" class="quick-filter-buttons mb-3">
                        <div class="quick-filter-group">
                            <span class="quick-filter-label"><i class="fas fa-filter"></i> Quick Filters:</span>
                            <button class="btn btn-sm quick-filter-btn active" data-filter="all" title="Tampilkan Semua">
                                <i class="fas fa-th"></i> Semua
                            </button>
                            <button class="btn btn-sm quick-filter-btn" data-filter="online" title="Hanya Pelanggan Online">
                                <i class="fas fa-circle text-success"></i> Online
                            </button>
                            <button class="btn btn-sm quick-filter-btn" data-filter="offline" title="Hanya Pelanggan Offline">
                                <i class="fas fa-circle text-danger"></i> Offline
                            </button>
                            <button class="btn btn-sm quick-filter-btn" data-filter="assets" title="Hanya Aset Jaringan">
                                <i class="fas fa-network-wired"></i> Aset
                            </button>
                            <button class="btn btn-sm quick-filter-btn" data-filter="customers" title="Hanya Pelanggan">
                                <i class="fas fa-users"></i> Pelanggan
                            </button>
                        </div>
                        <button class="btn btn-sm btn-outline-secondary" id="resetQuickFilterBtn" title="Reset Filter">
                            <i class="fas fa-redo"></i> Reset
                        </button>
                    </div>
                    
                    <!-- Connection Monitoring Dashboard -->
                    <div id="connectionMonitoringDashboard" class="row mb-3" style="display: none;">
                        <div class="col-md-3 col-sm-6 mb-2">
                            <div class="card border-left-success shadow h-100 py-2">
                                <div class="card-body">
                                    <div class="row no-gutters align-items-center">
                                        <div class="col mr-2">
                                            <div class="text-xs font-weight-bold text-success text-uppercase mb-1">Pelanggan Online</div>
                                            <div class="h5 mb-0 font-weight-bold text-gray-800" id="monitoring-online-count">0</div>
                                            <div class="text-xs text-muted">Aktif</div>
                                        </div>
                                        <div class="col-auto">
                                            <i class="fas fa-circle text-success fa-2x"></i>
                                        </div>
                                    </div>
                                    <div class="mt-2">
                                        <canvas id="chart-online" class="monitoring-chart" style="height: 40px;"></canvas>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-md-3 col-sm-6 mb-2">
                            <div class="card border-left-danger shadow h-100 py-2">
                                <div class="card-body">
                                    <div class="row no-gutters align-items-center">
                                        <div class="col mr-2">
                                            <div class="text-xs font-weight-bold text-danger text-uppercase mb-1">Pelanggan Offline</div>
                                            <div class="h5 mb-0 font-weight-bold text-gray-800" id="monitoring-offline-count">0</div>
                                            <div class="text-xs text-muted">Putus</div>
                                        </div>
                                        <div class="col-auto">
                                            <i class="fas fa-circle text-danger fa-2x"></i>
                                        </div>
                                    </div>
                                    <div class="mt-2">
                                        <canvas id="chart-offline" class="monitoring-chart" style="height: 40px;"></canvas>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-md-3 col-sm-6 mb-2">
                            <div class="card border-left-info shadow h-100 py-2">
                                <div class="card-body">
                                    <div class="row no-gutters align-items-center">
                                        <div class="col mr-2">
                                            <div class="text-xs font-weight-bold text-info text-uppercase mb-1">Total Pelanggan</div>
                                            <div class="h5 mb-0 font-weight-bold text-gray-800" id="monitoring-total-count">0</div>
                                            <div class="text-xs text-muted">Terdaftar</div>
                                        </div>
                                        <div class="col-auto">
                                            <i class="fas fa-users fa-2x text-gray-300"></i>
                                        </div>
                                    </div>
                                    <div class="mt-2">
                                        <canvas id="chart-total" class="monitoring-chart" style="height: 40px;"></canvas>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-md-3 col-sm-6 mb-2">
                            <div class="card border-left-warning shadow h-100 py-2">
                                <div class="card-body">
                                    <div class="row no-gutters align-items-center">
                                        <div class="col mr-2">
                                            <div class="text-xs font-weight-bold text-warning text-uppercase mb-1">Uptime Rate</div>
                                            <div class="h5 mb-0 font-weight-bold text-gray-800" id="monitoring-uptime-rate">0%</div>
                                            <div class="text-xs text-muted">Ketersediaan</div>
                                        </div>
                                        <div class="col-auto">
                                            <i class="fas fa-chart-line fa-2x text-gray-300"></i>
                                        </div>
                                    </div>
                                    <div class="mt-2">
                                        <canvas id="chart-uptime" class="monitoring-chart" style="height: 40px;"></canvas>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Map Sidebar Panel -->
                    <div id="mapSidebar" class="map-sidebar">
                        <div class="map-sidebar-header">
                            <h6 class="mb-0"><i class="fas fa-tools"></i> Quick Tools</h6>
                            <button id="toggleMapSidebar" class="btn btn-sm btn-link text-white" title="Tutup Sidebar">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                        <div class="map-sidebar-content">
                            <!-- Quick Stats Section -->
                            <div class="sidebar-section">
                                <h6 class="sidebar-section-title"><i class="fas fa-chart-bar"></i> Quick Stats</h6>
                                <div class="quick-stats">
                                    <div class="stat-item">
                                        <span class="stat-label">ODC</span>
                                        <span class="stat-value" id="sidebar-odc-count">0</span>
                                    </div>
                                    <div class="stat-item">
                                        <span class="stat-label">ODP</span>
                                        <span class="stat-value" id="sidebar-odp-count">0</span>
                                    </div>
                                    <div class="stat-item">
                                        <span class="stat-label">Pelanggan</span>
                                        <span class="stat-value" id="sidebar-customer-count">0</span>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Quick Search Section -->
                            <div class="sidebar-section">
                                <h6 class="sidebar-section-title"><i class="fas fa-search"></i> Quick Search</h6>
                                <div class="input-group input-group-sm">
                                    <input type="text" id="sidebarSearchInput" class="form-control" placeholder="Cari pelanggan/ODC/ODP...">
                                    <div class="input-group-append">
                                        <button class="btn btn-outline-secondary" type="button" id="sidebarSearchBtn">
                                            <i class="fas fa-search"></i>
                                        </button>
                                    </div>
                                </div>
                                <div id="sidebarSearchResults" class="search-results mt-2" style="display: none;"></div>
                            </div>
                            
                            <!-- Quick Filters Section -->
                            <div class="sidebar-section">
                                <h6 class="sidebar-section-title"><i class="fas fa-filter"></i> Quick Filters</h6>
                                <div class="quick-filters">
                                    <div class="form-check">
                                        <input class="form-check-input" type="checkbox" id="sidebarFilterOnline" checked>
                                        <label class="form-check-label" for="sidebarFilterOnline">
                                            <i class="fas fa-circle text-success"></i> Online
                                        </label>
                                    </div>
                                    <div class="form-check">
                                        <input class="form-check-input" type="checkbox" id="sidebarFilterOffline" checked>
                                        <label class="form-check-label" for="sidebarFilterOffline">
                                            <i class="fas fa-circle text-danger"></i> Offline
                                        </label>
                                    </div>
                                    <div class="form-check">
                                        <input class="form-check-input" type="checkbox" id="sidebarFilterOdc" checked>
                                        <label class="form-check-label" for="sidebarFilterOdc">
                                            <i class="fas fa-server text-purple"></i> ODC
                                        </label>
                                    </div>
                                    <div class="form-check">
                                        <input class="form-check-input" type="checkbox" id="sidebarFilterOdp" checked>
                                        <label class="form-check-label" for="sidebarFilterOdp">
                                            <i class="fas fa-network-wired text-orange"></i> ODP
                                        </label>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Recent Alerts Section -->
                            <div class="sidebar-section">
                                <h6 class="sidebar-section-title"><i class="fas fa-bell"></i> Recent Alerts</h6>
                                <div id="sidebarAlertsList" class="alerts-list">
                                    <div class="alert-item alert-info">
                                        <i class="fas fa-info-circle"></i>
                                        <span>Belum ada alert</span>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Export Options Section -->
                            <div class="sidebar-section">
                                <h6 class="sidebar-section-title"><i class="fas fa-download"></i> Export</h6>
                                <div class="export-buttons">
                                    <button class="btn btn-sm btn-outline-primary btn-block mb-2" id="exportCustomersBtn">
                                        <i class="fas fa-file-csv"></i> Export Pelanggan
                                    </button>
                                    <button class="btn btn-sm btn-outline-secondary btn-block mb-2" id="exportAssetsBtn">
                                        <i class="fas fa-file-excel"></i> Export Aset
                                    </button>
                                    <button class="btn btn-sm btn-outline-info btn-block" id="exportMapBtn">
                                        <i class="fas fa-image"></i> Export Peta
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Overlay untuk mobile -->
                    <div class="map-sidebar-overlay" id="mapSidebarOverlay"></div>
                    
                    <!-- Toast Notifications Container -->
                    <div id="toastNotificationsContainer" class="toast-notifications-container"></div>
                    
                    <!-- Alert Panel (Floating) -->
                    <div id="alertPanel" class="alert-panel">
                        <div class="alert-panel-header">
                            <h6 class="mb-0"><i class="fas fa-exclamation-triangle"></i> Active Alerts</h6>
                            <div class="alert-panel-actions">
                                <button id="toggleAlertPanel" class="btn btn-sm btn-link text-white" title="Minimize">
                                    <i class="fas fa-minus"></i>
                                </button>
                                <button id="closeAlertPanel" class="btn btn-sm btn-link text-white" title="Close">
                                    <i class="fas fa-times"></i>
                                </button>
                            </div>
                        </div>
                        <div class="alert-panel-content" id="alertPanelContent">
                            <div class="alert-panel-empty">
                                <i class="fas fa-check-circle text-success"></i>
                                <p>Tidak ada alert aktif</p>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Alert Panel Toggle Button (Floating) -->
                    <button id="openAlertPanelBtn" class="btn btn-warning alert-panel-toggle" title="Buka Alert Panel">
                        <i class="fas fa-bell"></i>
                        <span class="alert-badge" id="alertBadge" style="display: none;">0</span>
                    </button>
                    
                    <!-- Toggle Sidebar Button (Floating) -->
                    <button id="openMapSidebarBtn" class="btn btn-primary map-sidebar-toggle" title="Buka Quick Tools">
                        <i class="fas fa-tools"></i>
                    </button>
                    
                    <div id="mapContainer">
                        <button id="editWaypointBtn" class="btn btn-warning btn-sm" title="Edit Waypoint Manual">
                            <i class="fas fa-route"></i> Edit Waypoint
                        </button>
                        <button id="manualFullscreenBtn" class="btn btn-light btn-sm" title="Layar Penuh Peta (Kustom)">
                            <i class="fas fa-expand"></i>
                        </button>
                        <div id="interactiveMap"></div>
                    </div>
                </div>
            </div>
            <footer class="sticky-footer bg-white">
                <div class="container my-auto"><div class="copyright text-center my-auto"><span>Copyright &copy; RAF BOT 2025</span></div></div>
            </footer>
        </div>
    </div>

    <a class="scroll-to-top rounded" href="#page-top"><i class="fas fa-angle-up"></i></a>
    <div class="modal fade" id="logoutModal" tabindex="-1" role="dialog"><div class="modal-dialog modal-dialog-centered" role="document"><div class="modal-content"><div class="modal-header"><h5 class="modal-title">Ready to Leave?</h5><button class="close" type="button" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button></div><div class="modal-body">Select "Logout" below if you are ready to end your current session.</div><div class="modal-footer"><button class="btn btn-secondary" type="button" data-dismiss="modal">Cancel</button><a class="btn btn-primary" href="/logout">Logout</a></div></div></div></div>

    <div class="modal fade" id="assetModal" tabindex="-1" role="dialog" aria-labelledby="assetModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-lg" role="document">
            <form id="assetForm">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="assetModalLabel">Tambah Aset Jaringan Baru</h5>
                        <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
                    </div>
                    <div class="modal-body">
                        <input type="hidden" id="assetId">
                        <div class="row">
                            <div class="col-md-6">
                                <div class="form-group">
                                    <label for="assetType" class="form-label">Tipe Aset <span class="text-danger">*</span></label>
                                    <select class="form-control form-control-sm" id="assetType" name="type" required>
                                        <option value="ODC">ODC (Optical Distribution Cabinet)</option>
                                        <option value="ODP">ODP (Optical Distribution Point)</option>
                                    </select>
                                </div>
                            </div>
                            <div class="col-md-6">
                                <div class="form-group">
                                    <label for="assetName" class="form-label">Nama/Label Aset <span class="text-danger">*</span></label>
                                    <input type="text" class="form-control form-control-sm" id="assetName" name="name" placeholder="Contoh: ODC Kaliasin 01" required>
                                </div>
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="assetAddress" class="form-label">Alamat/Lokasi Detail</label>
                            <input type="text" class="form-control form-control-sm" id="assetAddress" name="address" placeholder="Contoh: Jl. Kaliasin No. 1, Surabaya">
                        </div>
                        <div class="row">
                            <div class="col-md-6">
                                <div class="form-group">
                                    <label for="assetLatitude" class="form-label">Latitude <span class="text-danger">*</span></label>
                                    <input type="number" step="any" class="form-control form-control-sm" id="assetLatitude" name="latitude" required>
                                </div>
                            </div>
                            <div class="col-md-6">
                                <div class="form-group">
                                    <label for="assetLongitude" class="form-label">Longitude <span class="text-danger">*</span></label>
                                    <input type="number" step="any" class="form-control form-control-sm" id="assetLongitude" name="longitude" required>
                                </div>
                            </div>
                        </div>
                        <div id="assetModalMap" style="height: 250px; width: 100%; margin-bottom: 15px; border: 1px solid #ddd; border-radius: .35rem;"></div>
                        <small class="form-text text-muted mb-2">Klik peta untuk menandai lokasi atau gunakan tombol GPS <i class="fas fa-map-marker-alt"></i>.</small>

                        <div class="form-group" id="parentOdcGroup" style="display:none;">
                            <label for="assetParentOdc" class="form-label">Induk ODC (untuk ODP)</label>
                            <select class="form-control form-control-sm" id="assetParentOdc" name="parent_odc_id" style="width: 100%;">
                                <option value="">-- Pilih ODC Induk --</option>
                            </select>
                            <div class="form-check mt-1">
                                <input class="form-check-input" type="checkbox" id="useParentOdcLocation">
                                <label class="form-check-label" for="useParentOdcLocation">
                                    Gunakan lokasi ODC Induk yang dipilih untuk ODP ini
                                </label>
                            </div>
                        </div>
                        <div class="row">
                            <div class="col-md-6">
                                <div class="form-group">
                                    <label for="assetCapacity" class="form-label">Kapasitas Port</label>
                                    <input type="number" class="form-control form-control-sm" id="assetCapacity" name="capacity_ports" placeholder="Contoh: 144 atau 8">
                                </div>
                            </div>
                            <div class="col-md-6">
                                <div class="form-group">
                                    <label for="assetPortsUsed" class="form-label">Port Terpakai
                                        <span id="odcPortsUsedLabelInfo" style="display:none;"><small class="text-muted">(otomatis dari ODP)</small></span>
                                        <span id="odpPortsUsedLabelInfo" style="display:none;"><small class="text-muted">(otomatis dari pelanggan)</small></span>
                                    </label>
                                    <input type="number" class="form-control form-control-sm" id="assetPortsUsed" name="ports_used" placeholder="Otomatis" readonly>
                                </div>
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="assetNotes" class="form-label">Catatan Tambahan</label>
                            <textarea class="form-control form-control-sm" id="assetNotes" name="notes" rows="2" placeholder="Informasi tambahan mengenai aset..."></textarea>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-danger mr-auto" id="deleteAssetBtn" style="display:none;">Hapus Aset Ini</button>
                        <button type="button" class="btn btn-secondary btn-sm" data-dismiss="modal">Batal</button>
                        <button type="submit" class="btn btn-primary btn-sm" id="saveAssetBtn">Simpan Aset</button>
                    </div>
                </div>
            </form>
        </div>
    </div>

    <div class="modal fade" id="addOdpAfterOdcModal" tabindex="-1" role="dialog" aria-labelledby="addOdpAfterOdcModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="addOdpAfterOdcModalLabel">ODC Berhasil Disimpan</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
                </div>
                <div class="modal-body">
                    <p id="addOdpAfterOdcMessageText"></p>
                    <p>Apakah Anda ingin menambahkan ODP di lokasi yang sama untuk ODC ini sekarang?</p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary btn-sm" data-dismiss="modal" id="noAddOdpBtn">Tidak, Lain Kali</button>
                    <button type="button" class="btn btn-primary btn-sm" id="yesAddOdpBtn">Ya, Tambah ODP</button>
                </div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="wifiInfoModal" data-backdrop="static" tabindex="-1" role="dialog" aria-labelledby="wifiInfoModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-lg" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="wifiInfoModalLabel">Detail Informasi WiFi</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
                </div>
                <div class="modal-body" id="wifiInfoModalBody" style="max-height: 75vh; overflow-y: auto;">
                    <p class="text-center my-3"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Memuat informasi...</p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary btn-sm" data-dismiss="modal">Tutup</button>
                </div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="wifiManagementModal" data-backdrop="static" tabindex="-1" role="dialog" aria-labelledby="wifiManagementModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered" role="document">
            <form id="wifiManagementForm">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="wifiManagementModalLabel">Kelola WiFi Pelanggan</h5>
                        <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
                    </div>
                    <div class="modal-body">
                        <input type="hidden" id="wifi_manage_device_id" name="device_id_for_wifi_manage">
                        <input type="hidden" id="wifi_manage_customer_name" name="customer_name_for_wifi_manage">

                        <div id="wifiManagementFormContainer">
                            <p class="text-center"><i class="fas fa-spinner fa-spin"></i> Memuat detail WiFi...</p>
                        </div>
                         <div class="form-group mt-3">
                            <label for="wifi_manage_transmit_power" class="form-label">Transmit Power Global</label>
                            <select name="transmit_power" id="wifi_manage_transmit_power" class="form-control form-control-sm">
                                <option value="">-- Biarkan Default --</option>
                                <option value="20">20%</option>
                                <option value="40">40%</option>
                                <option value="60">60%</option>
                                <option value="80">80%</option>
                                <option value="100">100%</option>
                            </select>
                        </div>
                        <small class="form-text text-muted">Kosongkan field SSID atau Password jika tidak ingin mengubahnya. Password minimal 8 karakter.</small>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-outline-secondary btn-sm" data-dismiss="modal">Batal</button>
                        <button type="submit" class="btn btn-primary btn-sm" id="saveWifiManagementBtn">Simpan Perubahan WiFi</button>
                    </div>
                </div>
            </form>
        </div>
    </div>

    <div class="modal fade" id="customFilterModal" tabindex="-1" role="dialog" aria-labelledby="customFilterModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-xl" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="customFilterModalLabel">Filter Item Peta Kustom</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
                </div>
                <div class="modal-body">
                    <div class="row">
                        <div class="col-md-4">
                            <h6><i class="fas fa-server"></i> Optical Distribution Cabinets (ODC)</h6>
                            <input type="text" class="form-control form-control-sm filter-search-input" id="searchOdcFilter" placeholder="Cari ODC...">
                            <div class="mb-2">
                                <input type="checkbox" id="selectAllOdc" class="mr-1">
                                <label for="selectAllOdc" class="small">Pilih Semua / Batal Pilih Semua ODC</label>
                            </div>
                            <ul class="list-group filter-list-column" id="odcFilterList">
                                </ul>
                        </div>
                        <div class="col-md-4">
                            <h6><i class="fas fa-network-wired"></i> Optical Distribution Points (ODP)</h6>
                            <input type="text" class="form-control form-control-sm filter-search-input" id="searchOdpFilter" placeholder="Cari ODP...">
                             <div class="mb-2">
                                <input type="checkbox" id="selectAllOdp" class="mr-1">
                                <label for="selectAllOdp" class="small">Pilih Semua / Batal Pilih Semua ODP</label>
                            </div>
                            <ul class="list-group filter-list-column" id="odpFilterList">
                                <li class="list-group-item text-muted small">Pilih ODC untuk melihat daftar ODP terkait.</li>
                            </ul>
                        </div>
                        <div class="col-md-4">
                            <h6><i class="fas fa-users"></i> Pelanggan</h6>
                             <input type="text" class="form-control form-control-sm filter-search-input" id="searchCustomerFilter" placeholder="Cari Pelanggan...">
                            <div class="mb-2">
                                <input type="checkbox" id="selectAllCustomer" class="mr-1">
                                <label for="selectAllCustomer" class="small">Pilih Semua / Batal Pilih Semua Pelanggan</label>
                            </div>
                            <ul class="list-group filter-list-column" id="customerFilterList">
                                <li class="list-group-item text-muted small">Pilih ODP untuk melihat daftar Pelanggan terkait.</li>
                            </ul>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-outline-secondary btn-sm" id="resetCustomFilterBtn">Reset ke Tampilkan Semua</button>
                    <button type="button" class="btn btn-secondary btn-sm" data-dismiss="modal">Batal</button>
                    <button type="button" class="btn btn-primary btn-sm" id="applyCustomFilterBtn">Terapkan Filter</button>
                </div>
            </div>
        </div>
    </div>


    <script src="/vendor/jquery/jquery.min.js?v=<?php echo time(); ?>"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js?v=<?php echo time(); ?>"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js?v=<?php echo time(); ?>"></script>
    <script src="/js/sb-admin-2.js?v=<?php echo time(); ?>"></script>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
    <script src="https://cdn.jsdelivr.net/npm/leaflet-ant-path@1.3.0/dist/leaflet-ant-path.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"></script>
    <!-- Re-enable plugin like in teknisi version which works -->
    <script src="https://cdn.jsdelivr.net/npm/leaflet.fullscreen@1.6.0/Control.FullScreen.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js"></script>
    <!-- Map Routing Helper -->
    <script src="/js/map-routing-helper.js?v=<?php echo time(); ?>"></script>

    <script>
        // Version check - Plugin re-enabled to match teknisi version
        console.log("[MAP-VIEWER] Version: WORKING-COPY-2025-11-07");
        console.log("[MAP-VIEWER] Plugin enabled - same as teknisi-map-viewer.php");
        
        if (window.location.protocol !== "https:" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
            console.warn("PERINGATAN: Halaman ini diakses melalui HTTP. Fitur geolokasi mungkin tidak berfungsi optimal. Silakan gunakan HTTPS.");
        }

        let currentUser = null;
        let map;
        let myLocationMarker = null;
        let networkMarkersLayer = L.layerGroup();
        let customerMarkersLayer = L.layerGroup();
        let linesLayer = L.layerGroup();
        
        // Global config untuk routing
        let globalConfig = null;

        let allOdcData = [];
        let allNetworkAssetsData = [];
        let allCustomerData = [];
        let activePppoeUsersMap = new Map();
        let initialPppoeLoadFailed = false;

        let odcMarkers = [];
        let odpMarkers = [];
        let customerMarkers = [];
        let odpToOdcLines = [];
        let customerToOdpLines = [];
        
        // Waypoint Editor State
        let waypointEditorMode = false;
        let currentEditingConnection = null; // { type: 'odc-odp'|'customer-odp', sourceId, targetId }
        let waypointMarkers = []; // Array of waypoint markers
        let waypointLayer = L.layerGroup();
        
        let labelVisibility = {
            odc: true,
            odp: true,
            customer: true
        };

        let selectedOdcIds = new Set();
        let selectedOdpIds = new Set();
        let selectedCustomerIds = new Set();
        let isInitialLoad = true;
        let autoRefreshIntervalId = null;
        const AUTO_REFRESH_INTERVAL_MS = 30000; // 30 detik
        
        // Chart.js variables (lazy loaded)
        let Chart = null;
        let monitoringCharts = {
            online: null,
            offline: null,
            total: null,
            uptime: null
        };
        
        // Data history untuk charts (24 jam terakhir, per jam)
        let monitoringHistory = {
            timestamps: [],
            online: [],
            offline: [],
            total: [],
            uptime: []
        };
        
        // Debounce untuk chart updates
        let chartUpdateTimeout = null;
        const CHART_UPDATE_DEBOUNCE_MS = 5000; // 5 detik

        // Mini-map specific variables
        let assetModalMapInstance = null;
        let assetModalMapMarker = null;

        const ICON_WIDTH = 30; // Standard width for our custom icons
        const ICON_HEIGHT = 24; // Standard height of FontAwesome icon (from font-size)
        // Note: For tooltips, their position is relative to the marker's anchor,
        // so we don't need to calculate label height into the main icon's size/anchor.

        /**
         * Creates a custom DivIcon with FontAwesome icon. This icon will NOT contain the label HTML.
         * The label will be handled by L.tooltip separately.
         * @param {string} faClassName - FontAwesome class (e.g., 'fa-server', 'fa-map-marker-alt').
         * @param {string} colorClass - Custom CSS class for color (e.g., 'icon-odc').
         * @returns {L.DivIcon} - A Leaflet DivIcon instance for the icon only.
         */
// Modifikasi createBaseIcon untuk menerima parameter anchor kustom
const createBaseIcon = (faClassName, colorClass, customAnchor = null) => {
    // Default anchor di tengah icon
    let iconAnchor = [ICON_WIDTH/2, ICON_HEIGHT/2];
    
    // Jika ada custom anchor, gunakan itu
    if (customAnchor) {
        iconAnchor = customAnchor;
    }
    
    return L.divIcon({
        html: `<div class="custom-div-icon ${colorClass}"><i class="fas ${faClassName}"></i></div>`,
        className: 'leaflet-div-icon',
        iconSize: [ICON_WIDTH, ICON_HEIGHT],
        iconAnchor: iconAnchor,
        popupAnchor: [0, -ICON_HEIGHT/2]
    });
};
        
const createAssetIcon = (asset) => {
    let iconClass, colorClass;
    if (asset.type === 'ODC') {
        iconClass = 'fa-server';
        colorClass = 'icon-odc';
    } else { // ODP
        iconClass = 'fa-network-wired';
        colorClass = 'icon-odp';
    }
    return createBaseIcon(iconClass, colorClass);
};

const myLocationIcon = createBaseIcon('fa-street-view', 'icon-customer-unknown'); 

const createCustomerStatusIcon = (status) => {
    let colorClass = 'icon-customer-unknown';
    if (status === 'online') {
        colorClass = 'icon-customer-online';
    } else if (status === 'offline') {
        colorClass = 'icon-customer-offline';
    }
    
    // Untuk icon marker, anchor harus di bagian bawah tengah
    // Nilai Y yang lebih besar berarti lebih ke bawah
    return createBaseIcon('fa-map-marker-alt', colorClass, [ICON_WIDTH/2, ICON_HEIGHT]);
};


        fetch('/api/me', { credentials: 'include' }).then(response => response.json()).then(data => {
            if (data.status === 200 && data.data) {
                document.getElementById('username-placeholder').textContent = data.data.username;
                currentUser = data.data;
            }
        }).catch(err => console.error("[MainScript] Error fetching user data:", err));
        
        // Load config untuk routing
        fetch('/api/config', { credentials: 'include' }).then(response => response.json()).then(data => {
            if (data.status === 200 && data.config) {
                globalConfig = data.config;
                // Make config available globally for routing helper
                window.globalConfig = globalConfig;
                console.log("[MAP-VIEWER] Config loaded successfully for routing");
            }
        }).catch(err => console.warn("[MAP-VIEWER] Error loading config (routing will use defaults):", err));

        function displayGlobalMapMessage(message, type = 'info', duration = 7000) {
            const globalMessageDiv = $('#globalMessageMap');
            globalMessageDiv.html(`<div class="alert alert-${type} alert-dismissible fade show" role="alert">
                                ${message}
                                <button type="button" class="close" data-dismiss="alert" aria-label="Close">
                                    <span aria-hidden="true">&times;</span>
                                </button>
                            </div>`);
            if (duration > 0 && type !== 'danger' && type !== 'warning') {
                 setTimeout(() => {
                    globalMessageDiv.find('.alert').alert('close');
                }, duration);
            }
        }

        function handleGeolocationErrorMapViewer(error, contextMessage, displayTarget) {
            console.warn(`${contextMessage} - Error Code: ${error.code}, Message: ${error.message}`);
            let errorText = `<b>${contextMessage}</b><br/>`;
            switch(error.code) {
                case error.PERMISSION_DENIED:
                    errorText += "IZIN LOKASI DITOLAK. Periksa pengaturan lokasi di OS & Browser Anda.";
                    break;
                case error.POSITION_UNAVAILABLE:
                    errorText += "INFORMASI LOKASI TIDAK TERSEDIA. Pastikan GPS/Layanan Lokasi aktif.";
                    break;
                case error.TIMEOUT:
                    errorText += "WAKTU PERMINTAAN LOKASI HABIS. Sinyal mungkin lemah.";
                    break;
                default:
                    errorText += `Kesalahan (Code: ${error.code || 'N/A'}). Cek koneksi & HTTPS.`;
                    break;
            }
            displayTarget(errorText, 'danger', 15000);
        }

        function processSuccessfulGeolocationMapViewer(position, contextMessage, displayTarget, mapInstanceToUpdate, buttonContainer, originalIcon) {
            const userLat = position.coords.latitude;
            const userLng = position.coords.longitude;
            const accuracy = position.coords.accuracy;
            console.log(`${contextMessage} - Coords: Lat=${userLat}, Lng=${userLng}, Accuracy=${accuracy}m`);

            if (mapInstanceToUpdate) {
                mapInstanceToUpdate.setView([userLat, userLng], 18);
                if (myLocationMarker) {
                    myLocationMarker.setLatLng([userLat, userLng])
                                    .setTooltipContent(`Lokasi Saya (Akurasi: ${accuracy.toFixed(0)}m)`);
                } else {
                    myLocationMarker = L.marker([userLat, userLng], {icon: myLocationIcon, zIndexOffset: 1000})
                                         .bindTooltip(`Lokasi Saya (Akurasi: ${accuracy.toFixed(0)}m)`, {permanent: true, direction: 'top', className: 'marker-label-tooltip', offset: [0, -ICON_HEIGHT/2 - 5]}) // Offset to put label above icon
                                         .addTo(mapInstanceToUpdate);
                }
                // Ensure myLocationMarker tooltip is visible
                myLocationMarker.getTooltip().setOpacity(1); 
            }

            let accuracyMessage = `Lokasi GPS ditemukan (Akurasi: ${accuracy.toFixed(0)}m).`;
            let accuracyType = "success";
            if (accuracy > 1000) {
                accuracyMessage = `PERINGATAN: Akurasi lokasi sangat rendah (${Math.round(accuracy)}m). Mungkin lokasi jaringan/IP.`;
                accuracyType = "danger";
            } else if (accuracy > 150) {
                 accuracyMessage = `Info: Akurasi lokasi sedang (${Math.round(accuracy)}m).`;
                 accuracyType = "warning";
            }
            displayTarget(accuracyMessage, accuracyType, 10000);

            if (buttonContainer && originalIcon) {
                buttonContainer.innerHTML = originalIcon;
            }
        }


        function haversineDistance(coords1, coords2) {
            function toRad(x) { return x * Math.PI / 180; }
            const R = 6371;
            const dLat = toRad(coords2.latitude - coords1.latitude);
            const dLon = toRad(coords2.longitude - coords1.longitude);
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                      Math.cos(toRad(coords1.latitude)) * Math.cos(toRad(coords2.latitude)) *
                      Math.sin(dLon / 2) * Math.sin(dLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c * 1000;
        }

        function getRedamanPresentation(redaman) {
            const val = parseFloat(redaman);
            let color = 'grey';
            let text;

            if (redaman === null || typeof redaman === 'undefined') {
                 text = 'RX: -';
                 color = '#6c757d';
            } else if (isNaN(val)) {
                text = 'RX: N/A';
                 color = '#6c757d';
            } else {
                 text = `RX: ${val.toFixed(2)} dBm`;
                 if (val > -20) color = '#28a745';
                 else if (val > -24) color = '#76ff03';
                 else if (val > -27) color = '#ffc107';
                 else if (val > -30) color = '#fd7e14';
                 else color = '#dc3545';
            }
            return { text, color };
        }

        async function updateCustomerPopupDetails(marker, customer) {
            const customerId = customer.id;
            const deviceId = customer.device_id;

            const modemTypeSpan = document.getElementById(`modem-type-${customerId}`);
            const redamanSpan = document.getElementById(`redaman-val-${customerId}`);

            if (!deviceId) {
                if (modemTypeSpan) modemTypeSpan.textContent = 'N/A (No Device ID)';
                if (redamanSpan) redamanSpan.innerHTML = getRedamanPresentation(null).text;
                return;
            }

            // Use the batch metrics API to get both redaman and modem type
            try {
                const response = await fetch('/api/customer-metrics-batch', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include', // ✅ Fixed by script
                    body: JSON.stringify({
                        deviceIds: [deviceId]
                    })
                });

                if (!response.ok) {
                    console.warn(`Failed to fetch metrics for ${deviceId}: ${response.status}`);
                    if (modemTypeSpan) modemTypeSpan.textContent = 'Tidak tersedia (Server Error)';
                    if (redamanSpan) {
                        const presentation = getRedamanPresentation('Error');
                        redamanSpan.innerHTML = `<span style="color: ${presentation.color}; font-weight: bold;">${presentation.text}</span>`;
                    }
                    return;
                }

                const result = await response.json();
                
                // API returns an array, find the device data by deviceId
                let deviceMetrics = null;
                if (result.status === 200 && Array.isArray(result.data)) {
                    deviceMetrics = result.data.find(metric => metric.deviceId === deviceId);
                }

                // Update modem type
                if (modemTypeSpan) {
                    if (deviceMetrics && deviceMetrics.modemType) {
                        modemTypeSpan.textContent = deviceMetrics.modemType;
                    } else {
                        modemTypeSpan.textContent = 'Tidak terdeteksi/N/A';
                    }
                }

                // Update redaman
                if (redamanSpan) {
                    let redamanValue = null;
                    if (deviceMetrics && deviceMetrics.redaman) {
                        // Remove the " dBm" suffix that's added by the API
                        redamanValue = deviceMetrics.redaman.replace(' dBm', '');
                    }
                    const presentation = getRedamanPresentation(redamanValue);
                    redamanSpan.innerHTML = `<span style="color: ${presentation.color}; font-weight: bold;">${presentation.text}</span>`;
                }

            } catch (error) {
                console.error(`Error fetching metrics for popup ${deviceId}:`, error);
                if (modemTypeSpan) modemTypeSpan.textContent = 'Error saat memuat';
                if (redamanSpan) {
                    const presentation = getRedamanPresentation('Error');
                    redamanSpan.innerHTML = `<span style="color: ${presentation.color}; font-weight: bold;">${presentation.text}</span>`;
                }
            }
        }


        async function fetchActivePppoeUsers() {
            initialPppoeLoadFailed = false;
            activePppoeUsersMap.clear();
            try {
                const response = await fetch('/api/mikrotik/ppp-active-users?_=${new Date().getTime()}', { credentials: 'include' });
                if (!response.ok) {
                    const errorResult = await response.json().catch(() => ({ message: response.statusText }));
                    console.error("[fetchActivePppoeUsers MapPage] API Error:", response.status, errorResult.message, errorResult.stderr || '');
                    displayGlobalMapMessage(`Gagal mengambil data PPPoE aktif: ${errorResult.message || response.statusText}. Status dan IP pelanggan mungkin tidak akurat.`, 'warning', 0);
                    initialPppoeLoadFailed = true;
                    return;
                }
                const result = await response.json();
                if (result.status === 200 && Array.isArray(result.data)) {
                    result.data.forEach(userEntry => {
                        if (userEntry.name && userEntry.address) {
                            activePppoeUsersMap.set(userEntry.name, userEntry.address);
                        } else {
                             console.warn("[fetchActivePppoeUsers MapPage] Entri pengguna dari API tidak lengkap:", userEntry);
                        }
                    });
                    console.log("Active PPPoE users and IPs fetched for Map Page:", activePppoeUsersMap.size);
                } else {
                    console.warn("[fetchActivePppoeUsers MapPage] Format data PPPoE aktif tidak sesuai atau status API bukan 200:", result);
                    displayGlobalMapMessage('Format data PPPoE aktif dari server tidak sesuai. Status dan IP pelanggan mungkin tidak akurat.', 'warning', 0);
                    initialPppoeLoadFailed = true;
                }
            } catch (error) {
                console.error("[fetchActivePppoeUsers MapPage] Error fetching active PPPoE data:", error);
                displayGlobalMapMessage('Kesalahan koneksi saat mengambil data PPPoE aktif. Status dan IP pelanggan mungkin tidak akurat.', 'danger', 0);
                initialPppoeLoadFailed = true;
            }
        }


        function initializeMap() {
            // Clean previous map instance
            if (map) { 
                map.remove(); 
                map = null; 
                if(myLocationMarker) myLocationMarker = null;
            }
            
            // Esri World Imagery hanya support sampai zoom level 18 (native)
            // maxZoom 19+ akan menyebabkan "map data not yet available" karena tile tidak tersedia
            // Diperbaiki: Set ke 18 untuk memastikan tidak ada error
            const satelliteMaxZoom = 18; // Diperbaiki: Esri hanya support sampai level 18
            const osmMaxZoom = 22;
            
            // Create map - simple like teknisi version
            map = L.map('interactiveMap', {
                maxZoom: satelliteMaxZoom
            }).setView([-7.2430309,111.846867], 15);

            // Create tile layers - simple like teknisi
            const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
                maxZoom: osmMaxZoom, 
                attribution: '&copy; OSM Contributors' 
            });
            // Perbaikan: Gunakan maxNativeZoom untuk mencegah zoom melebihi kemampuan tile server
            // maxNativeZoom: zoom maksimal yang didukung oleh tile server (18 untuk Esri)
            // maxZoom: zoom maksimal yang diizinkan Leaflet (harus sama dengan maxNativeZoom untuk mencegah error)
            const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { 
                maxZoom: satelliteMaxZoom,
                maxNativeZoom: 18, // Esri World Imagery hanya support sampai level 18
                attribution: 'Tiles &copy; Esri',
                // Tambahkan error handling untuk tile yang gagal load
                errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' // Transparent 1x1 pixel
            }).addTo(map);
            
            // Fungsi untuk menghapus text node yang berisi pesan error
            function removeErrorTextNodes() {
                // Cari semua tile container
                const tileContainers = document.querySelectorAll('.leaflet-tile-container');
                tileContainers.forEach(container => {
                    // Iterasi semua child nodes (termasuk text nodes)
                    const walker = document.createTreeWalker(
                        container,
                        NodeFilter.SHOW_TEXT,
                        null,
                        false
                    );
                    let node;
                    const nodesToRemove = [];
                    while (node = walker.nextNode()) {
                        const text = node.textContent.trim();
                        // Hapus text node yang berisi pesan error
                        if (text.includes('not yet') || 
                            text.includes('not available') || 
                            text.includes('map data') ||
                            text.toLowerCase().includes('error') ||
                            text.length > 0 && !text.match(/^\s*$/)) {
                            nodesToRemove.push(node);
                        }
                    }
                    // Hapus text nodes yang ditemukan
                    nodesToRemove.forEach(node => {
                        try {
                            node.parentNode.removeChild(node);
                        } catch (e) {
                            // Ignore jika node sudah dihapus
                        }
                    });
                });
            }
            
            // Handle tile loading errors untuk mencegah pesan "map data not yet available"
            satelliteLayer.on('tileerror', function(error, tile) {
                // Log error untuk debugging (hanya di development)
                if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                    console.warn('[MAP] Tile error pada zoom level:', map.getZoom(), 'Tile:', tile);
                }
                // Hapus text node error setelah error terjadi
                setTimeout(removeErrorTextNodes, 100);
                // Jika zoom level melebihi maxNativeZoom, turunkan zoom level
                if (map.getZoom() > 18) {
                    console.warn('[MAP] Zoom level melebihi maxNativeZoom (18), menurunkan zoom...');
                    map.setZoom(18);
                }
            });
            
            // Handle tile loading errors untuk OSM layer juga
            osmLayer.on('tileerror', function(error, tile) {
                if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                    console.warn('[MAP] OSM Tile error pada zoom level:', map.getZoom(), 'Tile:', tile);
                }
                setTimeout(removeErrorTextNodes, 100);
            });
            
            // Gunakan MutationObserver untuk memantau dan menghapus text node error secara real-time
            const errorTextObserver = new MutationObserver(function(mutations) {
                mutations.forEach(function(mutation) {
                    if (mutation.addedNodes.length > 0) {
                        // Cek setiap node yang ditambahkan
                        mutation.addedNodes.forEach(function(node) {
                            if (node.nodeType === Node.TEXT_NODE) {
                                const text = node.textContent.trim();
                                if (text.includes('not yet') || 
                                    text.includes('not available') || 
                                    text.includes('map data')) {
                                    try {
                                        node.parentNode.removeChild(node);
                                    } catch (e) {
                                        // Ignore jika node sudah dihapus
                                    }
                                }
                            } else if (node.nodeType === Node.ELEMENT_NODE) {
                                // Cek juga text content di dalam element
                                const text = node.textContent || '';
                                if (text.includes('not yet') || 
                                    text.includes('not available') || 
                                    text.includes('map data')) {
                                    node.style.display = 'none';
                                    node.style.visibility = 'hidden';
                                    node.style.opacity = '0';
                                    node.style.fontSize = '0';
                                }
                            }
                        });
                    }
                });
            });
            
            // Mulai observe tile pane untuk perubahan DOM
            map.whenReady(function() {
                const tilePane = document.querySelector('.leaflet-tile-pane');
                if (tilePane) {
                    errorTextObserver.observe(tilePane, {
                        childList: true,
                        subtree: true,
                        characterData: true
                    });
                }
            });
            
            // Juga observe saat map di-update
            map.on('moveend', function() {
                setTimeout(removeErrorTextNodes, 200);
            });
            
            map.on('zoomend', function() {
                setTimeout(removeErrorTextNodes, 200);
            });
            
            // Add layers
            networkMarkersLayer.addTo(map); 
            customerMarkersLayer.addTo(map); 
            linesLayer.addTo(map);
            
            // Add layer control
            const baseMaps = { "Satelit": satelliteLayer, "OpenStreetMap": osmLayer };
            const overlayMaps = { 
                "Aset Jaringan": networkMarkersLayer, 
                "Pelanggan": customerMarkersLayer, 
                "Koneksi Antar Aset": linesLayer 
            };
            L.control.layers(baseMaps, overlayMaps, {collapsed: true}).addTo(map);

            // Add GPS control - simplified like teknisi
            const GpsMapControl = L.Control.extend({
                options: { position: 'topleft'},
                onAdd: function(mapInstanceCtrl) {
                    const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom-gps');
                    const iconHTML = '<i class="fas fa-crosshairs"></i>';
                    const loadingIconHTML = '<i class="fas fa-spinner fa-spin"></i>';
                    container.innerHTML = iconHTML; 
                    container.title = 'Lokasi Saya';
                    
                    L.DomEvent.on(container, 'click', L.DomEvent.stopPropagation)
                        .on(container, 'click', L.DomEvent.preventDefault)
                        .on(container, 'click', function () {
                            container.innerHTML = loadingIconHTML; 
                            displayGlobalMapMessage("Meminta lokasi GPS...", "info", 3000);
                            if (navigator.geolocation) {
                                navigator.geolocation.getCurrentPosition(
                                    (pos) => processSuccessfulGeolocationMapViewer(pos, "GPS Peta", displayGlobalMapMessage, map, container, iconHTML),
                                    (err) => { 
                                        handleGeolocationErrorMapViewer(err, "GPS Gagal", displayGlobalMapMessage); 
                                        container.innerHTML = iconHTML; 
                                    },
                                    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
                                );
                            } else { 
                                handleGeolocationErrorMapViewer({code: -1, message: "Geolokasi tidak didukung."}, "GPS Gagal", displayGlobalMapMessage); 
                                container.innerHTML = iconHTML; 
                            }
                        });
                    return container;
                }
            });
            if (map) new GpsMapControl().addTo(map);

            // Setup Advanced Legend
            setupAdvancedLegend();
            
            // Event listeners - exactly like teknisi
            map.on('baselayerchange', e => { 
                const newMaxZoom = e.name === "Satelit" ? satelliteMaxZoom : osmMaxZoom;
                map.options.maxZoom = newMaxZoom;
                // Pastikan zoom tidak melebihi maxZoom yang didukung
                if (map.getZoom() > newMaxZoom) {
                    map.setZoom(newMaxZoom);
                }
                // Update maxNativeZoom untuk layer yang aktif
                const activeLayer = e.layer;
                if (activeLayer && activeLayer.options) {
                    if (e.name === "Satelit" && activeLayer.options.maxNativeZoom) {
                        // Pastikan maxNativeZoom tidak melebihi kemampuan tile server
                        activeLayer.options.maxNativeZoom = 18;
                    }
                }
            });
            
            map.on('fullscreenchange', () => { 
                $('#manualFullscreenBtn i').toggleClass('fa-expand fa-compress'); 
                if(map) map.invalidateSize(); 
                // Hapus error text setelah fullscreen change
                setTimeout(removeErrorTextNodes, 300);
            });
            
            // Hapus error text secara berkala untuk memastikan tidak ada yang terlewat
            setInterval(removeErrorTextNodes, 1000); // Setiap 1 detik
            
            document.addEventListener('fullscreenchange', handleFullscreenGlobal);
            document.addEventListener('webkitfullscreenchange', handleFullscreenGlobal);
            document.addEventListener('mozfullscreenchange', handleFullscreenGlobal);
            document.addEventListener('MSFullscreenChange', handleFullscreenGlobal);

            
            // Load map data
            loadAllMapData();
        }
        
        /**
         * Redraws markers of a specific type by updating their icons AND tooltip visibility.
         * This is called when label visibility changes.
         * @param {string} markerType - 'odc', 'odp', or 'customer'.
         */
function redrawMarkers(markerType) {
    let markersToRedraw = [];
    if(markerType === 'odc') {
        markersToRedraw = odcMarkers;
    } else if (markerType === 'odp') {
        markersToRedraw = odpMarkers;
    } else if (markerType === 'customer') {
        markersToRedraw = customerMarkers;
    }

    const currentLabelVisibility = labelVisibility[markerType];

    markersToRedraw.forEach(marker => {
        if(marker && marker.options && typeof marker.setIcon === 'function') {
            // Update icon (which is now just the base icon)
            if (marker.assetData) {
                marker.setIcon(createAssetIcon(marker.assetData));
                
                // Set tooltip content and visibility for asset
                if (marker.assetData.name) {
                    if (!marker.getTooltip()) {
                        marker.bindTooltip(marker.assetData.name, {
                            permanent: true,
                            direction: 'top',
                            className: 'marker-label-tooltip',
                            offset: [0, -ICON_HEIGHT/2 - 5]
                        });
                    } else {
                        marker.getTooltip().setContent(marker.assetData.name);
                    }
                    
                    // Kontrol visibilitas tooltip tanpa mempengaruhi posisi marker
                    if (currentLabelVisibility) {
                        marker.getTooltip().setOpacity(1);
                    } else {
                        marker.getTooltip().setOpacity(0);
                    }
                }
            } else if (marker.customerData) {
                // Update icon for customer
                marker.setIcon(createCustomerStatusIcon(marker.customerOnlineStatus));
                
                // Set tooltip content and visibility for customer
                let customerLabel = marker.customerData.pppoe_username || marker.customerData.name || `Cust. ID ${marker.customerData.id}`;
                if (!marker.getTooltip()) {
                    marker.bindTooltip(customerLabel, {
                        permanent: true,
                        direction: 'top',
                        className: 'marker-label-tooltip',
                        offset: [0, -ICON_HEIGHT/2 - 5]
                    });
                } else {
                    marker.getTooltip().setContent(customerLabel);
                }
                
                // Kontrol visibilitas tooltip tanpa mempengaruhi posisi marker
                if (currentLabelVisibility) {
                    marker.getTooltip().setOpacity(1);
                } else {
                    marker.getTooltip().setOpacity(0);
                }
            }
        }
    });
}

        // Store original parent of modals
        let modalOriginalParents = new Map();
        
        function moveModalsToFullscreen() {
            // Find all modals
            const modals = document.querySelectorAll('.modal');
            const mapContainer = document.getElementById('mapContainer');
            
            modals.forEach(modal => {
                // Store original parent
                modalOriginalParents.set(modal, modal.parentNode);
                // Move modal into mapContainer
                mapContainer.appendChild(modal);
            });
        }
        
        function restoreModalsPosition() {
            // Restore modals to original position
            modalOriginalParents.forEach((parent, modal) => {
                parent.appendChild(modal);
            });
            modalOriginalParents.clear();
        }

        function toggleFullScreenManual() {
            const mapContainer = document.getElementById('mapContainer');
            
            if (!document.fullscreenElement && !document.mozFullScreenElement && !document.webkitFullscreenElement && !document.msFullscreenElement) {
                // Move modals into mapContainer before going fullscreen
                moveModalsToFullscreen();
                
                if (mapContainer.requestFullscreen) {
                    mapContainer.requestFullscreen().catch(err => {
                        console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
                        restoreModalsPosition(); // Restore if fullscreen fails
                    });
                } else if (mapContainer.mozRequestFullScreen) { /* Firefox */
                    mapContainer.mozRequestFullScreen();
                } else if (mapContainer.webkitRequestFullscreen) { /* Chrome, Safari and Opera */
                    mapContainer.webkitRequestFullscreen();
                } else if (mapContainer.msRequestFullscreen) { /* IE/Edge */
                    mapContainer.msRequestFullscreen();
                }
            } else {
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                } else if (document.mozCancelFullScreen) { /* Firefox */
                    document.mozCancelFullScreen();
                } else if (document.webkitExitFullscreen) { /* Chrome, Safari and Opera */
                    document.webkitExitFullscreen();
                } else if (document.msExitFullscreen) { /* IE/Edge */
                    document.msExitFullscreen();
                }
            }
        }

        function handleFullscreenGlobal() {
            const isActuallyFullscreen = !!(document.fullscreenElement || document.mozFullScreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
            $('#manualFullscreenBtn i').toggleClass('fa-expand', !isActuallyFullscreen).toggleClass('fa-compress', isActuallyFullscreen);
            $('#manualFullscreenBtn').attr('title', isActuallyFullscreen ? 'Keluar Layar Penuh (Kustom)' : 'Layar Penuh Peta (Kustom)');
            if (map) { setTimeout(function() { map.invalidateSize(); }, 250); }
            // Restore modals when EXITING fullscreen (not entering)
            if (!isActuallyFullscreen) {
                restoreModalsPosition();
            }
        }

        function updateSelectAllCheckbox(type, totalItems, selectedItems) {
            const selectAllCb = $(`#selectAll${type}`);
            if (totalItems > 0 && selectedItems === totalItems) {
                selectAllCb.prop('checked', true).prop('indeterminate', false);
            } else if (selectedItems === 0 || totalItems === 0) {
                selectAllCb.prop('checked', false).prop('indeterminate', false);
            } else {
                selectAllCb.prop('checked', false).prop('indeterminate', true);
            }
        }

        function openCustomFilterModalWithCurrentSelections() {
            console.log("[OpenCustomFilterModal] Populating modal based on current map filter state...");
            $('#searchOdcFilter').val('').trigger('keyup');
            $('#searchOdpFilter').val('').trigger('keyup');
            $('#searchCustomerFilter').val('').trigger('keyup');

            const odcListElement = $('#odcFilterList');
            const allOdcsFromData = allNetworkAssetsData.filter(a => a.type === 'ODC').sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            odcListElement.empty();
            allOdcsFromData.forEach(odc => {
                const isChecked = isInitialLoad ? true : selectedOdcIds.has(String(odc.id));
                odcListElement.append(
                    `<li class="list-group-item">
                        <label><input type="checkbox" class="filter-item-checkbox" data-type="odc" data-id="${odc.id}" ${isChecked ? 'checked' : ''}> ${odc.name || `ODC ID ${odc.id}`}</label>
                    </li>`
                );
            });
            updateSelectAllCheckbox('Odc', allOdcsFromData.length, odcListElement.find('.filter-item-checkbox:checked').length);

            updateOdpFilterListFromModal(isInitialLoad);
            $('#customFilterModal').modal('show');
        }

        function updateOdpFilterListFromModal(checkAllChildrenIfParentIsAll = false) {
            const currentlySelectedOdcIdsInModal = new Set();
            $('#odcFilterList .filter-item-checkbox:checked').each(function() {
                currentlySelectedOdcIdsInModal.add($(this).data('id').toString());
            });

            const odpListElement = $('#odpFilterList');
            odpListElement.empty();
            $('#searchOdpFilter').val('').trigger('keyup');

            if (currentlySelectedOdcIdsInModal.size === 0) {
                odpListElement.append('<li class="list-group-item text-muted small">Pilih ODC untuk melihat daftar ODP terkait.</li>');
                updateSelectAllCheckbox('Odp', 0, 0);
                updateCustomerFilterListFromModal(false);
                return;
            }

            const relevantOdps = allNetworkAssetsData.filter(asset =>
                asset.type === 'ODP' && asset.parent_odc_id && currentlySelectedOdcIdsInModal.has(String(asset.parent_odc_id))
            ).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            relevantOdps.forEach(odp => {
                const isChecked = checkAllChildrenIfParentIsAll ? true : selectedOdpIds.has(String(odp.id));
                odpListElement.append(
                    `<li class="list-group-item">
                        <label><input type="checkbox" class="filter-item-checkbox" data-type="odp" data-id="${odp.id}" ${isChecked ? 'checked' : ''}> ${odp.name || `ODP ID ${odp.id}`}</label>
                    </li>`
                );
            });
            updateSelectAllCheckbox('Odp', relevantOdps.length, odpListElement.find('.filter-item-checkbox:checked').length);
            updateCustomerFilterListFromModal(checkAllChildrenIfParentIsAll);
        }

        function updateCustomerFilterListFromModal(checkAllChildrenIfParentIsAll = false) {
            const currentlySelectedOdpIdsInModal = new Set();
            $('#odpFilterList .filter-item-checkbox:checked').each(function() {
                currentlySelectedOdpIdsInModal.add($(this).data('id').toString());
            });

            const customerListElement = $('#customerFilterList');
            customerListElement.empty();
            $('#searchCustomerFilter').val('').trigger('keyup');

            if (currentlySelectedOdpIdsInModal.size === 0) {
                customerListElement.append('<li class="list-group-item text-muted small">Pilih ODP untuk melihat daftar Pelanggan terkait.</li>');
                updateSelectAllCheckbox('Customer', 0, 0);
                return;
            }

            const relevantCustomers = allCustomerData.filter(customer =>
                customer.connected_odp_id && currentlySelectedOdpIdsInModal.has(String(customer.connected_odp_id))
            ).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            relevantCustomers.forEach(customer => {
                const isChecked = checkAllChildrenIfParentIsAll ? true : selectedCustomerIds.has(String(customer.id));
                customerListElement.append(
                    `<li class="list-group-item">
                        <label><input type="checkbox" class="filter-item-checkbox" data-type="customer" data-id="${customer.id}" ${isChecked ? 'checked' : ''}> ${customer.name || `Cust. ID ${customer.id}`}</label>
                    </li>`
                );
            });
            updateSelectAllCheckbox('Customer', relevantCustomers.length, customerListElement.find('.filter-item-checkbox:checked').length);
        }

        $('#openCustomFilterModalBtn').on('click', openCustomFilterModalWithCurrentSelections);

        $(document).on('change', '#customFilterModal .filter-item-checkbox', function() {
            const type = $(this).data('type');
            if (type === 'odc') {
                updateSelectAllCheckbox('Odc', $('#odcFilterList .filter-item-checkbox').length, $('#odcFilterList .filter-item-checkbox:checked').length);
                updateOdpFilterListFromModal(false);
            } else if (type === 'odp') {
                updateSelectAllCheckbox('Odp', $('#odpFilterList .filter-item-checkbox').length, $('#odpFilterList .filter-item-checkbox:checked').length);
                updateCustomerFilterListFromModal(false);
            } else if (type === 'customer') {
                updateSelectAllCheckbox('Customer', $('#customerFilterList .filter-item-checkbox').length, $('#customerFilterList .filter-item-checkbox:checked').length);
            }
        });

        $(document).on('change', '#selectAllOdc, #selectAllOdp, #selectAllCustomer', function() {
            const type = $(this).attr('id').replace('selectAll', '').toLowerCase();
            const listElement = $(`#${type}FilterList`);
            const isChecked = $(this).is(':checked');

            listElement.find('.filter-item-checkbox').prop('checked', isChecked); 

            if (type === 'odc') {
                updateOdpFilterListFromModal(isChecked);
                updateSelectAllCheckbox('Odc', listElement.find('.filter-item-checkbox').length, isChecked ? listElement.find('.filter-item-checkbox').length : 0);
            } else if (type === 'odp') {
                updateCustomerFilterListFromModal(isChecked);
                updateSelectAllCheckbox('Odp', listElement.find('.filter-item-checkbox').length, isChecked ? listElement.find('.filter-item-checkbox').length : 0);
            } else if (type === 'customer') {
                 updateSelectAllCheckbox('Customer', listElement.find('.filter-item-checkbox').length, isChecked ? listElement.find('.filter-item-checkbox').length : 0);
            }
        });


        $('#applyCustomFilterBtn').on('click', function() {
            console.log("[ApplyCustomFilterBtn] Applying custom filter...");
            selectedOdcIds.clear();
            selectedOdpIds.clear();
            selectedCustomerIds.clear();

            $('#odcFilterList .filter-item-checkbox:checked').each(function() { selectedOdcIds.add($(this).data('id').toString()); });
            $('#odpFilterList .filter-item-checkbox:checked').each(function() { selectedOdpIds.add($(this).data('id').toString()); });
            $('#customerFilterList .filter-item-checkbox:checked').each(function() { selectedCustomerIds.add($(this).data('id').toString()); });

            isInitialLoad = false;
            applyFilters();
            $('#customFilterModal').modal('hide');
            displayGlobalMapMessage('Filter kustom diterapkan.', 'success', 3000);
        });

        $('#resetCustomFilterBtn').on('click', function() {
            $('#odcFilterList .filter-item-checkbox').prop('checked', true);
            updateSelectAllCheckbox('Odc', $('#odcFilterList .filter-item-checkbox').length, $('#odcFilterList .filter-item-checkbox').length);
            updateOdpFilterListFromModal(true);

            displayGlobalMapMessage('Filter direset untuk menampilkan semua. Klik "Terapkan Filter" untuk menyimpan.', 'info', 5000);
        });

        $('.filter-search-input').on('keyup', function() {
            const searchTerm = $(this).val().toLowerCase();
            const listId = $(this).nextAll('.filter-list-column').first().attr('id');
            $(`#${listId} li`).each(function() {
                const itemText = $(this).text().toLowerCase();
                if (itemText.includes(searchTerm)) {
                    $(this).show();
                } else {
                    $(this).hide();
                }
            });
        });

        function applyFilters() {
            if (!map) return;
            console.log("[ApplyFilters] Menerapkan filter. ODCs selected:", selectedOdcIds.size, "ODPs:", selectedOdpIds.size, "Customers:", selectedCustomerIds.size);

            networkMarkersLayer.clearLayers();
            customerMarkersLayer.clearLayers();
            linesLayer.clearLayers();

            odcMarkers.forEach(marker => {
                if (selectedOdcIds.has(String(marker.assetData.id))) {
                    networkMarkersLayer.addLayer(marker);
                    // Also ensure tooltip visibility is correctly applied
                    if (marker.getTooltip()) {
                        marker.getTooltip().setOpacity(labelVisibility.odc ? 1 : 0);
                    }
                }
            });

            odpMarkers.forEach(marker => {
                if (selectedOdpIds.has(String(marker.assetData.id))) {
                    networkMarkersLayer.addLayer(marker);
                     // Also ensure tooltip visibility is correctly applied
                    if (marker.getTooltip()) {
                        marker.getTooltip().setOpacity(labelVisibility.odp ? 1 : 0);
                    }
                }
            });

            customerMarkers.forEach(marker => {
                if (selectedCustomerIds.has(String(marker.customerData.id))) {
                    customerMarkersLayer.addLayer(marker);
                     // Also ensure tooltip visibility is correctly applied
                    if (marker.getTooltip()) {
                        marker.getTooltip().setOpacity(labelVisibility.customer ? 1 : 0);
                    }
                }
            });

            odpToOdcLines.forEach(line => {
                if (line.connectedEntities &&
                    selectedOdcIds.has(String(line.connectedEntities.odcId)) &&
                    selectedOdpIds.has(String(line.connectedEntities.odpId))) {
                    linesLayer.addLayer(line);
                }
            });

            customerToOdpLines.forEach(line => {
                 if (line.connectedEntities &&
                    selectedCustomerIds.has(String(line.connectedEntities.customerId)) &&
                    selectedOdpIds.has(String(line.connectedEntities.odpId))) {
                    linesLayer.addLayer(line);
                }
            });
            console.log("[ApplyFilters] Filter diterapkan.");
            updateLegendCounters();
        }
        
        // Apply Quick Filter
        function applyQuickFilter(filter) {
            if (!map) return;
            
            currentQuickFilter = filter;
            
            // Update button active state
            updateFilterButtons();
            
            // Apply filter logic
            switch(filter) {
                case 'all':
                    // Show all
                    selectedOdcIds.clear();
                    selectedOdpIds.clear();
                    selectedCustomerIds.clear();
                    allNetworkAssetsData.forEach(asset => {
                        if (asset.type === 'ODC') selectedOdcIds.add(String(asset.id));
                        else if (asset.type === 'ODP') selectedOdpIds.add(String(asset.id));
                    });
                    allCustomerData.forEach(customer => {
                        selectedCustomerIds.add(String(customer.id));
                    });
                    break;
                    
                case 'online':
                    // Show only online customers
                    selectedOdcIds.clear();
                    selectedOdpIds.clear();
                    selectedCustomerIds.clear();
                    customerMarkers.forEach(marker => {
                        if (marker.customerOnlineStatus === 'online') {
                            selectedCustomerIds.add(String(marker.customerData.id));
                        }
                    });
                    break;
                    
                case 'offline':
                    // Show only offline customers
                    selectedOdcIds.clear();
                    selectedOdpIds.clear();
                    selectedCustomerIds.clear();
                    customerMarkers.forEach(marker => {
                        if (marker.customerOnlineStatus === 'offline') {
                            selectedCustomerIds.add(String(marker.customerData.id));
                        }
                    });
                    break;
                    
                case 'assets':
                    // Show only network assets (ODC & ODP)
                    selectedOdcIds.clear();
                    selectedOdpIds.clear();
                    selectedCustomerIds.clear();
                    allNetworkAssetsData.forEach(asset => {
                        if (asset.type === 'ODC') selectedOdcIds.add(String(asset.id));
                        else if (asset.type === 'ODP') selectedOdpIds.add(String(asset.id));
                    });
                    break;
                    
                case 'customers':
                    // Show only customers
                    selectedOdcIds.clear();
                    selectedOdpIds.clear();
                    selectedCustomerIds.clear();
                    allCustomerData.forEach(customer => {
                        selectedCustomerIds.add(String(customer.id));
                    });
                    break;
            }
            
            // Apply filters
            applyFilters();
            updateConnectionMonitoring();
            
            // Show message
            const filterLabels = {
                'all': 'Semua',
                'online': 'Online',
                'offline': 'Offline',
                'assets': 'Aset Jaringan',
                'customers': 'Pelanggan'
            };
            displayGlobalMapMessage(`Filter: ${filterLabels[filter]}`, 'info', 2000);
        }
        
        function updateFilterButtons() {
            $('.quick-filter-btn').removeClass('active');
            $(`.quick-filter-btn[data-filter="${currentQuickFilter}"]`).addClass('active');
        }
        
        // Setup Advanced Legend
        function setupAdvancedLegend() {
            if (!map) return;
            
            // Remove existing legend if any
            if (advancedLegendControl) {
                map.removeControl(advancedLegendControl);
            }
            
            // Create advanced legend control
            advancedLegendControl = L.control({ position: 'bottomright' });
            
            advancedLegendControl.onAdd = function(mapInstance) {
                const div = L.DomUtil.create('div', 'advanced-legend');
                
                // Header
                const header = L.DomUtil.create('div', 'advanced-legend-header', div);
                const title = L.DomUtil.create('h4', '', header);
                title.textContent = 'Legenda Peta';
                const toggleBtn = L.DomUtil.create('button', 'advanced-legend-toggle-btn', header);
                toggleBtn.innerHTML = '<i class="fas fa-chevron-up"></i>';
                toggleBtn.title = 'Sembunyikan/Tampilkan';
                
                // Content container
                const content = L.DomUtil.create('div', 'advanced-legend-content', div);
                content.style.display = 'block';
                
                // Categories
                const categories = [
                    { id: 'odc', name: 'ODC', icon: 'fa-server', color: '#8A2BE2', class: 'legend-category-odc' },
                    { id: 'odp', name: 'ODP', icon: 'fa-network-wired', color: '#FFA500', class: 'legend-category-odp' },
                    { id: 'online', name: 'Pelanggan Online', icon: 'fa-user-alt', color: '#28a745', class: 'legend-category-online' },
                    { id: 'offline', name: 'Pelanggan Offline', icon: 'fa-user-alt', color: '#dc3545', class: 'legend-category-offline' },
                    { id: 'unknown', name: 'Pelanggan (Status Lain)', icon: 'fa-user-alt', color: '#007bff', class: 'legend-category-unknown' }
                ];
                
                categories.forEach(cat => {
                    const categoryDiv = L.DomUtil.create('div', `legend-category ${cat.class}`, content);
                    
                    const categoryHeader = L.DomUtil.create('div', 'legend-category-header', categoryDiv);
                    const label = L.DomUtil.create('div', 'legend-category-label', categoryHeader);
                    const icon = L.DomUtil.create('i', `fas ${cat.icon} legend-category-icon`, label);
                    icon.style.color = cat.color;
                    const name = L.DomUtil.create('span', '', label);
                    name.textContent = cat.name;
                    
                    const counter = L.DomUtil.create('span', 'legend-category-counter', categoryHeader);
                    counter.id = `legend-counter-${cat.id}`;
                    counter.textContent = '0';
                    
                    const toggle = L.DomUtil.create('div', 'legend-category-toggle', categoryDiv);
                    const checkbox = L.DomUtil.create('input', '', toggle);
                    checkbox.type = 'checkbox';
                    checkbox.id = `legend-toggle-${cat.id}`;
                    checkbox.checked = true;
                    checkbox.dataset.category = cat.id;
                    
                    const checkboxLabel = L.DomUtil.create('label', '', toggle);
                    checkboxLabel.htmlFor = `legend-toggle-${cat.id}`;
                    checkboxLabel.textContent = 'Tampilkan';
                    
                    // Event listener untuk toggle
                    checkbox.addEventListener('change', function() {
                        toggleLayerVisibility(cat.id, this.checked);
                    });
                });
                
                // Mini Map Container
                const minimapContainer = L.DomUtil.create('div', 'legend-minimap-container', content);
                const minimapLabel = L.DomUtil.create('div', 'text-xs font-weight-bold text-uppercase mb-2', minimapContainer);
                minimapLabel.textContent = 'Overview';
                const minimapDiv = L.DomUtil.create('div', 'legend-minimap', minimapContainer);
                minimapDiv.id = 'legendMinimap';
                
                // Tools Section
                const toolsContainer = L.DomUtil.create('div', 'legend-tools', content);
                const toolsLabel = L.DomUtil.create('div', 'text-xs font-weight-bold text-uppercase mb-2', toolsContainer);
                toolsLabel.textContent = 'Tools';
                const resetViewBtn = L.DomUtil.create('button', 'btn btn-sm btn-outline-secondary legend-tools-btn', toolsContainer);
                resetViewBtn.innerHTML = '<i class="fas fa-home"></i> Reset View';
                resetViewBtn.title = 'Kembali ke view default';
                resetViewBtn.addEventListener('click', function() {
                    if (map) {
                        map.setView([-7.2430309, 111.846867], 15);
                    }
                });
                
                // Toggle collapse/expand
                let isCollapsed = false;
                toggleBtn.addEventListener('click', function() {
                    isCollapsed = !isCollapsed;
                    content.style.display = isCollapsed ? 'none' : 'block';
                    toggleBtn.innerHTML = isCollapsed ? '<i class="fas fa-chevron-down"></i>' : '<i class="fas fa-chevron-up"></i>';
                });
                
                // Initialize mini map
                setTimeout(() => {
                    initLegendMinimap();
                }, 500);
                
                // Prevent map clicks from propagating
                L.DomEvent.disableClickPropagation(div);
                L.DomEvent.disableScrollPropagation(div);
                
                return div;
            };
            
            advancedLegendControl.addTo(map);
            updateLegendCounters();
        }
        
        function toggleLayerVisibility(category, visible) {
            if (!map) return;
            
            switch(category) {
                case 'odc':
                    odcMarkers.forEach(marker => {
                        if (visible) {
                            if (selectedOdcIds.has(String(marker.assetData.id))) {
                                networkMarkersLayer.addLayer(marker);
                            }
                        } else {
                            networkMarkersLayer.removeLayer(marker);
                        }
                    });
                    break;
                case 'odp':
                    odpMarkers.forEach(marker => {
                        if (visible) {
                            if (selectedOdpIds.has(String(marker.assetData.id))) {
                                networkMarkersLayer.addLayer(marker);
                            }
                        } else {
                            networkMarkersLayer.removeLayer(marker);
                        }
                    });
                    break;
                case 'online':
                case 'offline':
                case 'unknown':
                    customerMarkers.forEach(marker => {
                        const status = marker.customerOnlineStatus || 'unknown';
                        const shouldShow = (category === 'online' && status === 'online') ||
                                         (category === 'offline' && status === 'offline') ||
                                         (category === 'unknown' && status === 'unknown');
                        
                        if (shouldShow) {
                            if (visible) {
                                if (selectedCustomerIds.has(String(marker.customerData.id))) {
                                    customerMarkersLayer.addLayer(marker);
                                }
                            } else {
                                customerMarkersLayer.removeLayer(marker);
                            }
                        }
                    });
                    break;
            }
        }
        
        function updateLegendCounters() {
            legendCounters.odc = odcMarkers.length;
            legendCounters.odp = odpMarkers.length;
            
            let online = 0, offline = 0, unknown = 0;
            customerMarkers.forEach(marker => {
                const status = marker.customerOnlineStatus || 'unknown';
                if (status === 'online') online++;
                else if (status === 'offline') offline++;
                else unknown++;
            });
            legendCounters.online = online;
            legendCounters.offline = offline;
            legendCounters.unknown = unknown;
            
            // Update counter displays
            const odcCounter = document.getElementById('legend-counter-odc');
            const odpCounter = document.getElementById('legend-counter-odp');
            const onlineCounter = document.getElementById('legend-counter-online');
            const offlineCounter = document.getElementById('legend-counter-offline');
            const unknownCounter = document.getElementById('legend-counter-unknown');
            
            if (odcCounter) odcCounter.textContent = legendCounters.odc;
            if (odpCounter) odpCounter.textContent = legendCounters.odp;
            if (onlineCounter) onlineCounter.textContent = legendCounters.online;
            if (offlineCounter) offlineCounter.textContent = legendCounters.offline;
            if (unknownCounter) unknownCounter.textContent = legendCounters.unknown;
        }
        
        function initLegendMinimap() {
            const minimapDiv = document.getElementById('legendMinimap');
            if (!minimapDiv || !map) return;
            
            try {
                // Create mini map
                legendMinimap = L.map('legendMinimap', {
                    zoomControl: false,
                    attributionControl: false,
                    dragging: false,
                    touchZoom: false,
                    doubleClickZoom: false,
                    scrollWheelZoom: false,
                    boxZoom: false,
                    keyboard: false
                });
                
                // Add tile layer
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    maxZoom: 13,
                    attribution: ''
                }).addTo(legendMinimap);
                
                // Sync with main map
                map.on('moveend', function() {
                    if (legendMinimap) {
                        legendMinimap.setView(map.getCenter(), Math.min(map.getZoom(), 13));
                    }
                });
                
                map.on('zoomend', function() {
                    if (legendMinimap) {
                        legendMinimap.setView(map.getCenter(), Math.min(map.getZoom(), 13));
                    }
                });
                
                // Set initial view
                legendMinimap.setView(map.getCenter(), Math.min(map.getZoom(), 13));
                
                // Add rectangle to show main map bounds
                const updateBounds = function() {
                    if (legendMinimap && map) {
                        const bounds = map.getBounds();
                        if (legendMinimap._boundsRectangle) {
                            legendMinimap.removeLayer(legendMinimap._boundsRectangle);
                        }
                        legendMinimap._boundsRectangle = L.rectangle(bounds, {
                            color: '#ff7800',
                            weight: 2,
                            fill: false
                        }).addTo(legendMinimap);
                    }
                };
                
                map.on('moveend', updateBounds);
                map.on('zoomend', updateBounds);
                updateBounds();
                
            } catch (error) {
                console.error('[Legend] Error initializing mini map:', error);
            }
        }

        // MODIFIED: populateParentOdcDropdown to include capacity and disable full ODCs
        function populateParentOdcDropdown(selectedParentId = null) {
            const select = $('#assetParentOdc');
            const currentValue = selectedParentId || select.val();
            select.empty().append('<option value="">-- Tidak ada / ODC Induk --</option>');

            const odcsForDropdown = allNetworkAssetsData.filter(a => a.type === 'ODC');

            if(odcsForDropdown && odcsForDropdown.length > 0){
                odcsForDropdown.sort((a,b) => (a.name || '').localeCompare(b.name || '')).forEach(odc => {
                    const odcCapacity = parseInt(odc.capacity_ports) || 0;
                    const portsUsed = parseInt(odc.ports_used) || 0; // ODC ports_used counts connected ODPs
                    const isFull = (odcCapacity > 0 && portsUsed >= odcCapacity);

                    // Check if the current ODP being edited is already connected to this ODC
                    const isCurrentOdcForEditedOdp = (selectedParentId !== null && String(odc.id) === String(selectedParentId));

                    let displayText = `${odc.name} (ID: ${odc.id}) - ODP: ${portsUsed}/${odcCapacity || 'N/A'}`;
                    if (isFull && !isCurrentOdcForEditedOdp) {
                        displayText += ' (PENUH)';
                    } else if (isCurrentOdcForEditedOdp && isFull) {
                        displayText += ' (Sedang Digunakan - PENUH)'; // Clarify for the current ODP
                    }

                    const option = new Option(displayText, odc.id);
                    if (isFull && !isCurrentOdcForEditedOdp) {
                        option.disabled = true;
                    }
                    select.append(option);
                });
            }
            if(currentValue && select.find(`option[value="${currentValue}"]`).length > 0) {
                 select.val(currentValue);
            } else {
                 select.val("");
            }
            if (select.hasClass("select2-hidden-accessible")) {
                 select.trigger('change.select2');
            }
        }

        $('#assetType').on('change', function() {
            const type = $(this).val();
            const isNewAsset = !$('#assetId').val();
            $('#odcPortsUsedLabelInfo').hide();
            $('#odpPortsUsedLabelInfo').hide();

            if (type === 'ODP') {
                $('#parentOdcGroup').slideDown();
                // Pass current parent ID if editing an ODP to ensure its current ODC option isn't disabled due to being "full"
                populateParentOdcDropdown($('#assetParentOdc').data('current-odp-parent') || null);
                $('#assetPortsUsed').prop('readonly', true).attr('placeholder', 'Otomatis');
                $('#odpPortsUsedLabelInfo').show();
                if (isNewAsset) {
                    $('#assetPortsUsed').val('');
                }
            } else { // ODC
                $('#parentOdcGroup').slideUp();
                $('#assetPortsUsed').prop('readonly', true).attr('placeholder', 'Otomatis');
                $('#odcPortsUsedLabelInfo').show();
                 if (isNewAsset) {
                     $('#assetPortsUsed').val('');
                }
            }
        });

        $('#useParentOdcLocation').on('change', function() {
            if ($(this).is(':checked')) {
                const parentOdcId = $('#assetParentOdc').val();
                if (parentOdcId) {
                    const selectedOdc = allNetworkAssetsData.find(odc => odc.type === 'ODC' && odc.id == parentOdcId);
                    if (selectedOdc) {
                        const lat = parseFloat(selectedOdc.latitude).toFixed(5);
                        const lng = parseFloat(selectedOdc.longitude).toFixed(5);
                        $('#assetLatitude').val(lat).prop('readonly', true);
                        $('#assetLongitude').val(lng).prop('readonly', true);
                        if (assetModalMapInstance && assetModalMapMarker) {
                            assetModalMapMarker.setLatLng([lat, lng]);
                            assetModalMapInstance.setView([lat, lng], assetModalMapInstance.getZoom());
                        }
                    }
                } else {
                    displayGlobalMapMessage('Pilih ODC Induk terlebih dahulu untuk menggunakan lokasinya.', 'warning');
                    $(this).prop('checked', false);
                }
            } else {
                $('#assetLatitude').prop('readonly', false);
                $('#assetLongitude').prop('readonly', false);
            }
        });

        // New function for the map inside asset modal
        function initializeAssetModalMap(mapId, latInputId, lngInputId, initialLat, initialLng) {
            if (assetModalMapInstance) { assetModalMapInstance.remove(); assetModalMapInstance = null; }
            if (assetModalMapMarker) { assetModalMapMarker.remove(); assetModalMapMarker = null; }

            const latInput = $(`#${latInputId}`);
            const lngInput = $(`#${lngInputId}`);

            const defaultLat = -7.24139; // Default central location for asset modal map
            const defaultLng = 111.83833;
            const defaultZoom = 15;

            const viewLat = (initialLat && !isNaN(parseFloat(initialLat))) ? parseFloat(initialLat) : defaultLat;
            const viewLng = (initialLng && !isNaN(parseFloat(initialLng))) ? parseFloat(initialLng) : defaultLng;
            // Pastikan viewZoom tidak melebihi maxZoom (18 untuk satellite)
            const calculatedZoom = (initialLat && initialLng && !isNaN(parseFloat(initialLat)) && !isNaN(parseFloat(initialLng))) ? 18 : defaultZoom;
            const viewZoom = Math.min(calculatedZoom, 18); // Maksimal 18 untuk mencegah error

            const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 22,
                attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            });
            const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                maxZoom: 18,
                maxNativeZoom: 18, // Esri World Imagery hanya support sampai level 18
                attribution: 'Tiles &copy; Esri',
                errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' // Transparent 1x1 pixel
            });

            assetModalMapInstance = L.map(mapId, {
                layers: [satelliteLayer], // Default layer
                maxZoom: 18 // Sesuaikan dengan maxZoom satellite layer
            }).setView([viewLat, viewLng], viewZoom);

            const baseMaps = { "Satelit": satelliteLayer, "OpenStreetMap": osmLayer };
            L.control.layers(baseMaps, null, { collapsed: true, position: 'topright' }).addTo(assetModalMapInstance);
            
            // Handle baselayerchange untuk asset modal map
            assetModalMapInstance.on('baselayerchange', function(e) {
                const newMaxZoom = e.name === "Satelit" ? 18 : 22;
                assetModalMapInstance.options.maxZoom = newMaxZoom;
                if (assetModalMapInstance.getZoom() > newMaxZoom) {
                    assetModalMapInstance.setZoom(newMaxZoom);
                }
            });

            function updateMarkerAndInputs(latlng, setView = false) {
                latInput.val(latlng.lat.toFixed(5));
                lngInput.val(latlng.lng.toFixed(5));
                if (!assetModalMapMarker) {
                    assetModalMapMarker = L.marker(latlng, { draggable: true }).addTo(assetModalMapInstance);
                    assetModalMapMarker.on('dragend', function (event) {
                        const pos = event.target.getLatLng();
                        latInput.val(pos.lat.toFixed(5));
                        lngInput.val(pos.lng.toFixed(5));
                    });
                } else {
                    assetModalMapMarker.setLatLng(latlng);
                }
                if (setView) {
                    assetModalMapInstance.setView(latlng, Math.max(assetModalMapInstance.getZoom(), 16));
                }
            }

            if (initialLat != null && initialLng != null && !isNaN(parseFloat(initialLat)) && !isNaN(parseFloat(initialLng))) {
                 updateMarkerAndInputs(L.latLng(parseFloat(initialLat), parseFloat(initialLng)), false);
            }

            const GpsControl = L.Control.extend({
                options: { position: 'topleft' },
                onAdd: function (mapCtrl) {
                    const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom-gps');
                    const originalIconHTML = '<i class="fas fa-map-marker-alt"></i>';
                    const loadingIconHTML = '<i class="fas fa-spinner fa-spin"></i>';
                    container.innerHTML = originalIconHTML;
                    container.title = 'Dapatkan Lokasi GPS Saat Ini';

                    L.DomEvent.on(container, 'click', L.DomEvent.stopPropagation)
                        .on(container, 'click', L.DomEvent.preventDefault)
                        .on(container, 'click', function () {
                            container.innerHTML = loadingIconHTML;
                            // Re-use global map message for consistent display
                            displayGlobalMapMessage("Meminta lokasi GPS Anda...", "info", 3000);
                            if (navigator.geolocation) {
                                navigator.geolocation.getCurrentPosition(
                                    (position) => processSuccessfulGeolocationMapViewer(position, "Tombol GPS Modal", displayGlobalMapMessage, assetModalMapInstance, container, originalIconHTML),
                                    (error) => {
                                        handleGeolocationErrorMapViewer(error, "Gagal dari Tombol GPS Modal", displayGlobalMapMessage);
                                        container.innerHTML = originalIconHTML;
                                    },
                                    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
                                );
                            } else {
                                handleGeolocationErrorMapViewer({code: -1, message: "Browser tidak mendukung geolokasi."}, "Gagal dari Tombol GPS Modal", displayGlobalMapMessage);
                                container.innerHTML = originalIconHTML;
                            }
                        });
                    return container;
                }
            });
            new GpsControl().addTo(assetModalMapInstance);

            assetModalMapInstance.on('click', function (e) {
                updateMarkerAndInputs(e.latlng);
            });
            // Ensure map resizes correctly when modal is shown
            $('#assetModal').off('shown.bs.modal.assetmapfix').on('shown.bs.modal.assetmapfix', function() {
                 setTimeout(function () { if (assetModalMapInstance) assetModalMapInstance.invalidateSize(); }, 10);
            });
             if ($('#assetModal').is(':visible')) {
                 setTimeout(function () { if (assetModalMapInstance) assetModalMapInstance.invalidateSize(); }, 10);
            }
        }


        function openAssetModal(assetData = null, lat, lng) {
            $('#assetForm')[0].reset();
            $('#useParentOdcLocation').prop('checked', false);
            $('#deleteAssetBtn').hide();
            $('#assetLatitude').prop('readonly', false);
            $('#assetLongitude').prop('readonly', false);
            $('#assetId').val('');
            $('#assetParentOdc').data('current-odp-parent', null);
            $('#odcPortsUsedLabelInfo').hide();
            $('#odpPortsUsedLabelInfo').hide();
            $('#assetPortsUsed').val(''); // Clear on open

            let initialLat = lat;
            let initialLng = lng;

            if (assetData && assetData.id) {
                $('#assetModalLabel').text(`Edit Aset: ${assetData.name || assetData.id} (${assetData.type})`);
                $('#assetId').val(assetData.id);
                $('#assetType').val(assetData.type);
                $('#assetName').val(assetData.name);
                $('#assetAddress').val(assetData.address);
                $('#assetLatitude').val(assetData.latitude != null ? parseFloat(assetData.latitude).toFixed(5) : '');
                $('#assetLongitude').val(assetData.longitude != null ? parseFloat(assetData.longitude).toFixed(5) : '');
                $('#assetCapacity').val(assetData.capacity_ports);
                $('#assetNotes').val(assetData.notes);

                let portsUsedForDisplay = assetData.ports_used || 0;
                // Recalculate ports_used for ODPs based on current customer data
                if(assetData.type === 'ODP'){
                    const connectedCustomersToThisOdp = allCustomerData.filter(cust => String(cust.connected_odp_id) === String(assetData.id));
                    portsUsedForDisplay = connectedCustomersToThisOdp.length;
                }
                $('#assetPortsUsed').val(portsUsedForDisplay);


                $('#assetType').trigger('change');

                if (assetData.type === 'ODP') {
                    $('#assetParentOdc').data('current-odp-parent', assetData.parent_odc_id);
                }
                $('#deleteAssetBtn').show();
                initialLat = assetData.latitude;
                initialLng = assetData.longitude;
            } else {
                $('#assetModalLabel').text('Tambah Aset Jaringan Baru');
                $('#assetType').val('ODC').trigger('change');
            }

            // Always re-initialize select2 for the parent ODC dropdown
            if ($('#assetParentOdc').data('select2')) {
                 try { $('#assetParentOdc').select2('destroy'); } catch(e){}
            }
            $('#assetParentOdc').select2({
                theme: "bootstrap",
                dropdownParent: $('#assetModal'),
                placeholder: '-- Pilih ODC Induk --',
                allowClear: true
            });

            // Set parent ODC value and trigger change event to re-populate if necessary
            if (assetData && assetData.type === 'ODP' && assetData.parent_odc_id) {
                $('#assetParentOdc').val(assetData.parent_odc_id).trigger('change.select2');
            } else if (!assetData || assetData.type === 'ODC') {
                 $('#assetParentOdc').val(null).trigger('change.select2');
            }

            // Initialize the mini map within the modal
            initializeAssetModalMap('assetModalMap', 'assetLatitude', 'assetLongitude', initialLat, initialLng);

            $('#assetModal').modal('show');
        }


        $('#assetForm').on('submit', async function(event) {
            event.preventDefault();
            const assetIdFromForm = $('#assetId').val();
            const assetType = $('#assetType').val();
            const name = $('#assetName').val().trim();
            const latitudeVal = $('#assetLatitude').val();
            const longitudeVal = $('#assetLongitude').val();

            if (!name) { displayGlobalMapMessage('Nama aset wajib diisi.', 'warning'); return; }
            if (latitudeVal === '' || longitudeVal === '' || isNaN(parseFloat(latitudeVal)) || isNaN(parseFloat(longitudeVal))) {
                displayGlobalMapMessage('Latitude dan Longitude harus berupa angka yang valid dan tidak boleh kosong.', 'warning'); return;
            }

            const data = {
                type: assetType,
                name: name,
                address: $('#assetAddress').val().trim(),
                latitude: parseFloat(latitudeVal),
                longitude: parseFloat(longitudeVal),
                capacity_ports: parseInt($('#assetCapacity').val()) || null,
                notes: $('#assetNotes').val().trim(),
                parent_odc_id: assetType === 'ODP' ? ($('#assetParentOdc').val() || null) : null
            };
             data.capacity_ports = data.capacity_ports === 0 ? null : data.capacity_ports;


            const url = assetIdFromForm ? `/api/map/network-assets/${assetIdFromForm}` : '/api/map/network-assets';
            const method = assetIdFromForm ? 'PUT' : 'POST';
            const saveButton = $('#saveAssetBtn');
            const originalButtonText = saveButton.html();
            saveButton.prop('disabled', true).html('<span class="spinner-border spinner-border-sm"></span> Menyimpan...');

            try {
                const response = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                const result = await response.json();

                if (response.ok && (result.status === 200 || result.status === 201)) {
                    $('#assetModal').modal('hide');

                    if (!assetIdFromForm && result.data && result.data.id) {
                        const newAssetId = String(result.data.id);
                        if (result.data.type === 'ODC') selectedOdcIds.add(newAssetId);
                        else if (result.data.type === 'ODP') selectedOdpIds.add(newAssetId);
                    }

                    await loadAllMapData();

                    if (!assetIdFromForm && result.data && result.data.type === 'ODC') {
                        document.getElementById('addOdpAfterOdcMessageText').textContent = `ODC "${result.data.name}" (ID: ${result.data.id}) berhasil disimpan.`;
                        const yesBtn = document.getElementById('yesAddOdpBtn');
                        yesBtn.setAttribute('data-odc-id', result.data.id);
                        yesBtn.setAttribute('data-lat', result.data.latitude);
                        yesBtn.setAttribute('data-lng', result.data.longitude);
                        $('#addOdpAfterOdcModal').modal('show');
                    } else {
                        displayGlobalMapMessage(result.message, 'success');
                    }
                } else {
                    displayGlobalMapMessage(`Error Simpan: ${result.message || `Gagal menyimpan aset (Status: ${response.status})`}`, 'danger');
                }
            } catch (error) {
                console.error("[AssetFormSubmit] Error saving asset:", error);
                displayGlobalMapMessage('Kesalahan koneksi atau format respons tidak valid saat menyimpan aset.', 'danger');
            } finally {
                saveButton.prop('disabled', false).html(originalButtonText);
            }
        });

        $('#deleteAssetBtn').on('click', async function() {
            const assetId = $('#assetId').val();
            const assetType = $('#assetType').val();
            const originalButtonText = $(this).html();
            if (!assetId) {
                displayGlobalMapMessage('ID Aset tidak ditemukan untuk dihapus.', 'warning'); return;
            }
            if (confirm(`Apakah Anda yakin ingin menghapus aset ini (ID: ${assetId})? Jika ini ODC, ODP yang terhubung tidak akan otomatis terhapus namun relasinya akan hilang. Tindakan ini tidak dapat dibatalkan.`)) {
                const deleteButton = $(this);
                deleteButton.prop('disabled', true).html('<span class="spinner-border spinner-border-sm"></span> Menghapus...');
                try {
                    const response = await fetch(`/api/map/network-assets/${assetId}`, { method: 'DELETE' });
                    const result = await response.json();
                    if (response.ok && result.status === 200) {
                        displayGlobalMapMessage(result.message, 'success');
                        $('#assetModal').modal('hide');
                        if (assetType === 'ODC') selectedOdcIds.delete(String(assetId));
                        else if (assetType === 'ODP') selectedOdpIds.delete(String(assetId));
                        loadAllMapData();
                    } else {
                        displayGlobalMapMessage(result.message || `Gagal menghapus aset (Status: ${response.status})`, 'danger');
                    }
                } catch (error) {
                    console.error("[DeleteAsset] Error deleting asset:", error);
                    displayGlobalMapMessage('Terjadi kesalahan koneksi saat menghapus aset.', 'danger');
                } finally {
                    deleteButton.prop('disabled', false).html(originalButtonText);
                }
            }
        });

        $('#assetModal').on('hidden.bs.modal', function () {
             // Destroy the mini map instance when the modal is hidden
            if (assetModalMapInstance) {
                assetModalMapInstance.remove();
                assetModalMapInstance = null;
                assetModalMapMarker = null;
            }
        });

        async function fetchAllCustomerData() {
            console.log("[fetchAllCustomerData] Memulai pemuatan data pelanggan...");
            try {
                const response = await fetch('/api/users?_=${new Date().getTime()}', { credentials: 'include' });
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error("[fetchAllCustomerData] API Error:", response.status, errorText.substring(0, 200));
                    displayGlobalMapMessage(`Gagal memuat data pelanggan awal: Status ${response.status}.`, 'danger');
                    allCustomerData = [];
                    throw new Error(`API Users error for prefetch: ${response.status}`);
                }
                const result = await response.json();
                if (result.data && Array.isArray(result.data)) {
                    allCustomerData = result.data;
                    console.log("[fetchAllCustomerData] Data pelanggan berhasil dimuat:", allCustomerData.length);
                    return true;
                } else {
                    console.warn("[fetchAllCustomerData] Format API pelanggan salah atau tidak ada data. Result:", result);
                    allCustomerData = [];
                    return false;
                }
            } catch (error) {
                console.error("[fetchAllCustomerData] Kesalahan saat mengambil data pelanggan:", error);
                displayGlobalMapMessage("Kesalahan koneksi saat mengambil data pelanggan awal. Cek konsol.", 'danger');
                allCustomerData = [];
                throw error;
            }
        }
        
        async function fetchAllNetworkAssets() {
            console.log("[fetchAllNetworkAssets] Memulai pemuatan data aset jaringan...");
            try {
                const response = await fetch('/api/map/network-assets?_=${new Date().getTime()}', { credentials: 'include' });
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error("[fetchAllNetworkAssets] API Error:", response.status, errorText.substring(0, 500));
                    displayGlobalMapMessage(`Gagal memuat data aset jaringan awal: Status ${response.status}.`, 'danger');
                    allNetworkAssetsData = [];
                    throw new Error(`API Network Assets error: ${response.status}`);
                }
                const result = await response.json();
                if (result.status === 200 && Array.isArray(result.data)) {
                    allNetworkAssetsData = result.data;
                    console.log("[fetchAllNetworkAssets] Data aset jaringan berhasil dimuat:", allNetworkAssetsData.length);
                    return true;
                } else {
                    console.warn("[fetchAllNetworkAssets] Format API aset salah atau tidak ada data. Result:", result);
                    allNetworkAssetsData = [];
                    return false;
                }
            } catch (error) {
                console.error("[fetchAllNetworkAssets] Kesalahan saat mengambil data aset jaringan:", error);
                displayGlobalMapMessage("Kesalahan koneksi saat mengambil data aset jaringan. Cek konsol.", 'danger');
                allNetworkAssetsData = [];
                throw error;
            }
        }


        async function loadAllMapData() {
            console.log("[loadAllMapData] Memulai pemuatan semua data peta...");
            const initialMessageDiv = $('#globalMessageMap .alert-info');
            if (!initialMessageDiv.hasClass('alert-danger') && !initialMessageDiv.hasClass('alert-warning')) {
                displayGlobalMapMessage("Memuat data peta, mohon tunggu...", "info", 20000);
            }

            odcMarkers = []; 
            odpMarkers = [];
            customerMarkers = [];
            odpToOdcLines = [];
            customerToOdpLines = [];


            let networkLoadedSuccessfully = false;
            let customerDataFetchedSuccessfully = false;
            let markersProcessedSuccessfully = false;
            let pppoeStatusLoadedSuccessfully = false;

            try {
                await fetchActivePppoeUsers();
                pppoeStatusLoadedSuccessfully = !initialPppoeLoadFailed;

                await fetchAllCustomerData();
                customerDataFetchedSuccessfully = true;

                await fetchAllNetworkAssets();
                networkLoadedSuccessfully = true;

                if (networkLoadedSuccessfully && customerDataFetchedSuccessfully) {
                    await loadNetworkAssetMarkers();
                    await loadCustomerMarkers();
                    markersProcessedSuccessfully = true;
                    // Update sidebar stats
                    updateQuickStats();
                }

            } catch (error) {
                console.error("[loadAllMapData] Gagal selama fase pemuatan atau pemrosesan data:", error);
            }


            if (isInitialLoad) {
                console.log("[loadAllMapData] Initial load, selecting all items for filter sets.");
                selectedOdcIds.clear();
                selectedOdpIds.clear();
                selectedCustomerIds.clear();
                allNetworkAssetsData.forEach(asset => {
                    if (asset.type === 'ODC') selectedOdcIds.add(String(asset.id));
                    else if (asset.type === 'ODP') selectedOdpIds.add(String(asset.id));
                });
                allCustomerData.forEach(customer => selectedCustomerIds.add(String(customer.id)));
                // Mark initial load complete
                isInitialLoad = false;
            }
            
            // Call applyFilters *after* all marker arrays are populated
            applyFilters(); // Apply filters to actually add markers to layers

            const currentMessageDiv = $('#globalMessageMap .alert');
            if (networkLoadedSuccessfully && customerDataFetchedSuccessfully && markersProcessedSuccessfully) {
                 if (!pppoeStatusLoadedSuccessfully) {
                    if (!currentMessageDiv.hasClass('alert-danger') && !currentMessageDiv.hasClass('alert-warning')) {
                        displayGlobalMapMessage("Data peta dimuat, status online pelanggan mungkin tidak akurat (gagal ambil data PPPoE).", "warning", 10000);
                    }
                } else if (allNetworkAssetsData.length === 0 && allCustomerData.length === 0) {
                     if (!currentMessageDiv.hasClass('alert-danger') && !currentMessageDiv.hasClass('alert-warning')) {
                        displayGlobalMapMessage("Belum ada data aset jaringan atau pelanggan. Klik peta untuk menambah aset baru.", "info", 10000);
                    }
                } else {
                     if (currentMessageDiv.hasClass('alert-info') && currentMessageDiv.text().includes("Memuat data peta")) {
                         currentMessageDiv.alert('close');
                    }
                }
            } else {
                if (!currentMessageDiv.hasClass('alert-danger') && !currentMessageDiv.hasClass('alert-warning')) {
                     displayGlobalMapMessage("Sebagian data peta gagal dimuat. Beberapa informasi mungkin tidak lengkap atau akurat. Periksa konsol.", "warning", 0);
                }
            }
        }


        async function loadNetworkAssetMarkers() {
            console.log("[loadNetworkAssetMarkers] Memulai pemrosesan marker aset jaringan...");
            try {
                const assets = allNetworkAssetsData;
                allOdcData = assets.filter(asset => asset.type === 'ODC' && asset.latitude != null && asset.longitude != null)
                                   .map(asset => JSON.parse(JSON.stringify(asset)));
                populateParentOdcDropdown();

                const assetsByLocation = new Map();
                assets.forEach(asset => {
                    if (asset.latitude != null && asset.longitude != null) {
                        const locKey = `${parseFloat(asset.latitude).toFixed(5)},${parseFloat(asset.longitude).toFixed(5)}`;
                        if (!assetsByLocation.has(locKey)) assetsByLocation.set(locKey, []);
                        assetsByLocation.get(locKey).push(asset);
                    }
                });


                assets.forEach(asset => {
                    if (asset.latitude != null && asset.longitude != null) {
                        let plotLat = parseFloat(asset.latitude);
                        let plotLng = parseFloat(asset.longitude);
                        if (isNaN(plotLat) || isNaN(plotLng)) { console.warn("Koordinat tidak valid:", asset); return; }

                        let iconToUse = createAssetIcon(asset);

                        if (asset.type === 'ODP' && asset.parent_odc_id) {
                            const parentOdc = allOdcData.find(o => o.id == asset.parent_odc_id);
                            // Only apply offset if ODP is at the exact same coordinates as its parent ODC
                            if (parentOdc && parentOdc.latitude != null && parentOdc.longitude != null &&
                                Math.abs(parseFloat(parentOdc.latitude) - parseFloat(asset.latitude)) < 0.000001 &&
                                Math.abs(parseFloat(parentOdc.longitude) - parseFloat(asset.longitude)) < 0.000001) {
                                const randomAngle = Math.random() * 2 * Math.PI;
                                const offsetDistance = 0.00003 + (Math.random() * 0.00002); // 3-5 meters offset
                                plotLat += Math.sin(randomAngle) * offsetDistance;
                                plotLng += Math.cos(randomAngle) * offsetDistance;
                            }
                        }

                        let portsUsedDisplay;
                        if (asset.type === 'ODC') {
                            portsUsedDisplay = `${asset.ports_used || 0} ODP terhubung`;
                        } else if (asset.type === 'ODP') {
                            const connectedCustomersToThisOdp = allCustomerData.filter(cust => String(cust.connected_odp_id) === String(asset.id));
                            portsUsedDisplay = `${connectedCustomersToThisOdp.length} port terpakai`;
                        } else {
                             portsUsedDisplay = `${asset.ports_used || 0} (status tidak diketahui)`;
                        }


                        let popupContent = `<b>${asset.name || 'Aset'} (${asset.type})</b><p>ID: ${asset.id}</p>` +
                                         (asset.address ? `<p>Alamat: ${asset.address}</p>` : '') +
                                         `<p>Kapasitas: ${asset.capacity_ports || 'N/A'} Port / Status: ${portsUsedDisplay}</p>`;

                        const originalLocKey = `${parseFloat(asset.latitude).toFixed(5)},${parseFloat(asset.longitude).toFixed(5)}`;
                        const coLocatedAssets = (assetsByLocation.get(originalLocKey) || []).filter(a => a.id !== asset.id);
                        if (coLocatedAssets.length > 0) {
                            popupContent += `<hr class="my-1" style="border-top: 1px dashed #ccc;"><em><small>Juga di lokasi ini:</small></em>`;
                            coLocatedAssets.forEach(other => { popupContent += `<p class="mb-0 ml-2 small">- ${other.type}: ${other.name} (ID: ${other.id})</p>`; });
                        }

                        if (asset.type === 'ODC') {
                            const connectedOdps = allNetworkAssetsData.filter(odp => odp.type === 'ODP' && String(odp.parent_odc_id) === String(asset.id));
                            if (connectedOdps.length > 0) {
                                popupContent += `<hr class="my-1"><p class="mb-1"><strong><i class="fas fa-network-wired"></i> ODP Terhubung (${connectedOdps.length}):</strong></p><ul class="list-unstyled ml-3 mb-1" style="font-size:0.85em;">`;
                                connectedOdps.sort((a,b) => (a.name || '').localeCompare(b.name || '')).forEach(odp => {
                                    const odpConnectedCustomersCount = allCustomerData.filter(cust => String(cust.connected_odp_id) === String(odp.id)).length;
                                    popupContent += `<li>- ${odp.name || `ODP ID ${odp.id}`} (Kap: ${odp.capacity_ports || 'N/A'}, Pakai: ${odpConnectedCustomersCount})</li>`;
                                });
                                popupContent += `</ul>`;
                            } else {
                                popupContent += `<p class="small text-muted mt-1"><em>Tidak ada ODP terhubung ke ODC ini.</em></p>`;
                            }
                        }

                        if (asset.type === 'ODP') {
                            if (asset.parent_odc_id) {
                                const parent = allOdcData.find(o => String(o.id) === String(asset.parent_odc_id));
                                popupContent += `<p>Induk ODC: ${parent ? `${parent.name} (ID: ${asset.parent_odc_id})` : `ID ${asset.parent_odc_id || '-'}`}</p>`;
                                if (parent && parent.latitude != null && parent.longitude != null) {
                                    const dist = haversineDistance({ latitude: parseFloat(asset.latitude), longitude: parseFloat(asset.longitude) }, { latitude: parseFloat(parent.latitude), longitude: parseFloat(parent.longitude) });
                                    if (!isNaN(dist)) popupContent += `<p>Jarak ke ODC Induk: ${dist.toFixed(0)} meter</p>`;
                                }
                            }
                            const connectedCustomers = allCustomerData.filter(cust => String(cust.connected_odp_id) === String(asset.id));
                            if (connectedCustomers.length > 0) {
                                popupContent += `<hr class="my-1"><p class="mb-1"><strong><i class="fas fa-users"></i> Pelanggan Terhubung (${connectedCustomers.length}):</strong></p><ul class="list-unstyled ml-3 mb-1" style="font-size:0.85em;">`;
                                // MODIFIED: Display pppoe_username for connected customers
                                connectedCustomers.sort((a,b) => (a.name || '').localeCompare(b.name || '')).forEach(customer => {
                                    let onlineStatus = 'unknown';
                                    if (customer.pppoe_username) onlineStatus = activePppoeUsersMap.has(customer.pppoe_username) ? 'online' : 'offline';
                                    if (initialPppoeLoadFailed && customer.pppoe_username) onlineStatus = 'unknown'; else if (!customer.pppoe_username) onlineStatus = 'offline';
                                    const statusColor = onlineStatus === 'online' ? 'text-success' : (onlineStatus === 'offline' ? 'text-danger' : 'text-muted');
                                    // Use pppoe_username if available, otherwise fallback to customer name
                                    const customerDisplayId = customer.pppoe_username || customer.name || `Cust. ID ${customer.id}`;
                                    popupContent += `<li>- ${customerDisplayId} <span class="${statusColor}" style="font-weight:bold;">(${onlineStatus.charAt(0).toUpperCase() + onlineStatus.slice(1)})</span></li>`;
                                });
                                popupContent += `</ul>`;
                            } else {
                                popupContent += `<p class="small text-muted mt-1"><em>Tidak ada pelanggan terhubung ke ODP ini.</em></p>`;
                            }
                        }

                        popupContent += `<p>Lat: ${parseFloat(asset.latitude).toFixed(5)}, Lng: ${parseFloat(asset.longitude).toFixed(5)}</p>`;
                        if(asset.notes) popupContent += `<p>Catatan: ${asset.notes}</p>`;
                        if(asset.createdBy) popupContent += `<p><small>Dibuat: ${asset.createdBy} (${new Date(asset.createdAt).toLocaleDateString('id-ID', {day:'2-digit',month:'short',year:'numeric'})})</small></p>`;
                        if(asset.updatedBy && asset.updatedAt && asset.createdAt && new Date(asset.updatedAt).getTime() !== new Date(asset.createdAt).getTime()) {
                            popupContent += `<p><small>Diupdate: ${asset.updatedBy} (${new Date(asset.updatedAt).toLocaleDateString('id-ID', {day:'2-digit',month:'short',year:'numeric'})})</small></p>`;
                        }
                        popupContent += `<button class="btn btn-sm btn-primary btn-edit-asset">Edit Aset Ini</button>`;

                        const marker = L.marker([plotLat, plotLng], { icon: iconToUse }).bindPopup(popupContent);
                        marker.assetData = JSON.parse(JSON.stringify(asset));
                        // Bind tooltip for assets (ODC/ODP)
                        if (asset.name) {
                            marker.bindTooltip(asset.name, {
                                permanent: true, // Always show unless hidden by control
                                direction: 'top',
                                className: 'marker-label-tooltip',
                                offset: [0, -ICON_HEIGHT/2 - 5] // Adjust offset to position above icon
                            });
                            // Set initial visibility
                            if (!labelVisibility[asset.type.toLowerCase()]) {
                                marker.getTooltip().setOpacity(0);
                            }
                        }

                        if (asset.type === 'ODC') odcMarkers.push(marker);
                        else if (asset.type === 'ODP') odpMarkers.push(marker);
                    }
                });

                // Create routes from ODP to parent ODC dengan routing helper
                for (const odpMarker of odpMarkers) {
                    const odpAsset = odpMarker.assetData;
                    if (odpAsset.parent_odc_id) {
                        const parentOdcMarker = odcMarkers.find(m => String(m.assetData.id) === String(odpAsset.parent_odc_id));
                        if (parentOdcMarker) {
                            const startLatLng = parentOdcMarker.getLatLng();
                            const endLatLng = odpMarker.getLatLng();
                            
                            // Get routing profile dari config (default: 'driving-car' untuk ODC-ODP)
                            let routingProfile = 'driving-car';
                            if (typeof window !== 'undefined' && window.globalConfig && window.globalConfig.openRouteService) {
                                routingProfile = window.globalConfig.openRouteService.profiles?.odcToOdp || 'driving-car';
                            }
                            
                            // PRIORITAS 1: Cek waypoint manual terlebih dahulu
                            let routeCoordinates;
                            try {
                                const waypointResponse = await fetch(`/api/map/waypoints?connectionType=odc-odp&sourceId=${parentOdcMarker.assetData.id}&targetId=${odpAsset.id}`, {
                                    credentials: 'include'
                                });
                                
                                if (waypointResponse.ok) {
                                    const waypointData = await waypointResponse.json();
                                    if (waypointData.status === 200 && waypointData.data && waypointData.data.waypoints && waypointData.data.waypoints.length >= 2) {
                                        routeCoordinates = waypointData.data.waypoints;
                                        console.log(`[WAYPOINTS_MANUAL] ODP-ODC: ${odpAsset.name} → ODC-${parentOdcMarker.assetData.id} (${routeCoordinates.length} points manual)`);
                                    }
                                }
                            } catch (waypointError) {
                                console.warn(`[WAYPOINTS_ERROR] ODP-ODC: ${odpAsset.name} → ODC-${parentOdcMarker.assetData.id}:`, waypointError);
                            }
                            
                            // PRIORITAS 2: Jika tidak ada waypoint manual, gunakan routing API
                            if (!routeCoordinates || routeCoordinates.length < 2) {
                                try {
                                    routeCoordinates = await getRouteCoordinates(
                                        startLatLng.lat,
                                        startLatLng.lng,
                                        endLatLng.lat,
                                        endLatLng.lng,
                                        routingProfile
                                    );
                                    
                                    // Log jika routing berhasil (hanya untuk debugging, bisa di-disable)
                                    if (routeCoordinates && routeCoordinates.length > 2) {
                                        console.log(`[ROUTING_SUCCESS] ODP-ODC: ${odpAsset.name} → ODC-${parentOdcMarker.assetData.id} (${routeCoordinates.length} points)`);
                                    } else {
                                        console.warn(`[ROUTING_FALLBACK] ODP-ODC: ${odpAsset.name} → ODC-${parentOdcMarker.assetData.id} (straight line, ${routeCoordinates?.length || 0} points)`);
                                    }
                                } catch (error) {
                                    console.error(`[ROUTING_ERROR] ODP-ODC: ${odpAsset.name} → ODC-${parentOdcMarker.assetData.id}:`, error);
                                    // Fallback ke straight line jika routing gagal
                                    routeCoordinates = [
                                        [startLatLng.lat, startLatLng.lng],
                                        [endLatLng.lat, endLatLng.lng]
                                    ];
                                }
                            }
                            
                            // Create elegant animated line dengan route coordinates - Multi-layer untuk depth effect
                            // Base layer - subtle shadow untuk depth
                            const baseLine = L.polyline(routeCoordinates, {
                                color: '#ff7800',
                                weight: 4,
                                opacity: 0.12,
                                className: 'connection-line-base'
                            });
                            baseLine.connectedEntities = { odcId: parentOdcMarker.assetData.id, odpId: odpAsset.id };
                            odpToOdcLines.push(baseLine);
                            // Attach waypoint editor to base line
                            attachWaypointEditorToLine(baseLine, 'odc-odp', parentOdcMarker.assetData.id, odpAsset.id);
                            
                            // Main animated line - elegant and smooth
                            const line = L.polyline.antPath(routeCoordinates, {
                                color: '#ff7800', // Orange
                                weight: 2.5,
                                opacity: 0.75,
                                delay: 6000, // Slow, elegant animation
                                dashArray: [35, 55], // Long dashes for elegant look
                                pulseColor: '#ffaa44', // Soft orange pulse (lighter than line)
                                hardwareAccelerated: true
                            });
                            line.connectedEntities = { odcId: parentOdcMarker.assetData.id, odpId: odpAsset.id };
                            odpToOdcLines.push(line);
                            // Attach waypoint editor to main line
                            attachWaypointEditorToLine(line, 'odc-odp', parentOdcMarker.assetData.id, odpAsset.id);
                        }
                    }
                }

            } catch (error) {
                console.error("[loadNetworkAssetMarkers] Error processing assets:", error);
                throw error;
            }
        }

        // Lazy load Chart.js library
        function loadChartJS() {
            return new Promise((resolve, reject) => {
                if (window.Chart) {
                    Chart = window.Chart;
                    resolve();
                    return;
                }
                
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js';
                script.onload = () => {
                    Chart = window.Chart;
                    console.log('[ChartJS] Chart.js loaded successfully');
                    resolve();
                };
                script.onerror = () => {
                    console.error('[ChartJS] Failed to load Chart.js');
                    reject(new Error('Failed to load Chart.js'));
                };
                document.head.appendChild(script);
            });
        }
        
        // Initialize monitoring charts
        async function initMonitoringCharts() {
            // Lazy load Chart.js hanya jika dashboard visible
            const dashboard = document.getElementById('connectionMonitoringDashboard');
            if (!dashboard || dashboard.style.display === 'none') {
                return; // Dashboard belum visible, skip init
            }
            
            try {
                await loadChartJS();
                
                if (!Chart) {
                    console.warn('[ChartJS] Chart.js not available, skipping chart initialization');
                    return;
                }
                
                const chartOptions = {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: { enabled: false }
                    },
                    scales: {
                        x: { display: false },
                        y: { display: false }
                    },
                    elements: {
                        point: { radius: 0 },
                        line: { borderWidth: 2, tension: 0.4 }
                    },
                    animation: { duration: 0 }
                };
                
                // Online Chart
                const onlineCtx = document.getElementById('chart-online');
                if (onlineCtx && !monitoringCharts.online) {
                    monitoringCharts.online = new Chart(onlineCtx, {
                        type: 'line',
                        data: {
                            labels: monitoringHistory.timestamps,
                            datasets: [{
                                data: monitoringHistory.online,
                                borderColor: '#28a745',
                                backgroundColor: 'rgba(40, 167, 69, 0.1)',
                                fill: true
                            }]
                        },
                        options: chartOptions
                    });
                }
                
                // Offline Chart
                const offlineCtx = document.getElementById('chart-offline');
                if (offlineCtx && !monitoringCharts.offline) {
                    monitoringCharts.offline = new Chart(offlineCtx, {
                        type: 'line',
                        data: {
                            labels: monitoringHistory.timestamps,
                            datasets: [{
                                data: monitoringHistory.offline,
                                borderColor: '#dc3545',
                                backgroundColor: 'rgba(220, 53, 69, 0.1)',
                                fill: true
                            }]
                        },
                        options: chartOptions
                    });
                }
                
                // Total Chart
                const totalCtx = document.getElementById('chart-total');
                if (totalCtx && !monitoringCharts.total) {
                    monitoringCharts.total = new Chart(totalCtx, {
                        type: 'line',
                        data: {
                            labels: monitoringHistory.timestamps,
                            datasets: [{
                                data: monitoringHistory.total,
                                borderColor: '#17a2b8',
                                backgroundColor: 'rgba(23, 162, 184, 0.1)',
                                fill: true
                            }]
                        },
                        options: chartOptions
                    });
                }
                
                // Uptime Chart
                const uptimeCtx = document.getElementById('chart-uptime');
                if (uptimeCtx && !monitoringCharts.uptime) {
                    monitoringCharts.uptime = new Chart(uptimeCtx, {
                        type: 'line',
                        data: {
                            labels: monitoringHistory.timestamps,
                            datasets: [{
                                data: monitoringHistory.uptime,
                                borderColor: '#ffc107',
                                backgroundColor: 'rgba(255, 193, 7, 0.1)',
                                fill: true
                            }]
                        },
                        options: chartOptions
                    });
                }
                
                console.log('[ChartJS] Monitoring charts initialized');
            } catch (error) {
                console.error('[ChartJS] Error initializing charts:', error);
            }
        }
        
        // Update monitoring charts dengan debounce
        function updateMonitoringCharts(online, offline, total, uptime) {
            // Clear existing timeout
            if (chartUpdateTimeout) {
                clearTimeout(chartUpdateTimeout);
            }
            
            // Add current data to history
            const now = new Date();
            const hourLabel = now.getHours().toString().padStart(2, '0') + ':00';
            
            // Keep only last 24 hours
            monitoringHistory.timestamps.push(hourLabel);
            monitoringHistory.online.push(online);
            monitoringHistory.offline.push(offline);
            monitoringHistory.total.push(total);
            monitoringHistory.uptime.push(uptime);
            
            // Limit to 24 entries (24 hours)
            if (monitoringHistory.timestamps.length > 24) {
                monitoringHistory.timestamps.shift();
                monitoringHistory.online.shift();
                monitoringHistory.offline.shift();
                monitoringHistory.total.shift();
                monitoringHistory.uptime.shift();
            }
            
            // Debounce chart updates
            chartUpdateTimeout = setTimeout(() => {
                if (!Chart) {
                    // Try to init charts if not initialized
                    initMonitoringCharts();
                    return;
                }
                
                // Update charts jika sudah initialized
                if (monitoringCharts.online) {
                    monitoringCharts.online.data.labels = monitoringHistory.timestamps;
                    monitoringCharts.online.data.datasets[0].data = monitoringHistory.online;
                    monitoringCharts.online.update('none'); // 'none' mode = no animation
                }
                
                if (monitoringCharts.offline) {
                    monitoringCharts.offline.data.labels = monitoringHistory.timestamps;
                    monitoringCharts.offline.data.datasets[0].data = monitoringHistory.offline;
                    monitoringCharts.offline.update('none');
                }
                
                if (monitoringCharts.total) {
                    monitoringCharts.total.data.labels = monitoringHistory.timestamps;
                    monitoringCharts.total.data.datasets[0].data = monitoringHistory.total;
                    monitoringCharts.total.update('none');
                }
                
                if (monitoringCharts.uptime) {
                    monitoringCharts.uptime.data.labels = monitoringHistory.timestamps;
                    monitoringCharts.uptime.data.datasets[0].data = monitoringHistory.uptime;
                    monitoringCharts.uptime.update('none');
                }
            }, CHART_UPDATE_DEBOUNCE_MS);
        }
        
        // Function to update connection monitoring dashboard (moved before loadCustomerMarkers)
        function updateConnectionMonitoring() {
            // Show dashboard jika belum ditampilkan
            const dashboard = $('#connectionMonitoringDashboard');
            if (dashboard.length && dashboard.css('display') === 'none') {
                dashboard.slideDown(300);
                // Initialize charts saat dashboard ditampilkan pertama kali
                setTimeout(() => {
                    initMonitoringCharts();
                }, 350);
            }
            
            if (!customerMarkers || customerMarkers.length === 0) {
                $('#monitoring-online-count').text('0');
                $('#monitoring-offline-count').text('0');
                $('#monitoring-total-count').text('0');
                $('#monitoring-uptime-rate').text('0%');
                updateMonitoringCharts(0, 0, 0, 0);
                return;
            }
            
            let onlineCount = 0;
            let offlineCount = 0;
            let unknownCount = 0;
            
            customerMarkers.forEach(marker => {
                const status = marker.customerOnlineStatus;
                if (status === 'online') onlineCount++;
                else if (status === 'offline') offlineCount++;
                else unknownCount++;
            });
            
            const totalCount = customerMarkers.length;
            const uptimeRate = totalCount > 0 ? ((onlineCount / totalCount) * 100).toFixed(1) : 0;
            
            $('#monitoring-online-count').text(onlineCount);
            $('#monitoring-offline-count').text(offlineCount);
            $('#monitoring-total-count').text(totalCount);
            $('#monitoring-uptime-rate').text(uptimeRate + '%');
            
            // Update charts dengan debounce
            updateMonitoringCharts(onlineCount, offlineCount, totalCount, parseFloat(uptimeRate));
        }

        async function loadCustomerMarkers() {
            console.log("[loadCustomerMarkers] Memulai pemrosesan marker pelanggan (menggunakan data yang sudah ada)...");

            if (!allCustomerData || !Array.isArray(allCustomerData)) {
                console.error("[loadCustomerMarkers] allCustomerData tidak valid atau bukan array.");
                displayGlobalMapMessage("Data pelanggan tidak valid untuk diproses.", "danger", 0);
                allCustomerData = [];
            }

            if (allCustomerData.length === 0) {
                console.warn("[loadCustomerMarkers] Tidak ada data pelanggan untuk diproses.");
                return;
            }

            try {
                for (const customer of allCustomerData) {
                    if (customer.latitude != null && customer.longitude != null) {
                        let lat = parseFloat(customer.latitude);
                        let lng = parseFloat(customer.longitude);
                        if (isNaN(lat) || isNaN(lng)) { console.warn("Koordinat pelanggan tidak valid:", customer); continue; }

                        let onlineStatus = 'unknown';
                        let customerIpAddress = 'N/A';

                        if (customer.pppoe_username) {
                            if (activePppoeUsersMap.has(customer.pppoe_username)) {
                                onlineStatus = 'online';
                                customerIpAddress = activePppoeUsersMap.get(customer.pppoe_username);
                            } else {
                                onlineStatus = 'offline';
                                customerIpAddress = 'Offline';
                            }
                        } else {
                            onlineStatus = 'offline';
                        }

                        if (initialPppoeLoadFailed && customer.pppoe_username) {
                            onlineStatus = 'unknown';
                            customerIpAddress = 'Unknown';
                        }

                        const statusColor = onlineStatus === 'online' ? '#28a745' : (onlineStatus === 'offline' ? '#dc3545' : '#6c757d');

                        const statusIcon = onlineStatus === 'online' ? '<i class="fas fa-circle text-success"></i>' : 
                                          (onlineStatus === 'offline' ? '<i class="fas fa-circle text-danger"></i>' : 
                                          '<i class="fas fa-circle text-muted"></i>');
                        const statusBadge = onlineStatus === 'online' ? 
                            '<span class="badge badge-success badge-lg"><i class="fas fa-check-circle"></i> ONLINE</span>' : 
                            (onlineStatus === 'offline' ? 
                            '<span class="badge badge-danger badge-lg"><i class="fas fa-times-circle"></i> OFFLINE</span>' : 
                            '<span class="badge badge-secondary badge-lg"><i class="fas fa-question-circle"></i> UNKNOWN</span>');

                        let popupContent = `<div class="mb-3">
                            <h5 class="mb-2"><b>${customer.name || 'N/A'}</b></h5>
                            <div class="mb-2">${statusBadge}</div>
                        </div>
                        <hr>
                        <div class="mb-2">
                            <strong><i class="fas fa-id-card"></i> ID Pelanggan:</strong> ${customer.id}
                        </div>
                        ${customer.phone_number ? `<div class="mb-2"><strong><i class="fas fa-phone-alt"></i> No. HP:</strong> ${customer.phone_number}</div>` : ''}
                        ${customer.address ? `<div class="mb-2"><strong><i class="fas fa-map-marker-alt"></i> Alamat:</strong> ${customer.address}</div>` : ''}
                        <div class="mb-2"><strong><i class="fas fa-box"></i> Paket:</strong> ${customer.subscription || 'N/A'}</div>
                        <div class="mb-2">
                            <strong><i class="fas fa-money-bill-wave"></i> Status Bayar:</strong> 
                            ${customer.paid ? '<span class="badge badge-success">Lunas</span>' : '<span class="badge badge-danger">Belum Lunas</span>'}
                        </div>
                        <hr>
                        <div class="mb-2">
                            <strong><i class="fas fa-network-wired"></i> Status Koneksi:</strong>
                            <div class="mt-1 p-2 rounded" style="background-color: ${onlineStatus === 'online' ? '#d4edda' : (onlineStatus === 'offline' ? '#f8d7da' : '#e2e3e5')};">
                                <div class="d-flex align-items-center">
                                    ${statusIcon}
                                    <span class="ml-2" style="font-weight:bold; color:${statusColor};">${onlineStatus.toUpperCase()}</span>
                                </div>
                                ${customer.pppoe_username ? `<div class="mt-1"><small><strong>PPPoE User:</strong> ${customer.pppoe_username}</small></div>` : ''}
                                <div class="mt-1"><small><strong>IP Address:</strong> ${customerIpAddress}</small></div>
                            </div>
                        </div>`;

                        if (customer.device_id) {
                            popupContent += `<p>Redaman: <span id="redaman-val-${customer.id}">Memuat...</span></p>`;
                            popupContent += `<p>Tipe Modem: <span id="modem-type-${customer.id}">Memuat...</span></p>`;
                        } else {
                            popupContent += '<p>Redaman: <span class="text-muted">N/A (No Device ID)</span></p>';
                            popupContent += '<p>Tipe Modem: <span class="text-muted">N/A (No Device ID)</span></p>';
                        }

                        popupContent += `<p><small>Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}</small></p>`;
                        let odpDetailsHtml = '';
                        let odcDetailsHtml = '';

                        if (customer.connected_odp_id) {
                            const odpMarker = odpMarkers.find(m => String(m.assetData.id) === String(customer.connected_odp_id));
                            if (odpMarker && odpMarker.assetData) {
                                const odpAsset = odpMarker.assetData;
                                const connectedCustomersToThisOdp = allCustomerData.filter(cust => String(cust.connected_odp_id) === String(odpAsset.id));

                                odpDetailsHtml = `<p class="mt-2 pt-2 border-top"><strong><i class="fas fa-network-wired"></i> ODP Terhubung:</strong> ${odpAsset.name || `ID ${odpAsset.id}`}</p>`;

                                if (odpAsset.address) {
                                    odpDetailsHtml += `<p style="margin-left:15px; font-size:0.9em;">Alamat ODP: ${odpAsset.address}</p>`;
                                } else {
                                    odpDetailsHtml += `<p style="margin-left:15px; font-size:0.9em;">Alamat ODP: Tidak tersedia</p>`;
                                }
                                odpDetailsHtml += `<p style="margin-left:15px; font-size:0.9em;">Kapasitas ODP: ${odpAsset.capacity_ports || 'N/A'} Port</p>`;
                                odpDetailsHtml += `<p style="margin-left:15px; font-size:0.9em;">Port Terpakai ODP: ${connectedCustomersToThisOdp.length}</p>`;


                                if (odpAsset.latitude != null && odpAsset.longitude != null) {
                                    const custLatForDist = lat;
                                    const custLngForDist = lng;
                                    const odpAssetLatForDist = parseFloat(odpAsset.latitude);
                                    const odpAssetLngForDist = parseFloat(odpAsset.longitude);

                                    if (!isNaN(custLatForDist) && !isNaN(custLngForDist) && !isNaN(odpAssetLatForDist) && !isNaN(odpAssetLngForDist)) {
                                        const dist = haversineDistance(
                                            { latitude: custLatForDist, longitude: custLngForDist },
                                            { latitude: odpAssetLatForDist, longitude: odpAssetLngForDist }
                                        );
                                        if (!isNaN(dist)) {
                                            odpDetailsHtml += `<p style="margin-left:15px; font-size:0.9em;">Jarak ke ODP: ${dist.toFixed(0)} m</p>`;
                                        }
                                    }
                                }
                                // NEW LOGIC: Differentiate line types based on status dengan routing
                                // Get routing profile dari config (default: 'foot-walking' untuk Customer-ODP)
                                let routingProfile = 'foot-walking';
                                if (typeof window !== 'undefined' && window.globalConfig && window.globalConfig.openRouteService) {
                                    routingProfile = window.globalConfig.openRouteService.profiles?.customerToOdp || 'foot-walking';
                                }
                                
                                // PRIORITAS 1: Cek waypoint manual terlebih dahulu
                                let customerToOdpRouteCoordinates;
                                try {
                                    const waypointResponse = await fetch(`/api/map/waypoints?connectionType=customer-odp&sourceId=${customer.id}&targetId=${odpAsset.id}`, {
                                        credentials: 'include'
                                    });
                                    
                                    if (waypointResponse.ok) {
                                        const waypointData = await waypointResponse.json();
                                        if (waypointData.status === 200 && waypointData.data && waypointData.data.waypoints && waypointData.data.waypoints.length >= 2) {
                                            customerToOdpRouteCoordinates = waypointData.data.waypoints;
                                            console.log(`[WAYPOINTS_MANUAL] Customer-ODP: ${customer.name || customer.id} → ${odpAsset.name} (${customerToOdpRouteCoordinates.length} points manual)`);
                                        }
                                    }
                                } catch (waypointError) {
                                    console.warn(`[WAYPOINTS_ERROR] Customer-ODP: ${customer.name || customer.id} → ${odpAsset.name}:`, waypointError);
                                }
                                
                                // PRIORITAS 2: Jika tidak ada waypoint manual, gunakan routing API
                                if (!customerToOdpRouteCoordinates || customerToOdpRouteCoordinates.length < 2) {
                                    try {
                                        customerToOdpRouteCoordinates = await getRouteCoordinates(
                                            lat,
                                            lng,
                                            odpMarker.getLatLng().lat,
                                            odpMarker.getLatLng().lng,
                                            routingProfile
                                        );
                                        
                                        // Log jika routing berhasil (hanya untuk debugging, bisa di-disable)
                                        if (customerToOdpRouteCoordinates && customerToOdpRouteCoordinates.length > 2) {
                                            console.log(`[ROUTING_SUCCESS] Customer-ODP: ${customer.name || customer.id} → ${odpAsset.name} (${customerToOdpRouteCoordinates.length} points)`);
                                        } else {
                                            console.warn(`[ROUTING_FALLBACK] Customer-ODP: ${customer.name || customer.id} → ${odpAsset.name} (straight line, ${customerToOdpRouteCoordinates?.length || 0} points)`);
                                        }
                                    } catch (error) {
                                        console.error(`[ROUTING_ERROR] Customer-ODP: ${customer.name || customer.id} → ${odpAsset.name}:`, error);
                                        // Fallback ke straight line jika routing gagal
                                        customerToOdpRouteCoordinates = [
                                            [lat, lng],
                                            [odpMarker.getLatLng().lat, odpMarker.getLatLng().lng]
                                        ];
                                    }
                                }
                                
                                if (onlineStatus === 'online') {
                                    // Elegant multi-layer animated line untuk online customers
                                    // Base layer - subtle glow
                                    const baseGlow = L.polyline(customerToOdpRouteCoordinates, {
                                        color: '#28a745',
                                        weight: 5,
                                        opacity: 0.15,
                                        className: 'connection-line-glow'
                                    });
                                    baseGlow.connectedEntities = { customerId: customer.id, odpId: odpAsset.id };
                                    customerToOdpLines.push(baseGlow);
                                    // Attach waypoint editor to base glow
                                    attachWaypointEditorToLine(baseGlow, 'customer-odp', customer.id, odpAsset.id);
                                    
                                    // Main animated line - elegant and smooth
                                    const lineDots = L.polyline.antPath(customerToOdpRouteCoordinates, {
                                        color: '#28a745', // Green
                                        weight: 2.5,
                                        opacity: 0.8,
                                        delay: 7000, // Slow, elegant animation
                                        dashArray: [40, 60], // Long dashes for elegant look
                                        pulseColor: '#4ade80', // Soft green pulse (lighter)
                                        hardwareAccelerated: true
                                    });
                                    lineDots.connectedEntities = { customerId: customer.id, odpId: odpAsset.id };
                                    customerToOdpLines.push(lineDots);
                                    // Attach waypoint editor to main line
                                    attachWaypointEditorToLine(lineDots, 'customer-odp', customer.id, odpAsset.id);
                                } else {
                                    // For 'offline' or 'unknown' status - elegant subtle line
                                    let lineColor = (onlineStatus === 'offline') ? '#dc3545' : '#6c757d'; // Red for offline, grey for unknown
                                    let pulseColor = (onlineStatus === 'offline') ? '#f87171' : '#94a3b8'; // Soft red/grey pulse

                                    // Base layer - subtle shadow
                                    const baseShadow = L.polyline(customerToOdpRouteCoordinates, {
                                        color: lineColor,
                                        weight: 4,
                                        opacity: 0.1,
                                        className: 'connection-line-shadow'
                                    });
                                    baseShadow.connectedEntities = { customerId: customer.id, odpId: odpAsset.id };
                                    customerToOdpLines.push(baseShadow);
                                    
                                    // Attach waypoint editor to base shadow
                                    attachWaypointEditorToLine(baseShadow, 'customer-odp', customer.id, odpAsset.id);

                                    // Main animated line
                                    const offlineLine = L.polyline.antPath(customerToOdpRouteCoordinates, {
                                        color: lineColor,
                                        weight: 2.5,
                                        opacity: 0.6,
                                        delay: 8000, // Very slow, elegant animation
                                        dashArray: [45, 65], // Long dashes for elegant look
                                        pulseColor: pulseColor, // Soft pulse color
                                        hardwareAccelerated: true
                                    });
                                    offlineLine.connectedEntities = { customerId: customer.id, odpId: odpAsset.id };
                                    customerToOdpLines.push(offlineLine);
                                    
                                    // Attach waypoint editor to main line
                                    attachWaypointEditorToLine(offlineLine, 'customer-odp', customer.id, odpAsset.id);
                                }

                                if (odpAsset.parent_odc_id) {
                                    const parentOdc = allOdcData.find(o => String(o.id) === String(odpAsset.parent_odc_id));
                                    if (parentOdc) {
                                        odcDetailsHtml = `<p><strong><i class="fas fa-server"></i> Induk ODC:</strong> ${parentOdc.name || `ID ${parentOdc.id}`}</p>`;
                                        if (parentOdc.address) {
                                            odcDetailsHtml += `<p style="margin-left:15px; font-size:0.9em;">Alamat ODC: ${parentOdc.address}</p>`;
                                        } else {
                                             odcDetailsHtml += `<p style="margin-left:15px; font-size:0.9em;">Alamat ODC: Tidak tersedia</p>`;
                                        }
                                        odcDetailsHtml += `<p style="margin-left:15px; font-size:0.9em;">Kapasitas ODC: ${parentOdc.capacity_ports || 'N/A'} Port</p>`;
                                        odcDetailsHtml += `<p style="margin-left:15px; font-size:0.9em;">Port Terpakai ODC: ${parentOdc.ports_used || 0} (ODP)</p>`;
                                    } else {
                                        odcDetailsHtml = `<p><strong><i class="fas fa-server"></i> Induk ODC:</strong> ID ${odpAsset.parent_odc_id} (Detail tidak ditemukan atau ODC tidak difilter)</p>`;
                                    }
                                } else {
                                    odcDetailsHtml = `<p><strong><i class="fas fa-server"></i> Induk ODC:</strong> Tidak terhubung ke ODC.`;
                                }
                            } else {
                                odpDetailsHtml = `<p class="mt-2 pt-2 border-top"><strong><i class="fas fa-network-wired"></i> ODP Terhubung:</strong> ID ${customer.connected_odp_id} (Detail ODP tidak ditemukan/difilter)</p>`;
                            }
                        }
                        popupContent += odpDetailsHtml;
                        popupContent += odcDetailsHtml;

                        if (customer.device_id) {
                            popupContent += `<div class="mt-2"><button class="btn btn-sm btn-info btn-show-wifi-info" data-device-id="${customer.device_id}" data-customer-name="${customer.name||'Pelanggan'}"><i class="fas fa-wifi"></i> Detail Perangkat</button> ` +
                                            `<button class="btn btn-sm btn-warning btn-manage-wifi" data-device-id="${customer.device_id}" data-customer-name="${customer.name||'Pelanggan'}"><i class="fas fa-edit"></i> Kelola WiFi</button></div>`;
                        }
                        
                        const icon = createCustomerStatusIcon(onlineStatus); // Icon only, label is tooltip
                        const marker = L.marker([lat, lng], { icon: icon }).bindPopup(popupContent);
                        marker.customerData = JSON.parse(JSON.stringify(customer));
                        marker.customerOnlineStatus = onlineStatus;
                        marker.customerIpAddress = customerIpAddress;

                        // Bind tooltip for customer
                        let customerLabel = customer.pppoe_username || customer.name || `Cust. ID ${customer.id}`;
                        marker.bindTooltip(customerLabel, {
                            permanent: true, // Always show unless hidden by control
                            direction: 'top',
                            className: 'marker-label-tooltip', // Apply custom styling to tooltip
                            offset: [0, -ICON_HEIGHT/2 - 5] // Offset to position above icon
                        });
                        // Set initial visibility
                        if (!labelVisibility.customer) {
                            marker.getTooltip().setOpacity(0);
                        }

                        marker.on('popupopen', function(e) {
                            updateCustomerPopupDetails(e.target, e.target.customerData);
                        });

                        customerMarkers.push(marker);
                        
                        // Update monitoring statistics
                        updateConnectionMonitoring();
                        updateLegendCounters();
                    }
                }
            } catch(processingError) {
                console.error("[loadCustomerMarkers] Error processing customer data for markers:", processingError);
                displayGlobalMapMessage("Gagal memproses data pelanggan untuk ditampilkan di peta. Cek konsol.", "danger", 0);
                throw processingError;
            }
        }

        $(document).on('click', '.btn-edit-asset', function(e) {
            e.stopPropagation();
            const activePopup = map ? map._popup : null;
            if (activePopup && activePopup._source && activePopup._source.assetData) {
                const assetDataForModal = JSON.parse(JSON.stringify(activePopup._source.assetData));
                openAssetModal(assetDataForModal, null, null); 
                if (map) map.closePopup();
            }
        });

        $(document).on('click', '.btn-show-wifi-info', async function(e) {
            e.stopPropagation();
            if (map && map._popup && map._popup.isOpen()) map.closePopup();

            const deviceId = $(this).data('device-id');
            let customerName = $(this).data('customer-name') || "Pelanggan";
            const popupContentElement = $(this).closest('.leaflet-popup-content');
            if (popupContentElement.length > 0) {
                const nameFromPopup = popupContentElement.find('b').first().text().replace('Pelanggan: ','').trim();
                if (nameFromPopup && nameFromPopup !== 'N/A') customerName = nameFromPopup;
            }

            $('#wifiInfoModalLabel').text(`Detail Perangkat & WiFi untuk ${customerName}`);
            const modalBody = $('#wifiInfoModalBody');
            modalBody.html('<p class="text-center my-3"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Memuat informasi...</p>');
            $('#wifiInfoModal').modal('show');

            let deviceDetailsContent = '';
            if (deviceId) {
                try {
                    const response = await fetch('/api/device-details/${deviceId}?_=${new Date().getTime()}', { credentials: 'include' });
                    if (!response.ok) {
                         console.warn(`Gagal mengambil detail perangkat untuk modal (${deviceId}): ${response.status}`);
                         deviceDetailsContent += `<p class="mb-1"><strong><i class="fas fa-microchip"></i> Tipe Modem:</strong> Tidak tersedia (Server Error)</p>`;
                    } else {
                        const result = await response.json();
                        if (result.data && result.data.modemType) {
                            deviceDetailsContent += `<p class="mb-1"><strong><i class="fas fa-microchip"></i> Tipe Modem:</strong> ${result.data.modemType}</p>`;
                        } else {
                            deviceDetailsContent += `<p class="mb-1"><strong><i class="fas fa-microchip"></i> Tipe Modem:</strong> Tidak terdeteksi/N/A</p>`;
                        }
                    }
                } catch (devError) {
                    console.error("Error fetching device details for modal:", devError);
                    deviceDetailsContent += `<p class="mb-1"><strong><i class="fas fa-microchip"></i> Tipe Modem:</strong> Error saat memuat</p>`;
                }
            } else {
                 deviceDetailsContent += `<p class="mb-1"><strong><i class="fas fa-microchip"></i> Tipe Modem:</strong> N/A (No Device ID)</p>`;
            }


            try {
                const response = await fetch('/api/customer-wifi-info/${deviceId}?_=${new Date().getTime()}', { credentials: 'include' });
                const result = await response.json();
                if (!response.ok || result.status !== 200) throw new Error(result.message || `Gagal ambil info WiFi (HTTP ${response.status})`);

                if (result.data && Array.isArray(result.data.ssid)) {
                    let content = deviceDetailsContent;
                    content += `<p class="mb-2"><strong><i class="fas fa-clock"></i> Uptime Modem (dari WiFi API):</strong> ${result.data.uptime || 'N/A'}</p><hr class="mt-1 mb-3">`;
                    if (result.data.ssid.length > 0) {
                        content += `<h5><i class="fas fa-wifi"></i> Daftar SSID</h6>`;
                        result.data.ssid.forEach(s => {
                            if (!s || typeof s !== 'object') return;
                            content += `<div class="card mb-3 shadow-sm"><div class="card-header py-2"><strong>SSID ${s.id||'N/A'}: <span class="text-primary font-weight-bold">${s.name||'N/A'}</span></strong></div>`+
                                       `<div class="card-body py-2 px-3"><p class="mb-1 small"><strong>Transmit Power:</strong> ${s.transmitPower != null ? s.transmitPower + '%' : 'N/A'}</p>`;
                            if (s.associatedDevices && s.associatedDevices.length > 0) {
                                content += `<p class="mb-1 small mt-2"><strong><i class="fas fa-users"></i> Perangkat Terhubung (${s.associatedDevices.length}):</strong></p><ul class="list-group list-group-flush device-list small">`;
                                s.associatedDevices.forEach(dev => {
                                     if (!dev || typeof dev !== 'object') return;
                                    content += `<li class="list-group-item py-1 px-0">${dev.hostName||'Tanpa Nama'} <br><small class="text-muted" style="font-size:0.9em;">(MAC: ${dev.mac||'-'}, IP: ${dev.ip||'-'}, Sinyal: ${dev.signal ? dev.signal+' dBm':'-'})</small></li>`;
                                });
                                content += `</ul>`;
                            } else content += `<p class="mb-1 small mt-2"><em>Tidak ada perangkat terhubung.</em></p>`;
                            content += `</div></div>`;
                        });
                    } else content += '<p class="text-muted">Tidak ada SSID aktif ditemukan.</p>';
                    modalBody.html(content);
                } else modalBody.html(deviceDetailsContent + '<p class="text-danger">Format data API WiFi tidak sesuai.</p>');
            } catch (error) {
                modalBody.html(deviceDetailsContent + `<p class="text-danger"><strong>Error memuat info WiFi:</strong> ${error.message}</p>`);
            }
        });

        $(document).on('click', '.btn-manage-wifi', async function(e) {
            e.stopPropagation();
            if (map && map._popup) map.closePopup();

            const deviceId = $(this).data('device-id');
            let customerName = $(this).data('customer-name') || "Pelanggan";
             const popupContentElement = $(this).closest('.leaflet-popup-content');
             if (popupContentElement.length > 0) {
                const nameFromPopup = popupContentElement.find('b').first().text().replace('Pelanggan: ','').trim();
                if (nameFromPopup && nameFromPopup !== 'N/A') customerName = nameFromPopup;
             }

            $('#wifi_manage_device_id').val(deviceId);
            $('#wifi_manage_customer_name').val(customerName);
            $('#wifiManagementModalLabel').text(`Kelola WiFi untuk ${customerName}`);
            const formContainer = $('#wifiManagementFormContainer');
            formContainer.html('<p class="text-center my-3"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Memuat...</p>');
            $('#wifi_manage_transmit_power').val('');
            $('#wifiManagementModal').modal('show');

            try {
                const response = await fetch('/api/customer-wifi-info/${deviceId}?_=${new Date().getTime()}', { credentials: 'include' });
                const result = await response.json();
                if (!response.ok || result.status !== 200 ) throw new Error(result.message || `Gagal ambil data SSID (HTTP ${response.status})`);

                if (result.data && result.data.ssid && Array.isArray(result.data.ssid)) {
                    let formContent = '';
                    if (result.data.ssid.length > 0) {
                        result.data.ssid.forEach(s => {
                            if(!s || typeof s !== 'object') return;
                            formContent += `<div class="card card-body mb-2 p-2 shadow-sm">
                                <p class="mb-1"><strong>SSID ID: ${s.id} (Nama: <span class="text-info font-weight-bold">${s.name||'N/A'}</span>)</strong></p>
                                <div class="form-group mb-2"><label for="wifi_manage_ssid_name_${s.id}" class="form-label mb-0">Nama SSID Baru</label><input type="text" class="form-control form-control-sm" id="wifi_manage_ssid_name_${s.id}" name="ssid_${s.id}" placeholder="Kosong jika tidak diubah"></div>
                                <div class="form-group mb-1"><label for="wifi_manage_ssid_password_${s.id}" class="form-label mb-0">Password Baru</label><input type="password" class="form-control form-control-sm" id="wifi_manage_ssid_password_${s.id}" name="ssid_password_${s.id}" placeholder="Min. 8 karakter, kosong jika tidak diubah"></div>
                                </div>`;
                        });
                    } else formContent = '<p class="text-muted">Tidak ada SSID terkonfigurasi.</p>';
                    formContainer.html(formContent);
                    if(result.data.ssid.length > 0 && result.data.ssid[0].transmitPower != null) {
                        $('#wifi_manage_transmit_power').val(result.data.ssid[0].transmitPower);
                    }
                } else formContainer.html('<p class="text-danger">Format data API tidak sesuai.</p>');
            } catch (error) {
                formContainer.html(`<p class="text-danger">Error: ${error.message}</p>`);
            }
        });

        $('#wifiManagementForm').on('submit', async function(event) {
            event.preventDefault();
            const deviceId = $('#wifi_manage_device_id').val();
            const customerName = $('#wifi_manage_customer_name').val();
            const formData = new FormData(this);
            const dataToSend = {};
            let hasChanges = false;
            formData.forEach((value, key) => {
                if (value && value.trim() !== '') {
                    dataToSend[key] = value.trim();
                    if (!['device_id_for_wifi_manage', 'customer_name_for_wifi_manage'].includes(key)) hasChanges = true;
                }
            });
            delete dataToSend.device_id_for_wifi_manage;
            delete dataToSend.customer_name_for_wifi_manage;

            if (!hasChanges) {
                displayGlobalMapMessage('Tidak ada perubahan dimasukkan.', 'info');
                $('#wifiManagementModal').modal('hide'); return;
            }

            const saveButton = $('#saveWifiManagementBtn');
            const originalButtonText = saveButton.html();
            saveButton.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Menyimpan...');

            try {
                const response = await fetch(`/api/ssid/${deviceId}`, { 
                    method: 'POST', 
                    headers: {'Content-Type':'application/json'}, 
                    credentials: 'include',
                    body: JSON.stringify(dataToSend) 
                });
                const result = await response.json();
                if (response.ok && result.status === 200) {
                    displayGlobalMapMessage(`Perubahan WiFi untuk ${customerName} berhasil dikirim.`, 'success');
                    $('#wifiManagementModal').modal('hide');
                } else displayGlobalMapMessage(`Gagal simpan: ${result.message || `Status ${response.status}`}`, 'danger');
            } catch (error) {
                displayGlobalMapMessage(`Error koneksi: ${error.message}`, 'danger');
            } finally {
                saveButton.prop('disabled', false).html(originalButtonText);
            }
        });


        // Map Sidebar Variables
        let sidebarSearchTimeout = null;
        let sidebarAlerts = [];
        
        // Advanced Legend Variables
        let advancedLegendControl = null;
        let legendMinimap = null;
        let legendCounters = {
            odc: 0,
            odp: 0,
            online: 0,
            offline: 0,
            unknown: 0
        };
        
        // Alert System Variables
        let alertSystem = null;
        let activeAlerts = [];
        let alertSoundEnabled = false;
        
        // Quick Filter Variables
        let currentQuickFilter = 'all';
        
        // Map Sidebar Functions
        function toggleMapSidebar() {
            const sidebar = document.getElementById('mapSidebar');
            const overlay = document.getElementById('mapSidebarOverlay');
            
            if (sidebar.classList.contains('open')) {
                sidebar.classList.remove('open');
                if (overlay) overlay.classList.remove('active');
            } else {
                sidebar.classList.add('open');
                if (overlay) overlay.classList.add('active');
                updateQuickStats();
            }
        }
        
        function updateQuickStats() {
            const odcCount = allNetworkAssetsData.filter(a => a.type === 'ODC').length;
            const odpCount = allNetworkAssetsData.filter(a => a.type === 'ODP').length;
            const customerCount = allCustomerData.length;
            
            $('#sidebar-odc-count').text(odcCount);
            $('#sidebar-odp-count').text(odpCount);
            $('#sidebar-customer-count').text(customerCount);
        }
        
        function performSidebarSearch(query) {
            if (!query || query.trim().length < 2) {
                $('#sidebarSearchResults').hide().empty();
                return;
            }
            
            const searchTerm = query.toLowerCase().trim();
            const results = [];
            
            // Search customers
            allCustomerData.forEach(customer => {
                const name = (customer.name || '').toLowerCase();
                const phone = (customer.phone_number || '').toLowerCase();
                const address = (customer.address || '').toLowerCase();
                
                if (name.includes(searchTerm) || phone.includes(searchTerm) || address.includes(searchTerm)) {
                    results.push({
                        type: 'customer',
                        id: customer.id,
                        name: customer.name || 'N/A',
                        phone: customer.phone_number || 'N/A',
                        data: customer
                    });
                }
            });
            
            // Search network assets
            allNetworkAssetsData.forEach(asset => {
                const name = (asset.name || '').toLowerCase();
                const address = (asset.address || '').toLowerCase();
                
                if (name.includes(searchTerm) || address.includes(searchTerm)) {
                    results.push({
                        type: asset.type.toLowerCase(),
                        id: asset.id,
                        name: asset.name || 'N/A',
                        address: asset.address || 'N/A',
                        data: asset
                    });
                }
            });
            
            // Display results
            const resultsContainer = $('#sidebarSearchResults');
            resultsContainer.empty();
            
            if (results.length === 0) {
                resultsContainer.html('<div class="search-result-item text-muted p-2">Tidak ada hasil ditemukan</div>');
            } else {
                results.slice(0, 10).forEach(result => {
                    const icon = result.type === 'customer' ? 'fa-user' : 
                                result.type === 'odc' ? 'fa-server' : 'fa-network-wired';
                    const color = result.type === 'customer' ? 'text-primary' : 
                                 result.type === 'odc' ? 'text-purple' : 'text-orange';
                    
                    const item = $(`
                        <div class="search-result-item" data-type="${result.type}" data-id="${result.id}">
                            <i class="fas ${icon} ${color}"></i>
                            <strong>${result.name}</strong>
                            <small class="text-muted d-block">${result.type === 'customer' ? result.phone : result.address}</small>
                        </div>
                    `);
                    
                    item.on('click', function() {
                        handleSearchResultClick(result);
                    });
                    
                    resultsContainer.append(item);
                });
            }
            
            resultsContainer.show();
        }
        
        function handleSearchResultClick(result) {
            if (result.type === 'customer' && map) {
                // Find customer marker and open popup
                const marker = customerMarkers.find(m => m.customerData && m.customerData.id === result.id);
                if (marker) {
                    map.setView([marker.getLatLng().lat, marker.getLatLng().lng], 18);
                    marker.openPopup();
                }
            } else if ((result.type === 'odc' || result.type === 'odp') && map) {
                // Find asset marker and open popup
                const allAssetMarkers = [...odcMarkers, ...odpMarkers];
                const marker = allAssetMarkers.find(m => m.assetData && m.assetData.id === result.id);
                if (marker) {
                    map.setView([marker.getLatLng().lat, marker.getLatLng().lng], 18);
                    marker.openPopup();
                }
            }
            
            // Close sidebar on mobile
            if (window.innerWidth <= 768) {
                toggleMapSidebar();
            }
        }
        
        function applySidebarFilters() {
            const showOnline = $('#sidebarFilterOnline').is(':checked');
            const showOffline = $('#sidebarFilterOffline').is(':checked');
            const showOdc = $('#sidebarFilterOdc').is(':checked');
            const showOdp = $('#sidebarFilterOdp').is(':checked');
            
            // Update selected sets based on filters
            if (!showOdc) {
                selectedOdcIds.clear();
            } else {
                allNetworkAssetsData.filter(a => a.type === 'ODC').forEach(a => {
                    selectedOdcIds.add(String(a.id));
                });
            }
            
            if (!showOdp) {
                selectedOdpIds.clear();
            } else {
                allNetworkAssetsData.filter(a => a.type === 'ODP').forEach(a => {
                    selectedOdpIds.add(String(a.id));
                });
            }
            
            // Filter customers by online/offline status
            if (!showOnline || !showOffline) {
                selectedCustomerIds.clear();
                customerMarkers.forEach(marker => {
                    const status = marker.customerOnlineStatus;
                    if ((showOnline && status === 'online') || (showOffline && status === 'offline')) {
                        selectedCustomerIds.add(String(marker.customerData.id));
                    }
                });
            } else {
                allCustomerData.forEach(c => selectedCustomerIds.add(String(c.id)));
            }
            
            // Apply filters
            applyFilters();
            updateConnectionMonitoring();
        }
        
        function updateSidebarAlerts() {
            const alertsList = $('#sidebarAlertsList');
            alertsList.empty();
            
            if (sidebarAlerts.length === 0) {
                alertsList.html('<div class="alert-item alert-info"><i class="fas fa-info-circle"></i><span>Belum ada alert</span></div>');
                return;
            }
            
            sidebarAlerts.slice(0, 5).forEach(alert => {
                const alertClass = alert.severity === 'critical' ? 'alert-danger' :
                                  alert.severity === 'warning' ? 'alert-warning' :
                                  alert.severity === 'info' ? 'alert-info' : 'alert-success';
                
                const item = $(`
                    <div class="alert-item ${alertClass}">
                        <i class="fas ${alert.icon || 'fa-exclamation-circle'}"></i>
                        <div>
                            <strong>${alert.title}</strong>
                            <small class="d-block">${alert.message}</small>
                        </div>
                    </div>
                `);
                
                alertsList.append(item);
            });
        }
        
        function exportCustomers() {
            try {
                const csv = ['ID,Nama,No HP,Alamat,Status,PPPoE Username'];
                allCustomerData.forEach(customer => {
                    const status = customerMarkers.find(m => m.customerData && m.customerData.id === customer.id)?.customerOnlineStatus || 'unknown';
                    csv.push([
                        customer.id,
                        customer.name || '',
                        customer.phone_number || '',
                        (customer.address || '').replace(/,/g, ';'),
                        status,
                        customer.pppoe_username || ''
                    ].join(','));
                });
                
                const blob = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = `pelanggan_${new Date().toISOString().split('T')[0]}.csv`;
                link.click();
                
                displayGlobalMapMessage('Export pelanggan berhasil!', 'success');
            } catch (error) {
                console.error('Export error:', error);
                displayGlobalMapMessage('Gagal export pelanggan', 'danger');
            }
        }
        
        function exportAssets() {
            try {
                const csv = ['ID,Tipe,Nama,Alamat,Latitude,Longitude'];
                allNetworkAssetsData.forEach(asset => {
                    csv.push([
                        asset.id,
                        asset.type,
                        asset.name || '',
                        (asset.address || '').replace(/,/g, ';'),
                        asset.latitude || '',
                        asset.longitude || ''
                    ].join(','));
                });
                
                const blob = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = `aset_jaringan_${new Date().toISOString().split('T')[0]}.csv`;
                link.click();
                
                displayGlobalMapMessage('Export aset berhasil!', 'success');
            } catch (error) {
                console.error('Export error:', error);
                displayGlobalMapMessage('Gagal export aset', 'danger');
            }
        }
        
        function exportMap() {
            if (!map) {
                displayGlobalMapMessage('Peta belum siap', 'warning');
                return;
            }
            
            try {
                map.once('rendercomplete', function() {
                    html2canvas(document.getElementById('interactiveMap'), {
                        useCORS: true,
                        logging: false
                    }).then(canvas => {
                        canvas.toBlob(function(blob) {
                            const link = document.createElement('a');
                            link.href = URL.createObjectURL(blob);
                            link.download = `peta_jaringan_${new Date().toISOString().split('T')[0]}.png`;
                            link.click();
                            displayGlobalMapMessage('Export peta berhasil!', 'success');
                        }, 'image/png');
                    });
                });
                
                map.fire('rendercomplete');
            } catch (error) {
                console.error('Export map error:', error);
                displayGlobalMapMessage('Gagal export peta. Pastikan html2canvas tersedia.', 'danger');
            }
        }
        
        // Alert System Class
        class AlertSystem {
            constructor() {
                this.activeAlerts = [];
                this.toastContainer = document.getElementById('toastNotificationsContainer');
                this.alertPanel = document.getElementById('alertPanel');
                this.alertPanelContent = document.getElementById('alertPanelContent');
                this.alertBadge = document.getElementById('alertBadge');
                this.soundEnabled = false;
            }
            
            showToast(alert) {
                const toast = document.createElement('div');
                toast.className = `toast-notification toast-${alert.severity}`;
                
                const iconMap = {
                    'critical': 'fa-exclamation-circle',
                    'warning': 'fa-exclamation-triangle',
                    'info': 'fa-info-circle',
                    'success': 'fa-check-circle'
                };
                
                toast.innerHTML = `
                    <i class="fas ${iconMap[alert.severity] || 'fa-info-circle'} toast-icon toast-${alert.severity}"></i>
                    <div class="toast-content">
                        <div class="toast-title">${alert.title}</div>
                        <p class="toast-message">${alert.message}</p>
                    </div>
                    <button class="toast-close" onclick="this.parentElement.remove()">
                        <i class="fas fa-times"></i>
                    </button>
                `;
                
                this.toastContainer.appendChild(toast);
                
                // Auto-dismiss untuk non-critical alerts
                if (alert.severity !== 'critical') {
                    setTimeout(() => {
                        toast.classList.add('removing');
                        setTimeout(() => toast.remove(), 300);
                    }, alert.duration || 5000);
                }
                
                // Play sound untuk critical alerts
                if (alert.severity === 'critical' && this.soundEnabled) {
                    this.playAlertSound();
                }
            }
            
            addAlert(alert) {
                const alertId = alert.id || `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                const newAlert = {
                    id: alertId,
                    title: alert.title || 'Alert',
                    message: alert.message || '',
                    severity: alert.severity || 'info',
                    timestamp: new Date(),
                    acknowledged: false,
                    duration: alert.duration || 5000
                };
                
                // Check if alert already exists
                const existingIndex = this.activeAlerts.findIndex(a => a.id === alertId);
                if (existingIndex >= 0) {
                    this.activeAlerts[existingIndex] = newAlert;
                } else {
                    this.activeAlerts.push(newAlert);
                }
                
                // Show toast
                this.showToast(newAlert);
                
                // Update alert panel
                this.updateAlertPanel();
                
                // Update badge
                this.updateBadge();
                
                return alertId;
            }
            
            acknowledgeAlert(alertId) {
                const alert = this.activeAlerts.find(a => a.id === alertId);
                if (alert) {
                    alert.acknowledged = true;
                    this.removeAlert(alertId);
                }
            }
            
            removeAlert(alertId) {
                this.activeAlerts = this.activeAlerts.filter(a => a.id !== alertId);
                this.updateAlertPanel();
                this.updateBadge();
            }
            
            updateAlertPanel() {
                const unacknowledgedAlerts = this.activeAlerts.filter(a => !a.acknowledged);
                
                if (unacknowledgedAlerts.length === 0) {
                    this.alertPanelContent.innerHTML = `
                        <div class="alert-panel-empty">
                            <i class="fas fa-check-circle text-success"></i>
                            <p>Tidak ada alert aktif</p>
                        </div>
                    `;
                    return;
                }
                
                this.alertPanelContent.innerHTML = unacknowledgedAlerts.map(alert => {
                    const severityLabels = {
                        'critical': 'Critical',
                        'warning': 'Warning',
                        'info': 'Info',
                        'success': 'Success'
                    };
                    
                    const timeAgo = this.getTimeAgo(alert.timestamp);
                    
                    return `
                        <div class="alert-panel-item alert-${alert.severity}">
                            <div class="alert-panel-item-header">
                                <div class="alert-panel-item-title">${alert.title}</div>
                                <span class="alert-panel-item-severity severity-${alert.severity}">
                                    ${severityLabels[alert.severity] || 'Info'}
                                </span>
                            </div>
                            <div class="alert-panel-item-message">${alert.message}</div>
                            <div class="alert-panel-item-time">${timeAgo}</div>
                            <div class="alert-panel-item-actions">
                                <button class="btn btn-sm btn-primary" onclick="alertSystem.acknowledgeAlert('${alert.id}')">
                                    <i class="fas fa-check"></i> Acknowledge
                                </button>
                                <button class="btn btn-sm btn-secondary" onclick="alertSystem.removeAlert('${alert.id}')">
                                    <i class="fas fa-times"></i> Dismiss
                                </button>
                            </div>
                        </div>
                    `;
                }).join('');
            }
            
            updateBadge() {
                const unacknowledgedCount = this.activeAlerts.filter(a => !a.acknowledged).length;
                if (unacknowledgedCount > 0) {
                    this.alertBadge.textContent = unacknowledgedCount;
                    this.alertBadge.style.display = 'flex';
                } else {
                    this.alertBadge.style.display = 'none';
                }
            }
            
            getTimeAgo(timestamp) {
                const now = new Date();
                const diff = now - timestamp;
                const seconds = Math.floor(diff / 1000);
                const minutes = Math.floor(seconds / 60);
                const hours = Math.floor(minutes / 60);
                
                if (seconds < 60) return `${seconds} detik yang lalu`;
                if (minutes < 60) return `${minutes} menit yang lalu`;
                if (hours < 24) return `${hours} jam yang lalu`;
                return timestamp.toLocaleString('id-ID');
            }
            
            playAlertSound() {
                // Create audio context untuk sound alert (optional)
                try {
                    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    const oscillator = audioContext.createOscillator();
                    const gainNode = audioContext.createGain();
                    
                    oscillator.connect(gainNode);
                    gainNode.connect(audioContext.destination);
                    
                    oscillator.frequency.value = 800;
                    oscillator.type = 'sine';
                    
                    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
                    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
                    
                    oscillator.start(audioContext.currentTime);
                    oscillator.stop(audioContext.currentTime + 0.5);
                } catch (error) {
                    console.warn('Sound alert tidak didukung:', error);
                }
            }
            
            enableSound() {
                this.soundEnabled = true;
            }
            
            disableSound() {
                this.soundEnabled = false;
            }
        }

        document.addEventListener('DOMContentLoaded', function() {
            console.log("[DOMReady] DOM fully loaded. Initializing application...");
            
            // Start with sidebar collapsed for more map space on desktop
            if (window.innerWidth >= 768) {
                $('body').addClass('sidebar-toggled');
                $('.sidebar').addClass('toggled');
            }
            
            try {
                initializeMap();
            } catch(e) {
                console.error("[DOMReady] FATAL ERROR during initializeMap:", e);
                 $('#interactiveMap').html('<div class="alert alert-danger text-center"><strong>Peta Gagal Dimuat!</strong> Error kritis. Cek konsol.</div>');
            }

            $('#manualFullscreenBtn').on('click', toggleFullScreenManual);
            
            // Map Sidebar Event Handlers
            $('#openMapSidebarBtn').on('click', toggleMapSidebar);
            $('#toggleMapSidebar').on('click', toggleMapSidebar);
            $('#mapSidebarOverlay').on('click', toggleMapSidebar);
            
            // Search functionality
            $('#sidebarSearchInput').on('input', function() {
                const query = $(this).val();
                if (sidebarSearchTimeout) clearTimeout(sidebarSearchTimeout);
                sidebarSearchTimeout = setTimeout(() => {
                    performSidebarSearch(query);
                }, 300);
            });
            
            $('#sidebarSearchBtn').on('click', function() {
                performSidebarSearch($('#sidebarSearchInput').val());
            });
            
            // Quick filters
            $('#sidebarFilterOnline, #sidebarFilterOffline, #sidebarFilterOdc, #sidebarFilterOdp').on('change', function() {
                applySidebarFilters();
            });
            
            // Export buttons
            $('#exportCustomersBtn').on('click', exportCustomers);
            $('#exportAssetsBtn').on('click', exportAssets);
            $('#exportMapBtn').on('click', exportMap);
            
            // Initialize alerts
            updateSidebarAlerts();
            
            // Initialize Alert System
            alertSystem = new AlertSystem();
            
            // Quick Filter Buttons Event Handlers
            $('.quick-filter-btn').on('click', function() {
                const filter = $(this).data('filter');
                applyQuickFilter(filter);
            });
            
            $('#resetQuickFilterBtn').on('click', function() {
                applyQuickFilter('all');
            });
            
            // Alert Panel Event Handlers
            $('#openAlertPanelBtn').on('click', function() {
                $('#alertPanel').addClass('open');
                $(this).hide();
            });
            
            $('#closeAlertPanel').on('click', function() {
                $('#alertPanel').removeClass('open');
                $('#openAlertPanelBtn').show();
            });
            
            $('#toggleAlertPanel').on('click', function() {
                $('#alertPanel').toggleClass('minimized');
                const icon = $(this).find('i');
                if ($('#alertPanel').hasClass('minimized')) {
                    icon.removeClass('fa-minus').addClass('fa-plus');
                } else {
                    icon.removeClass('fa-plus').addClass('fa-minus');
                }
            });
            
            // Example: Test alerts (can be removed in production)
            // Uncomment to test alert system
            /*
            setTimeout(() => {
                alertSystem.addAlert({
                    title: 'Pelanggan Offline',
                    message: '5 pelanggan terdeteksi offline',
                    severity: 'warning'
                });
            }, 3000);
            
            setTimeout(() => {
                alertSystem.addAlert({
                    title: 'Koneksi Gagal',
                    message: 'Gagal mengambil data dari MikroTik',
                    severity: 'critical'
                });
            }, 5000);
            */
            
            // Monitor untuk auto-generate alerts (contoh: banyak pelanggan offline)
            setInterval(() => {
                if (alertSystem && customerMarkers && customerMarkers.length > 0) {
                    const offlineCount = customerMarkers.filter(m => m.customerOnlineStatus === 'offline').length;
                    const totalCount = customerMarkers.length;
                    const offlinePercentage = (offlineCount / totalCount) * 100;
                    
                    // Alert jika > 20% pelanggan offline
                    if (offlinePercentage > 20 && offlineCount > 5) {
                        const existingAlert = alertSystem.activeAlerts.find(a => a.id === 'high-offline-alert');
                        if (!existingAlert) {
                            alertSystem.addAlert({
                                id: 'high-offline-alert',
                                title: 'Tingkat Offline Tinggi',
                                message: `${offlineCount} dari ${totalCount} pelanggan offline (${offlinePercentage.toFixed(1)}%)`,
                                severity: 'warning',
                                duration: 10000
                            });
                        }
                    }
                }
            }, 60000); // Check setiap 1 menit

            $('#yesAddOdpBtn').on('click', async function() {
                const parentOdcId = this.getAttribute('data-odc-id');
                const lat = parseFloat(this.getAttribute('data-lat'));
                const lng = parseFloat(this.getAttribute('data-lng'));
                $('#addOdpAfterOdcModal').modal('hide');
                openAssetModal(null, lat, lng); 
                setTimeout(() => {
                    $('#assetType').val('ODP').trigger('change');
                    setTimeout(() => { 
                        $('#assetParentOdc').val(parentOdcId).trigger('change.select2');
                        $('#useParentOdcLocation').prop('checked', true).trigger('change');
                        const parentOdcAsset = allNetworkAssetsData.find(odc => odc.type === 'ODC' && odc.id == parentOdcId);
                        const parentOdcName = parentOdcAsset ? parentOdcAsset.name : `ODC-${parentOdcId}`;
                        const existingOdps = allNetworkAssetsData.filter(a => a.type === 'ODP' && a.parent_odc_id == parentOdcId &&
                                                Math.abs(parseFloat(a.latitude) - lat) < 0.00001 && Math.abs(parseFloat(a.longitude) - lng) < 0.00001).length;
                        $('#assetName').val(`${parentOdcName} - ODP ${String(existingOdps + 1).padStart(2, '0')}`).focus();
                    }, 150);
                }, 50);
            });

            $('#noAddOdpBtn').on('click', () => {
                $('#addOdpAfterOdcModal').modal('hide');
                displayGlobalMapMessage('ODC berhasil disimpan.', 'success');
            });
            
            
            $('#refreshAllDataBtn').on('click', async function() {
                if (!map) { displayGlobalMapMessage("Peta belum siap.", "warning"); return; }
                const button = $(this);
                const originalHtml = button.html();
                button.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Refreshing...');

                await loadAllMapData();
                updateConnectionMonitoring(); // Update monitoring setelah refresh

                let msg = `Refresh data selesai.`;
                 if (initialPppoeLoadFailed) {
                    msg = `Refresh selesai, namun pengambilan status PPPoE gagal.`;
                    displayGlobalMapMessage(msg, "warning", 10000);
                } else {
                    displayGlobalMapMessage(msg, "success", 7000);
                }

                button.prop('disabled', false).html(originalHtml);
            });

            const AUTO_REFRESH_INTERVAL_MS = 30000; // 30 detik
            $('#autoRefreshToggle').on('change', function() {
                if ($(this).is(':checked')) {
                    if (autoRefreshIntervalId) clearInterval(autoRefreshIntervalId);

                    const runAutoRefresh = async () => {
                        console.log(`[AutoRefresh] Running automatic data refresh at ${new Date().toLocaleTimeString()}`);
                        const refreshBtn = $('#refreshAllDataBtn');
                        if (refreshBtn.prop('disabled')) {
                            console.log('[AutoRefresh] Skipping as a manual refresh is already in progress.');
                            return;
                        }
                        
                        await loadAllMapData();
                        updateConnectionMonitoring(); // Update monitoring setelah refresh 
                        console.log('[AutoRefresh] Automatic data refresh finished.');
                    };

                    runAutoRefresh();
                    autoRefreshIntervalId = setInterval(runAutoRefresh, AUTO_REFRESH_INTERVAL_MS);
                    
                    const label = $(this).next('label');
                    displayGlobalMapMessage(`Auto refresh diaktifkan setiap ${AUTO_REFRESH_INTERVAL_MS / 1000} detik.`, 'info', 5000);
                    label.attr('title', `Nonaktifkan refresh data otomatis (interval ${AUTO_REFRESH_INTERVAL_MS / 1000} detik)`);

                } else {
                    if (autoRefreshIntervalId) {
                        clearInterval(autoRefreshIntervalId);
                        autoRefreshIntervalId = null;
                        console.log('[AutoRefresh] Stopped.');
                        displayGlobalMapMessage('Auto refresh dinonaktifkan.', 'info', 5000);
                        $(this).next('label').attr('title', 'Aktifkan refresh data otomatis setiap 30 detik');
                    }
                }
            });

            console.log("[DOMReady] Event listeners and page setup complete.");
        });
        
        // ============================================
        // Waypoint Editor Functions
        // ============================================
        
        /**
         * Start editing waypoints for a connection
         */
        function startWaypointEditor(connectionType, sourceId, targetId) {
            if (!waypointEditorMode) {
                displayGlobalMapMessage('Aktifkan mode Edit Waypoint terlebih dahulu.', 'warning', 3000);
                return;
            }
            
            currentEditingConnection = { connectionType, sourceId, targetId };
            
            // Load existing waypoints
            loadWaypointsForEditing(connectionType, sourceId, targetId);
            
            // Enable map click untuk add waypoint
            map.on('click', onMapClickAddWaypoint);
            
            displayGlobalMapMessage(`Edit waypoint: ${connectionType} (${sourceId} → ${targetId}). Klik di map untuk tambah waypoint.`, 'info', 5000);
            
            // Update controls
            updateWaypointEditorControls();
        }
        
        /**
         * Load waypoints for editing
         */
        async function loadWaypointsForEditing(connectionType, sourceId, targetId) {
            try {
                const response = await fetch(`/api/map/waypoints?connectionType=${connectionType}&sourceId=${sourceId}&targetId=${targetId}`, {
                    credentials: 'include'
                });
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.status === 200 && data.data && data.data.waypoints) {
                        // Clear existing waypoints
                        clearWaypointMarkers();
                        
                        // Add waypoint markers
                        data.data.waypoints.forEach((waypoint, index) => {
                            addWaypointMarker(waypoint[0], waypoint[1], index);
                        });
                    } else {
                        // No waypoints yet, create default (start and end points)
                        const startPoint = getStartPoint(connectionType, sourceId);
                        const endPoint = getEndPoint(connectionType, targetId);
                        
                        if (startPoint && endPoint) {
                            clearWaypointMarkers();
                            addWaypointMarker(startPoint.lat, startPoint.lng, 0);
                            addWaypointMarker(endPoint.lat, endPoint.lng, 1);
                        }
                    }
                }
            } catch (error) {
                console.error('[WAYPOINT_EDITOR] Error loading waypoints:', error);
                displayGlobalMapMessage('Gagal memuat waypoint.', 'danger', 3000);
            }
        }
        
        /**
         * Get start point coordinates
         */
        function getStartPoint(connectionType, sourceId) {
            if (connectionType === 'odc-odp') {
                const odcMarker = odcMarkers.find(m => String(m.assetData.id) === String(sourceId));
                if (odcMarker) {
                    const latLng = odcMarker.getLatLng();
                    return { lat: latLng.lat, lng: latLng.lng };
                }
            } else if (connectionType === 'customer-odp') {
                const customerMarker = customerMarkers.find(m => String(m.customerData?.id) === String(sourceId));
                if (customerMarker) {
                    const latLng = customerMarker.getLatLng();
                    return { lat: latLng.lat, lng: latLng.lng };
                }
            }
            return null;
        }
        
        /**
         * Get end point coordinates
         */
        function getEndPoint(connectionType, targetId) {
            const odpMarker = odpMarkers.find(m => String(m.assetData.id) === String(targetId));
            if (odpMarker) {
                const latLng = odpMarker.getLatLng();
                return { lat: latLng.lat, lng: latLng.lng };
            }
            return null;
        }
        
        /**
         * Add waypoint marker
         */
        function addWaypointMarker(lat, lng, index) {
            const waypointIcon = L.divIcon({
                className: 'waypoint-marker',
                html: `<div class="waypoint-marker-inner">
                    <i class="fas fa-map-marker-alt"></i>
                    <span class="waypoint-index">${index + 1}</span>
                </div>`,
                iconSize: [30, 40],
                iconAnchor: [15, 40]
            });
            
            const marker = L.marker([lat, lng], {
                icon: waypointIcon,
                draggable: true,
                zIndexOffset: 1000
            });
            
            marker.waypointIndex = index;
            
            // Drag event
            marker.on('dragend', function() {
                updateWaypointOrder();
            });
            
            // Click to delete (with confirmation)
            marker.on('click', function(e) {
                if (e.originalEvent.ctrlKey || e.originalEvent.metaKey) {
                    // Ctrl/Cmd + Click to delete
                    if (waypointMarkers.length <= 2) {
                        displayGlobalMapMessage('Minimal harus ada 2 waypoint (start dan end).', 'warning', 3000);
                        return;
                    }
                    
                    if (confirm(`Hapus waypoint ${index + 1}?`)) {
                        const markerIndex = waypointMarkers.indexOf(marker);
                        if (markerIndex > -1) {
                            waypointMarkers.splice(markerIndex, 1);
                            waypointLayer.removeLayer(marker);
                            map.removeLayer(marker);
                            updateWaypointOrder();
                            displayGlobalMapMessage(`Waypoint ${index + 1} dihapus.`, 'success', 2000);
                        }
                    }
                }
            });
            
            waypointMarkers.push(marker);
            waypointLayer.addLayer(marker);
            marker.addTo(map);
            
            // Update controls
            updateWaypointEditorControls();
        }
        
        /**
         * Clear all waypoint markers
         */
        function clearWaypointMarkers() {
            waypointMarkers.forEach(marker => {
                waypointLayer.removeLayer(marker);
                map.removeLayer(marker);
            });
            waypointMarkers = [];
            
            // Update controls
            updateWaypointEditorControls();
        }
        
        /**
         * Update waypoint order after drag
         */
        function updateWaypointOrder() {
            waypointMarkers.forEach((marker, index) => {
                marker.waypointIndex = index;
                const icon = marker.getIcon();
                if (icon && icon.options && icon.options.html) {
                    icon.options.html = `<div class="waypoint-marker-inner">
                        <i class="fas fa-map-marker-alt"></i>
                        <span class="waypoint-index">${index + 1}</span>
                    </div>`;
                    marker.setIcon(icon);
                }
            });
        }
        
        /**
         * Handle map click to add waypoint
         */
        function onMapClickAddWaypoint(e) {
            if (!waypointEditorMode || !currentEditingConnection) return;
            
            const { lat, lng } = e.latlng;
            const newIndex = waypointMarkers.length;
            addWaypointMarker(lat, lng, newIndex);
            
            displayGlobalMapMessage(`Waypoint ${newIndex + 1} ditambahkan. Drag untuk pindahkan, Ctrl+Click untuk hapus.`, 'success', 3000);
        }
        
        /**
         * Save waypoints
         */
        async function saveWaypoints() {
            if (!currentEditingConnection || waypointMarkers.length < 2) {
                displayGlobalMapMessage('Minimal harus ada 2 waypoint (start dan end).', 'warning', 3000);
                return;
            }
            
            const waypoints = waypointMarkers.map(marker => {
                const latLng = marker.getLatLng();
                return [latLng.lat, latLng.lng];
            });
            
            try {
                const response = await fetch('/api/map/waypoints', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include',
                    body: JSON.stringify({
                        connectionType: currentEditingConnection.connectionType,
                        sourceId: currentEditingConnection.sourceId,
                        targetId: currentEditingConnection.targetId,
                        waypoints: waypoints
                    })
                });
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.status === 200) {
                        displayGlobalMapMessage('Waypoint berhasil disimpan! Refresh map untuk melihat perubahan.', 'success', 5000);
                        exitWaypointEditor();
                        // Auto refresh setelah 2 detik
                        setTimeout(() => {
                            loadAllMapData();
                        }, 2000);
                    } else {
                        displayGlobalMapMessage(data.message || 'Gagal menyimpan waypoint.', 'danger', 3000);
                    }
                } else {
                    const errorData = await response.json().catch(() => ({ message: 'Gagal menyimpan waypoint.' }));
                    displayGlobalMapMessage(errorData.message || 'Gagal menyimpan waypoint.', 'danger', 3000);
                }
            } catch (error) {
                console.error('[WAYPOINT_EDITOR] Error saving waypoints:', error);
                displayGlobalMapMessage('Gagal menyimpan waypoint.', 'danger', 3000);
            }
        }
        
        /**
         * Delete waypoints
         */
        async function deleteWaypoints() {
            if (!currentEditingConnection) return;
            
            if (!confirm('Hapus waypoint manual untuk koneksi ini? Garis akan kembali menggunakan routing API atau straight line.')) {
                return;
            }
            
            try {
                const response = await fetch(`/api/map/waypoints?connectionType=${currentEditingConnection.connectionType}&sourceId=${currentEditingConnection.sourceId}&targetId=${currentEditingConnection.targetId}`, {
                    method: 'DELETE',
                    credentials: 'include'
                });
                
                if (response.ok) {
                    displayGlobalMapMessage('Waypoint berhasil dihapus! Refresh map untuk melihat perubahan.', 'success', 5000);
                    exitWaypointEditor();
                    // Auto refresh setelah 2 detik
                    setTimeout(() => {
                        loadAllMapData();
                    }, 2000);
                } else {
                    const errorData = await response.json().catch(() => ({ message: 'Gagal menghapus waypoint.' }));
                    displayGlobalMapMessage(errorData.message || 'Gagal menghapus waypoint.', 'danger', 3000);
                }
            } catch (error) {
                console.error('[WAYPOINT_EDITOR] Error deleting waypoints:', error);
                displayGlobalMapMessage('Gagal menghapus waypoint.', 'danger', 3000);
            }
        }
        
        /**
         * Exit waypoint editor
         */
        function exitWaypointEditor() {
            waypointEditorMode = false;
            currentEditingConnection = null;
            clearWaypointMarkers();
            map.off('click', onMapClickAddWaypoint);
            $('#editWaypointBtn').removeClass('active').html('<i class="fas fa-route"></i> Edit Waypoint');
            
            // Hide controls
            $('.waypoint-editor-controls').remove();
        }
        
        /**
         * Attach waypoint editor to connection line
         */
        function attachWaypointEditorToLine(line, connectionType, sourceId, targetId) {
            if (!line) return;
            
            // Make line clickable
            line.setStyle({ interactive: true });
            
            line.on('click', function(e) {
                if (waypointEditorMode) {
                    e.originalEvent.stopPropagation();
                    startWaypointEditor(connectionType, sourceId, targetId);
                }
            });
            
            // Add context menu hint
            line.on('mouseover', function() {
                if (waypointEditorMode) {
                    line.setStyle({ weight: line.options.weight + 1, opacity: 0.9 });
                }
            });
            
            line.on('mouseout', function() {
                if (waypointEditorMode) {
                    line.setStyle({ weight: line.options.weight - 1, opacity: line.options.opacity });
                }
            });
        }
        
        // Global functions untuk context menu
        window.startWaypointEditor = function(connectionType, sourceId, targetId) {
            if (!waypointEditorMode) {
                $('#editWaypointBtn').click();
            }
            startWaypointEditor(connectionType, sourceId, targetId);
        };
        
        window.deleteWaypointsForConnection = async function(connectionType, sourceId, targetId) {
            if (!confirm('Hapus waypoint manual untuk koneksi ini?')) return;
            
            try {
                const response = await fetch(`/api/map/waypoints?connectionType=${connectionType}&sourceId=${sourceId}&targetId=${targetId}`, {
                    method: 'DELETE',
                    credentials: 'include'
                });
                
                if (response.ok) {
                    displayGlobalMapMessage('Waypoint berhasil dihapus! Refresh map untuk melihat perubahan.', 'success', 5000);
                    // Reload map data
                    setTimeout(() => {
                        loadAllMapData();
                    }, 2000);
                }
            } catch (error) {
                console.error('[WAYPOINT_EDITOR] Error deleting waypoints:', error);
                displayGlobalMapMessage('Gagal menghapus waypoint.', 'danger', 3000);
            }
        };
        
        // Add save/delete buttons to waypoint editor
        function showWaypointEditorControls() {
            if (!currentEditingConnection) return;
            
            // Remove existing controls if any
            $('.waypoint-editor-controls').remove();
            
            const controls = $(`
                <div class="waypoint-editor-controls" style="position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 2000; background: white; padding: 15px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
                    <div class="d-flex align-items-center gap-2">
                        <button class="btn btn-success btn-sm" onclick="saveWaypoints()">
                            <i class="fas fa-save"></i> Simpan Waypoint
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="deleteWaypoints()">
                            <i class="fas fa-trash"></i> Hapus Waypoint
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="exitWaypointEditor()">
                            <i class="fas fa-times"></i> Batal
                        </button>
                        <span class="ml-2 text-muted">${waypointMarkers.length} waypoint</span>
                    </div>
                </div>
            `);
            
            $('body').append(controls);
        }
        
        // Update waypoint editor controls
        function updateWaypointEditorControls() {
            if (currentEditingConnection) {
                showWaypointEditorControls();
            } else {
                $('.waypoint-editor-controls').remove();
            }
        }
        
        // Make functions global
        window.saveWaypoints = saveWaypoints;
        window.deleteWaypoints = deleteWaypoints;
        window.exitWaypointEditor = exitWaypointEditor;
        
        // Update controls when waypoints change - call updateWaypointEditorControls() in relevant functions
        // This is done inline in addWaypointMarker, clearWaypointMarkers, startWaypointEditor, exitWaypointEditor
    </script>
</body>
</html>