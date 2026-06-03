<?php

class DotEnv {
    public function load($path) {
        $lines = file($path . '/.env');
        foreach ($lines as $line) {
            if (strpos(trim($line), '#') === 0) continue; // Abaikan komentar
            list($key, $value) = explode('=', trim($line), 2);
            putenv(sprintf('%s=%s', trim($key), trim($value)));
            $_ENV[trim($key)] = trim($value);
            $_SERVER[trim($key)] = trim($value);
        }
    }
}