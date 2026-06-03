// Speed Boost Configuration JavaScript
let speedBoostConfig = {};
let packages = [];
let tempMatrix = null;

function resolveBoolean(value, defaultValue) {
  return value === undefined || value === null ? defaultValue : value;
}

function resolveNumber(value, defaultValue) {
  return value === undefined || value === null || value === '' ? defaultValue : value;
}

// Load configuration on page load
$(document).ready(function() {
  try {
    console.log('Document ready - initializing Speed Boost Config');
    loadPackages();
    loadConfiguration();
    
    // Initialize Select2
    if ($.fn.select2) {
      $('#fromPackage, #toPackage').select2({
        placeholder: 'Pilih paket...',
        allowClear: true
      });
    } else {
      console.error('Select2 not loaded');
    }
  } catch (error) {
    console.error('Error in document ready:', error);
  }
});

// Format rupiah
function formatRupiah(angka) {
  if (!angka) return 'Rp 0';
  const number_string = angka.toString();
  const split = number_string.split(',');
  const sisa = split[0].length % 3;
  let rupiah = split[0].substr(0, sisa);
  const ribuan = split[0].substr(sisa).match(/\d{3}/gi);

  if (ribuan) {
    const separator = sisa ? '.' : '';
    rupiah += separator + ribuan.join('.');
  }

  rupiah = split[1] != undefined ? rupiah + ',' + split[1] : rupiah;
  return 'Rp ' + rupiah;
}

function loadPackages() {
  console.log('Loading packages...');
  $.ajax({
    url: '/api/packages',
    method: 'GET',
    success: function(response) {
      console.log('Packages loaded:', response);
      packages = response.data || response;
      populatePackageSelects();
    },
    error: function(xhr) {
      console.error('Failed to load packages:', xhr);
      Swal.fire('Error', 'Gagal memuat daftar paket', 'error');
    }
  });
}

function populatePackageSelects() {
  const fromSelect = $('#fromPackage');
  const toSelect = $('#toPackage');
  
  fromSelect.empty();
  toSelect.empty();
  
  packages.forEach(pkg => {
    const option = `<option value="${pkg.id}" data-name="${pkg.name}" data-price="${pkg.price}">${pkg.name} (${formatRupiah(pkg.price)})</option>`;
    fromSelect.append(option);
    toSelect.append(option);
  });
  
  fromSelect.trigger('change');
  toSelect.trigger('change');
}

function loadConfiguration() {
  console.log('Loading configuration...');
  $.ajax({
    url: '/api/speed-boost-config',
    method: 'GET',
    success: function(response) {
      console.log('Configuration loaded:', response);
      speedBoostConfig = response;
      populateConfiguration();
    },
    error: function(xhr) {
      console.log('Configuration not found, using defaults. Error:', xhr);
      // Use default config if not found
      speedBoostConfig = {
        enabled: true,
        globalSettings: {
          allowMultipleBoosts: false,
          requirePaymentFirst: true,
          autoApproveDoubleBoost: true,
          maxBoostDuration: 30,
          minBoostDuration: 1
        },
        pricingMatrix: [],
        customPackages: [],
        paymentMethods: {
          cash: { enabled: true, autoApprove: false },
          transfer: { enabled: true, requireProof: true },
          double_billing: { enabled: true, maxAmount: 500000 }
        },
        templates: {
          welcomeMessage: '🚀 *SPEED BOOST ON DEMAND*\n\nTingkatkan kecepatan internet Anda sesuai kebutuhan!',
          successMessage: '✅ Request Speed Boost berhasil dibuat!\n\nID: {requestId}\nPaket: {packageName}\nDurasi: {duration}\nHarga: {price}',
          rejectionMessage: '❌ Maaf, request Speed Boost Anda ditolak.\n\nAlasan: {reason}'
        }
      };
      populateConfiguration();
    }
  });
}

