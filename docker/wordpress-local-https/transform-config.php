<?php

declare(strict_types=1);

function gq_local_https_transform_configuration(string $source): string
{
    $overrides = [
        'WP_HOME', 'WP_SITEURL', 'ABSPATH', 'FORCE_SSL_ADMIN', 'DISABLE_WP_CRON',
        'DISALLOW_FILE_MODS', 'GQ_GAME_ADMIN_STAGING_DB_CONFIG_FILE',
        'GQ_GAME_ADMIN_PRODUCTION_DB_CONFIG_FILE',
    ];
    $tokens = token_get_all($source);
    $result = '';
    for ($index = 0, $count = count($tokens); $index < $count; $index++) {
        $token = $tokens[$index];
        if (is_array($token) && $token[0] === T_STRING && strtolower($token[1]) === 'define') {
            $end = $index + 1;
            while ($end < $count && is_array($tokens[$end]) && $tokens[$end][0] === T_WHITESPACE) {
                $end++;
            }
            $argument = $end + 1;
            while ($argument < $count && is_array($tokens[$argument]) && $tokens[$argument][0] === T_WHITESPACE) {
                $argument++;
            }
            $name = $tokens[$argument] ?? null;
            if (
                ($tokens[$end] ?? null) === '('
                && is_array($name) && $name[0] === T_CONSTANT_ENCAPSED_STRING
                && in_array(substr($name[1], 1, -1), $overrides, true)
            ) {
                $depth = 0;
                for (; $end < $count; $end++) {
                    if ($tokens[$end] === '(') {
                        $depth++;
                    } elseif ($tokens[$end] === ')' && --$depth === 0) {
                        break;
                    }
                }
                if ($end === $count) {
                    throw new RuntimeException('Unsupported local WordPress configuration.');
                }
                $result .= 'true';
                $index = $end;
                continue;
            }
        }
        $result .= is_array($token) ? $token[1] : $token;
    }
    return $result;
}
