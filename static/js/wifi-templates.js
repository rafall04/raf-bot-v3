        $(document).ready(function() {
            let currentEditIntent = null;
            let currentDeleteIntent = null;

            // Fetch username
            fetch('/api/me', { credentials: 'include' })
                .then(response => response.json())
                .then(data => {
                    if (data.status === 200 && data.data && data.data.username) {
                        $('#username-placeholder').text(data.data.username);
                    }
                }).catch(err => console.warn("Could not fetch user data: ", err));

            // Toast notification function
            function showToast(message, type = 'success') {
                const toastId = 'toast-' + new Date().getTime();
                const bgClass = type === 'success' ? 'bg-success' : 'bg-danger';
                const toastHtml = `
                    <div id="${toastId}" class="toast ${bgClass} text-white" role="alert" aria-live="assertive" aria-atomic="true" data-delay="5000">
                        <div class="toast-header ${bgClass} text-white">
                            <strong class="mr-auto">${type === 'success' ? 'Berhasil' : 'Error'}</strong>
                            <button type="button" class="ml-2 mb-1 close text-white" data-dismiss="toast" aria-label="Close">
                                <span aria-hidden="true">&times;</span>
                            </button>
                        </div>
                        <div class="toast-body">
                            ${message}
                        </div>
                    </div>`;
                $('.toast-container').append(toastHtml);
                $(`#${toastId}`).toast('show');
                $(`#${toastId}`).on('hidden.bs.toast', function () {
                    $(this).remove();
                });
            }

            // Category color mapping
            const categoryColors = {
                'wifi': 'primary',
                'customer': 'success',
                'support': 'danger',
                'saldo': 'warning',
                'voucher': 'info',
                'help': 'secondary',
                'greeting': 'dark',
                'agent': 'success',
                'admin': 'danger',
                'menu': 'info',
                'speedboost': 'warning'
            };

            const categoryLabels = {
                'wifi': '📡 WiFi',
                'customer': '👤 Customer',
                'support': '🚨 Support',
                'saldo': '💳 Saldo',
                'voucher': '🎫 Voucher',
                'help': '❓ Help',
                'greeting': '👋 Greeting',
                'agent': '🏪 Agent',
                'admin': '👨‍💼 Admin',
                'menu': '📋 Menu',
                'speedboost': '⚡ Speed'
            };

            // Load templates
            function loadTemplates() {
                const container = $('#templatesContainer');
                container.html('<div class="text-center"><div class="spinner-border text-primary" role="status"><span class="sr-only">Loading...</span></div><p>Memuat templates...</p></div>');
                
                fetch('/api/wifi-templates', { credentials: 'include' })
                    .then(response => {
                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }
                        return response.json();
                    })
                    .then(result => {
                        if (result.status !== 200) {
                            throw new Error(result.message || 'Gagal memuat templates');
                        }
                        
                        const templates = result.data;
                        container.empty();

                        if (!templates || templates.length === 0) {
                            container.html('<div class="alert alert-info"><i class="fas fa-info-circle"></i> Belum ada template. Silakan tambah template baru.</div>');
                            return;
                        }

                        // Calculate statistics
                        const totalTemplates = templates.length;
                        const totalKeywords = templates.reduce((sum, t) => sum + t.keywords.length, 0);
                        const categories = [...new Set(templates.map(t => t.category || 'other'))];
                        const totalCategories = categories.length;

                        $('#total-templates').text(totalTemplates);
                        $('#total-keywords').text(totalKeywords);

                        // Update category counters
                        const categoryCounts = {};
                        templates.forEach(t => {
                            const cat = t.category || 'other';
                            categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
                        });

                        // Update tab counters
                        $('#count-all').text(totalTemplates);
                        Object.keys(categoryCounts).forEach(cat => {
                            $(`#count-${cat}`).text(categoryCounts[cat] || 0);
                        });

                        // Set all undefined counters to 0
                        ['wifi', 'customer', 'support', 'saldo', 'agent', 'admin', 'voucher', 'menu', 'speedboost', 'help', 'greeting'].forEach(cat => {
                            if (!categoryCounts[cat]) {
                                $(`#count-${cat}`).text(0);
                            }
                        });

                        templates.forEach(template => {
                            const category = template.category || 'other';
                            const categoryColor = categoryColors[category] || 'secondary';
                            const icon = template.icon || '📝';
                            const description = template.description || '';

                            const keywordBadges = template.keywords.map(keyword => 
                                `<span class="badge badge-primary mr-1 mb-1">${keyword}</span>`
                            ).join('');

                            const cardHtml = `
                                <div class="card mb-3 shadow-sm" data-intent="${template.intent}" data-category="${category}">
                                    <div class="card-header card-header-actions">
                                        <div>
                                            ${icon} 
                                            <span class="badge badge-${categoryColor} mr-2">${category}</span>
                                            <span class="badge badge-info intent-badge">${template.intent}</span>
                                        </div>
                                        <div>
                                            <button class="btn btn-sm btn-warning edit-template-btn" data-intent="${template.intent}">
                                                <i class="fas fa-edit"></i> Edit
                                            </button>
                                            <button class="btn btn-sm btn-danger delete-template-btn" data-intent="${template.intent}">
                                                <i class="fas fa-trash"></i> Hapus
                                            </button>
                                        </div>
                                    </div>
                                    <div class="card-body">
                                        ${description ? `<p class="text-muted small mb-2"><em>${description}</em></p>` : ''}
                                        <h6 class="font-weight-bold mb-2">Keywords:</h6>
                                        <div class="keywords-display">
                                            ${keywordBadges}
                                        </div>
                                        <small class="text-muted">Total: ${template.keywords.length} keyword(s)</small>
                                    </div>
                                </div>
                            `;
                            container.append(cardHtml);
                        });

                        // Attach event handlers
                        $('.edit-template-btn').on('click', function() {
                            const intent = $(this).data('intent');
                            openEditModal(intent, templates);
                        });

                        $('.delete-template-btn').on('click', function() {
                            const intent = $(this).data('intent');
                            openDeleteModal(intent);
                        });
                    })
                    .catch(error => {
                        console.error('Error loading templates:', error);
                        container.html('<div class="alert alert-danger"><i class="fas fa-exclamation-triangle"></i> Gagal memuat templates. Silakan refresh halaman.</div>');
                    });
            }

            // Tab click handler
            $('#category-tabs .nav-link, #category-tabs-2 .nav-link').on('click', function(e) {
                e.preventDefault();
                
                // Remove active from all tabs
                $('#category-tabs .nav-link, #category-tabs-2 .nav-link').removeClass('active');
                
                // Add active to clicked tab
                $(this).addClass('active');
                
                const selectedCategory = $(this).data('category');
                
                // Update active category name
                const categoryName = selectedCategory === '' ? 'All' : categoryLabels[selectedCategory] || selectedCategory;
                $('#active-category-name').text(categoryName);
                
                // Update template count in statistics
                const visibleCount = selectedCategory === '' ? 
                    $('.card[data-category]').length : 
                    $(`.card[data-category="${selectedCategory}"]`).length;
                $('#total-templates').text(visibleCount);
                
                // Update keywords count for visible templates
                let visibleKeywords = 0;
                if (selectedCategory === '') {
                    $('.card[data-category]').each(function() {
                        const keywordCount = $(this).find('.badge-primary').length;
                        visibleKeywords += keywordCount;
                    });
                } else {
                    $(`.card[data-category="${selectedCategory}"]`).each(function() {
                        const keywordCount = $(this).find('.badge-primary').length;
                        visibleKeywords += keywordCount;
                    });
                }
                $('#total-keywords').text(visibleKeywords);
                
                // Filter templates with smooth animation
                if (selectedCategory === '') {
                    // Show all
                    $('.card[data-category]').removeClass('hidden').show();
                } else {
                    // Hide non-matching, show matching
                    $('.card[data-category]').each(function() {
                        if ($(this).data('category') === selectedCategory) {
                            $(this).removeClass('hidden').show();
                        } else {
                            $(this).addClass('hidden').hide();
                        }
                    });
                }
                
                // Smooth scroll to templates container
                $('html, body').animate({
                    scrollTop: $('#templatesContainer').offset().top - 100
                }, 300);
            });

            // Open edit modal
            function openEditModal(intent, templates) {
                const template = templates.find(t => t.intent === intent);
                if (!template) return;

                currentEditIntent = intent;
                $('#editIntent').val(intent);
                $('#editKeywords').val(template.keywords.join(', '));
                $('#editCategory').val(template.category || 'other');
                $('#editDescription').val(template.description || '');
                $('#editIcon').val(template.icon || '📝');
                $('#editTemplateModal').modal('show');
            }

            // Open delete modal
            function openDeleteModal(intent) {
                currentDeleteIntent = intent;
                $('#deleteIntentName').text(intent);
                $('#deleteTemplateModal').modal('show');
            }

            // Save new template
            $('#saveNewTemplateBtn').on('click', function() {
                const intent = $('#newIntent').val().trim();
                const category = $('#newCategory').val();
                const description = $('#newDescription').val().trim();
                const icon = $('#newIcon').val().trim();
                const keywordsText = $('#newKeywords').val().trim();

                if (!intent || !category || !keywordsText) {
                    showToast('Intent, category, dan keywords wajib diisi!', 'error');
                    return;
                }

                const keywords = keywordsText.split(',').map(k => k.trim()).filter(k => k !== '');

                if (keywords.length === 0) {
                    showToast('Minimal harus ada 1 keyword!', 'error');
                    return;
                }

                const button = $(this);
                const originalText = button.html();
                button.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Menyimpan...');

                const templateData = {
                    intent,
                    keywords,
                    category,
                    description,
                    icon
                };

                fetch('/api/wifi-templates', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include', // ✅ Fixed by script
                    body: JSON.stringify(templateData)
                })
                .then(response => response.json())
                .then(result => {
                    if (result.status === 201) {
                        showToast('Template berhasil ditambahkan!', 'success');
                        $('#addTemplateModal').modal('hide');
                        $('#addTemplateForm')[0].reset();
                        loadTemplates();
                    } else {
                        throw new Error(result.message || 'Gagal menambahkan template');
                    }
                })
                .catch(error => {
                    console.error('Error adding template:', error);
                    showToast(`Error: ${error.message}`, 'error');
                })
                .finally(() => {
                    button.prop('disabled', false).html(originalText);
                });
            });

            // Save edited template
            $('#saveEditTemplateBtn').on('click', function() {
                const intent = currentEditIntent;
                const keywordsText = $('#editKeywords').val().trim();
                const category = $('#editCategory').val().trim();
                const description = $('#editDescription').val().trim();
                const icon = $('#editIcon').val().trim();

                if (!keywordsText) {
                    showToast('Keywords wajib diisi!', 'error');
                    return;
                }

                if (!category) {
                    showToast('Category wajib dipilih!', 'error');
                    return;
                }

                const keywords = keywordsText.split(',').map(k => k.trim()).filter(k => k !== '');

                if (keywords.length === 0) {
                    showToast('Minimal harus ada 1 keyword!', 'error');
                    return;
                }

                const button = $(this);
                const originalText = button.html();
                button.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Menyimpan...');

                const updateData = {
                    keywords: keywords,
                    category: category,
                    description: description || '',
                    icon: icon || '📝'
                };

                fetch(`/api/wifi-templates/${intent}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include', // ✅ Fixed by script
                    body: JSON.stringify(updateData)
                })
                .then(response => response.json())
                .then(result => {
                    if (result.status === 200) {
                        showToast('Template berhasil diupdate!', 'success');
                        $('#editTemplateModal').modal('hide');
                        loadTemplates();
                    } else {
                        throw new Error(result.message || 'Gagal mengupdate template');
                    }
                })
                .catch(error => {
                    console.error('Error updating template:', error);
                    showToast(`Error: ${error.message}`, 'error');
                })
                .finally(() => {
                    button.prop('disabled', false).html(originalText);
                });
            });

            // Confirm delete
            $('#confirmDeleteBtn').on('click', function() {
                const intent = currentDeleteIntent;

                const button = $(this);
                const originalText = button.html();
                button.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Menghapus...');

                fetch(`/api/wifi-templates/${intent}`, {
                    method: 'DELETE',
                    credentials: 'include' // ✅ Fixed by script
                })
                .then(response => response.json())
                .then(result => {
                    if (result.status === 200) {
                        showToast('Template berhasil dihapus!', 'success');
                        $('#deleteTemplateModal').modal('hide');
                        loadTemplates();
                    } else {
                        throw new Error(result.message || 'Gagal menghapus template');
                    }
                })
                .catch(error => {
                    console.error('Error deleting template:', error);
                    showToast(`Error: ${error.message}`, 'error');
                })
                .finally(() => {
                    button.prop('disabled', false).html(originalText);
                });
            });

            // Initial load
            loadTemplates();
        });
