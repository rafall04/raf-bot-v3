        let parameters = [];

        // Load parameters on page load
        $(document).ready(function() {
            loadParameters();
            
            // Get current user
            fetch('/api/me', { credentials: 'include' })
                .then(response => response.json())
                .then(data => {
                    if (data.status === 200 && data.data && data.data.username) {
                        $('#username-placeholder').text(data.data.username);
                    }
                }).catch(err => console.warn("Could not fetch user data: ", err));
        });

        async function loadParameters() {
            try {
                const response = await fetch('/api/genieacs-parameters', { credentials: 'include' });
                const result = await response.json();
                
                if (result.status === 200) {
                    parameters = result.data;
                    renderParameters();
                } else {
                    console.error('Failed to load parameters:', result.message);
                    showAlert('Gagal memuat parameter: ' + result.message, 'danger');
                }
            } catch (error) {
                console.error('Error loading parameters:', error);
                showAlert('Error memuat parameter: ' + error.message, 'danger');
            }
        }

        function renderParameters() {
            const container = $('#parametersContainer');
            container.empty();

            if (parameters.length === 0) {
                container.html(`
                    <div class="text-center py-4">
                        <i class="fas fa-cogs fa-3x text-gray-300 mb-3"></i>
                        <h5 class="text-gray-500">Belum ada parameter yang dikonfigurasi</h5>
                        <p class="text-gray-400">Klik "Tambah Parameter Baru" untuk memulai</p>
                    </div>
                `);
                return;
            }

            parameters.forEach(param => {
                let badgeColor = 'info';
                if (param.type === 'redaman') badgeColor = 'primary';
                else if (param.type === 'temperature') badgeColor = 'warning';
                else if (param.type === 'serialNumber') badgeColor = 'success';
                
                const pathsHtml = param.paths.map(path => 
                    `<code class="d-block mb-1">${path}</code>`
                ).join('');

                const card = $(`
                    <div class="parameter-card card">
                        <div class="card-body">
                            <div class="d-flex justify-content-between align-items-start mb-2">
                                <div>
                                    <h6 class="card-title mb-1">
                                        ${param.name}
                                        <span class="badge badge-${badgeColor} parameter-type-badge ml-2">${param.type.toUpperCase()}</span>
                                    </h6>
                                    <p class="card-text text-muted small mb-2">${param.description || 'Tidak ada deskripsi'}</p>
                                </div>
                                <div class="btn-group">
                                    <button class="btn btn-sm btn-outline-primary" onclick="editParameter('${param.id}')">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="btn btn-sm btn-outline-danger" onclick="deleteParameter('${param.id}')">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </div>
                            </div>
                            <div>
                                <small class="text-muted d-block mb-1"><strong>GenieACS Paths:</strong></small>
                                ${pathsHtml}
                            </div>
                        </div>
                    </div>
                `);
                
                container.append(card);
            });
        }

        function addPath() {
            const pathItem = $(`
                <div class="path-item">
                    <input type="text" class="form-control path-input" placeholder="e.g., VirtualParameters.Temperature" required>
                    <button type="button" class="btn btn-danger btn-sm btn-remove" onclick="removePath(this)">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `);
            $('#pathsContainer').append(pathItem);
        }

        function addEditPath() {
            const pathItem = $(`
                <div class="path-item">
                    <input type="text" class="form-control path-input" placeholder="e.g., VirtualParameters.Temperature" required>
                    <button type="button" class="btn btn-danger btn-sm btn-remove" onclick="removePath(this)">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `);
            $('#editPathsContainer').append(pathItem);
        }

        function removePath(button) {
            $(button).closest('.path-item').remove();
        }

        async function saveParameter() {
            const type = $('#parameterType').val();
            const name = $('#parameterName').val();
            const description = $('#parameterDescription').val();
            const paths = [];
            
            $('#pathsContainer .path-input').each(function() {
                const path = $(this).val().trim();
                if (path) paths.push(path);
            });

            if (!type || !name || paths.length === 0) {
                showAlert('Semua field wajib diisi dan minimal satu path harus ada', 'warning');
                return;
            }

            try {
                const response = await fetch('/api/genieacs-parameters', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include', // ✅ Fixed by script
                    body: JSON.stringify({
                        type,
                        name,
                        description,
                        paths
                    })
                });

                const result = await response.json();
                
                if (result.status === 200) {
                    $('#addParameterModal').modal('hide');
                    $('#addParameterForm')[0].reset();
                    $('#pathsContainer').html(`
                        <div class="path-item">
                            <input type="text" class="form-control path-input" placeholder="e.g., VirtualParameters.RXPower" required>
                            <button type="button" class="btn btn-danger btn-sm btn-remove" onclick="removePath(this)">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    `);
                    loadParameters();
                    showAlert('Parameter berhasil disimpan', 'success');
                } else {
                    showAlert('Gagal menyimpan parameter: ' + result.message, 'danger');
                }
            } catch (error) {
                console.error('Error saving parameter:', error);
                showAlert('Error menyimpan parameter: ' + error.message, 'danger');
            }
        }

        function editParameter(id) {
            const param = parameters.find(p => p.id === id);
            if (!param) return;

            $('#editParameterId').val(param.id);
            $('#editParameterType').val(param.type);
            $('#editParameterName').val(param.name);
            $('#editParameterDescription').val(param.description || '');
            
            // Clear and populate paths
            const pathsContainer = $('#editPathsContainer');
            pathsContainer.empty();
            
            param.paths.forEach(path => {
                const pathItem = $(`
                    <div class="path-item">
                        <input type="text" class="form-control path-input" value="${path}" required>
                        <button type="button" class="btn btn-danger btn-sm btn-remove" onclick="removePath(this)">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                `);
                pathsContainer.append(pathItem);
            });

            $('#editParameterModal').modal('show');
        }

        async function updateParameter() {
            const id = $('#editParameterId').val();
            const type = $('#editParameterType').val();
            const name = $('#editParameterName').val();
            const description = $('#editParameterDescription').val();
            const paths = [];
            
            $('#editPathsContainer .path-input').each(function() {
                const path = $(this).val().trim();
                if (path) paths.push(path);
            });

            if (!type || !name || paths.length === 0) {
                showAlert('Semua field wajib diisi dan minimal satu path harus ada', 'warning');
                return;
            }

            try {
                const response = await fetch(`/api/genieacs-parameters/${id}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include', // ✅ Fixed by script
                    body: JSON.stringify({
                        type,
                        name,
                        description,
                        paths
                    })
                });

                const result = await response.json();
                
                if (result.status === 200) {
                    $('#editParameterModal').modal('hide');
                    loadParameters();
                    showAlert('Parameter berhasil diupdate', 'success');
                } else {
                    showAlert('Gagal mengupdate parameter: ' + result.message, 'danger');
                }
            } catch (error) {
                console.error('Error updating parameter:', error);
                showAlert('Error mengupdate parameter: ' + error.message, 'danger');
            }
        }

        async function deleteParameter(id) {
            if (!confirm('Yakin ingin menghapus parameter ini?')) return;

            try {
                const response = await fetch(`/api/genieacs-parameters/${id}`, {
                    method: 'DELETE',
                    credentials: 'include'
                });

                const result = await response.json();
                
                if (result.status === 200) {
                    loadParameters();
                    showAlert('Parameter berhasil dihapus', 'success');
                } else {
                    showAlert('Gagal menghapus parameter: ' + result.message, 'danger');
                }
            } catch (error) {
                console.error('Error deleting parameter:', error);
                showAlert('Error menghapus parameter: ' + error.message, 'danger');
            }
        }

        async function testParameter() {
            const deviceId = $('#testDeviceId').val().trim();
            const parameterType = $('#testParameterType').val();
            
            if (!deviceId) {
                showAlert('Device ID harus diisi', 'warning');
                return;
            }

            $('#testParameterBtn').prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Testing...');
            $('#testResults').empty();

            try {
                const response = await fetch('/api/test-parameter', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include', // ✅ Fixed by script
                    body: JSON.stringify({
                        deviceId,
                        parameterType
                    })
                });

                const result = await response.json();
                
                let resultClass = 'test-success';
                let icon = 'fas fa-check-circle';
                
                if (result.status !== 200) {
                    resultClass = 'test-error';
                    icon = 'fas fa-times-circle';
                } else if (!result.data.value) {
                    resultClass = 'test-warning';
                    icon = 'fas fa-exclamation-triangle';
                }

                const messageHtml = result.message ? '<p><strong>Message:</strong> ' + result.message + '</p>' : '';
                $('#testResults').html(`
                    <div class="${resultClass}">
                        <h6><i class="${icon}"></i> Test Result</h6>
                        <p><strong>Device ID:</strong> ${deviceId}</p>
                        <p><strong>Parameter:</strong> ${parameterType}</p>
                        <p><strong>Value:</strong> ${result.data?.value || 'N/A'}</p>
                        <p><strong>Path Found:</strong> ${result.data?.pathFound || 'None'}</p>
                        ${messageHtml}
                    </div>
                `);
                
            } catch (error) {
                console.error('Error testing parameter:', error);
                $('#testResults').html(`
                    <div class="test-error">
                        <h6><i class="fas fa-times-circle"></i> Test Error</h6>
                        <p>Error: ${error.message}</p>
                    </div>
                `);
            } finally {
                $('#testParameterBtn').prop('disabled', false).html('<i class="fas fa-vial"></i> Test Parameter');
            }
        }

        $('#testParameterBtn').click(testParameter);

        // Test Custom Parameter (not registered)
        async function testCustomParameter() {
            const deviceId = $('#testCustomDeviceId').val().trim();
            const parameterPath = $('#testCustomParameterPath').val().trim();
            
            if (!deviceId) {
                showAlert('Device ID harus diisi', 'warning');
                return;
            }
            
            if (!parameterPath) {
                showAlert('Parameter Path harus diisi', 'warning');
                return;
            }

            $('#testCustomParameterBtn').prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Testing...');
            $('#testCustomResults').empty();

            try {
                const response = await fetch('/api/test-parameter-custom', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include',
                    body: JSON.stringify({
                        deviceId,
                        parameterPath
                    })
                });

                const result = await response.json();
                
                let resultClass = 'test-success';
                let icon = 'fas fa-check-circle';
                
                if (result.status !== 200) {
                    resultClass = 'test-error';
                    icon = 'fas fa-times-circle';
                } else if (result.data.value === null || result.data.value === undefined) {
                    resultClass = 'test-warning';
                    icon = 'fas fa-exclamation-triangle';
                }

                let valueDisplay = 'N/A';
                if (result.data.value !== null && result.data.value !== undefined) {
                    if (typeof result.data.value === 'object') {
                        valueDisplay = JSON.stringify(result.data.value, null, 2);
                    } else {
                        valueDisplay = String(result.data.value);
                    }
                }

                const messageHtml = result.message ? '<p><strong>Message:</strong> ' + result.message + '</p>' : '';
                const rawValueHtml = result.data.rawValue ? '<p><strong>Raw Value (JSON):</strong><pre class="bg-light p-2 rounded mt-2" style="max-height: 200px; overflow-y: auto;">' + JSON.stringify(result.data.rawValue, null, 2) + '</pre></p>' : '';
                
                $('#testCustomResults').html(`
                    <div class="test-result ${resultClass}">
                        <h6><i class="${icon}"></i> Test Result</h6>
                        <p><strong>Device ID:</strong> ${deviceId}</p>
                        <p><strong>Parameter Path:</strong> <code>${parameterPath}</code></p>
                        <p><strong>Value:</strong> <code>${valueDisplay}</code></p>
                        <p><strong>Value Type:</strong> ${result.data.valueType || 'N/A'}</p>
                        ${rawValueHtml}
                        ${messageHtml}
                    </div>
                `);
                
            } catch (error) {
                console.error('Error testing custom parameter:', error);
                $('#testCustomResults').html(`
                    <div class="test-result test-error">
                        <h6><i class="fas fa-times-circle"></i> Test Error</h6>
                        <p>Error: ${error.message}</p>
                    </div>
                `);
            } finally {
                $('#testCustomParameterBtn').prop('disabled', false).html('<i class="fas fa-flask"></i> Test');
            }
        }

        $('#testCustomParameterBtn').click(testCustomParameter);

        function showAlert(message, type) {
            const alert = $(`
                <div class="alert alert-${type} alert-dismissible fade show" role="alert">
                    ${message}
                    <button type="button" class="close" data-dismiss="alert" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
            `);
            
            $('.container-fluid').prepend(alert);
            
            setTimeout(() => {
                alert.alert('close');
            }, 5000);
        }
