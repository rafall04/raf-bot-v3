/**
 * Smoke test driver ZTE end-to-end ke OLT asli.
 * Usage: node scripts/olt-zte-smoke.js [host] [community] [port]
 */
const reg = require('../lib/olt-drivers');
const { host, community, port } = require('./_olt-args')(2);

const cfg = { host, community, port, timeout: 12000, retries: 1 };

(async () => {
    const brand = await reg.detectBrand(cfg);
    console.log('detectBrand →', brand);
    const driver = reg.getDriver(brand);
    console.log('driver:', driver.label, '| caps:', JSON.stringify(driver.capabilities));

    const t0 = Date.now();
    const r = await driver.getOltData(cfg);
    console.log('getOltData status=', r.status, '| onus=', r.onus ? r.onus.length : 0, '| ms=', Date.now() - t0);
    if (r.onus && r.onus.length) {
        const dist = {};
        r.onus.forEach((o) => { dist[o.status] = (dist[o.status] || 0) + 1; });
        console.log('status dist:', JSON.stringify(dist));
        console.log('\nsample 5 ONU:');
        r.onus.slice(0, 5).forEach((o) =>
            console.log(`  pon=${o.ponName} onu=${o.id} sn=${o.serial} desc=${o.description} status=${o.status} rx=${o.rxPower}`));
        console.log('\nsample rx (online):');
        r.onus.filter((o) => o.rxPower !== 'N/A').slice(0, 5).forEach((o) =>
            console.log(`  ${o.description} → ${o.rxPower}`));
    }
    process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