function populateConfiguration() {
  console.log('Populating configuration with:', speedBoostConfig);
  
  // Global settings
  $('#speedBoostEnabled').val(String(resolveBoolean(speedBoostConfig.enabled, true)));
  $('#allowMultipleBoosts').val(String(resolveBoolean(speedBoostConfig.globalSettings?.allowMultipleBoosts, false)));
  $('#requirePaymentFirst').val(String(resolveBoolean(speedBoostConfig.globalSettings?.requirePaymentFirst, true)));
  $('#autoApproveDoubleBoost').val(String(resolveBoolean(speedBoostConfig.globalSettings?.autoApproveDoubleBoost, true)));
  $('#maxBoostDuration').val(resolveNumber(speedBoostConfig.globalSettings?.maxBoostDuration, 30));
  $('#minBoostDuration').val(resolveNumber(speedBoostConfig.globalSettings?.minBoostDuration, 1));
  
  // Payment methods with defaults
  $('#payment_cash_enabled').val(String(speedBoostConfig.paymentMethods?.cash?.enabled ?? true));
  $('#payment_cash_autoApprove').val(String(speedBoostConfig.paymentMethods?.cash?.autoApprove ?? false));
  $('#payment_transfer_enabled').val(String(speedBoostConfig.paymentMethods?.transfer?.enabled ?? true));
  $('#payment_transfer_requireProof').val(String(speedBoostConfig.paymentMethods?.transfer?.requireProof ?? true));
  $('#payment_double_enabled').val(String(speedBoostConfig.paymentMethods?.double_billing?.enabled ?? true));
  $('#payment_double_maxAmount').val(resolveNumber(speedBoostConfig.paymentMethods?.double_billing?.maxAmount, 500000));
  
  // Templates - handle escaped newlines and ensure they display
  const welcomeMsg = speedBoostConfig.templates?.welcomeMessage || '🚀 *SPEED BOOST ON DEMAND*\n\nTingkatkan kecepatan internet Anda sesuai kebutuhan!';
  const successMsg = speedBoostConfig.templates?.successMessage || '✅ Request Speed Boost berhasil dibuat!\n\nID: {requestId}\nPaket: {packageName}\nDurasi: {duration}\nHarga: {price}';
  const rejectionMsg = speedBoostConfig.templates?.rejectionMessage || '❌ Maaf, request Speed Boost Anda ditolak.\n\nAlasan: {reason}';
  
  // Replace escaped newlines with actual newlines for display
  $('#template_welcome').val(welcomeMsg.replace(/\\n/g, '\n'));
  $('#template_success').val(successMsg.replace(/\\n/g, '\n'));
  $('#template_rejection').val(rejectionMsg.replace(/\\n/g, '\n'));
  
  console.log('Templates loaded:', {
    welcome: welcomeMsg,
    success: successMsg,
    rejection: rejectionMsg
  });
  
  // Display pricing matrix
  displayPricingMatrix();
  displayCustomPackages();
}

function displayPricingMatrix() {
  const container = $('#pricingMatrixList');
  container.empty();
  
  if (!speedBoostConfig.pricingMatrix || speedBoostConfig.pricingMatrix.length === 0) {
    container.html('<div class="alert alert-info">Belum ada pricing matrix. Silakan tambahkan.</div>');
    return;
  }
  
  speedBoostConfig.pricingMatrix.forEach((matrix, index) => {
    const matrixHtml = createMatrixCard(matrix, index);
    container.append(matrixHtml);
  });
}

function createMatrixCard(matrix, index) {
  const fromPackages = Array.isArray(matrix.fromPackages) ? matrix.fromPackages : [matrix.fromPackages];
  const fromBadges = fromPackages.map(p => `<span class="package-badge from-package">${p.name}</span>`).join('');
  
  let durationsHtml = '';
  Object.entries(matrix.prices || {}).forEach(([key, price]) => {
    const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    durationsHtml += `
      <div class="duration-item">
        <label>${label}</label>
        <input type="number" class="form-control" value="${price}" 
               onchange="updateMatrixPrice(${index}, '${key}', this.value)">
      </div>
    `;
  });
  
  return `
    <div class="pricing-matrix-card">
      <div class="matrix-header">
        <div>
          <div class="mb-2">
            <strong>Dari:</strong> ${fromBadges}
          </div>
          <div>
            <strong>Ke:</strong> <span class="package-badge to-package">${matrix.toPackage.name}</span>
          </div>
        </div>
        <button class="btn btn-danger btn-sm" onclick="removeMatrix(${index})">
          <i class="fas fa-trash"></i> Hapus
        </button>
      </div>
      <div class="duration-prices">
        ${durationsHtml}
      </div>
    </div>
  `;
}

