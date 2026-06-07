<?php
include __DIR__ . '/_role_shell.php';

if (!empty($shellRoleContext['isAdminLike'])) {
    include __DIR__ . '/topbar.php';
    echo '<span id="loggedInTechnicianInfo" class="d-none"></span>';
    return;
}
?>
<nav class="navbar navbar-expand navbar-light bg-white topbar mb-4 static-top shadow">
    <button type="button" id="sidebarToggleTop" class="btn btn-link d-md-none rounded-circle mr-3">
        <i class="fa fa-bars"></i>
    </button>
    <ul class="navbar-nav ml-auto align-items-center">
        <li class="nav-item mr-1">
            <button type="button" id="tkThemeToggle" class="tk-theme-toggle" title="Mode gelap / terang" aria-label="Ganti mode gelap/terang">
                <i class="fas fa-moon"></i>
            </button>
        </li>
        <li class="nav-item dropdown no-arrow">
            <a class="nav-link dropdown-toggle" href="#" id="userDropdown" role="button" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                <span id="loggedInTechnicianInfo" class="mr-2 text-gray-600 small">Memuat nama...</span>
                <img class="img-profile rounded-circle" src="/img/undraw_profile.svg">
            </a>
            <div class="dropdown-menu dropdown-menu-right shadow animated--grow-in" aria-labelledby="userDropdown">
                <a class="dropdown-item" href="#" data-toggle="modal" data-target="#logoutModal">
                    <i class="fas fa-sign-out-alt fa-sm fa-fw mr-2 text-gray-400"></i>
                    Logout
                </a>
            </div>
        </li>
    </ul>
</nav>
<script>
// Populate the logged-in technician name in the topbar for every teknisi page.
(function () {
    fetch('/api/me', { credentials: 'include' })
        .then(function (res) { return res.json(); })
        .then(function (data) {
            if (data && data.status === 200 && data.data && data.data.name) {
                document.querySelectorAll('#loggedInTechnicianInfo').forEach(function (el) {
                    el.textContent = data.data.name;
                });
            }
        })
        .catch(function () { /* leave placeholder on failure */ });
})();

// Safeguard against Bootstrap 4 stacked-modal scroll bug: when one modal hides
// while another is still open, BS4 strips `modal-open` from <body>, breaking the
// remaining modal's scroll lock on mobile. Re-assert it. (Runs once jQuery is ready.)
window.addEventListener('load', function () {
    if (!window.jQuery) { return; }
    window.jQuery(document).on('hidden.bs.modal', function () {
        if (window.jQuery('.modal.show').length) {
            window.jQuery('body').addClass('modal-open');
        }
    });
});
</script>
<script src="/js/theme.js"></script>
