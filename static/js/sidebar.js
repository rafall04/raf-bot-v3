/* sidebar.js — perilaku sidebar SB Admin BERSAMA (search menu + filter heading + mobile). Diekstrak
   dari _navbar.php (kanonik admin). Include via <script src rafAssetUrl('/js/sidebar.js')>. Boundary #b126. */
document.addEventListener('DOMContentLoaded', function () {
    const sidebar = document.getElementById('accordionSidebar');
    const closeButton = document.getElementById('mobileSidebarClose');
    if (!sidebar) {
        return;
    }

    const closeMobileSidebar = function () {
        if (window.innerWidth > 767.98) {
            return;
        }
        document.body.classList.remove('sidebar-toggled');
        sidebar.classList.add('toggled');
    };

    const closeMobileDrawerAndCollapse = function () {
        closeMobileSidebar();
        const openPanels = sidebar.querySelectorAll('.collapse.show');
        openPanels.forEach(function (panel) {
            const trigger = sidebar.querySelector('[data-target="#' + panel.id + '"]');
            if (trigger && trigger.getAttribute('aria-expanded') === 'true' && !trigger.closest('.nav-item.active')) {
                $(panel).collapse('hide');
            }
        });
    };

    const handleResize = function () {
        if (window.innerWidth > 767.98) {
            // Desktop: just clean up the mobile-drawer body class. Do NOT touch
            // sidebar.toggled here because the user may have manually collapsed it
            // (sb-admin-2's #sidebarToggle button toggles that class).
            document.body.classList.remove('sidebar-toggled');
        } else if (!document.body.classList.contains('sidebar-toggled')) {
            sidebar.classList.add('toggled');
        }
    };

    // One-time cleanup on initial load: sb-admin-2.js auto-adds `.toggled` at
    // <480px during render and never restores it on desktop. Wipe the stuck
    // state so a fresh desktop load always shows an expanded sidebar. (We don't
    // do this on resize events to preserve user manual collapse.)
    const cleanupInitialToggleStuck = function () {
        if (window.innerWidth > 767.98) {
            document.body.classList.remove('sidebar-toggled');
            sidebar.classList.remove('toggled');
        }
    };

    document.addEventListener('click', function (event) {
        if (window.innerWidth > 767.98 || !document.body.classList.contains('sidebar-toggled')) {
            return;
        }

        const topToggle = document.getElementById('sidebarToggleTop');
        const sideToggle = document.getElementById('sidebarToggle');
        const clickedToggle = (topToggle && topToggle.contains(event.target)) || (sideToggle && sideToggle.contains(event.target));

        if (clickedToggle || sidebar.contains(event.target)) {
            return;
        }

        closeMobileSidebar();
    });

    if (closeButton) {
        closeButton.addEventListener('click', closeMobileSidebar);
    }

    sidebar.querySelectorAll('.collapse-item[href], .nav-link[href]:not([data-toggle="collapse"])').forEach(function (link) {
        link.addEventListener('click', function () {
            closeMobileDrawerAndCollapse();
        });
    });

    window.addEventListener('resize', handleResize);
    handleResize();
    // Initial-load cleanup (separate from resize) — wins the race against
    // sb-admin-2.js which may add `.toggled` at <480px during early render.
    cleanupInitialToggleStuck();
    setTimeout(cleanupInitialToggleStuck, 50);
    setTimeout(cleanupInitialToggleStuck, 250);

    // -------------------------------------------------------------
    // Live menu search filter (>=50 menus on admin sidebar).
    // -------------------------------------------------------------
    const searchInput = document.getElementById('sidebarMenuSearch');
    const searchClear = document.getElementById('sidebarMenuSearchClear');
    const searchEmpty = document.getElementById('sidebarMenuSearchEmpty');
    if (searchInput) {
        // Open submenus during search so matches are visible immediately.
        const navItems = Array.from(sidebar.querySelectorAll('li.nav-item:not(.sidebar-search)'));
        const headings = Array.from(sidebar.querySelectorAll('.sidebar-heading'));

        function normalise(s) { return (s || '').toLowerCase().trim(); }

        function applyFilter(q) {
            q = normalise(q);
            const active = q.length > 0;
            document.body.classList.toggle('sidebar-search-active', active);
            searchClear.hidden = !active;

            // headings always hidden during search (we lift items into a flat list visually)
            headings.forEach(h => h.classList.toggle('is-filtered', active));

            let totalVisible = 0;
            navItems.forEach(item => {
                const link = item.querySelector(':scope > .nav-link');
                const linkText = normalise(link ? link.textContent : '');
                const childItems = Array.from(item.querySelectorAll('.collapse-item'));

                if (!active) {
                    item.classList.remove('is-filtered');
                    childItems.forEach(ci => ci.classList.remove('is-filtered'));
                    return;
                }

                const parentMatch = linkText.includes(q);
                let childMatchCount = 0;
                childItems.forEach(ci => {
                    const m = normalise(ci.textContent).includes(q);
                    ci.classList.toggle('is-filtered', !m && !parentMatch);
                    if (m || parentMatch) childMatchCount++;
                });

                const itemHasChildren = childItems.length > 0;
                const itemVisible = parentMatch || childMatchCount > 0;
                item.classList.toggle('is-filtered', !itemVisible);
                if (itemVisible) totalVisible++;
                // If parent itself matched, reveal all its children too
                if (itemVisible && parentMatch && itemHasChildren) {
                    childItems.forEach(ci => ci.classList.remove('is-filtered'));
                }
            });

            searchEmpty.hidden = !(active && totalVisible === 0);
        }

        let debounceId = null;
        searchInput.addEventListener('input', function () {
            const v = searchInput.value;
            clearTimeout(debounceId);
            debounceId = setTimeout(() => applyFilter(v), 60);
        });
        searchInput.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { searchInput.value = ''; applyFilter(''); searchInput.blur(); }
        });
        searchClear.addEventListener('click', function () {
            searchInput.value = ''; applyFilter(''); searchInput.focus();
        });
    }
});