function addPricingMatrix() {
  const fromPackages = $('#fromPackage').val();
  const toPackageId = $('#toPackage').val();
  
  if (!fromPackages || fromPackages.length === 0) {
    Swal.fire('Error', 'Pilih minimal satu paket asal', 'error');
    return;
  }
  
  if (!toPackageId) {
    Swal.fire('Error', 'Pilih paket tujuan', 'error');
    return;
  }
  
  // Get package details
  const fromPkgs = fromPackages.map(id => {
    const pkg = packages.find(p => p.id == id);
    return { id: pkg.id, name: pkg.name, price: pkg.price };
  });
  
  const toPkg = packages.find(p => p.id == toPackageId);
  
  // Check if any from package has lower or equal price than to package
  const invalidPackages = fromPkgs.filter(p => Number(p.price) >= Number(toPkg.price));
  if (invalidPackages.length > 0) {
    Swal.fire('Error', 'Paket tujuan harus memiliki harga lebih tinggi dari paket asal', 'error');
    return;
  }
  
  // Check if matrix already exists
  const existingMatrix = speedBoostConfig.pricingMatrix?.find(m => {
    const existingFromIds = (Array.isArray(m.fromPackages) ? m.fromPackages : [m.fromPackages]).map(p => p.id);
    const newFromIds = fromPkgs.map(p => p.id);
    return m.toPackage.id == toPkg.id && 
           existingFromIds.some(id => newFromIds.includes(id));
  });
  
  if (existingMatrix) {
    Swal.fire('Error', 'Matrix dengan kombinasi paket ini sudah ada', 'error');
    return;
  }
  
  // Store temp matrix
  tempMatrix = {
    fromPackages: fromPkgs,
    toPackage: { id: toPkg.id, name: toPkg.name, price: toPkg.price },
    prices: {}
  };
  
  // Show pricing input
  $('#newMatrixPricing').show();
}

function saveTempMatrix() {
  if (!tempMatrix) return;
  
  // Get all prices
  tempMatrix.prices = {};
  $('#newMatrixDurations input').each(function() {
    const id = $(this).attr('id');
    if (id && id.startsWith('price_')) {
      const key = id.replace('price_', '');
      const value = $(this).val();
      if (value) {
        tempMatrix.prices[key] = Number(value);
      }
    }
  });
  
  if (Object.keys(tempMatrix.prices).length === 0) {
    Swal.fire('Error', 'Masukkan minimal satu harga', 'error');
    return;
  }
  
  // Add to config
  if (!speedBoostConfig.pricingMatrix) {
    speedBoostConfig.pricingMatrix = [];
  }
  speedBoostConfig.pricingMatrix.push(tempMatrix);
  
  // Reset
  tempMatrix = null;
  $('#newMatrixPricing').hide();
  $('#newMatrixDurations').html(`
    <div class="duration-item">
      <label>Harga 1 Hari</label>
      <input type="number" class="form-control" id="price_1_day" placeholder="20000">
    </div>
    <div class="duration-item">
      <label>Harga 3 Hari</label>
      <input type="number" class="form-control" id="price_3_days" placeholder="50000">
    </div>
    <div class="duration-item">
      <label>Harga 7 Hari</label>
      <input type="number" class="form-control" id="price_7_days" placeholder="100000">
    </div>
  `);
  $('#customDurations').empty();
  $('#fromPackage').val(null).trigger('change');
  $('#toPackage').val(null).trigger('change');
  
  // Refresh display
  displayPricingMatrix();
  
  Swal.fire('Success', 'Pricing matrix berhasil ditambahkan', 'success');
}

