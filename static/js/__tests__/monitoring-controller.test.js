const fs = require('fs');
const path = require('path');
const {
    MonitoringController,
    escapeHtml,
    formatLastUpdated,
    resolveMonitoringState
} = require('../monitoring-controller');

describe('monitoring-controller helpers', () => {
    test('escapeHtml escapes unsafe HTML characters', () => {
        expect(escapeHtml(`<script>alert("x")</script>&'`))
            .toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;');
    });

    test('formatLastUpdated returns empty string for invalid input', () => {
        expect(formatLastUpdated(null)).toBe('');
        expect(formatLastUpdated('not-a-date')).toBe('');
    });

    test('formatLastUpdated returns a formatted string for valid input', () => {
        const result = formatLastUpdated(new Date('2026-04-14T10:15:30+07:00'));
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    test('resolveMonitoringState returns disconnected for explicit disconnect', () => {
        expect(resolveMonitoringState({
            explicitDisconnected: true,
            hasData: true,
            failureCount: 0,
            threshold: 3
        })).toBe('disconnected');
    });

    test('resolveMonitoringState returns healthy when live data exists', () => {
        expect(resolveMonitoringState({
            hasData: true,
            failureCount: 2,
            threshold: 3
        })).toBe('healthy');
    });

    test('resolveMonitoringState returns stale before failure threshold', () => {
        expect(resolveMonitoringState({
            failureCount: 2,
            threshold: 3
        })).toBe('stale');
    });

    test('resolveMonitoringState returns disconnected at threshold', () => {
        expect(resolveMonitoringState({
            failureCount: 3,
            threshold: 3
        })).toBe('disconnected');
    });

    test('controller no longer keeps legacy symbol names', () => {
        const source = fs.readFileSync(path.join(__dirname, '..', 'monitoring-controller.js'), 'utf8');
        expect(source.includes('Legacy')).toBe(false);
    });

    test('controller prototype keeps mixed-in monitoring methods', () => {
        expect(typeof MonitoringController.prototype.bindEvents).toBe('function');
        expect(typeof MonitoringController.prototype.connectSocket).toBe('function');
        expect(typeof MonitoringController.prototype.initClickableStatCards).toBe('function');
        expect(typeof MonitoringController.prototype.handleNewAlert).toBe('function');
    });
});
