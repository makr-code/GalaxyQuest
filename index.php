<?php
/**
 * index.php – Main application entry point
 * 
 * Processes template variables and serves index.html with dynamic content
 */

// Require template renderer
require_once __DIR__ . '/lib/template-renderer.php';

// Determine build information
$buildInfo = getBuildInfo();

// Extract static index.html
$indexPath = __DIR__ . '/index.html';
if (!is_file($indexPath)) {
  http_response_code(500);
  die('index.html not found');
}

$html = file_get_contents($indexPath);

// Render template variables
$html = renderTemplate($html, $buildInfo);

// Set content type and headers
header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
header('Expires: 0');

// Output rendered HTML
echo $html;