function addCustomDuration() {
  const container = $('#customDurations');
  const id = Date.now();
  
  const html = `
    <div class="custom-duration-input" id="custom_${id}">
      <input type="number" class="form-control" placeholder="Durasi (hari)" id="days_${id}">
      <input type="number" class="form-control" placeholder="Harga" id="price_custom_${id}">
      <button class="btn btn-success" onclick="saveCustomDuration(${id})">
        <i class="fas fa-check"></i>
      </button>
      <button class="btn btn-danger" onclick="$('#custom_${id}').remove()">
        <i class="fas fa-times"></i>
      </button>
    </div>
  `;
  
  container.append(html);
}

function saveCustomDuration(id) {
  const days = $(`#days_${id}`).val();
  const price = $(`#price_custom_${id}`).val();
  
  if (!days || !price) {
    Swal.fire('Error', 'Masukkan durasi dan harga', 'error');
    return;
  }
  
  const key = days == 1 ? '1_day' : `${days}_days`;
  const label = `Harga ${days} Hari`;
  
  // Check if duration already exists
  if ($(`#price_${key}`).length > 0) {
    Swal.fire('Error', `Durasi ${days} hari sudah ada`, 'error');
    return;
  }
  
  // Add to new matrix durations
  const html = `
    <div class="duration-item">
      <label>${label}</label>
      <input type="number" class="form-control" id="price_${key}" value="${price}">
    </div>
  `;
  
  $('#newMatrixDurations').append(html);
  $(`#custom_${id}`).remove();
}

function updateMatrixPrice(index, key, value) {
  if (speedBoostConfig.pricingMatrix[index]) {
    speedBoostConfig.pricingMatrix[index].prices[key] = Number(value);
  }
}

function removeMatrix(index) {
  Swal.fire({
    title: 'Hapus Matrix?',
    text: 'Matrix pricing ini akan dihapus',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Hapus',
    cancelButtonText: 'Batal'
  }).then((result) => {
    if (result.isConfirmed) {
      speedBoostConfig.pricingMatrix.splice(index, 1);
      displayPricingMatrix();
      Swal.fire('Deleted!', 'Matrix berhasil dihapus', 'success');
    }
  });
}

function addCustomPackage() {
  Swal.fire({
    title: 'Tambah Custom Package',
    html: `
      <input id="swal-name" class="swal2-input" placeholder="Nama Package">
      <input id="swal-speed" class="swal2-input" placeholder="Kecepatan (Mbps)">
      <input id="swal-price" type="number" class="swal2-input" placeholder="Harga Bulanan">
      <hr>
      <h5>Harga Speed Boost</h5>
      <input id="swal-1day" type="number" class="swal2-input" placeholder="Harga 1 Hari">
      <input id="swal-3days" type="number" class="swal2-input" placeholder="Harga 3 Hari">
      <input id="swal-7days" type="number" class="swal2-input" placeholder="Harga 7 Hari">
    `,
    focusConfirm: false,
    preConfirm: () => {
      const name = document.getElementById('swal-name').value;
      const speed = document.getElementById('swal-speed').value;
      const price = document.getElementById('swal-price').value;
      const price1Day = document.getElementById('swal-1day').value;
      const price3Days = document.getElementById('swal-3days').value;
      const price7Days = document.getElementById('swal-7days').value;
      
      if (!name || !speed || !price) {
        Swal.showValidationMessage('Lengkapi nama, kecepatan, dan harga bulanan');
        return false;
      }
      
      return {
        id: 'custom_' + Date.now(),
        name: name,
        speed: speed,
        price: Number(price),
        speedBoostPrices: {
          '1_day': Number(price1Day) || 0,
          '3_days': Number(price3Days) || 0,
          '7_days': Number(price7Days) || 0
        }
      };
    }
  }).then((result) => {
    if (result.isConfirmed) {
      if (!speedBoostConfig.customPackages) {
        speedBoostConfig.customPackages = [];
      }
      speedBoostConfig.customPackages.push(result.value);
      displayCustomPackages();
      Swal.fire('Success', 'Custom package berhasil ditambahkan', 'success');
    }
  });
}

