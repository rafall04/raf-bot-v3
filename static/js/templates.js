        $(document).ready(function() {
            // Fetch username
            fetch('/api/me', { credentials: 'include' })
                .then(response => response.json())
                .then(data => {
                    if (data.status === 200 && data.data && data.data.username) {
                        $('#username-placeholder').text(data.data.username);
                    }
                }).catch(err => console.warn("Could not fetch user data: ", err));

            const form = $('#templatesForm');
            let allTemplatesData = {};
            let templateCounts = {
                notification: 0,
                wifi: 0,
                response: 0,
                customer: 0,
                payment: 0,
                ticket: 0,
                command: 0,
                error: 0,
                success: 0,
                system: 0,
                menu: 0,
                report: 0
            };

            function showToast(message, type = 'success') {
                const toastId = 'toast-' + new Date().getTime();
                const toastHtml = `
                    <div id="${toastId}" class="toast" role="alert" aria-live="assertive" aria-atomic="true" data-delay="5000">
                        <div class="toast-header">
                            <strong class="mr-auto">${type === 'success' ? 'Success' : 'Error'}</strong>
                            <button type="button" class="ml-2 mb-1 close" data-dismiss="toast" aria-label="Close">
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

            function extractTemplatePlaceholders(templateText) {
                const matches = String(templateText || '').match(/\$\{([^}]+)\}/g) || [];
                return [...new Set(matches
                    .map(match => match.slice(2, -1).trim())
                    .filter(Boolean))];
            }

            function renderTemplateCard(key, templateData, groupName) {
                const cardId = `card-${groupName}-${key}`;
                const templateValue = typeof templateData === 'string' ? templateData : (templateData.template || '');
                const templateName = typeof templateData === 'string' ? key : (templateData.name || key);
                const placeholders = extractTemplatePlaceholders(templateValue);
                const placeholderText = placeholders.join(', ');
                const placeholderHint = placeholders.length > 0
                    ? `<div class="small text-muted mt-2" data-template-placeholders="${placeholderText}">
                        <i class="fas fa-code"></i> Placeholder: ${placeholders.map(placeholder => `<code>\${${placeholder}}</code>`).join(' ')}
                    </div>`
                    : `<div class="small text-muted mt-2" data-template-placeholders="">
                        <i class="fas fa-code"></i> Placeholder: -
                    </div>`;
                
                return `
                    <div class="card shadow template-card" id="${cardId}" data-template-key="${key}">
                        <div class="card-header">
                            <div class="d-flex justify-content-between align-items-center">
                                <span class="font-weight-bold">${templateName}</span>
                                <small class="text-muted">${key}</small>
                            </div>
                        </div>
                        <div class="card-body">
                            <div class="form-group mb-0">
                                <textarea class="form-control" 
                                    id="template-${groupName}-${key}" 
                                    data-group="${groupName}" 
                                    name="${key}" 
                                    rows="5"
                                    placeholder="Enter template content here...">${templateValue}</textarea>
                                ${placeholderHint}
                            </div>
                        </div>
                    </div>`;
            }

            function categorizeTemplates(templates) {
                const categorized = {
                    notification: {},
                    wifi: {},
                    response: {},
                    customer: {},
                    payment: {},
                    ticket: {},
                    command: {},
                    error: {},
                    success: {},
                    system: {},
                    menu: {},
                    report: {}
                };

                // Reset counts
                Object.keys(templateCounts).forEach(key => templateCounts[key] = 0);

                // Categorize notification templates
                // IMPORTANT: Templates are only categorized for display, they remain in notificationTemplates
                if (templates.notificationTemplates) {
                    for (const [key, value] of Object.entries(templates.notificationTemplates)) {
                        // Check for payment/invoice keywords first (more specific)
                        if (key.includes('payment') || key.includes('invoice') || key.includes('tagihan') || key.includes('bayar')) {
                            categorized.payment[key] = value;
                            templateCounts.payment++;
                        } 
                        // Check for ticket/lapor keywords
                        else if (key.includes('ticket') || key.includes('lapor') || key.includes('report')) {
                            categorized.ticket[key] = value;
                            templateCounts.ticket++;
                        } 
                        // Default to notification category
                        else {
                            categorized.notification[key] = value;
                            templateCounts.notification++;
                        }
                    }
                }

                // WiFi menu templates
                if (templates.wifiMenuTemplates) {
                    categorized.wifi = templates.wifiMenuTemplates;
                    templateCounts.wifi = Object.keys(templates.wifiMenuTemplates).length;
                }

                // Response templates
                // IMPORTANT: Templates are only categorized for display, they remain in responseTemplates
                if (templates.responseTemplates) {
                    for (const [key, value] of Object.entries(templates.responseTemplates)) {
                        // Check for customer/pelanggan/user keywords first (most specific)
                        if (key.includes('customer') || key.includes('pelanggan') || key.includes('user') || key.includes('welcome')) {
                            categorized.customer[key] = value;
                            templateCounts.customer++;
                        } 
                        // Check for payment/bayar/tagihan keywords
                        else if (key.includes('payment') || key.includes('bayar') || key.includes('tagihan') || key.includes('invoice')) {
                            categorized.payment[key] = value;
                            templateCounts.payment++;
                        } 
                        // Check for ticket/lapor keywords
                        else if (key.includes('ticket') || key.includes('lapor') || key.includes('report')) {
                            categorized.ticket[key] = value;
                            templateCounts.ticket++;
                        } 
                        // Default to response category
                        else {
                            categorized.response[key] = value;
                            templateCounts.response++;
                        }
                    }
                }

                // Command templates
                if (templates.commandTemplates) {
                    categorized.command = templates.commandTemplates;
                    templateCounts.command = Object.keys(templates.commandTemplates).length;
                }

                // Error templates
                if (templates.errorTemplates) {
                    categorized.error = templates.errorTemplates;
                    templateCounts.error = Object.keys(templates.errorTemplates).length;
                }

                // Success templates
                if (templates.successTemplates) {
                    categorized.success = templates.successTemplates;
                    templateCounts.success = Object.keys(templates.successTemplates).length;
                }

                // System templates
                if (templates.systemTemplates) {
                    categorized.system = templates.systemTemplates;
                    templateCounts.system = Object.keys(templates.systemTemplates).length;
                }

                // Menu templates
                if (templates.menuTemplates) {
                    categorized.menu = templates.menuTemplates;
                    templateCounts.menu = Object.keys(templates.menuTemplates).length;
                }

                // Report templates
                if (templates.reportTemplates) {
                    categorized.report = templates.reportTemplates;
                    templateCounts.report = Object.keys(templates.reportTemplates).length;
                }

                return categorized;
            }

            function renderTemplates(category, templates) {
                const container = $(`#${category}Templates`);
                container.empty();

                if (Object.keys(templates).length === 0) {
                    container.html(`
                        <div class="col-12">
                            <div class="alert alert-info">
                                <i class="fas fa-info-circle"></i> No templates found in this category.
                            </div>
                        </div>
                    `);
                    return;
                }

                for (const [key, value] of Object.entries(templates)) {
                    container.append(renderTemplateCard(key, value, category));
                }
            }

            function updateBadges() {
                Object.keys(templateCounts).forEach(category => {
                    $(`#${category}-count`).text(templateCounts[category]);
                });
            }

            function loadTemplates() {
                // Show loading in all tabs
                $('.template-grid').each(function() {
                    $(this).html(`
                        <div class="text-center p-5">
                            <div class="spinner-border text-primary" role="status">
                                <span class="sr-only">Loading...</span>
                            </div>
                            <p class="mt-3">Loading templates...</p>
                        </div>
                    `);
                });

                fetch('/api/templates', { credentials: 'include' })
                    .then(response => {
                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }
                        return response.json();
                    })
                    .then(result => {
                        if (result.status !== 200 || typeof result.data !== 'object') {
                            throw new Error(result.message || 'Invalid data format from server.');
                        }
                        
                        allTemplatesData = result.data;
                        const categorized = categorizeTemplates(allTemplatesData);
                        
                        // Render each category
                        Object.keys(categorized).forEach(category => {
                            renderTemplates(category, categorized[category]);
                        });
                        
                        // Update badges
                        updateBadges();
                    })
                    .catch(error => {
                        console.error('Error loading templates:', error);
                        $('.template-grid').html('<div class="alert alert-danger">Failed to load templates. Please try refreshing the page.</div>');
                    });
            }

            // Search functionality
            $('#templateSearch').on('input', function() {
                const searchTerm = $(this).val().toLowerCase();
                
                if (searchTerm === '') {
                    $('.template-card').show();
                } else {
                    $('.template-card').each(function() {
                        const card = $(this);
                        const key = card.data('template-key');
                        const headerText = card.find('.card-header').text().toLowerCase();
                        const textareaContent = card.find('textarea').val().toLowerCase();
                        
                        if (key.includes(searchTerm) || headerText.includes(searchTerm) || textareaContent.includes(searchTerm)) {
                            card.show();
                        } else {
                            card.hide();
                        }
                    });
                }
            });

            // Load templates on page load
            loadTemplates();
            
            // Make loadTemplates available globally for reload button
            window.loadTemplates = loadTemplates;

            function buildTemplatePayloadEntry(sourceEntry, headerText, templateText) {
                if (sourceEntry && typeof sourceEntry === 'object' && !Array.isArray(sourceEntry)) {
                    return {
                        ...sourceEntry,
                        name: sourceEntry.name || headerText,
                        template: templateText
                    };
                }

                return {
                    name: headerText,
                    template: templateText
                };
            }

            // Form submission
            form.on('submit', function(event) {
                event.preventDefault();
                const submitButton = $(this).find('button[type="submit"]');
                const originalButtonText = submitButton.html();
                submitButton.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Saving...');

                const payload = {
                    notificationTemplates: {},
                    wifiMenuTemplates: {},
                    responseTemplates: {},
                    commandTemplates: {},
                    errorTemplates: {},
                    successTemplates: {},
                    systemTemplates: {},
                    menuTemplates: {},
                    reportTemplates: {}
                };

                // Collect all textarea values
                // IMPORTANT: Map categories back to original source files to prevent duplication
                const processedKeys = new Set(); // Track target file + key to prevent same-source duplicates
                
                $('.template-card').each(function() {
                    const card = $(this);
                    const textarea = card.find('textarea');
                    const key = textarea.attr('name');
                    const group = textarea.data('group');
                    const value = textarea.val();
                    
                    if (!key || !value) return;
                    
                    // Map categories back to original source files
                    // Templates are categorized for display only, but saved to their original source
                    let targetGroup = null;
                    if (group === 'notification' || group === 'ticket' || group === 'payment') {
                        // Check if key exists in original notificationTemplates
                        if (allTemplatesData.notificationTemplates && allTemplatesData.notificationTemplates[key]) {
                            targetGroup = 'notificationTemplates';
                        } else if (allTemplatesData.responseTemplates && allTemplatesData.responseTemplates[key]) {
                            targetGroup = 'responseTemplates';
                        } else {
                            // Default: if categorized as notification/ticket/payment, save to notificationTemplates
                            targetGroup = 'notificationTemplates';
                        }
                    } else if (group === 'wifi') {
                        targetGroup = 'wifiMenuTemplates';
                    } else if (group === 'response' || group === 'customer') {
                        // Check if key exists in original responseTemplates
                        if (allTemplatesData.responseTemplates && allTemplatesData.responseTemplates[key]) {
                            targetGroup = 'responseTemplates';
                        } else if (allTemplatesData.notificationTemplates && allTemplatesData.notificationTemplates[key]) {
                            targetGroup = 'notificationTemplates';
                        } else {
                            // Default: if categorized as response/customer, save to responseTemplates
                            targetGroup = 'responseTemplates';
                        }
                    } else if (group === 'command') {
                        targetGroup = 'commandTemplates';
                    } else if (group === 'error') {
                        targetGroup = 'errorTemplates';
                    } else if (group === 'success') {
                        targetGroup = 'successTemplates';
                    } else if (group === 'system') {
                        targetGroup = 'systemTemplates';
                    } else if (group === 'menu') {
                        targetGroup = 'menuTemplates';
                    } else if (group === 'report') {
                        targetGroup = 'reportTemplates';
                    }
                    
                    if (targetGroup) {
                        const processedKey = `${targetGroup}:${key}`;
                        if (processedKeys.has(processedKey)) {
                            console.warn(`[TEMPLATES] Duplicate key detected: ${key} in ${targetGroup}. Skipping duplicate.`);
                            return;
                        }
                        processedKeys.add(processedKey);

                        if (targetGroup === 'wifiMenuTemplates') {
                            payload[targetGroup][key] = value;
                        } else {
                            const headerText = card.find('.card-header span.font-weight-bold').text().trim();
                            const originalEntry = allTemplatesData[targetGroup] && allTemplatesData[targetGroup][key];
                            payload[targetGroup][key] = buildTemplatePayloadEntry(originalEntry, headerText, value);
                        }
                    }
                });

                fetch('/api/templates', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include', // ✅ Fixed by script
                    body: JSON.stringify(payload)
                })
                .then(response => response.json().then(data => ({ ok: response.ok, data })))
                .then(result => {
                    if (result.ok) {
                        showToast('Templates saved successfully!', 'success');
                    } else {
                        throw new Error(result.data.message || 'An unknown error occurred.');
                    }
                })
                .catch(error => {
                    console.error('Error saving templates:', error);
                    showToast(`Error saving templates: ${error.message}`, 'danger');
                })
                .finally(() => {
                    submitButton.prop('disabled', false).html(originalButtonText);
                });
            });
        });
