/**
 * Konfigurasi PM2 untuk menjalankan bot di produksi.
 *
 * Pakai:
 *   pm2 start ecosystem.config.js
 *   pm2 logs raf-dander-v3      # lihat QR WhatsApp untuk scan
 *   pm2 save                    # simpan daftar proses
 *   pm2 startup                 # (sekali) agar auto-start saat server reboot
 *
 * PENTING: aplikasi ini WAJIB single-instance (fork). Ada satu koneksi
 * WhatsApp, state global di memori, dan cron terjadwal — menjalankan lebih
 * dari satu instance (cluster) akan menyebabkan cron dobel, koneksi WA
 * bentrok, dan data tidak konsisten. JANGAN ubah instances > 1 / cluster.
 */
module.exports = {
    apps: [
        {
            name: "raf-dander-v3",
            script: "index.js",
            cwd: __dirname,
            exec_mode: "fork",
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: "1G",
            time: true,
            env: {
                NODE_ENV: "production",
                TZ: "Asia/Jakarta"
            }
        }
    ]
};