function displayCustomPackages() {
  const container = $('#customPackagesList');
  container.empty();
  
  if (!speedBoostConfig.customPackages || speedBoostConfig.customPackages.length === 0) {
    container.html('<div class="alert alert-info">Belum ada custom package. Silakan tambahkan.</div>');
    return;
  }
  
  speedBoostConfig.customPackages.forEach((pkg, index) => {
    const html = `
      <div class="custom-package-item">
        <div class="custom-package-info">
          <h6>${pkg.name} <span class="speed-badge">${pkg.speed} Mbps</span> <span class="price-badge">${formatRupiah(pkg.price)}/bulan</span></h6>
          <p>
            1 Hari: ${formatRupiah(pkg.speedBoostPrices['1_day'])} | 
            3 Hari: ${formatRupiah(pkg.speedBoostPrices['3_days'])} | 
            7 Hari: ${formatRupiah(pkg.speedBoostPrices['7_days'])}
          </p>
        </div>
        <button class="btn btn-danger btn-sm" onclick="removeCustomPackage(${index})">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    `;
    container.append(html);
  });
}

function removeCustomPackage(index) {
  Swal.fire({
    title: 'Hapus Custom Package?',
    text: 'Package ini akan dihapus',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Hapus',
    cancelButtonText: 'Batal'
  }).then((result) => {
    if (result.isConfirmed) {
      speedBoostConfig.customPackages.splice(index, 1);
      displayCustomPackages();
      Swal.fire('Deleted!', 'Custom package berhasil dihapus', 'success');
    }
  });
}

