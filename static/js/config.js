    document.addEventListener('DOMContentLoaded', function() {
      const form = document.getElementById('configForm');

      // Fetch initial data
      fetch('/api/config', { credentials: 'include' })
        .then(res => res.json())
        .then(json => {
            if (json.data) {
                // Helper to set value
                const setValue = (id, value, fallback = '') => {
                    const el = document.getElementById(id);
                    if (el) el.value = value || fallback;
                };

                // Set values from json.data
                setValue('nama', json.data.nama);
                setValue('namabot', json.data.namabot);
                setValue('telfon', json.data.telfon);
                setValue('adminPhone', json.data.adminPhone || '089685645956');
                setValue('parentbinding', json.data.parentbinding);
                setValue('tanggal_pengingat', json.data.tanggal_pengingat, '1');
                setValue('tanggal_batas_bayar', json.data.tanggal_batas_bayar, '10');
                setValue('teknisiCollectionCommissionEnabled', json.data.teknisiCollectionCommissionEnabled === true ? "true" : "false");
                setValue('teknisiCollectionCommissionAmount', json.data.teknisiCollectionCommissionAmount || '0');
                setValue('agenCollectionCommissionEnabled', json.data.agenCollectionCommissionEnabled === true ? "true" : "false");
                setValue('agenCollectionCommissionAmount', json.data.agenCollectionCommissionAmount || '0');
                setValue('tanggal_isolir', json.data.tanggal_isolir, '11');
                setValue('isolir_profile', json.data.isolir_profile);
                setValue('isolirFeatureEnabled', json.data.isolirFeatureEnabled !== false ? "true" : "false");
                setValue('isolirManualEnabled', json.data.isolirManualEnabled !== false ? "true" : "false");
                setValue('isolirManualDefaultProfile', json.data.isolirManualDefaultProfile || json.data.isolir_profile || 'ISOLIR');
                setValue('isolirManualAllowCustomProfile', json.data.isolirManualAllowCustomProfile !== false ? "true" : "false");
                setValue('isolirManualDefaultDisconnect', json.data.isolirManualDefaultDisconnect !== false ? "true" : "false");
                setValue('isolirManualDefaultReboot', json.data.isolirManualDefaultReboot === true ? "true" : "false");
                setValue('isolirOpenDefaultReboot', json.data.isolirOpenDefaultReboot !== false ? "true" : "false");
                setValue('site_url_bot', json.data.site_url_bot, 'http://127.0.0.1:3100');
                setValue('public_url', json.data.public_url);
                setValue('genieacsBaseUrl', json.data.genieacsBaseUrl);
                setValue('genieacsEnabled', json.data.genieacsEnabled !== false ? "true" : "false");
                setValue('genieacsCustomerRebootEnabled', json.data.genieacsCustomerRebootEnabled !== false ? "true" : "false");
                setValue('genieacsAdminRebootEnabled', json.data.genieacsAdminRebootEnabled !== false ? "true" : "false");
                setValue('genieacsWifiManagementEnabled', json.data.genieacsWifiManagementEnabled !== false ? "true" : "false");
                setValue('genieacsPsbDeviceProvisioningEnabled', json.data.genieacsPsbDeviceProvisioningEnabled !== false ? "true" : "false");
                setValue('accessLimit', json.data.accessLimit);
                setValue('rx_tolerance', json.data.rx_tolerance);
                // Alert redaman: penerima diatur per PERAN + nomor tambahan.
                // Bawaan (config.redamanAlert absen) = perilaku lama, yaitu SEMUA peran.
                (function isiSetelanRedaman() {
                    const ra = json.data.redamanAlert || {};
                    setValue('redamanAlertEnabled', ra.enabled === false ? 'false' : 'true');
                    const sel = document.getElementById('redamanAlertRoles');
                    if (sel) {
                        // roles absen = semua peran (perilaku lama) -> semua opsi tercentang,
                        // supaya yang tampil di layar SAMA dengan yang benar-benar berlaku.
                        const dipilih = Array.isArray(ra.roles)
                            ? ra.roles.map(function (r) { return String(r).toLowerCase(); })
                            : Array.from(sel.options).map(function (o) { return o.value; });
                        Array.from(sel.options).forEach(function (o) {
                            o.selected = dipilih.indexOf(o.value) !== -1;
                        });
                    }
                    setValue('redamanAlertExtraNumbers', Array.isArray(ra.extraNumbers) ? ra.extraNumbers.join(', ') : '');
                    // Cakupan & kesegaran: bawaan (key absen) = gerbang HIDUP, karena mengalert
                    // modem bot lain / dari pembacaan mati bukan fitur melainkan cacat.
                    setValue('redamanAlertHanyaPelangganSendiri', ra.hanyaPelangganSendiri === false ? 'false' : 'true');
                    // Angka dibiarkan KOSONG kalau belum disetel supaya placeholder (bawaan)
                    // yang tampil — menulis "15" ke kotak akan mengunci nilainya diam-diam.
                    setValue('redamanAlertMaxDataAgeMinutes', ra.maxDataAgeMinutes !== undefined && ra.maxDataAgeMinutes !== null ? ra.maxDataAgeMinutes : '');
                    var cdJam = ra.cooldownHours;
                    if (cdJam === undefined || cdJam === null || cdJam === '') cdJam = json.data.redaman_alert_cooldown_hours;
                    setValue('redamanAlertCooldownHours', cdJam !== undefined && cdJam !== null ? cdJam : '');
                })();
                setValue('ipaymuSecret', json.data.ipaymuSecret);
                setValue('ipaymuVA', json.data.ipaymuVA);
                setValue('ipaymuCallback', json.data.ipaymuCallback);
                setValue('ipaymuProduction', json.data.ipaymuProduction ? "yes" : "no");
                setValue('paymentGateway', json.data.paymentGateway || 'ipaymu');
                setValue('tripayApiKey', json.data.tripayApiKey);
                setValue('tripayPrivateKey', json.data.tripayPrivateKey);
                setValue('tripayMerchantCode', json.data.tripayMerchantCode);
                setValue('tripayProduction', json.data.tripayProduction ? "yes" : "no");
                setValue('tripayDefaultMethod', json.data.tripayDefaultMethod, 'QRIS');
                setValue('mayarApiKey', json.data.mayarApiKey);
                setValue('mayarSandboxApiKey', json.data.mayarSandboxApiKey);
                setValue('mayarSandbox', json.data.mayarSandbox === false ? "no" : "yes");
                // Identitas & Kontak Usaha (dipakai halaman publik FAQ/Refund/Syarat/Kontak).
                // Nilai placeholder "ISI_..." disaring jadi kosong agar field bersih.
                var _co = json.data.company || {};
                var _clean = function (v) { v = String(v == null ? '' : v); return /^ISI_/i.test(v) ? '' : v; };
                setValue('company_name', _clean(_co.name) || _clean(json.data.nama));
                setValue('company_phone', _clean(_co.phone));
                setValue('company_email', _clean(_co.email));
                setValue('company_address', _clean(_co.address));
                setValue('company_website', _clean(_co.website));
                setValue('defaultBulkSSID', json.data.defaultBulkSSID || '1');
                setValue('speedOnDemandEnabled', json.data.speedOnDemandEnabled !== false ? "true" : "false");
                setValue('showPaymentStatus', json.data.showPaymentStatus !== false ? "true" : "false");
        setValue('showDueDate', json.data.showDueDate !== false ? "true" : "false");
        setValue('customerTrafficUsageEnabled', json.data.customerTrafficUsageEnabled === true ? "true" : "false");
        setValue('customerTrafficLiveEnabled', json.data.customerTrafficLiveEnabled === true ? "true" : "false");
                setValue('custom_wifi_modification', json.data.custom_wifi_modification ? "true" : "false");
                setValue('sync_to_mikrotik', json.data.sync_to_mikrotik ? "true" : "false");
                setValue('whatsapp_message_delay', json.data.whatsapp_message_delay, '2000');
                setValue('defaultPPPoEPassword', json.data.defaultPPPoEPassword, '');
                setValue('voucherGuideSteps', json.data.voucherGuide?.steps || '', '');
                setValue('voucherLoginUrl', json.data.voucherGuide?.loginUrl || '', '');
                setValue('welcomeMessageEnabled', json.data.welcomeMessage?.enabled !== false ? "true" : "false");
                setValue('customerPortalUrl', json.data.welcomeMessage?.customerPortalUrl || json.data.company?.website || json.data.site_url_bot || 'https://rafnet.my.id/customer');

                // Intake PSB — toggle + grup ringkasan tersimpan (pasang opsi agar tetap terpilih walau daftar grup belum dimuat).
                setValue('psbIntakeEnabled', json.data.psbIntake?.enabled === true ? "true" : "false");
                setValue('psbIntakeRecency', json.data.psbIntake?.recencyWindowMinutes || '', '120');
                setValue('psbIntakeFreeInstallMonth', json.data.psbIntake?.freeInstallMonth === true ? "true" : "false");
                // Alamat pelanggan dirakit bot dari dusun + RT/RW + desa/kecamatan area.
                setValue('psbIntakeDesa', json.data.psbIntake?.desa || '', '');
                setValue('psbIntakeKecamatan', json.data.psbIntake?.kecamatan || '', '');
                setValue('psbIntakeDusunList', (json.data.psbIntake?.dusunList || []).join(', '), '');
                (function () {
                    var sel = document.getElementById('psbIntakeGroupId');
                    var gid = (json.data.psbIntake && json.data.psbIntake.groupId) || '';
                    if (sel && gid && !Array.prototype.some.call(sel.options, function (o) { return o.value === gid; })) {
                        var opt = document.createElement('option');
                        opt.value = gid;
                        opt.textContent = gid + ' (tersimpan)';
                        sel.appendChild(opt);
                    }
                    if (sel && gid) sel.value = gid;
                })();

                // Notif Perbaikan + tutorial URL.
                setValue('repairNotifEnabled', json.data.repairNotif?.enabled === true ? "true" : "false");
                setValue('teknisiTutorialUrl', json.data.teknisiTutorialUrl || '');
                (function () {
                    var sel = document.getElementById('repairNotifGroupId');
                    var gid = (json.data.repairNotif && json.data.repairNotif.groupId) || '';
                    if (sel && gid && !Array.prototype.some.call(sel.options, function (o) { return o.value === gid; })) {
                        var opt = document.createElement('option');
                        opt.value = gid; opt.textContent = gid + ' (tersimpan)';
                        sel.appendChild(opt);
                    }
                    if (sel && gid) sel.value = gid;
                })();

                // Load bank accounts
                if (json.data.bankAccounts) {
                    window.bankAccounts = json.data.bankAccounts;
                    displayBankAccounts();
                } else {
                    window.bankAccounts = [];
                }
            }
        })
        .catch(error => {
            console.error("Error fetching initial config:", error);
            Swal.fire({
                icon: 'error',
                title: 'Gagal Memuat',
                text: 'Tidak dapat memuat konfigurasi awal dari server.'
            });
        });

      fetch('/api/genieacs/feature-status', { credentials: 'include' })
        .then(res => res.json())
        .then(json => {
            const badge = document.getElementById('genieacsCapabilityBadge');
            const reason = document.getElementById('genieacsCapabilityReason');
            if (!badge || !reason) return;
            const data = json.data || {};
            if (data.available) {
                badge.className = 'badge badge-success';
                badge.textContent = data.reachable === false ? 'Configured / Unreachable' : 'Tersedia';
            } else {
                badge.className = 'badge badge-warning';
                badge.textContent = 'Limited';
            }
            reason.textContent = data.reason || 'Status GenieACS berhasil dimuat.';
        })
        .catch(() => {
            const badge = document.getElementById('genieacsCapabilityBadge');
            const reason = document.getElementById('genieacsCapabilityReason');
            if (badge) {
                badge.className = 'badge badge-danger';
                badge.textContent = 'Gagal';
            }
            if (reason) {
                reason.textContent = 'Status capability GenieACS gagal dimuat.';
            }
        });

      // ===== Navigasi tab (ringan, tanpa pindah node DOM) =====
      const configNav = document.getElementById('configNav');
      if (configNav) {
        configNav.addEventListener('click', function(event) {
          const link = event.target.closest('.nav-link');
          if (!link) return;
          event.preventDefault();
          const paneId = link.dataset.pane;
          configNav.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l === link));
          document.querySelectorAll('#configForm .config-pane').forEach(p => p.classList.toggle('active', p.id === paneId));
        });
      }

      // ===== Simpan per-bagian =====
      // Konversi tipe (boolean/yes-no) dilakukan di backend berdasar nama key,
      // jadi cukup kirim name=value apa adanya. /api/config melakukan merge
      // parsial sehingga bagian lain tidak terhapus.
      function collectPaneData(pane) {
        const data = {};
        pane.querySelectorAll('input[name], select[name], textarea[name]').forEach(el => {
          if (el.type === 'checkbox') {
            data[el.name] = el.checked ? 'true' : 'false';
          } else if (el.multiple) {
            // `el.value` pada <select multiple> hanya memulangkan opsi PERTAMA yang
            // terpilih — pilihan lain hilang diam-diam. Harus dibaca dari selectedOptions.
            // Array kosong SAH (mis. "tidak ada peran yang dialerti") dan wajib terkirim,
            // jadi jangan diubah jadi undefined/dilewati.
            data[el.name] = Array.from(el.selectedOptions).map(o => o.value);
          } else {
            data[el.name] = el.value;
          }
        });
        // Pane Penagihan memuat daftar rekening bank dinamis.
        if (pane.querySelector('#bankAccountsList')) {
          data.bankAccounts = window.bankAccounts || [];
        }
        return data;
      }

      document.querySelectorAll('.config-save-btn').forEach(btn => {
        btn.addEventListener('click', function() {
          const pane = document.getElementById(this.dataset.pane);
          if (!pane) return;
          const btnEl = this;
          const original = btnEl.innerHTML;
          const data = collectPaneData(pane);

          btnEl.disabled = true;
          btnEl.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Menyimpan...';

          fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(data),
          })
          .then(response => {
            if (!response.ok) {
              return response.json().then(err => { throw new Error(err.message || `HTTP error! status: ${response.status}`) });
            }
            return response.json();
          })
          .then(result => {
            Swal.fire({
              icon: 'success',
              title: 'Berhasil!',
              text: result.message || 'Konfigurasi berhasil disimpan.',
              timer: 2000,
              showConfirmButton: false
            });
          })
          .catch(error => {
            console.error('Error:', error);
            Swal.fire({
              icon: 'error',
              title: 'Oops...',
              text: error.message || 'Terjadi kesalahan saat menyimpan konfigurasi!',
            });
          })
          .finally(() => {
            btnEl.disabled = false;
            btnEl.innerHTML = original;
          });
        });
      });

      // Intake PSB Grup — muat daftar grup WhatsApp ke dropdown (bot harus online).
      // Muat daftar grup WA ke SEMUA dropdown grup (PSB + Perbaikan) sekaligus dari satu fetch.
      function wireGroupLoader(btnId, selectIds) {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        btn.addEventListener('click', function () {
          const sels = selectIds.map(function (id) { return document.getElementById(id); }).filter(Boolean);
          const currents = sels.map(function (s) { return s.value; });
          const original = btn.innerHTML;
          btn.disabled = true;
          btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
          fetch('/api/whatsapp/groups', { credentials: 'include' })
            .then(res => res.json())
            .then(json => {
              if (!json.success || !Array.isArray(json.groups)) {
                throw new Error(json.message || 'Bot WhatsApp belum terkoneksi.');
              }
              sels.forEach(function (sel, i) {
                sel.innerHTML = '<option value="">— pilih grup —</option>';
                json.groups.forEach(function (g) {
                  const opt = document.createElement('option');
                  opt.value = g.id;
                  opt.textContent = g.subject + ' (' + g.size + ' anggota)';
                  sel.appendChild(opt);
                });
                if (currents[i] && Array.prototype.some.call(sel.options, function (o) { return o.value === currents[i]; })) {
                  sel.value = currents[i];
                }
              });
              if (typeof Swal !== 'undefined') {
                Swal.fire({ icon: 'success', title: 'Grup dimuat', text: json.groups.length + ' grup ditemukan.', timer: 1500, showConfirmButton: false });
              }
            })
            .catch(err => {
              if (typeof Swal !== 'undefined') {
                Swal.fire({ icon: 'error', title: 'Gagal memuat grup', text: err.message });
              }
            })
            .finally(() => {
              btn.disabled = false;
              btn.innerHTML = original;
            });
        });
      }
      wireGroupLoader('btnLoadPsbGroups', ['psbIntakeGroupId', 'repairNotifGroupId']);
      wireGroupLoader('btnLoadPsbGroups2', ['psbIntakeGroupId', 'repairNotifGroupId']);

      // Mikrotik Devices Management
      const mikrotikDevicesTable = document.getElementById('mikrotikDevicesTable').getElementsByTagName('tbody')[0];
      const mikrotikDeviceModal = $('#mikrotikDeviceModal');
      const mikrotikDeviceForm = document.getElementById('mikrotikDeviceForm');
      const saveMikrotikDeviceBtn = document.getElementById('saveMikrotikDeviceBtn');

      function loadMikrotikDevices() {
        fetch('/api/mikrotik-devices', { credentials: 'include' })
          .then(res => res.json())
          .then(devices => {
            mikrotikDevicesTable.innerHTML = '';
            devices.forEach(device => {
              const row = mikrotikDevicesTable.insertRow();
              row.innerHTML = `
                <td>${device.ip}</td>
                <td>${device.name}</td>
                <td>${device.active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-secondary">Inactive</span>'}</td>
                <td>
                  <button type="button" class="btn btn-sm btn-info setActiveBtn" data-id="${device.id}" ${device.active ? 'disabled' : ''}>Set Active</button>
                  <button type="button" class="btn btn-sm btn-warning editBtn" data-id="${device.id}">Edit</button>
                  <button type="button" class="btn btn-sm btn-danger deleteBtn" data-id="${device.id}">Delete</button>
                </td>
              `;
            });
          });
      }

      document.getElementById('addMikrotikDeviceBtn').addEventListener('click', () => {
        mikrotikDeviceForm.reset();
        document.getElementById('mikrotikDeviceId').value = '';
        mikrotikDeviceModal.find('.modal-title').text('Tambah Perangkat MikroTik');
      });

      saveMikrotikDeviceBtn.addEventListener('click', () => {
        const formData = new FormData(mikrotikDeviceForm);
        const data = Object.fromEntries(formData.entries());
        const id = data.id;
        const url = id ? `/api/mikrotik-devices/${id}` : '/api/mikrotik-devices';
        const method = id ? 'PUT' : 'POST';

        // PENTING: Validasi data sebelum submit
        if (!data.ip || !data.name || !data.password) {
          Swal.fire('Error', 'IP Address, Username, dan Password harus diisi', 'error');
          return;
        }

        fetch(url, {
          method: method,
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(data)
        })
        .then(res => {
          if (!res.ok) {
            return res.json().then(err => Promise.reject(err));
          }
          return res.json();
        })
        .then(result => {
          Swal.fire('Success', result.message || 'Perangkat berhasil disimpan', 'success');
          mikrotikDeviceModal.modal('hide');
          loadMikrotikDevices();
        })
        .catch(err => {
          console.error('Error saving device:', err);
          Swal.fire('Error', err.message || 'Gagal menyimpan perangkat', 'error');
        });
      });

      mikrotikDevicesTable.addEventListener('click', (e) => {
        const target = e.target;
        const id = target.dataset.id;

        if (target.classList.contains('editBtn')) {
          // PENTING: Gunakan backtick (`) bukan single quote (') untuk template literal
          fetch(`/api/mikrotik-devices/${id}`, { credentials: 'include' })
            .then(res => {
              if (!res.ok) {
                throw new Error(`HTTP error! status: ${res.status}`);
              }
              return res.json();
            })
            .then(device => {
              // PENTING: Validasi data device sebelum mengisi form
              if (!device || !device.id) {
                Swal.fire('Error', 'Data perangkat tidak valid atau tidak ditemukan', 'error');
                return;
              }
              
              // Isi form dengan data device
              document.getElementById('mikrotikDeviceId').value = device.id || '';
              document.getElementById('mikrotikIp').value = device.ip || '';
              document.getElementById('mikrotikName').value = device.name || '';
              document.getElementById('mikrotikPassword').value = device.password || '';
              document.getElementById('mikrotikPort').value = device.port || '8728';
              document.getElementById('mikrotikMonitorInterface').value = device.monitoring_interface || 'ether1';

              mikrotikDeviceModal.find('.modal-title').text('Edit Perangkat MikroTik');
              mikrotikDeviceModal.modal('show');
            })
            .catch(err => {
              console.error('Error loading device:', err);
              Swal.fire('Error', 'Gagal memuat data perangkat: ' + err.message, 'error');
            });
        }

        if (target.classList.contains('deleteBtn')) {
          Swal.fire({
            title: 'Are you sure?',
            text: "You won't be able to revert this!",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#3085d6',
            cancelButtonColor: '#d33',
            confirmButtonText: 'Yes, delete it!'
          }).then((result) => {
            if (result.isConfirmed) {
              fetch(`/api/mikrotik-devices/${id}`, { method: 'DELETE', credentials: 'include' })
                .then(res => res.json())
                .then(result => {
                  Swal.fire('Deleted!', result.message, 'success');
                  loadMikrotikDevices();
                })
                .catch(err => Swal.fire('Error', err.message, 'error'));
            }
          });
        }

        if (target.classList.contains('setActiveBtn')) {
          fetch(`/api/mikrotik-devices/set-active/${id}`, { method: 'POST', credentials: 'include' })
            .then(res => res.json())
            .then(result => {
              Swal.fire('Success', result.message, 'success');
              loadMikrotikDevices();
            })
            .catch(err => Swal.fire('Error', err.message, 'error'));
        }
      });

      loadMikrotikDevices();
    });
    
    // Bank Accounts Management
    window.bankAccounts = [];
    
    function displayBankAccounts() {
      const container = document.getElementById('bankAccountsList');
      if (!container) return;
      
      container.innerHTML = '';
      
      if (window.bankAccounts.length === 0) {
        container.innerHTML = '<div class="alert alert-info">Belum ada rekening bank. Klik tombol "Tambah Rekening" untuk menambahkan.</div>';
        return;
      }
      
      window.bankAccounts.forEach((account, index) => {
        const accountHtml = `
          <div class="card mb-3">
            <div class="card-body">
              <div class="row mb-2">
                <div class="col-md-11">
                  <div class="mb-2">
                    <label class="form-label mb-1 small text-muted">Nama Bank</label>
                    <input type="text" class="form-control" placeholder="Contoh: BCA, BRI, DANA" value="${account.bank || ''}" 
                           onchange="updateBankAccount(${index}, 'bank', this.value)">
                  </div>
                  <div class="mb-2">
                    <label class="form-label mb-1 small text-muted">Nomor Rekening</label>
                    <input type="text" class="form-control" placeholder="Contoh: 1234567890" value="${account.number || ''}"
                           onchange="updateBankAccount(${index}, 'number', this.value)">
                  </div>
                  <div class="mb-0">
                    <label class="form-label mb-1 small text-muted">Atas Nama</label>
                    <input type="text" class="form-control" placeholder="Contoh: MUHAMMAD RAFLI ALDIVA PRATAMA" value="${account.name || ''}"
                           onchange="updateBankAccount(${index}, 'name', this.value)">
                  </div>
                </div>
                <div class="col-md-1 d-flex align-items-center justify-content-center">
                  <button type="button" class="btn btn-danger btn-sm" onclick="removeBankAccount(${index})" title="Hapus Rekening">
                    <i class="fas fa-trash"></i>
                  </button>
                </div>
              </div>
              <div class="mt-3 p-2 bg-light rounded">
                <small class="text-muted d-block mb-1"><strong>Preview format di pesan:</strong></small>
                <small class="d-block cfg-pratinjau-rekening"> ${account.bank || '[Bank]'}:
${account.number || '[Nomor]'}
a.n ${account.name || '[Nama]'}</small>
              </div>
            </div>
          </div>
        `;
        container.innerHTML += accountHtml;
      });
    }
    
    function addBankAccount() {
      window.bankAccounts.push({
        bank: '',
        number: '',
        name: ''
      });
      displayBankAccounts();
    }
    
    function updateBankAccount(index, field, value) {
      if (window.bankAccounts[index]) {
        window.bankAccounts[index][field] = value;
      }
    }
    
    function removeBankAccount(index) {
      Swal.fire({
        title: 'Hapus Rekening?',
        text: "Rekening bank ini akan dihapus",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#3085d6',
        cancelButtonColor: '#d33',
        confirmButtonText: 'Ya, hapus!',
        cancelButtonText: 'Batal'
      }).then((result) => {
        if (result.isConfirmed) {
          window.bankAccounts.splice(index, 1);
          displayBankAccounts();
        }
      });
    }
    
    // =====================================================
    // TELEGRAM BACKUP CONFIGURATION
    // =====================================================
    
    // Load Telegram config on page load
    function loadTelegramConfig() {
      fetch('/api/telegram-backup/config', { credentials: 'include' })
        .then(res => res.json())
        .then(json => {
          if (json.status === 200 && json.data) {
            document.getElementById('telegramBotToken').value = json.data.botToken || '';
            document.getElementById('telegramChatId').value = json.data.chatId || '';
            
            // Integration enablement is owned by config.php; scheduler is managed from cron.php
            const isEnabled = json.data.enabled === true || json.data.enabled === 'true';
            document.getElementById('telegramBackupEnabled').value = isEnabled ? 'true' : 'false';
          }
        })
        .catch(err => {
          console.error('Error loading Telegram config:', err);
        });
    }
    
    // Save Telegram config
    document.getElementById('saveTelegramConfigBtn').addEventListener('click', function() {
      const btn = this;
      const originalText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Menyimpan...';
      
      const data = {
        botToken: document.getElementById('telegramBotToken').value.trim(),
        chatId: document.getElementById('telegramChatId').value.trim(),
        enabled: document.getElementById('telegramBackupEnabled').value === 'true'
      };
      
      fetch('/api/telegram-backup/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
      })
      .then(res => res.json())
      .then(result => {
        if (result.status === 200) {
          Swal.fire({
            icon: 'success',
            title: 'Berhasil!',
            text: result.message,
            timer: 2000,
            showConfirmButton: false
          });
        } else {
          throw new Error(result.message);
        }
      })
      .catch(err => {
        Swal.fire({
          icon: 'error',
          title: 'Gagal',
          text: err.message || 'Terjadi kesalahan saat menyimpan konfigurasi'
        });
      })
      .finally(() => {
        btn.disabled = false;
        btn.innerHTML = originalText;
      });
    });
    
    // Test Telegram connection
    document.getElementById('testTelegramBtn').addEventListener('click', function() {
      const btn = this;
      const originalText = btn.innerHTML;
      
      const botToken = document.getElementById('telegramBotToken').value.trim();
      const chatId = document.getElementById('telegramChatId').value.trim();
      
      if (!botToken || !chatId) {
        Swal.fire({
          icon: 'warning',
          title: 'Data Tidak Lengkap',
          text: 'Silakan isi Bot Token dan Chat ID terlebih dahulu'
        });
        return;
      }
      
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Testing...';
      
      fetch('/api/telegram-backup/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ botToken, chatId })
      })
      .then(res => res.json())
      .then(result => {
        if (result.status === 200) {
          Swal.fire({
            icon: 'success',
            title: 'Koneksi Berhasil!',
            text: result.message
          });
        } else {
          throw new Error(result.message);
        }
      })
      .catch(err => {
        Swal.fire({
          icon: 'error',
          title: 'Koneksi Gagal',
          text: err.message || 'Tidak dapat terhubung ke Telegram'
        });
      })
      .finally(() => {
        btn.disabled = false;
        btn.innerHTML = originalText;
      });
    });
    
    // Run backup manually
    document.getElementById('runBackupBtn').addEventListener('click', function() {
      const btn = this;
      const originalText = btn.innerHTML;
      
      Swal.fire({
        title: 'Jalankan Backup?',
        text: 'Database akan di-backup dan dikirim ke Telegram sekarang',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#28a745',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Ya, Backup Sekarang',
        cancelButtonText: 'Batal'
      }).then((result) => {
        if (result.isConfirmed) {
          btn.disabled = true;
          btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Memproses...';
          
          fetch('/api/telegram-backup/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
          })
          .then(res => res.json())
          .then(result => {
            if (result.status === 200) {
              Swal.fire({
                icon: 'success',
                title: 'Backup Dimulai!',
                text: result.message
              });
            } else {
              throw new Error(result.message);
            }
          })
          .catch(err => {
            Swal.fire({
              icon: 'error',
              title: 'Gagal',
              text: err.message || 'Terjadi kesalahan saat menjalankan backup'
            });
          })
          .finally(() => {
            btn.disabled = false;
            btn.innerHTML = originalText;
          });
        }
      });
    });
    
    // Load Telegram config when page loads
    document.addEventListener('DOMContentLoaded', function() {
      loadTelegramConfig();
      loadOltConfig();
    });
    
    // =====================================================
    // OLT HIOSO CONFIGURATION
    // =====================================================
    
    // Load OLT config on page load
    function loadOltConfig() {
      fetch('/api/olt/config', { credentials: 'include' })
        .then(res => res.json())
        .then(json => {
          if (json.status === 200 && json.data) {
            // Tab OLT sudah didesain ulang jadi DAFTAR PERANGKAT (#oltDevicesTable):
            // field tunggal host/port/community/timeout serta kredensial web sudah
            // TIDAK ADA lagi di markup. Kode lama menyetel .value pada elemen yang
            // hilang → melempar di baris pertama yang absen, dan SELURUH setelan di
            // bawahnya (time window, interval scrape, maks halaman log) tak pernah
            // terisi — errornya tertelan .catch sebagai "Error loading OLT config".
            // Ditemukan lewat sapuan error konsol; setel per-elemen dengan penjaga.
            const set = (id, val) => {
              const el = document.getElementById(id);
              if (el) el.value = val;
            };
            set('oltEnabled', json.data.enabled ? 'true' : 'false');
            set('oltWebEnabled', json.data.webEnabled ? 'true' : 'false');
            set('oltTimeWindow', json.data.timeWindow || 10);
            set('oltScrapeInterval', json.data.scrapeInterval || 1);
            set('oltMaxLogPages', json.data.maxLogPages || 3);
          }
        })
        .catch(err => {
          console.error('Error loading OLT config:', err);
        });
    }
    
    // ============================================
    // OLT CONFIGURATION - MULTIPLE OLT SUPPORT
    // ============================================
    
    // Save OLT Global Config
    document.getElementById('saveOltGlobalConfigBtn').addEventListener('click', function() {
      const btn = this;
      const originalText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Menyimpan...';
      
      const data = {
        enabled: document.getElementById('oltEnabled').value === 'true',
        webEnabled: document.getElementById('oltWebEnabled').value === 'true',
        timeWindow: parseInt(document.getElementById('oltTimeWindow').value) || 10,
        scrapeInterval: parseInt(document.getElementById('oltScrapeInterval').value) || 1,
        maxLogPages: parseInt(document.getElementById('oltMaxLogPages').value) || 3
      };
      
      fetch('/api/olt/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
      })
      .then(res => res.json())
      .then(result => {
        if (result.status === 200) {
          Swal.fire({
            icon: 'success',
            title: 'Berhasil!',
            text: result.message,
            timer: 2000,
            showConfirmButton: false
          });
        } else {
          throw new Error(result.message);
        }
      })
      .catch(err => {
        Swal.fire({
          icon: 'error',
          title: 'Gagal',
          text: err.message || 'Terjadi kesalahan saat menyimpan konfigurasi OLT'
        });
      })
      .finally(() => {
        btn.disabled = false;
        btn.innerHTML = originalText;
      });
    });
    
    // Debug Scrape Log
    document.getElementById('debugScrapeBtn').addEventListener('click', function() {
      const btn = this;
      const originalText = btn.innerHTML;
      
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Scraping...';
      
      console.log('[OLT Debug] Starting manual scrape...');
      
      fetch('/api/olt/scrape-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      })
      .then(res => res.json())
      .then(result => {
        console.log('[OLT Debug] Scrape result:', result);
        
        if (result.status === 200) {
          const eventCount = Object.keys(result.data.events || {}).length;
          
          // Show events in console
          console.log('[OLT Debug] Events:', result.data.events);
          console.log('[OLT Debug] Scraper Status:', result.data.scraperStatus);
          
          // Show alert with summary
          Swal.fire({
            icon: 'info',
            title: 'Debug Scrape Selesai',
            html: `
              <div class="text-left">
                <p><strong>Events ditemukan:</strong> ${eventCount}</p>
                <p><strong>Last scrape:</strong> ${result.data.scraperStatus.lastScrapeTime || 'N/A'}</p>
                <p><strong>Status:</strong> ${result.data.scraperStatus.running ? 'Running' : 'Stopped'}</p>
                <hr>
                <p class="text-muted small">Cek console browser (F12) dan server log untuk detail lengkap.</p>
              </div>
            `
          });
        } else {
          throw new Error(result.message);
        }
      })
      .catch(err => {
        Swal.fire({
          icon: 'error',
          title: 'Gagal',
          text: err.message || 'Terjadi kesalahan saat scraping'
        });
      })
      .finally(() => {
        btn.disabled = false;
        btn.innerHTML = originalText;
      });
    });
    
    // ============================================
    // OLT DEVICES MANAGEMENT
    // ============================================
    
    const oltDevicesTable = document.getElementById('oltDevicesTable').getElementsByTagName('tbody')[0];
    const oltDeviceModal = $('#oltDeviceModal');
    const oltDeviceForm = document.getElementById('oltDeviceForm');
    const saveOltDeviceBtn = document.getElementById('saveOltDeviceBtn');
    
    // Load OLT devices
    function loadOltDevices() {
      console.log('[OLT] Loading OLT devices...');
      
      fetch('/api/olt/devices', { credentials: 'include' })
        .then(res => {
          console.log('[OLT] Response status:', res.status);
          return res.json();
        })
        .then(result => {
          console.log('[OLT] Response data:', result);
          
          if (result.status === 200 && result.data) {
            const devices = result.data.devices || [];
            const globalConfig = result.data.globalConfig || {};
            
            console.log('[OLT] Devices:', devices);
            console.log('[OLT] Global config:', globalConfig);
            
            // Update global config fields
            document.getElementById('oltEnabled').value = globalConfig.enabled ? 'true' : 'false';
            document.getElementById('oltWebEnabled').value = globalConfig.webEnabled ? 'true' : 'false';
            document.getElementById('oltTimeWindow').value = globalConfig.timeWindow || 10;
            document.getElementById('oltScrapeInterval').value = globalConfig.scrapeInterval || 1;
            document.getElementById('oltMaxLogPages').value = globalConfig.maxLogPages || 3;
            
            // Populate table
            oltDevicesTable.innerHTML = '';
            
            if (devices.length === 0) {
              const row = oltDevicesTable.insertRow();
              row.innerHTML = '<td colspan="8" class="text-center text-muted">Belum ada perangkat OLT. Klik "Tambah OLT" untuk menambahkan.</td>';
              console.log('[OLT] No devices found');
            } else {
              devices.forEach(device => {
                console.log('[OLT] Adding device to table:', device);
                const row = oltDevicesTable.insertRow();
                const brandLabels = { auto: 'Auto', hioso: 'HIOSO EPON', zte: 'ZTE GPON' };
                const brandKey = device.brand || 'auto';
                // Indikator ringkas kelengkapan config: SSH (utk provisioning) & ACS (utk OLT-push TR069).
                const sshBadge = device.sshUsername
                  ? `<span class="badge badge-success" title="SSH siap (user ${device.sshUsername}, port ${device.sshPort || 22})"><i class="fas fa-check"></i></span>`
                  : '<span class="badge badge-light" title="SSH belum diatur">&ndash;</span>';
                const acsBadge = (device.acs && device.acs.url)
                  ? `<span class="badge badge-success" title="ACS ${device.acs.url}">VLAN ${device.acs.mgmtVlan || 100}</span>`
                  : '<span class="badge badge-light" title="ACS belum diatur">&ndash;</span>';
                const statusBadge = device.enabled !== false
                  ? '<span class="badge badge-success">Aktif</span>'
                  : '<span class="badge badge-secondary">Nonaktif</span>';
                row.innerHTML = `
                  <td class="align-middle">${device.name}</td>
                  <td class="align-middle">${device.host}</td>
                  <td class="align-middle"><span class="badge badge-info">${brandLabels[brandKey] || brandKey}</span></td>
                  <td class="align-middle">${device.snmpPort || 161}</td>
                  <td class="align-middle">${sshBadge}</td>
                  <td class="align-middle">${acsBadge}</td>
                  <td class="align-middle">${statusBadge}</td>
                  <td class="text-center text-nowrap">
                    <div class="btn-group btn-group-sm" role="group">
                      <button type="button" class="btn btn-info test-olt-device" data-id="${device.id}" title="Test Koneksi"><i class="fas fa-plug"></i></button>
                      <button type="button" class="btn btn-warning edit-olt-device" data-id="${device.id}" title="Edit"><i class="fas fa-edit"></i></button>
                      <button type="button" class="btn btn-danger delete-olt-device" data-id="${device.id}" title="Hapus"><i class="fas fa-trash"></i></button>
                    </div>
                  </td>
                `;
              });
              
              console.log('[OLT] Added', devices.length, 'devices to table');
            }
            
            // Attach event listeners
            document.querySelectorAll('.test-olt-device').forEach(btn => {
              btn.addEventListener('click', function() {
                testOltDevice(this.dataset.id);
              });
            });
            
            document.querySelectorAll('.edit-olt-device').forEach(btn => {
              btn.addEventListener('click', function() {
                editOltDevice(this.dataset.id);
              });
            });
            
            document.querySelectorAll('.delete-olt-device').forEach(btn => {
              btn.addEventListener('click', function() {
                deleteOltDevice(this.dataset.id);
              });
            });
          } else {
            console.error('[OLT] Invalid response:', result);
            Swal.fire('Error', 'Gagal memuat data OLT devices', 'error');
          }
        })
        .catch(err => {
          console.error('[OLT] Error loading OLT devices:', err);
          Swal.fire('Error', 'Gagal memuat data OLT devices: ' + err.message, 'error');
        });
    }
    
    // Add OLT device button
    document.getElementById('addOltDeviceBtn').addEventListener('click', function() {
      oltDeviceForm.reset();
      document.getElementById('oltDeviceId').value = '';
      document.getElementById('oltDeviceSnmpPort').value = '161';
      document.getElementById('oltDeviceSnmpCommunity').value = 'public';
      document.getElementById('oltDeviceSnmpTimeout').value = '30000';
      document.getElementById('oltDeviceSnmpRetries').value = '2';
      document.getElementById('oltDeviceSshPort').value = '22';
      document.getElementById('oltDeviceEnabled').value = 'true';
      oltDeviceModal.find('.modal-title').text('Tambah Perangkat OLT');
    });
    
    // Save OLT device
    saveOltDeviceBtn.addEventListener('click', function() {
      const deviceId = document.getElementById('oltDeviceId').value;
      const isEdit = deviceId !== '';
      
      const data = {
        name: document.getElementById('oltDeviceName').value.trim(),
        host: document.getElementById('oltDeviceHost').value.trim(),
        brand: document.getElementById('oltDeviceBrand').value || 'auto',
        snmpPort: parseInt(document.getElementById('oltDeviceSnmpPort').value) || 161,
        snmpCommunity: document.getElementById('oltDeviceSnmpCommunity').value.trim() || 'public',
        snmpTimeout: parseInt(document.getElementById('oltDeviceSnmpTimeout').value) || 30000,
        snmpRetries: parseInt(document.getElementById('oltDeviceSnmpRetries').value) || 2,
        webUsername: document.getElementById('oltDeviceWebUsername').value.trim(),
        webPassword: document.getElementById('oltDeviceWebPassword').value,
        sshPort: parseInt(document.getElementById('oltDeviceSshPort').value) || 22,
        sshUsername: document.getElementById('oltDeviceSshUsername').value.trim(),
        sshPassword: document.getElementById('oltDeviceSshPassword').value,
        enabled: document.getElementById('oltDeviceEnabled').value === 'true'
      };
      
      if (!data.name || !data.host) {
        Swal.fire('Error', 'Nama dan IP Address harus diisi', 'error');
        return;
      }
      
      const url = isEdit ? `/api/olt/devices/${deviceId}` : '/api/olt/devices';
      const method = isEdit ? 'PUT' : 'POST';
      
      fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
      })
      .then(res => res.json())
      .then(result => {
        Swal.fire('Success', result.message || 'Perangkat berhasil disimpan', 'success');
        oltDeviceModal.modal('hide');
        loadOltDevices();
      })
      .catch(err => {
        Swal.fire('Error', err.message || 'Gagal menyimpan perangkat', 'error');
      });
    });
    
    // Edit OLT device
    function editOltDevice(deviceId) {
      fetch(`/api/olt/devices`, { credentials: 'include' })
        .then(res => res.json())
        .then(result => {
          if (result.status === 200 && result.data) {
            const device = result.data.devices.find(d => d.id === deviceId);
            if (device) {
              document.getElementById('oltDeviceId').value = device.id;
              document.getElementById('oltDeviceName').value = device.name;
              document.getElementById('oltDeviceHost').value = device.host;
              document.getElementById('oltDeviceBrand').value = device.brand || 'auto';
              document.getElementById('oltDeviceSnmpPort').value = device.snmpPort || 161;
              document.getElementById('oltDeviceSnmpCommunity').value = device.snmpCommunity || 'public';
              document.getElementById('oltDeviceSnmpTimeout').value = device.snmpTimeout || 30000;
              document.getElementById('oltDeviceSnmpRetries').value = device.snmpRetries || 2;
              document.getElementById('oltDeviceWebUsername').value = device.webUsername || '';
              document.getElementById('oltDeviceWebPassword').value = device.webPassword || '';
              document.getElementById('oltDeviceSshPort').value = device.sshPort || 22;
              document.getElementById('oltDeviceSshUsername').value = device.sshUsername || '';
              document.getElementById('oltDeviceSshPassword').value = device.sshPassword || '';
              document.getElementById('oltDeviceEnabled').value = device.enabled !== false ? 'true' : 'false';
              
              oltDeviceModal.find('.modal-title').text('Edit Perangkat OLT');
              oltDeviceModal.modal('show');
            }
          }
        })
        .catch(err => {
          Swal.fire('Error', 'Gagal memuat data perangkat', 'error');
        });
    }
    
    // Delete OLT device
    function deleteOltDevice(deviceId) {
      Swal.fire({
        title: 'Hapus Perangkat OLT?',
        text: 'Data perangkat akan dihapus permanen',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Ya, Hapus!',
        cancelButtonText: 'Batal'
      }).then((result) => {
        if (result.isConfirmed) {
          fetch(`/api/olt/devices/${deviceId}`, {
            method: 'DELETE',
            credentials: 'include'
          })
          .then(res => res.json())
          .then(result => {
            Swal.fire('Terhapus!', result.message || 'Perangkat berhasil dihapus', 'success');
            loadOltDevices();
          })
          .catch(err => {
            Swal.fire('Error', err.message || 'Gagal menghapus perangkat', 'error');
          });
        }
      });
    }
    
    // Test OLT device connection
    function testOltDevice(deviceId) {
      Swal.fire({
        title: 'Testing Koneksi...',
        text: 'Mohon tunggu',
        allowOutsideClick: false,
        didOpen: () => {
          Swal.showLoading();
        }
      });
      
      fetch(`/api/olt/devices/${deviceId}/test`, {
        method: 'POST',
        credentials: 'include'
      })
      .then(res => res.json())
      .then(result => {
        if (result.status === 200) {
          Swal.fire({
            icon: 'success',
            title: 'Koneksi Berhasil!',
            text: result.message
          });
        } else {
          throw new Error(result.message);
        }
      })
      .catch(err => {
        Swal.fire({
          icon: 'error',
          title: 'Koneksi Gagal',
          text: err.message || 'Tidak dapat terhubung ke OLT'
        });
      });
    }
    
    // Load OLT devices on page load
    loadOltDevices();
