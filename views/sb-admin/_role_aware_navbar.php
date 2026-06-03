<?php
include __DIR__ . '/_role_shell.php';

if (!empty($shellRoleContext['isAdminLike'])) {
    include __DIR__ . '/_navbar.php';
} else {
    include __DIR__ . '/_navbar_teknisi.php';
}