// Save configuration function
function saveConfiguration() {
  // Collect all settings
  speedBoostConfig.enabled = $('#speedBoostEnabled').val() === 'true';
  speedBoostConfig.globalSettings = {
    allowMultipleBoosts: $('#allowMultipleBoosts').val() === 'true',
    requirePaymentFirst: $('#requirePaymentFirst').val() === 'true',
    autoApproveDoubleBoost: $('#autoApproveDoubleBoost').val() === 'true',
    maxBoostDuration: Number($('#maxBoostDuration').val()),
    minBoostDuration: Number($('#minBoostDuration').val())
  };
  
  speedBoostConfig.paymentMethods = {
    cash: {
      enabled: $('#payment_cash_enabled').val() === 'true',
      label: 'Bayar Tunai',
      requireProof: false,
      autoApprove: $('#payment_cash_autoApprove').val() === 'true'
    },
    transfer: {
      enabled: $('#payment_transfer_enabled').val() === 'true',
      label: 'Transfer Bank',
      requireProof: $('#payment_transfer_requireProof').val() === 'true',
      autoApprove: false
    },
    double_billing: {
      enabled: $('#payment_double_enabled').val() === 'true',
      label: 'Double Billing',
      requireProof: false,
      autoApprove: true,
      maxAmount: Number($('#payment_double_maxAmount').val())
    }
  };
  
  speedBoostConfig.templates = {
    welcomeMessage: $('#template_welcome').val(),
    successMessage: $('#template_success').val(),
    rejectionMessage: $('#template_rejection').val()
  };
  
  speedBoostConfig.lastUpdated = new Date().toISOString();
  
  console.log('Saving config:', speedBoostConfig);
  
  // Validate config structure before save
  const validationErrors = [];
  
  // Validate globalSettings
  if (!speedBoostConfig.globalSettings) {
    validationErrors.push('Pengaturan global tidak boleh kosong');
  } else {
    if (typeof speedBoostConfig.globalSettings.maxBoostDuration !== 'number' || speedBoostConfig.globalSettings.maxBoostDuration < 1) {
      validationErrors.push('Max durasi harus berupa angka dan minimal 1 hari');
    }
    if (typeof speedBoostConfig.globalSettings.minBoostDuration !== 'number' || speedBoostConfig.globalSettings.minBoostDuration < 1) {
      validationErrors.push('Min durasi harus berupa angka dan minimal 1 hari');
    }
    if (speedBoostConfig.globalSettings.minBoostDuration > speedBoostConfig.globalSettings.maxBoostDuration) {
      validationErrors.push('Min durasi tidak boleh lebih besar dari max durasi');
    }
  }
  
  // Validate paymentMethods
  if (!speedBoostConfig.paymentMethods) {
    validationErrors.push('Metode pembayaran tidak boleh kosong');
  } else {
    const requiredMethods = ['cash', 'transfer', 'double_billing'];
    requiredMethods.forEach(method => {
      if (!speedBoostConfig.paymentMethods[method]) {
        validationErrors.push(`Metode pembayaran ${method} tidak ditemukan`);
      }
    });
  }
  
  // Validate pricingMatrix (should be array)
  if (!Array.isArray(speedBoostConfig.pricingMatrix)) {
    validationErrors.push('Pricing matrix harus berupa array');
  }
  
  // Validate customPackages (should be array)
  if (!Array.isArray(speedBoostConfig.customPackages)) {
    validationErrors.push('Custom packages harus berupa array');
  }
  
  // Show validation errors if any
  if (validationErrors.length > 0) {
    Swal.fire({
      icon: 'error',
      title: 'Validasi Gagal',
      html: '<ul style="text-align: left;"><li>' + validationErrors.join('</li><li>') + '</li></ul>',
      confirmButtonText: 'OK'
    });
    return;
  }
  
  // Save to server
  // Ensure templates are not empty
  if (!speedBoostConfig.templates) {
    speedBoostConfig.templates = {};
  }
  if (!speedBoostConfig.templates.welcomeMessage) {
    speedBoostConfig.templates.welcomeMessage = '🚀 *SPEED BOOST ON DEMAND*\n\nTingkatkan kecepatan internet Anda sesuai kebutuhan!';
  }
  if (!speedBoostConfig.templates.successMessage) {
    speedBoostConfig.templates.successMessage = '✅ Request Speed Boost berhasil dibuat!\n\nID: {requestId}\nPaket: {packageName}\nDurasi: {duration}\nHarga: {price}';
  }
  if (!speedBoostConfig.templates.rejectionMessage) {
    speedBoostConfig.templates.rejectionMessage = '❌ Maaf, request Speed Boost Anda ditolak.\n\nAlasan: {reason}';
  }
  
  $.ajax({
    url: '/api/speed-boost-config',
    method: 'POST',
    contentType: 'application/json',
    data: JSON.stringify(speedBoostConfig),
    success: function(response) {
      console.log('Save success:', response);
      Swal.fire('Success', 'Konfigurasi berhasil disimpan', 'success');
      // Reload configuration to ensure sync
      loadConfiguration();
    },
    error: function(xhr) {
      console.error('Save error:', xhr);
      const errorMsg = xhr.responseJSON?.message || xhr.statusText || 'Unknown error';
      console.error('Full error details:', {
        status: xhr.status,
        statusText: xhr.statusText,
        responseJSON: xhr.responseJSON,
        responseText: xhr.responseText
      });
      Swal.fire('Error', 'Gagal menyimpan konfigurasi: ' + errorMsg, 'error');
    }
  });
}

// Expose functions to window for onclick handlers
window.saveConfiguration = saveConfiguration;
window.addPricingMatrix = addPricingMatrix;
window.saveTempMatrix = saveTempMatrix;
window.addCustomDuration = addCustomDuration;
window.saveCustomDuration = saveCustomDuration;
window.updateMatrixPrice = updateMatrixPrice;
window.removeMatrix = removeMatrix;
window.addCustomPackage = addCustomPackage;
window.removeCustomPackage = removeCustomPackage;
window.displayCustomPackages = displayCustomPackages;
