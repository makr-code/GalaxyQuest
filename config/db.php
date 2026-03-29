<?php
require_once __DIR__ . '/config.php';

/**
 * PDOStatement subclass that logs queries exceeding SLOW_QUERY_THRESHOLD_MS to error_log.
 * Installed automatically via PDO::ATTR_STATEMENT_CLASS — no call-site changes required.
 */
class LoggingStatement extends PDOStatement
{
    // PDOStatement's constructor is hidden; the subclass constructor must be protected.
    protected function __construct() {}

    public function execute(?array $params = null): bool
    {
        $t0     = hrtime(true);
        $result = parent::execute($params);
        $ms     = (hrtime(true) - $t0) / 1e6;

        if ($ms >= SLOW_QUERY_THRESHOLD_MS) {
            error_log(sprintf(
                '[GQ slow-query %.1fms] %s',
                $ms,
                preg_replace('/\s+/', ' ', (string)$this->queryString)
            ));
        }

        return $result;
    }
}

function get_db(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = 'mysql:host=' . DB_HOST . ';port=' . DB_PORT
             . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET;
        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
            PDO::ATTR_STATEMENT_CLASS    => [LoggingStatement::class, []],
        ];
        $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
    }
    return $pdo;
}
