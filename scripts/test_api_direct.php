<?php
// Direct test of vessel_designs API without going through HTTP

$_SERVER['REQUEST_METHOD'] = 'POST';
$_SERVER['REQUEST_URI'] = '/api/wireframe_designs';
$_SERVER['SCRIPT_FILENAME'] = '/var/www/html/api/vessel_designs.php';
$_GET['wireframe'] = 1;
$_POST = [];

// Mock input
$input = json_encode([
    'name' => 'Test Design',
    'description' => 'Test wireframe',
    'vertices' => [['id' => 'v0', 'position' => ['x' => 0, 'y' => 0, 'z' => 0], 'components' => []]],
    'edges' => [],
    'faces' => [],
    'components' => []
]);

// Override php://input
stream_wrapper_unregister('php');
stream_wrapper_register('php', 'TestPhpWrapper');

class TestPhpWrapper {
    public static $input = '';
    public function stream_open($path, $mode, $options, &$opened_path) { return true; }
    public function stream_read($count) { 
        if (empty(self::$input)) return false;
        $r = substr(self::$input, 0, $count);
        self::$input = substr(self::$input, $count);
        return $r;
    }
    public function stream_eof() { return empty(self::$input); }
}

TestPhpWrapper::$input = $input;

// Include the actual API
include '/var/www/html/api/vessel_designs.php';
